// Reference chunking + per-section selection.
//
// Why this exists: a 60-page reference DOCX inlined into every
// per-section drafting prompt is wasteful. Each section only needs
// the salient parts. We chunk the reference once and then, at draft
// time, select the most relevant chunks per section against a budget.
//
// Two chunking strategies are supported:
//
//   1. naiveChunkText() — paragraph-based windowing. ~5k chars per
//      chunk. Free, deterministic, runs entirely in the browser. Used
//      as a fallback when the user hasn't explicitly chunked a file.
//
//   2. semanticChunkFile() — single LLM call that returns a list of
//      semantically-coherent chunks with titles and summaries. The
//      titles and summaries are what relevance scoring scores against,
//      so quality matters here. Stored permanently on the file record.
//
// Selection (selectChunksForSection) is currently a token-overlap
// heuristic: tokenize the section's anchor query (intent + name +
// project subject) and the chunk's title+summary, score by Jaccard
// overlap, return the top-K up to a per-section character budget. No
// extra LLM call per section. Future iteration could swap the
// heuristic for an LLM-based selection pass.

import type { LLMClient } from '../provider/types';
import type { BodyFillRegion } from '../template/types';
import type { ProjectContextFile, ReferenceChunk } from '../db/schema';
import type { SectionSizeClass } from '../draft/section_size';
import { type UsageByModel, recordUsage } from '../usage';

/** Default per-chunk size in characters for naive chunking. */
export const NAIVE_CHUNK_SIZE_CHARS = 5_000;
/** Overlap between adjacent naive chunks (helps continuity). */
export const NAIVE_CHUNK_OVERLAP_CHARS = 400;

/**
 * Per-section reference budget by size class. Replaces the old flat
 * 120k-char budget that effectively passed every chunk to every
 * section regardless of how much output was actually expected — the
 * regression that burned a month's tokens drafting a 7-word
 * "Memorandum For" line. Each tuple is [max chars, max chunks]; the
 * greedy selector enforces both caps.
 */
export const SECTION_REF_BUDGETS: Record<
  SectionSizeClass,
  { maxChars: number; maxChunks: number }
> = {
  // inline_metadata sections never reach selectChunksForSection — they go
  // through the metadata batch drafter — but we still expose a budget for
  // completeness in case a caller needs it.
  inline_metadata: { maxChars: 1_500, maxChunks: 1 },
  short: { maxChars: 4_000, maxChunks: 2 },
  body: { maxChars: 15_000, maxChunks: 6 },
  long: { maxChars: 30_000, maxChunks: 12 },
};

/**
 * Legacy default kept for callers that haven't been updated to pass a
 * size class. Matches the old `body` budget so legacy behavior is the
 * standard prose path, not the runaway 120k cap.
 */
export const DEFAULT_SECTION_REF_BUDGET_CHARS = SECTION_REF_BUDGETS.body.maxChars;

// ─── Naive chunking ──────────────────────────────────────────────

/**
 * Split a long string into roughly fixed-size chunks on paragraph
 * boundaries (with a small overlap window for continuity). Used as
 * the fallback when a file hasn't been semantically chunked.
 *
 * The output isn't promoted to a `ReferenceChunk` because there's no
 * meaningful title/summary to score against — relevance scoring
 * against naive chunks falls back to scoring against the chunk's own
 * text.
 */
export function naiveChunkText(
  text: string,
  targetSize: number = NAIVE_CHUNK_SIZE_CHARS,
  overlap: number = NAIVE_CHUNK_OVERLAP_CHARS,
): string[] {
  if (text.length === 0) return [];
  if (text.length <= targetSize) return [text];

  // Split on paragraph boundaries first; merge until each window
  // hits target_size. Add overlap by including the last `overlap`
  // chars of the previous chunk at the start of the next.
  const paragraphs = text.split(/\n\s*\n/);
  const chunks: string[] = [];
  let current = '';

  for (const para of paragraphs) {
    if (current.length + para.length + 2 > targetSize && current.length > 0) {
      chunks.push(current);
      // Carry overlap from the tail of the previous chunk.
      current = current.slice(Math.max(0, current.length - overlap)) + '\n\n' + para;
    } else {
      current = current.length > 0 ? `${current}\n\n${para}` : para;
    }
  }
  if (current.length > 0) chunks.push(current);

  // If a single paragraph blew through targetSize, hard-split it on
  // sentence boundaries (or character windows as a last resort).
  const final: string[] = [];
  for (const c of chunks) {
    if (c.length <= targetSize * 1.5) {
      final.push(c);
      continue;
    }
    final.push(...hardSplit(c, targetSize, overlap));
  }
  return final;
}

function hardSplit(text: string, size: number, overlap: number): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    out.push(text.slice(i, i + size));
    i += size - overlap;
  }
  return out;
}

// ─── Semantic chunking via LLM ───────────────────────────────────

const SEMANTIC_CHUNK_SYSTEM_PROMPT = `You split a reference document into SEMANTICALLY COHERENT chunks suitable for retrieval-augmented drafting. Each chunk should be self-contained — a reader who saw only that chunk should still understand its topic and intent.

OUTPUT — strict JSON only, no markdown code fences, no commentary:
{
  "chunks": [
    {
      "title": "<short human-readable label, e.g. '2.1 Period of Performance'>",
      "summary": "<one full sentence describing what the chunk says, used for downstream relevance scoring against drafting sections>",
      "text": "<verbatim text of the chunk; preserve original wording, do not paraphrase>"
    }
  ]
}

GUIDANCE:
- Aim for 5-30 chunks per document. Very short docs may have just 2-3.
- Each chunk should be ~500-3000 words. Smaller is fine for short structured items (POC blocks, definition lists). Larger only when the content is one coherent block (a whole subsection, a contiguous procedure).
- Respect natural document structure: numbered subsections, headings, bullet groups, tables, signature blocks. Do NOT split across natural boundaries unless the resulting chunk would be much too large.
- title: 5-10 words. Include the section number if the document uses one. Make it specific enough to disambiguate from other chunks ("3.2 Contractor Quality Control" not "Quality").
- summary: ONE full sentence. Mention the SUBJECT MATTER concretely so a relevance scorer can match it to a drafting section's intent. Bad: "This chunk describes responsibilities." Good: "Defines the COR's authority to inspect contractor deliverables and issue corrective action requests during the period of performance."
- text: verbatim. Preserve numbers, acronyms, dates, names exactly as written. Do not summarize or rephrase the body — that's what the summary field is for.

Return STRICT JSON only.`;

interface SemanticChunkOutput {
  chunks: Array<{
    title?: string;
    summary?: string;
    text?: string;
  }>;
}

export interface SemanticChunkResult {
  chunks: ReferenceChunk[];
  tokens_in: number;
  tokens_out: number;
  /** Per-model usage breakdown. Single entry — the chunker model. */
  usage_by_model: UsageByModel;
  /** Model id used for the chunking call. */
  model: string;
}

/**
 * Run an LLM pass to chunk an extracted reference document. Returns
 * the chunks plus token usage so the recipe runner can roll the cost
 * into its per-stage totals (this used to be invisible, which made the
 * recipe history report ~0 tokens for documents that were actually
 * burning thousands on chunking). Throws on parse failure (the caller
 * renders the error as a toast — no automatic fallback).
 */
export async function semanticChunkText(
  client: LLMClient,
  text: string,
  opts: { model?: string; sourceLabel?: string } = {},
): Promise<SemanticChunkResult> {
  const message = `Reference document${opts.sourceLabel ? ` (${opts.sourceLabel})` : ''}:\n\n${text}\n\nNow split this into semantically coherent chunks per the system prompt. Return STRICT JSON.`;
  const { data, raw } = await client.queryJson<SemanticChunkOutput>({
    message,
    system_prompt: SEMANTIC_CHUNK_SYSTEM_PROMPT,
    model: opts.model,
    dataset: 'none',
    temperature: 0,
    usage: true,
  });
  const out: ReferenceChunk[] = [];
  let i = 0;
  for (const c of data.chunks ?? []) {
    if (!c || typeof c !== 'object') continue;
    const text = typeof c.text === 'string' ? c.text.trim() : '';
    if (!text) continue;
    out.push({
      id: `chunk_${i++}_${Date.now().toString(36)}`,
      title: typeof c.title === 'string' ? c.title.trim() : `Chunk ${i}`,
      summary: typeof c.summary === 'string' ? c.summary.trim() : '',
      text,
    });
  }
  if (out.length === 0) {
    throw new Error(
      'LLM returned no usable chunks. Check the audit log for the raw response — the model may have rejected the document or returned an empty array.',
    );
  }
  const usage = (raw.usage as { prompt_tokens?: number; completion_tokens?: number }) ?? {};
  const tokens_in = usage.prompt_tokens ?? 0;
  const tokens_out = usage.completion_tokens ?? 0;
  // semanticChunkText accepts an optional `opts.model`; when omitted
  // the LLMClient picks its provider default. We don't have a way to
  // know which id the client actually sent (it isn't echoed in the
  // response), so attribute under the explicit override or 'unknown'.
  const recordedModel = opts.model ?? 'unknown';
  const usage_by_model: UsageByModel = {};
  recordUsage(usage_by_model, recordedModel, {
    tokens_in,
    tokens_out,
    web_search_results: raw.web_search_results,
  });
  return {
    chunks: out,
    tokens_in,
    tokens_out,
    usage_by_model,
    model: recordedModel,
  };
}

// ─── Per-section selection ───────────────────────────────────────

export interface SelectedChunk {
  source_file: string;
  source_file_id: string;
  chunk_id: string;
  title: string;
  text: string;
  /** Relevance score from the heuristic, for diagnostics */
  score: number;
}

/**
 * Build a per-section selection of chunks across every reference
 * file. The orchestrator calls this once per section and inlines the
 * resulting chunks into that section's drafting prompt.
 *
 * Strategy:
 *   1. Build a query string from section.name + section.intent +
 *      template_example. We deliberately do NOT mix in
 *      project_description here — every section in a project would
 *      otherwise pull the same project-subject-flavored chunks
 *      regardless of what that specific section is actually about,
 *      defeating per-section relevance. The project subject still
 *      reaches the LLM via the SUBJECT block of the drafting prompt.
 *   2. For each chunk in each file, score relevance via token-overlap
 *      between the query and the chunk's title+summary (or, for
 *      naive chunks without summaries, against the chunk's own text).
 *   3. Sort chunks across all files by descending score, drop chunks
 *      with score == 0 (unless that would leave the section with no
 *      chunks at all — always keep at least the highest scorer).
 *   4. Greedy-select until either the char budget OR the chunk-count
 *      cap is hit. Both caps come from SECTION_REF_BUDGETS keyed by
 *      the section's size_class so a 7-word "Memorandum For" line
 *      doesn't drag in a 28k-token reference doc.
 *
 * Returns chunks in source-document order so the prompt reads naturally.
 */
export function selectChunksForSection(args: {
  files: ProjectContextFile[];
  /**
   * Map from file id → extracted text (the orchestrator's
   * once-per-run extraction cache). Used to fall back to naive
   * chunking when a file has no `chunks` field set.
   */
  extractedById: Map<string, string>;
  section: BodyFillRegion;
  /**
   * Sliced template example for this section (the actual paragraphs
   * the section occupies in the source DOCX). The strongest signal
   * for what the section is "about" — used as the primary scoring
   * query so chunks match the section's content rather than the
   * project's overall subject.
   */
  template_example?: string | null;
  /**
   * Size bucket for this section. Determines both the char budget
   * and the chunk-count cap. Required so callers explicitly pick a
   * tier instead of falling into the runaway 120k default.
   */
  size_class: SectionSizeClass;
  /** Optional override for the char budget (defaults to size_class). */
  budget_chars?: number;
  /** Optional override for the chunk-count cap (defaults to size_class). */
  max_chunks?: number;
  /**
   * Chunk ids the upstream mapper says belong to this section. They
   * bypass the relevance score floor and are always included first
   * (in source-document order), up to the char budget. Remaining
   * slots — both chunk count AND char budget — are then filled by
   * scored chunks. The mapper's matches are trusted because it had
   * the full chunk title+summary set in front of it; the Jaccard
   * heuristic is the fallback when the mapper had nothing useful to
   * say (no references, or use_template_only).
   */
  preferred_chunk_ids?: string[];
}): SelectedChunk[] {
  const tier = SECTION_REF_BUDGETS[args.size_class];
  const budget = args.budget_chars ?? tier.maxChars;
  const maxChunks = args.max_chunks ?? tier.maxChunks;
  const preferred = new Set(args.preferred_chunk_ids ?? []);

  // 1. Build the query — section name + intent + template example.
  // Project description is intentionally excluded; see the docstring.
  const queryParts = [
    args.section.name,
    args.section.intent ?? '',
    args.template_example ?? '',
  ];
  const queryTokens = tokenize(queryParts.join(' '));

  // 2. Score every chunk in every file
  const scored: Array<SelectedChunk & { fileOrder: number; chunkOrder: number }> = [];
  let fileOrder = 0;
  for (const f of args.files) {
    const explicit = f.chunks ?? [];
    let chunks: ReferenceChunk[] = explicit;
    if (chunks.length === 0) {
      // Fallback: naive-chunk the file's extracted text on the fly.
      const text = args.extractedById.get(f.id) ?? '';
      if (!text) {
        fileOrder += 1;
        continue;
      }
      const naive = naiveChunkText(text);
      chunks = naive.map((t, i) => ({
        id: `${f.id}_naive_${i}`,
        title: `${f.filename} — chunk ${i + 1}/${naive.length}`,
        summary: '',
        text: t,
      }));
    }
    let chunkOrder = 0;
    for (const c of chunks) {
      const scoringText = c.summary && c.summary.length > 0 ? `${c.title}\n${c.summary}` : c.text;
      const score = jaccardScore(queryTokens, tokenize(scoringText));
      scored.push({
        source_file: f.filename,
        source_file_id: f.id,
        chunk_id: c.id,
        title: c.title,
        text: c.text,
        score,
        fileOrder,
        chunkOrder,
      });
      chunkOrder += 1;
    }
    fileOrder += 1;
  }

  // 3. Sort by score desc, then by source-document order as a tiebreaker
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.fileOrder !== b.fileOrder) return a.fileOrder - b.fileOrder;
    return a.chunkOrder - b.chunkOrder;
  });

  // 4. Greedy-select. First seat every preferred chunk (the upstream
  //    mapper said these belong to this section regardless of what
  //    the local Jaccard heuristic thinks). Then fill remaining slots
  //    by score, dropping score==0 chunks unless we'd otherwise have
  //    nothing at all. Both the char budget AND the chunk-count cap
  //    apply across preferred + scored fills — preferred chunks
  //    cannot blow the bucket on their own, but they DO bypass the
  //    score floor.
  const selected: SelectedChunk[] = [];
  const seenIds = new Set<string>();
  let used = 0;

  if (preferred.size > 0) {
    // Iterate `scored` so preferred chunks come out in source-document
    // order (the secondary sort) once score ties are broken — keeps
    // the rendered references block reading naturally.
    for (const s of scored) {
      if (!preferred.has(s.chunk_id)) continue;
      if (selected.length >= maxChunks) break;
      // Always include the FIRST preferred chunk even if it alone
      // exceeds the budget — same one-big-chunk-beats-zero rule that
      // applies to the score-based seed below.
      if (selected.length > 0 && used + s.text.length > budget) continue;
      selected.push(s);
      seenIds.add(s.chunk_id);
      used += s.text.length;
    }
  }

  for (const s of scored) {
    if (seenIds.has(s.chunk_id)) continue;
    if (selected.length === 0) {
      // Always seed with the top scorer regardless of score, so the
      // section never receives an empty references block when we have
      // any chunks at all and no preferred matches.
      selected.push(s);
      seenIds.add(s.chunk_id);
      used += s.text.length;
      continue;
    }
    if (s.score <= 0) continue;
    if (selected.length >= maxChunks) break;
    if (used + s.text.length > budget) continue;
    selected.push(s);
    seenIds.add(s.chunk_id);
    used += s.text.length;
  }

  // 5. Re-sort by source-document order so the prompt reads naturally
  selected.sort((a, b) => {
    const af = scored.findIndex((x) => x.chunk_id === a.chunk_id);
    const bf = scored.findIndex((x) => x.chunk_id === b.chunk_id);
    if (af === -1 || bf === -1) return 0;
    const sa = scored[af]!;
    const sb = scored[bf]!;
    if (sa.fileOrder !== sb.fileOrder) return sa.fileOrder - sb.fileOrder;
    return sa.chunkOrder - sb.chunkOrder;
  });

  return selected;
}

/**
 * Render a list of selected chunks as the ATTACHED REFERENCES block
 * for a single section's drafting prompt. Returns null if empty.
 */
export function renderSelectedChunks(
  selected: SelectedChunk[],
  totalAvailable: number,
): string | null {
  if (selected.length === 0) return null;
  const totalChars = selected.reduce((acc, s) => acc + s.text.length, 0);
  const lines: string[] = [];
  lines.push(
    `=== ATTACHED REFERENCES (${selected.length} of ${totalAvailable} chunk${totalAvailable === 1 ? '' : 's'} selected for relevance, ${totalChars.toLocaleString()} chars) ===`,
  );
  lines.push(
    `These are the most relevant chunks from the user's source documents for THIS section. Each chunk is labeled with its source file and a short title. Quote, paraphrase, and synthesize from them. Do NOT invent facts that aren't grounded here or in the SUBJECT statement above.`,
  );
  for (const s of selected) {
    lines.push(``);
    lines.push(`--- ${s.source_file} → ${s.title} (relevance ${s.score.toFixed(3)}) ---`);
    lines.push(s.text);
  }
  lines.push(`=== END ATTACHED REFERENCES ===`);
  return lines.join('\n');
}

// ─── Token-overlap scoring ───────────────────────────────────────

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'in', 'on', 'at', 'to', 'for',
  'with', 'by', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'should',
  'could', 'may', 'might', 'must', 'shall', 'can', 'this', 'that', 'these',
  'those', 'it', 'its', "it's", 'their', 'them', 'they', 'we', 'us', 'our',
  'you', 'your', 'i', 'me', 'my', 'he', 'she', 'him', 'her', 'his', 'from',
  'into', 'about', 'against', 'between', 'through', 'during', 'before',
  'after', 'above', 'below', 'than', 'then', 'so', 'such', 'if', 'no',
  'not', 'only', 'own', 'same', 'too', 'very', 's', 't', 'don', 'now',
  'each', 'few', 'more', 'most', 'other', 'some', 'any', 'all', 'one',
  'two', 'three', 'first', 'second', 'third', 'section', 'document',
]);

function tokenize(s: string): Set<string> {
  const out = new Set<string>();
  const lower = s.toLowerCase();
  // Match words of 3+ chars (alphanumeric + dash). Strip stopwords.
  const words = lower.match(/[a-z0-9][a-z0-9\-]{2,}/g) ?? [];
  for (const w of words) {
    if (STOPWORDS.has(w)) continue;
    out.add(w);
  }
  return out;
}

function jaccardScore(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersect = 0;
  for (const t of a) {
    if (b.has(t)) intersect += 1;
  }
  const union = a.size + b.size - intersect;
  return union === 0 ? 0 : intersect / union;
}

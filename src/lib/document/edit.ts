// Asks the LLM to review a finished document and propose surgical
// edits.
//
// Two important properties of this module:
//
//   1. Long documents are walked in SMALL OVERLAPPING WINDOWS so the
//      model can't get lazy and only edit the first chunk it sees.
//      Each window is its own /server/query call; ops are merged
//      into a single result. Empty per-chunk responses are silently
//      absorbed — they are NOT surfaced as toasts or rationale lines.
//
//   2. The cleanup pass can be GROUNDED with reference context: an
//      Ask Sage RAG dataset, web search (live=1|2), and/or attached
//      reference files that get extracted via /server/file and inlined
//      into every chunk's prompt. This mirrors the drafting pipeline.
//
// The model still emits the typed DocumentEditOp catalog. The writer
// validates indices and applies them surgically against the original
// DOCX, preserving every other formatting node.

import type { LLMClient } from '../provider/types';
import type { ParagraphInfo } from '../template/parser';
import type { ProjectContextFile } from '../db/schema';
import { AskSageClient } from '../asksage/client';
import { blobToFile, extractedTextFromRet } from '../asksage/extract';
import type { DocumentEditOp, DocumentEditOutput } from './types';
import { runProblemIdentificationPass, narrowChunkToFocus } from './prepass';

export const DEFAULT_DOCUMENT_EDIT_MODEL = 'google-claude-46-sonnet';

/**
 * Significant-paragraph window size for the chunked edit pass. Smaller
 * windows force the model to spend attention on every section of the
 * document — large windows let it summarize the body and miss edits
 * past the first ~third. Tune cautiously: too small and you waste
 * tokens on the system prompt + reference block per chunk.
 */
export const EDIT_CHUNK_SIZE = 40;

/**
 * Number of significant paragraphs that overlap between consecutive
 * windows. Gives the model continuity context (so a sentence that
 * spans a chunk boundary still has its lead-in visible) without
 * double-charging too many tokens. Ops on overlapped paragraphs are
 * de-duped at merge time.
 */
export const EDIT_CHUNK_OVERLAP = 5;

/** Per-reference-file character cap (≈2k tokens). */
const REFERENCE_FILE_CAP_CHARS = 8000;

const SYSTEM_PROMPT = `You are a careful editor reviewing a finished government document. Your job is to propose SURGICAL improvements ONLY — fix grammar, tighten wording, correct factual or formal errors, remove redundancy, and clean up obvious typos. You preserve the author's voice and intent and you NEVER rewrite paragraphs that are already clean.

You will be shown a CHUNK of the document at a time. Each paragraph is labeled with its absolute index in the full document (the same indices the writer uses to apply your edits). Even though you only see a window, you MUST still emit edits for any paragraph in this window that needs one — do not defer to "the next chunk" and do not rewrite the chunk wholesale.

You have a TYPED OP CATALOG you can emit. Pick the NARROWEST op for each change so the writer can preserve the maximum amount of surrounding formatting.

CRITICAL — UNDERSTAND WHAT A "RUN" IS BEFORE EMITTING replace_run_text
A "run" (<w:r> in OOXML) is a tiny formatting fragment, NOT a sentence or a paragraph. Word splits a paragraph into multiple runs whenever the formatting changes — at every bold span, italic span, hyperlink, font change, or color change. A typical paragraph has 1-10 runs. The DOCUMENT CHUNK below shows you each paragraph's runs explicitly with their actual text content. Read them carefully:
- A run with text "Procure and deploy " (note the trailing space) is ONLY 19 characters.
- If you want to rewrite "Procure and deploy " into "Procure and deploy a NAS/DAS/SAS enclosure in a RAID 6 configuration..." (380 characters), the rewrite SPANS the run boundary into the rest of the paragraph. The correct op is replace_paragraph_text — NOT replace_run_text with run_index 0.
- replace_run_text replaces ONLY that one tiny fragment. Whatever runs come after it stay in place. If you give it a new_text longer than the run, the surplus does NOT spill over — the writer leaves the rest of the paragraph stranded after your new content, producing visible duplication.

RULE: only use replace_run_text when your new_text is roughly the same length as the run's original text (give or take a few characters for typo fixes). For any rewrite that's substantially longer than the original run, use replace_paragraph_text. The system will auto-promote disproportionate replace_run_text ops to paragraph rewrites, but it's better to emit the right op the first time.

You output STRICT JSON only — no markdown code fences, no commentary outside the JSON:

{
  "edits": [ <op> , ... ]
}

OP CATALOG (pick the narrowest op that does the job):

TEXT
1. replace_paragraph_text — replace ALL visible text of one paragraph. Use this for any rewrite that spans more than one run.
   { "op": "replace_paragraph_text", "index": <int>, "new_text": "...", "rationale": "..." }

2. replace_run_text — replace ONE run's text. Use ONLY when the new text is comparable in length to the original run's text.
   { "op": "replace_run_text", "paragraph_index": <int>, "run_index": <int>, "new_text": "...", "rationale": "..." }

STRUCTURE
3. insert_paragraph_after — add a NEW paragraph after the given index. The new paragraph inherits formatting from the anchor unless you set style_id. Use this to add missing topic sentences, transitions, or signature blocks.
   { "op": "insert_paragraph_after", "index": <int>, "new_text": "...", "style_id": "<optional pStyle id>", "rationale": "..." }

4. merge_paragraphs — combine paragraph N with paragraph N+1. Use this to fix accidental fragmentation. The separator defaults to a single space; pass "" to concatenate without spacing.
   { "op": "merge_paragraphs", "index": <int>, "separator": " ", "rationale": "..." }

5. split_paragraph — break one paragraph into two at a verbatim substring. The substring becomes the start of the new (second) paragraph.
   { "op": "split_paragraph", "index": <int>, "split_at_text": "...", "rationale": "..." }

6. delete_paragraph — remove a paragraph entirely. Use sparingly; prefer replace_paragraph_text.
   { "op": "delete_paragraph", "index": <int>, "rationale": "..." }

PARAGRAPH FORMATTING
7. set_paragraph_style — change pStyle. Common ids: Normal, Heading1..6, BodyText, Quote, ListBullet, ListNumber.
   { "op": "set_paragraph_style", "index": <int>, "style_id": "<style id>", "rationale": "..." }

8. set_paragraph_alignment — left | center | right | justify | both.
   { "op": "set_paragraph_alignment", "index": <int>, "alignment": "left", "rationale": "..." }

9. set_paragraph_indent — set left, first-line, or hanging indent in twips (1440 twips = 1 inch). Pass null on a field to clear it. Omit a field to leave it unchanged.
   { "op": "set_paragraph_indent", "paragraph_index": <int>, "left_twips": 720, "first_line_twips": 360, "rationale": "..." }

10. set_paragraph_spacing — space before/after the paragraph (twips) and line spacing. line_value+line_rule together: rule "auto" with value 240 = single, 360 = 1.5x, 480 = double; rule "exact" or "atLeast" with value in twips. Pass null on a field to clear, omit to leave unchanged.
    { "op": "set_paragraph_spacing", "paragraph_index": <int>, "before_twips": 0, "after_twips": 240, "line_value": 360, "line_rule": "auto", "rationale": "..." }

RUN FORMATTING
11. set_run_property — toggle bold / italic / underline / strike on a run.
    { "op": "set_run_property", "paragraph_index": <int>, "run_index": <int>, "property": "bold", "value": true, "rationale": "..." }

12. set_run_font — change a run's font family and/or size. Pass null to clear; omit to leave unchanged.
    { "op": "set_run_font", "paragraph_index": <int>, "run_index": <int>, "family": "Times New Roman", "size_pt": 12, "rationale": "..." }

13. set_run_color — set a run's text color (hex without #) and/or highlight (palette name like "yellow", "green", "cyan"). Pass null to clear.
    { "op": "set_run_color", "paragraph_index": <int>, "run_index": <int>, "color": "FF0000", "highlight": null, "rationale": "..." }

TABLES
14. set_cell_text — replace one table cell's text.
    { "op": "set_cell_text", "table_index": <int>, "row_index": <int>, "cell_index": <int>, "new_text": "...", "rationale": "..." }

15. insert_table_row — clone a row and insert a new one after it.
    { "op": "insert_table_row", "table_index": <int>, "after_row_index": <int>, "cells": ["cell 1", "cell 2"], "rationale": "..." }

16. delete_table_row — remove a row from a table.
    { "op": "delete_table_row", "table_index": <int>, "row_index": <int>, "rationale": "..." }

CONTENT CONTROLS
17. set_content_control_value — update a Word content control by tag (CUI banner, document number, classification, dates).
    { "op": "set_content_control_value", "tag": "<sdt tag>", "value": "...", "rationale": "..." }

CRITICAL CONSTRAINTS:
- A clean chunk yields { "edits": [] }. Do not invent edits to look productive.
- All paragraph indices MUST refer to the exact integer labels shown in the DOCUMENT CHUNK below. Out-of-range indices are silently dropped.
- ONLY emit edits for paragraphs labeled "[edit]". Paragraphs labeled "[ctx]" are context lines from the previous/next window — read them but do NOT propose edits against them; they will be handled in their own window.
- replace_run_text new_text length must be COMPARABLE to the original run's text length. Use replace_paragraph_text for longer rewrites.
- Do NOT use markdown formatting (**, _, -). Inline formatting is encoded in run properties; use set_run_property and set_run_font and set_run_color.
- Preserve specialized terminology, acronyms, citations, dates, names, and section numbers exactly as written unless they are demonstrably wrong.
- If ATTACHED REFERENCES are provided, they are AUTHORITATIVE for facts, terminology, and citations — prefer the reference's wording over the draft's when they disagree on a verifiable fact.
- When you make an edit that was specifically justified by an ATTACHED REFERENCE, populate a \`references_used\` field on the op as an array of one or more entries:
    "references_used": [{ "source_filename": "<exact filename of the attached reference>", "excerpt": "<short verbatim excerpt of the passage you used, ~80 chars>", "rationale": "<one-line explanation of how this passage supports the edit>" }]
  Only populate this when the reference actually drove the edit. Do NOT cite a reference for generic grammar/typo fixes that have nothing to do with the references. Do NOT invent excerpts — they must be verbatim substrings of the reference text. The user will spot-check.
- Honor the user's instruction — it controls scope and tone of edits.

Return STRICT JSON only.`;

export interface DocumentEditRequest {
  document_name: string;
  paragraphs: ParagraphInfo[];
  /** Free-form user instruction. e.g. "tighten language" or "fix typos only" */
  instruction: string;
  model?: string;
  // ─── grounding context (all optional) ───
  /** Ask Sage RAG dataset name; passed straight to /server/query */
  dataset?: string;
  /** RAG references cap; default 5 when dataset is set, 0 otherwise */
  limit_references?: number;
  /** Web search toggle: 0 off, 1 Google results, 2 Google + crawl */
  live?: 0 | 1 | 2;
  /**
   * Reference files to inline into the prompt as ATTACHED REFERENCES.
   * Each file is uploaded once via /server/file (Ask-Sage-only) and
   * the extracted text is reused for every chunk.
   */
  references?: ProjectContextFile[];
  /** Progress callback fired after each chunk completes. */
  on_chunk_done?: (info: ChunkProgress) => void;
  /**
   * Maximum number of chunks the orchestrator processes in parallel.
   * Each chunk is its own /server/query call, so the cost is one
   * concurrent request per slot. Default 3 — empirically a good
   * trade-off between wall-time speedup and rate-limit pressure on
   * the health.mil tenant. Set to 1 for the legacy sequential
   * behavior.
   */
  chunk_concurrency?: number;
  /**
   * Enable the two-call pre-pass: first call identifies which
   * paragraphs in each chunk need editing, second call runs the full
   * fix pass narrowed to those paragraphs (plus a small neighbor
   * context window). Total tokens are usually LOWER than the single-
   * pass approach because the fix pass has less to read. Defaults
   * false to preserve legacy behavior.
   */
  use_prepass?: boolean;
  /**
   * When use_prepass is true, the model used for the cheap
   * identification pass. Defaults to the same model as the fix pass;
   * users can downgrade to a faster/cheaper model here.
   */
  prepass_model?: string;
}

export interface ChunkProgress {
  chunk_index: number;
  chunk_count: number;
  ops_emitted: number;
  tokens_in: number;
  tokens_out: number;
}

/** Narrowed paragraph_text op for the legacy UI accept flow. */
export type ReplaceParagraphTextOp = Extract<
  DocumentEditOp,
  { op: 'replace_paragraph_text' }
>;

export interface DocumentEditResponse {
  llm_output: DocumentEditOutput;
  /**
   * Paragraph-text edits whose index exists in the input. The legacy
   * UI accept flow consumes these. Other op types are kept in
   * `all_valid_ops` for callers using the new union-based pipeline.
   */
  valid_edits: ReplaceParagraphTextOp[];
  /** Every op the LLM returned that passed validation, in any shape */
  all_valid_ops: DocumentEditOp[];
  tokens_in: number;
  tokens_out: number;
  model: string;
  /** Concatenated chunk prompts, for the diagnostic "what did the model see" view */
  prompt_sent: string;
  chunk_count: number;
}

export async function requestDocumentEdits(
  client: LLMClient,
  args: DocumentEditRequest,
): Promise<DocumentEditResponse> {
  const model = args.model ?? DEFAULT_DOCUMENT_EDIT_MODEL;

  // 1. Pre-flight: extract attached reference files (Ask-Sage-only).
  //    Re-uploaded once here and reused for every chunk in the run.
  //    Failures are non-fatal — the chunk just won't see that file.
  const referencesBlock = await buildReferencesBlock(client, args.references ?? []);

  // 2. Build chunks. Significant paragraphs only — blank ones are
  //    layout artifacts; we still keep their absolute indices intact
  //    so the writer applies edits to the right place.
  const significant = args.paragraphs.filter((p) => p.text.trim().length > 0);
  const chunks = chunkParagraphs(significant, EDIT_CHUNK_SIZE, EDIT_CHUNK_OVERLAP);

  // 3. Process chunks. Each chunk is processed independently — the
  //    only per-chunk shared state is the seen-op-keys dedup set,
  //    which we synchronize after the fact since each chunk's results
  //    are merged at completion time. Concurrency is capped via
  //    `chunk_concurrency` (default 3) so we don't slam the tenant
  //    with parallel requests.
  const seenOpKeys = new Set<string>();
  const validIndices = new Set(args.paragraphs.map((p) => p.index));
  const concurrency = Math.max(1, args.chunk_concurrency ?? 3);
  const usePrepass = args.use_prepass === true;
  const prepassModel = args.prepass_model ?? model;

  interface ChunkResult {
    chunk_index: number;
    ops: DocumentEditOp[];
    prompt_sent: string;
    tokens_in: number;
    tokens_out: number;
  }

  async function runOneChunk(i: number): Promise<ChunkResult> {
    let chunk = chunks[i];
    let prepassTokensIn = 0;
    let prepassTokensOut = 0;

    // OPTIONAL Phase A: pre-pass problem identification. Narrows the
    // chunk to only the paragraphs the model thinks have issues, plus
    // a small read-only neighbor window. Skips this chunk entirely if
    // pre-pass returns zero focus indices.
    if (usePrepass) {
      try {
        const prepass = await runProblemIdentificationPass(client, {
          paragraphs: chunk.paragraphs,
          instruction: args.instruction,
          model: prepassModel,
        });
        prepassTokensIn = prepass.tokens_in;
        prepassTokensOut = prepass.tokens_out;
        if (prepass.focus_indices.length === 0) {
          // Nothing to fix in this chunk. Return early with prepass cost only.
          return {
            chunk_index: i,
            ops: [],
            prompt_sent: `--- CHUNK ${i + 1} / ${chunks.length} (prepass: clean, skipped) ---`,
            tokens_in: prepassTokensIn,
            tokens_out: prepassTokensOut,
          };
        }
        const narrowed = narrowChunkToFocus({
          paragraphs: chunk.paragraphs,
          focus_indices: prepass.focus_indices,
          neighbor_window: 1,
        });
        chunk = {
          paragraphs: narrowed.paragraphs,
          editableIndices: narrowed.editable_indices,
        };
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
          `[requestDocumentEdits] chunk ${i + 1}/${chunks.length} prepass failed (continuing with full chunk):`,
          err,
        );
      }
    }

    const message = buildEditMessage({
      document_name: args.document_name,
      instruction: args.instruction,
      chunk,
      chunk_index: i,
      chunk_count: chunks.length,
      total_significant: significant.length,
      total_paragraphs: args.paragraphs.length,
      references_block: referencesBlock,
    });

    const queryInput: Parameters<LLMClient['queryJson']>[0] = {
      message,
      system_prompt: SYSTEM_PROMPT,
      model,
      dataset: args.dataset && args.dataset.length > 0 ? args.dataset : 'none',
      temperature: 0,
      usage: true,
    };
    if (typeof args.limit_references === 'number') {
      queryInput.limit_references = args.limit_references;
    } else if (args.dataset && args.dataset !== 'none') {
      queryInput.limit_references = 5;
    }
    if (typeof args.live === 'number') {
      queryInput.live = args.live;
    }

    try {
      const { data, raw } = await client.queryJson<DocumentEditOutput>(queryInput);
      const rawOps = (data.edits ?? []).filter((op) =>
        isValidOp(op, validIndices, chunk.editableIndices),
      );
      // Auto-promote run-text ops that the LLM emitted with paragraph-
      // spanning new_text. Without this the writer leaves the rest of
      // the original paragraph stranded after the new content. See
      // maybePromoteRunOp() for the rule and the rationale.
      const ops = rawOps.map((op) => maybePromoteRunOp(op, args.paragraphs));
      const usage =
        (raw.usage as { prompt_tokens?: number; completion_tokens?: number }) ?? {};
      return {
        chunk_index: i,
        ops,
        prompt_sent: `--- CHUNK ${i + 1} / ${chunks.length} ---\n${message}`,
        tokens_in: prepassTokensIn + (usage.prompt_tokens ?? 0),
        tokens_out: prepassTokensOut + (usage.completion_tokens ?? 0),
      };
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[requestDocumentEdits] chunk ${i + 1}/${chunks.length} failed:`,
        err,
      );
      return {
        chunk_index: i,
        ops: [],
        prompt_sent: `--- CHUNK ${i + 1} / ${chunks.length} (failed) ---\n${message}`,
        tokens_in: prepassTokensIn,
        tokens_out: prepassTokensOut,
      };
    }
  }

  // Concurrency-capped fan-out. We don't use Promise.all over the
  // whole list because that would unleash all chunks at once and
  // pile up requests against the tenant. The pool walks the index
  // queue, picking the next index whenever a slot frees up.
  const chunkResults: ChunkResult[] = new Array(chunks.length);
  let nextIndex = 0;
  async function worker(): Promise<void> {
    while (true) {
      const i = nextIndex++;
      if (i >= chunks.length) return;
      const result = await runOneChunk(i);
      chunkResults[i] = result;
      // Fire the per-chunk progress callback as soon as the result
      // lands, even though chunks may complete out of order.
      args.on_chunk_done?.({
        chunk_index: i,
        chunk_count: chunks.length,
        ops_emitted: result.ops.length,
        tokens_in: result.tokens_in,
        tokens_out: result.tokens_out,
      });
    }
  }
  const workers: Promise<void>[] = [];
  for (let w = 0; w < Math.min(concurrency, chunks.length); w++) {
    workers.push(worker());
  }
  await Promise.all(workers);

  // Merge results in original chunk order so dedup is deterministic.
  const allOps: DocumentEditOp[] = [];
  const promptParts: string[] = [];
  let tokensIn = 0;
  let tokensOut = 0;
  for (const result of chunkResults) {
    if (!result) continue;
    promptParts.push(result.prompt_sent);
    tokensIn += result.tokens_in;
    tokensOut += result.tokens_out;
    for (const op of result.ops) {
      const key = opDedupKey(op);
      if (seenOpKeys.has(key)) continue;
      seenOpKeys.add(key);
      allOps.push(op);
    }
  }

  const valid_edits: ReplaceParagraphTextOp[] = allOps.filter(
    (op): op is ReplaceParagraphTextOp => op.op === 'replace_paragraph_text',
  );

  return {
    llm_output: { edits: allOps },
    valid_edits,
    all_valid_ops: allOps,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    model,
    prompt_sent: promptParts.join('\n\n'),
    chunk_count: chunks.length,
  };
}

// ─── Chunking ─────────────────────────────────────────────────────

interface EditChunk {
  /**
   * The actual paragraph window the model sees (in document order),
   * including overlap context from neighboring chunks.
   */
  paragraphs: ParagraphInfo[];
  /**
   * The subset of paragraph indices in this window that the model is
   * allowed to emit edits against. Overlap rows are read-only context.
   */
  editableIndices: Set<number>;
}

function chunkParagraphs(
  significant: ParagraphInfo[],
  size: number,
  overlap: number,
): EditChunk[] {
  if (significant.length === 0) return [];
  if (significant.length <= size) {
    return [
      {
        paragraphs: significant,
        editableIndices: new Set(significant.map((p) => p.index)),
      },
    ];
  }

  const chunks: EditChunk[] = [];
  const stride = Math.max(1, size - overlap);
  for (let editStart = 0; editStart < significant.length; editStart += stride) {
    const editEnd = Math.min(significant.length, editStart + size);
    // Window includes `overlap` paragraphs of context on each side
    // (when available), but only [editStart, editEnd) is editable.
    const winStart = Math.max(0, editStart - overlap);
    const winEnd = Math.min(significant.length, editEnd + overlap);
    const windowParas = significant.slice(winStart, winEnd);
    const editable = new Set(
      significant.slice(editStart, editEnd).map((p) => p.index),
    );
    chunks.push({ paragraphs: windowParas, editableIndices: editable });
    if (editEnd >= significant.length) break;
  }
  return chunks;
}

// ─── Op validation + dedup ────────────────────────────────────────

function isValidOp(
  op: unknown,
  validIndices: Set<number>,
  editableIndices: Set<number>,
): op is DocumentEditOp {
  if (!op || typeof op !== 'object' || !('op' in op)) return false;
  const o = op as DocumentEditOp;
  switch (o.op) {
    case 'replace_paragraph_text':
    case 'set_paragraph_style':
    case 'set_paragraph_alignment':
    case 'delete_paragraph':
    case 'insert_paragraph_after':
    case 'merge_paragraphs':
    case 'split_paragraph':
      return (
        typeof o.index === 'number' &&
        validIndices.has(o.index) &&
        editableIndices.has(o.index)
      );
    case 'set_paragraph_indent':
    case 'set_paragraph_spacing':
      return (
        typeof o.paragraph_index === 'number' &&
        validIndices.has(o.paragraph_index) &&
        editableIndices.has(o.paragraph_index)
      );
    case 'replace_run_text':
    case 'set_run_property':
    case 'set_run_font':
    case 'set_run_color':
      return (
        typeof o.paragraph_index === 'number' &&
        validIndices.has(o.paragraph_index) &&
        editableIndices.has(o.paragraph_index) &&
        typeof o.run_index === 'number' &&
        o.run_index >= 0
      );
    case 'set_cell_text':
    case 'insert_table_row':
    case 'delete_table_row':
    case 'set_content_control_value':
      // Table / sdt ops are not gated by paragraph windows; the writer
      // validates them at apply time.
      return true;
    default:
      return false;
  }
}

/**
 * The LLM frequently emits `replace_run_text` with a `new_text` that
 * is much longer than the actual run it targets — it treats "run 0"
 * as if it meant "the start of paragraph N" and writes a full
 * paragraph rewrite into the new_text. The writer then dutifully
 * replaces just that one run, leaving the remaining runs of the
 * paragraph in place after the new content. The result in the
 * exported DOCX is "[new full paragraph][surviving fragment of the
 * original paragraph]" — visible duplication.
 *
 * Promotion rule: if a `replace_run_text` op's new_text is much
 * longer than the targeted run's actual text length, AND the new_text
 * is also longer than a hard floor, rewrite the op to a
 * `replace_paragraph_text` covering the whole paragraph. The LLM's
 * intent was clearly a paragraph rewrite; we make it actually do that.
 *
 * Returns the promoted op (or the original op unchanged if no
 * promotion was warranted).
 */
function maybePromoteRunOp(
  op: DocumentEditOp,
  paragraphs: ParagraphInfo[],
): DocumentEditOp {
  if (op.op !== 'replace_run_text') return op;
  const p = paragraphs[op.paragraph_index];
  if (!p) return op;
  const targetRun = p.runs[op.run_index];
  if (!targetRun) return op;
  const runLen = targetRun.text.length;
  const newLen = op.new_text.length;
  // Hard floor: only promote if the new content is substantial enough
  // that we're confident the LLM meant a paragraph rewrite. Avoids
  // promoting legitimate "fix one word" replacements.
  if (newLen < 80) return op;
  // Disproportion ratio: promote if the new text is more than 3x the
  // run's actual length. A 20-char run with a 400-char replacement is
  // a clear sign the LLM thought it was rewriting the paragraph.
  if (newLen <= runLen * 3) return op;
  return {
    op: 'replace_paragraph_text',
    index: op.paragraph_index,
    new_text: op.new_text,
    rationale: op.rationale
      ? `${op.rationale} [auto-promoted from replace_run_text — original run was only ${runLen} chars but the proposed new_text is ${newLen} chars, so the writer would have left the rest of the paragraph stranded after the new content]`
      : `[auto-promoted from replace_run_text on run ${op.run_index} (${runLen} chars) → replace_paragraph_text (${newLen} chars). The LLM emitted a paragraph-spanning rewrite under a per-run op; promoting prevents the original text from being duplicated.]`,
  };
}

/**
 * Stable string key used to de-dup ops emitted in overlapped windows.
 * The same paragraph can appear in two adjacent chunks; if both chunks
 * propose the same edit we keep only the first.
 */
function opDedupKey(op: DocumentEditOp): string {
  switch (op.op) {
    case 'replace_paragraph_text':
      return `rp:${op.index}:${op.new_text}`;
    case 'replace_run_text':
      return `rr:${op.paragraph_index}:${op.run_index}:${op.new_text}`;
    case 'set_run_property':
      return `srp:${op.paragraph_index}:${op.run_index}:${op.property}:${op.value}`;
    case 'set_cell_text':
      return `sct:${op.table_index}:${op.row_index}:${op.cell_index}:${op.new_text}`;
    case 'insert_table_row':
      return `itr:${op.table_index}:${op.after_row_index}:${op.cells.join('|')}`;
    case 'delete_table_row':
      return `dtr:${op.table_index}:${op.row_index}`;
    case 'set_content_control_value':
      return `scc:${op.tag}:${op.value}`;
    case 'set_paragraph_style':
      return `sps:${op.index}:${op.style_id}`;
    case 'set_paragraph_alignment':
      return `spa:${op.index}:${op.alignment}`;
    case 'delete_paragraph':
      return `dp:${op.index}`;
    case 'insert_paragraph_after':
      return `ipa:${op.index}:${op.new_text}`;
    case 'merge_paragraphs':
      return `mp:${op.index}:${op.separator ?? ' '}`;
    case 'split_paragraph':
      return `sp:${op.index}:${op.split_at_text}`;
    case 'set_paragraph_indent':
      return `spi:${op.paragraph_index}:${op.left_twips ?? '_'}:${op.first_line_twips ?? '_'}:${op.hanging_twips ?? '_'}`;
    case 'set_paragraph_spacing':
      return `sps2:${op.paragraph_index}:${op.before_twips ?? '_'}:${op.after_twips ?? '_'}:${op.line_value ?? '_'}:${op.line_rule ?? '_'}`;
    case 'set_run_font':
      return `srf:${op.paragraph_index}:${op.run_index}:${op.family ?? '_'}:${op.size_pt ?? '_'}`;
    case 'set_run_color':
      return `src:${op.paragraph_index}:${op.run_index}:${op.color ?? '_'}:${op.highlight ?? '_'}`;
  }
}

// ─── Prompt assembly ──────────────────────────────────────────────

interface BuildEditMessageArgs {
  document_name: string;
  instruction: string;
  chunk: EditChunk;
  chunk_index: number;
  chunk_count: number;
  total_significant: number;
  total_paragraphs: number;
  references_block: string;
}

function buildEditMessage(a: BuildEditMessageArgs): string {
  const lines: string[] = [];
  lines.push(`Document: ${a.document_name}`);
  lines.push(
    `Chunk: ${a.chunk_index + 1} of ${a.chunk_count} · ${a.total_significant} significant paragraphs total · ${a.total_paragraphs} including blanks`,
  );
  lines.push(``);
  lines.push(
    `User instruction: ${a.instruction || '(no specific instruction; perform a general cleanup pass for grammar, language, and obvious errors)'}`,
  );
  lines.push(``);
  if (a.references_block) {
    lines.push(a.references_block);
    lines.push(``);
  }
  lines.push(`=== DOCUMENT CHUNK ===`);
  lines.push(
    `Each paragraph is rendered as a header line plus one indented line per <w:r> run. The header format is: <gate>[<index>]<flags> <text>. The gate is "[edit]" for paragraphs you may propose edits against, or "[ctx]" for read-only context paragraphs from the neighboring chunk. Indices are absolute over the full document. Flags appear in {curly braces} only when present and describe formatting context (style id, alignment, indent, list level). The run lines below the header show each run's index and verbatim text — this is what replace_run_text and set_run_* ops target. Pay attention to run lengths: replace_run_text only works for replacements comparable in size to the original run.`,
  );
  lines.push(``);
  for (const p of a.chunk.paragraphs) {
    const gate = a.chunk.editableIndices.has(p.index) ? '[edit]' : '[ctx] ';
    lines.push(`${gate}[${p.index}]${formatParagraphFlags(p)} ${p.text}`);
    // Render runs only when the paragraph has more than one — single-
    // run paragraphs don't add information and inflate token use.
    if (p.runs.length > 1) {
      for (let i = 0; i < p.runs.length; i++) {
        const run = p.runs[i]!;
        const text = run.text.length > 0 ? JSON.stringify(run.text) : '""';
        lines.push(`    run[${i}] (${run.text.length} chars): ${text}`);
      }
    }
  }
  lines.push(`=== END DOCUMENT CHUNK ===`);
  lines.push(``);
  lines.push(
    `Return STRICT JSON only with the edits array. Empty edits array is fine if this chunk is already clean.`,
  );

  return lines.join('\n');
}

// ─── Reference files: upload + extract + render ───────────────────

async function buildReferencesBlock(
  client: LLMClient,
  files: ProjectContextFile[],
): Promise<string> {
  if (files.length === 0) return '';
  // /server/file is Ask-Sage-only. If the user is on OpenRouter we
  // bail out — the UI hides the reference uploader on that provider,
  // but defend in depth here too.
  if (!(client instanceof AskSageClient)) {
    // eslint-disable-next-line no-console
    console.warn(
      '[requestDocumentEdits] reference files supplied with a non-AskSage client; ignoring.',
    );
    return '';
  }

  const sections: string[] = [];
  for (const f of files) {
    try {
      const fileObj = blobToFile(f.bytes, f.filename, f.mime_type);
      const upload = await client.uploadFile(fileObj);
      const text = extractedTextFromRet(upload.ret).trim();
      if (!text) continue;
      const truncated =
        text.length > REFERENCE_FILE_CAP_CHARS
          ? text.slice(0, REFERENCE_FILE_CAP_CHARS - 1).trimEnd() + '…'
          : text;
      sections.push(
        `--- ${f.filename} (${truncated.length.toLocaleString()} chars${text.length > REFERENCE_FILE_CAP_CHARS ? ` of ${text.length.toLocaleString()}` : ''}) ---\n${truncated}`,
      );
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[requestDocumentEdits] failed to extract reference ${f.filename}:`,
        err,
      );
    }
  }

  if (sections.length === 0) return '';

  return [
    `=== ATTACHED REFERENCES ===`,
    `The following files were attached by the user as authoritative grounding context. Prefer their wording for facts, terminology, and citations when they disagree with the draft.`,
    ``,
    sections.join('\n\n'),
    `=== END ATTACHED REFERENCES ===`,
  ].join('\n');
}

// ─── Paragraph flag formatting ────────────────────────────────────

function formatParagraphFlags(p: ParagraphInfo): string {
  const flags: string[] = [];
  if (p.style_id) flags.push(`style=${p.style_id}`);
  if (p.alignment && p.alignment !== 'left') flags.push(`align=${p.alignment}`);
  if (p.indent_left_twips && p.indent_left_twips > 0) {
    flags.push(`indent=${twipsToInches(p.indent_left_twips)}in`);
  }
  if (p.indent_first_line_twips && p.indent_first_line_twips > 0) {
    flags.push(`first_line=${twipsToInches(p.indent_first_line_twips)}in`);
  }
  if (p.indent_hanging_twips && p.indent_hanging_twips > 0) {
    flags.push(`hanging=${twipsToInches(p.indent_hanging_twips)}in`);
  }
  if (p.numbering_id !== null) {
    flags.push(`list=${p.numbering_id}.${p.numbering_level ?? 0}`);
  }
  if (p.in_table) flags.push(`in_table`);
  if (p.content_control_tag) flags.push(`sdt=${p.content_control_tag}`);
  return flags.length > 0 ? ` {${flags.join(', ')}}` : '';
}

function twipsToInches(twips: number): string {
  return (twips / 1440).toFixed(2);
}

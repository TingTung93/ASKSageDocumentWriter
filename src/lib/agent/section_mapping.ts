// section_mapping.ts — single-LLM-call alignment between template
// sections and reference chunks.
//
// Why this exists: a bare-bones template ("DHA Policy" with placeholder
// boilerplate) drafted from a content-rich source ("a MAMC policy with
// 1800 words of procedures") needs to absorb the source content into
// the template's structure — not output 40 words because the template's
// example is 40 words long. The size classifier alone can't know that;
// it only sees the template. This mapper closes the gap by asking the
// LLM, in one cheap call (chunk titles + summaries only, never bodies),
// to estimate per-section how much content the reference actually has
// for each section and which chunks belong where.
//
// Downstream consumers:
//   - section_size.classifySectionSize() — uses estimated_content_words
//     so a 40-word template section with 1800 words of mapped reference
//     content lands in `long`, not `inline_metadata`.
//   - chunk.selectChunksForSection() — uses matched_chunk_ids as
//     preferred selections that bypass the score floor.
//   - draft prompt — surfaces drafting_strategy as a guidance line so
//     the model knows whether to absorb verbatim, summarize, or rely on
//     template-only.
//   - metadata_batch — re-filters: a section can only be drafted by
//     the metadata batch if BOTH the template is short AND the mapper
//     says nothing was matched.

import type { LLMClient } from '../provider/types';
import type { ProjectRecord, ProjectContextFile, TemplateRecord } from '../db/schema';
import { type UsageByModel, recordUsage } from '../usage';

// ─── Public types ────────────────────────────────────────────────

/**
 * How the drafter should treat the reference content for a section.
 *
 * - `absorb_verbatim` — the reference contains substantively the same
 *   subject matter as the section; preserve wording, technical terms,
 *   and structure where possible. The MAMC→DHA policy migration case.
 * - `summarize` — the reference has more detail than the section
 *   needs; condense into the template's expected length range.
 * - `expand` — the template names a topic the reference touches on;
 *   draw supporting facts/examples but the section is still primarily
 *   the model's own composition.
 * - `use_template_only` — no useful reference content; rely on
 *   project subject + shared inputs + template example only.
 */
export type DraftingStrategy =
  | 'absorb_verbatim'
  | 'summarize'
  | 'expand'
  | 'use_template_only';

export interface SectionMapping {
  template_id: string;
  section_id: string;
  /** Chunk ids (from any reference file in the project) that the
   *  section should pull content from. May be empty for sections
   *  with no reference grounding. */
  matched_chunk_ids: string[];
  /** Estimated word count of the section's *output* after reshaping
   *  the matched reference content into the template's structure.
   *  Capped at MAX_ESTIMATED_WORDS so a runaway estimate can't push
   *  every section into the long bucket. */
  estimated_content_words: number;
  drafting_strategy: DraftingStrategy;
  /** One-line LLM-supplied rationale, surfaced in diagnostics only. */
  reasoning?: string;
}

export interface MapReferencesResult {
  mappings: SectionMapping[];
  tokens_in: number;
  tokens_out: number;
  /** Per-model usage breakdown. Empty map when skipped. */
  usage_by_model: UsageByModel;
  /** True when the mapper had nothing to do (no references). */
  skipped: boolean;
}

/**
 * Cap on estimated_content_words from the LLM. Above ~3000 words a
 * section is firmly in the `long` bucket regardless, so a higher cap
 * doesn't change behavior — it would just waste budget if the model
 * hallucinates a wildly large number.
 */
export const MAX_ESTIMATED_WORDS = 3000;

// ─── Lookup helpers consumed by downstream stages ───────────────

/**
 * Index a flat mapping list by composite (template_id::section_id) so
 * downstream stages can do O(1) lookups while iterating sections.
 */
export function indexMappings(
  mappings: SectionMapping[],
): Map<string, SectionMapping> {
  const out = new Map<string, SectionMapping>();
  for (const m of mappings) {
    out.set(`${m.template_id}::${m.section_id}`, m);
  }
  return out;
}

export function lookupMapping(
  index: Map<string, SectionMapping> | undefined,
  template_id: string,
  section_id: string,
): SectionMapping | undefined {
  if (!index) return undefined;
  return index.get(`${template_id}::${section_id}`);
}

// ─── Mapper ──────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You align the structure of one or more DOCUMENT TEMPLATES with the content of one or more REFERENCE FILES that have already been split into semantic chunks. Your output drives a downstream agentic drafter that will reshape the reference content into each template's section structure.

You are given:
  - A list of TEMPLATE SECTIONS (each with id, name, intent, target_words range).
  - A list of REFERENCE CHUNKS from the user's source material (each with id, source filename, title, and a one-sentence summary). You do NOT see the chunk bodies — work from titles and summaries only.
  - The PROJECT SUBJECT.

For EVERY template section in the list, decide:
  1. Which chunk ids contain content the section should pull from. Empty list is fine — many sections (titles, dates, signature blocks, addressee lines) won't have any reference content.
  2. How many WORDS the section should produce in the final output AFTER absorbing the matched reference content. This is the OUTPUT word count, not the input chunk word count. For sections with no matched chunks, default to the midpoint of the section's target_words range. For sections with matched chunks, estimate how much output the absorbed/summarized content will produce — this can be much LARGER than the template's target_words range when the source has substantively more content than the template's example. CAP at ${MAX_ESTIMATED_WORDS}.
  3. A drafting strategy from this exact enum: "absorb_verbatim" | "summarize" | "expand" | "use_template_only".
       - absorb_verbatim: the matched chunks cover the same subject matter as the section; preserve wording, technical terms, numerical thresholds, and procedural ordering. Use this for policy migrations where the source IS the content.
       - summarize: the matched chunks have substantively MORE content than the section needs; condense to fit the template's expected length.
       - expand: the section names a topic the chunks touch on but the chunks alone wouldn't fill the section; the model will compose using the chunks as supporting facts.
       - use_template_only: no useful reference content was matched; the model should rely on the project subject, shared inputs, and the template's own example structure.
  4. A ONE-SENTENCE reasoning string explaining the decision.

OUTPUT — strict JSON only, no markdown, no commentary:
{
  "mappings": [
    {
      "template_id": "<template id from input>",
      "section_id": "<section id from input>",
      "matched_chunk_ids": ["<chunk id>", ...],
      "estimated_content_words": <integer>,
      "drafting_strategy": "<enum value>",
      "reasoning": "<one sentence>"
    },
    ...
  ]
}

GUIDANCE:
  - Include a mapping entry for EVERY template section. Do not skip sections — sections with no matches still need an entry with empty matched_chunk_ids and use_template_only.
  - Match aggressively when chunk titles/summaries clearly cover a section's topic. False positives are usually harmless (the chunk just gets included in the prompt); false negatives drop substantive content on the floor.
  - A single chunk MAY be matched to multiple sections if it covers multiple topics.
  - drafting_strategy is the most important field for the downstream drafter — choose it based on the volume and specificity of matched content, not on how confident you are in the match.
  - estimated_content_words: use the section's target_words range as a floor when nothing is matched, but be willing to go well past target_words[1] when the matched content clearly has more substance than the template anticipated. Examples:
      • Section "1. Purpose" with target_words 30-80, two chunks matched → ~80
      • Section "4. Procedures" with target_words 80-150, eight chunks of detailed procedures matched → ~1500 (the template was a placeholder; the source has the real content)
      • Section "Signature Block" with target_words 5-15, no chunks matched → 10
  - chunk ids: use the EXACT id strings from the input. Do not invent ids, do not abbreviate, do not strip prefixes.

Return STRICT JSON only.`;

interface MappingsLLMResponse {
  mappings?: Array<{
    template_id?: string;
    section_id?: string;
    matched_chunk_ids?: string[];
    estimated_content_words?: number;
    drafting_strategy?: string;
    reasoning?: string;
  }>;
}

const VALID_STRATEGIES: Set<string> = new Set([
  'absorb_verbatim',
  'summarize',
  'expand',
  'use_template_only',
]);

export interface MapReferencesArgs {
  project: ProjectRecord;
  templates: TemplateRecord[];
  reference_files: ProjectContextFile[];
  model?: string;
}

/**
 * Run the one-shot mapping. Returns a result with `skipped: true` and
 * zero tokens when there are no reference chunks to map against (no
 * files attached, or every file failed chunking) — downstream stages
 * fall back to template-only sizing in that case.
 */
export async function mapReferencesToSections(
  client: LLMClient,
  args: MapReferencesArgs,
): Promise<MapReferencesResult> {
  // Collect every chunk across every reference file. We work from the
  // file.chunks field set by the chunking stage; files without chunks
  // (chunking failed or was skipped) don't contribute.
  const allChunks: Array<{ file: ProjectContextFile; chunk: { id: string; title: string; summary: string } }> = [];
  for (const f of args.reference_files) {
    for (const c of f.chunks ?? []) {
      allChunks.push({
        file: f,
        chunk: { id: c.id, title: c.title, summary: c.summary },
      });
    }
  }

  // Collect every section across every template.
  const allSections: Array<{ template: TemplateRecord; section: TemplateRecord['schema_json']['sections'][number] }> = [];
  for (const t of args.templates) {
    for (const s of t.schema_json.sections) {
      allSections.push({ template: t, section: s });
    }
  }

  if (allSections.length === 0) {
    return { mappings: [], tokens_in: 0, tokens_out: 0, usage_by_model: {}, skipped: true };
  }

  // No chunks at all? Skip the LLM call. Synthesize a use_template_only
  // mapping for every section so downstream stages have a uniform
  // input shape (and so a section that target_words says is short
  // still flows naturally into the metadata batch).
  if (allChunks.length === 0) {
    const mappings: SectionMapping[] = allSections.map(({ template, section }) => {
      const fallbackWords = section.target_words
        ? Math.round((section.target_words[0] + section.target_words[1]) / 2)
        : 0;
      return {
        template_id: template.id,
        section_id: section.id,
        matched_chunk_ids: [],
        estimated_content_words: fallbackWords,
        drafting_strategy: 'use_template_only',
        reasoning: 'No reference chunks available for this run.',
      };
    });
    return { mappings, tokens_in: 0, tokens_out: 0, usage_by_model: {}, skipped: true };
  }

  const lines: string[] = [];
  lines.push('=== PROJECT SUBJECT ===');
  lines.push(args.project.description?.trim() || '(empty)');
  lines.push('=== END PROJECT SUBJECT ===');
  lines.push('');

  lines.push(`=== TEMPLATE SECTIONS (${allSections.length}) ===`);
  for (const { template, section } of allSections) {
    const tw = section.target_words
      ? `target_words: ${section.target_words[0]}-${section.target_words[1]}`
      : 'target_words: (unspecified)';
    lines.push(`--- template_id="${template.id}" section_id="${section.id}" ---`);
    lines.push(`  template_name: ${template.name}`);
    lines.push(`  name: ${section.name}`);
    if (section.intent && section.intent.trim().length > 0) {
      lines.push(`  intent: ${section.intent.trim()}`);
    }
    lines.push(`  ${tw}`);
  }
  lines.push('=== END TEMPLATE SECTIONS ===');
  lines.push('');

  lines.push(`=== REFERENCE CHUNKS (${allChunks.length}, titles + summaries only — bodies are NOT shown) ===`);
  for (const { file, chunk } of allChunks) {
    const summary = chunk.summary?.trim() ? ` — ${chunk.summary.trim()}` : '';
    lines.push(`  id="${chunk.id}" file="${file.filename}" title="${chunk.title}"${summary}`);
  }
  lines.push('=== END REFERENCE CHUNKS ===');
  lines.push('');
  lines.push(
    `Produce one mapping entry per template section. Include EVERY section even when no chunks match. Return STRICT JSON per the OUTPUT SCHEMA in your system prompt.`,
  );

  const { data, raw } = await client.queryJson<MappingsLLMResponse>({
    message: lines.join('\n'),
    system_prompt: SYSTEM_PROMPT,
    model: args.model,
    dataset: 'none',
    temperature: 0,
    limit_references: 0,
    usage: true,
  });

  const usage = (raw.usage as { prompt_tokens?: number; completion_tokens?: number }) ?? {};
  const tokens_in = usage.prompt_tokens ?? 0;
  const tokens_out = usage.completion_tokens ?? 0;
  const usage_by_model: UsageByModel = {};
  // args.model may be undefined here (this helper accepts an explicit
  // override but doesn't fall back to settings); record under the
  // model id the call actually used. When undefined, attribute to
  // an "unknown" sentinel so the cost rollup can flag it.
  const recordedModel = args.model ?? 'unknown';
  recordUsage(usage_by_model, recordedModel, {
    tokens_in,
    tokens_out,
    web_search_results: raw.web_search_results,
  });

  // Validate against the actual section list — drop hallucinated ids,
  // and synthesize fallback entries for any section the model skipped.
  const validChunkIds = new Set(allChunks.map((c) => c.chunk.id));
  const seen = new Set<string>();
  const mappings: SectionMapping[] = [];

  for (const raw of data.mappings ?? []) {
    if (!raw || typeof raw !== 'object') continue;
    const template_id = typeof raw.template_id === 'string' ? raw.template_id : '';
    const section_id = typeof raw.section_id === 'string' ? raw.section_id : '';
    if (!template_id || !section_id) continue;
    const key = `${template_id}::${section_id}`;
    // Make sure the (template, section) pair exists in our input.
    const matched = allSections.find(
      (s) => s.template.id === template_id && s.section.id === section_id,
    );
    if (!matched) continue;
    if (seen.has(key)) continue;
    seen.add(key);

    const matched_chunk_ids = Array.isArray(raw.matched_chunk_ids)
      ? raw.matched_chunk_ids.filter((id): id is string => typeof id === 'string' && validChunkIds.has(id))
      : [];

    let estimated = typeof raw.estimated_content_words === 'number' && raw.estimated_content_words > 0
      ? Math.round(raw.estimated_content_words)
      : matched.section.target_words
        ? Math.round((matched.section.target_words[0] + matched.section.target_words[1]) / 2)
        : 0;
    if (estimated > MAX_ESTIMATED_WORDS) estimated = MAX_ESTIMATED_WORDS;

    const strategy: DraftingStrategy = VALID_STRATEGIES.has(raw.drafting_strategy ?? '')
      ? (raw.drafting_strategy as DraftingStrategy)
      : matched_chunk_ids.length > 0
        ? 'expand'
        : 'use_template_only';

    mappings.push({
      template_id,
      section_id,
      matched_chunk_ids,
      estimated_content_words: estimated,
      drafting_strategy: strategy,
      reasoning: typeof raw.reasoning === 'string' ? raw.reasoning.trim() || undefined : undefined,
    });
  }

  // Backfill any section the model skipped, so downstream stages can
  // safely assume EVERY section has a mapping.
  for (const { template, section } of allSections) {
    const key = `${template.id}::${section.id}`;
    if (seen.has(key)) continue;
    const fallbackWords = section.target_words
      ? Math.round((section.target_words[0] + section.target_words[1]) / 2)
      : 0;
    mappings.push({
      template_id: template.id,
      section_id: section.id,
      matched_chunk_ids: [],
      estimated_content_words: fallbackWords,
      drafting_strategy: 'use_template_only',
      reasoning: 'Section was not returned by the mapper; synthesized fallback.',
    });
  }

  return { mappings, tokens_in, tokens_out, usage_by_model, skipped: false };
}

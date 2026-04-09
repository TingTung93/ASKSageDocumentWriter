// metadata_batch.ts — one-shot drafter for short, metadata-flavored
// template fields ("Memorandum For", date, document number, signature
// blocks, POC lines, titles).
//
// Why this exists: the per-section drafting loop is overkill — and
// catastrophically expensive — for fields whose entire output is a
// handful of words. Sending a 28k-token reference doc to draft a 7-word
// addressee line was burning the user's monthly Ask Sage quota in a
// single recipe run. This module collects every section the size
// classifier flagged as `inline_metadata` across every selected
// template and fills them all in ONE LLM call.
//
// Design constraints (locked in by user):
//   - No reference chunk text. The model sees chunk titles + summaries
//     only, NOT chunk bodies. The user can manually fix any field that
//     came out wrong; the round-trip cost of including chunk text
//     defeats the purpose of batching.
//   - No critic loop. One shot, one pass. Metadata fields are too
//     short for the critic loop to reliably improve them.
//   - Same drafting model as full sections (balanced speed/accuracy).
//   - Runs even when references aren't chunked yet — metadata fields
//     rarely need references, so we don't gate this stage on chunking.

import type { LLMClient } from '../provider/types';
import { resolveDraftingModel } from '../provider/resolve_model';
import { type UsageByModel, recordUsage } from '../usage';
import {
  db,
  type DraftRecord,
  type ProjectContextFile,
  type ProjectRecord,
  type TemplateRecord,
} from '../db/schema';
import type { BodyFillRegion } from '../template/types';
import { DEFAULT_DRAFTING_TEMPERATURE } from './drafter';
import { classifySectionSize } from './section_size';
import { extractParagraphs } from '../template/parser';
import { sliceTemplateExampleForSection } from './template_slice';
import {
  indexMappings,
  lookupMapping,
  type SectionMapping,
} from '../agent/section_mapping';

export interface MetadataBatchArgs {
  project: ProjectRecord;
  templates: TemplateRecord[];
  /** Reference files attached to the project; only titles+summaries are sent. */
  reference_files: ProjectContextFile[];
  /**
   * Pre-rendered PROJECT NOTES block. The user's chat-style guidance
   * is often the PRIMARY source for short metadata fields (addressee,
   * date, office symbol, soldier name) — for many short documents
   * the entire substance lives in the notes and there are no
   * attached files at all. Pass null when the project has no notes.
   */
  notes_block?: string | null;
  /**
   * Reference→section mappings from the recipe's mapping stage. The
   * batch uses them to filter out sections that LOOK short (template
   * example is brief) but actually have substantive matched
   * reference content — those need the full per-section drafter, not
   * a one-shot key→value fill. When omitted, the batch falls back to
   * template-only classification.
   */
  section_mappings?: SectionMapping[];
  /** Override the drafting model. Defaults to the standard drafting model. */
  model?: string;
}

export interface MetadataBatchResult {
  /** Number of inline_metadata sections that received a value. */
  filled: number;
  /** Sections we tried to fill but the model returned nothing for. */
  skipped: number;
  /** Sections that errored during persistence. */
  errored: number;
  tokens_in: number;
  tokens_out: number;
  /** Per-model usage breakdown. Always one entry — the batch model. */
  usage_by_model: UsageByModel;
  model: string;
}

interface CollectedField {
  template: TemplateRecord;
  section: BodyFillRegion;
  template_example: string | null;
  /** Composite drafts row id, mirrors orchestrator.ts::draftId. */
  draft_id: string;
}

// The strict response shape from the system prompt is
//   { fields: { "<section_id>": { "value": "..." } } }
// In practice gemini-flash (and other smaller models) return all of:
//   { fields: { "<section_id>": "literal string" } }                       // flat string
//   { fields: { "<section_id>": { "text": "..." } } }                      // wrong key
//   { fields: [ { "section_id": "...", "value": "..." } ] }                // array form
//   { "<section_id>": { "value": "..." } }                                 // top-level keys
// `extractFieldValues` accepts every shape and returns a flat
//   Map<section_id, string>
// of resolved values, indexed by lowercased id so case mismatches still
// match.
interface MetadataBatchLLMResponse {
  fields?: unknown;
  [key: string]: unknown;
}

function extractFieldValues(
  data: MetadataBatchLLMResponse,
  knownIds: string[],
): Map<string, string> {
  const out = new Map<string, string>();
  const idLookup = new Map<string, string>();
  for (const id of knownIds) idLookup.set(id.toLowerCase(), id);

  const tryAdd = (rawId: unknown, rawValue: unknown): void => {
    if (typeof rawId !== 'string') return;
    const canonical = idLookup.get(rawId.toLowerCase());
    if (!canonical) return; // hallucinated id
    if (out.has(canonical)) return; // first writer wins

    let str: string | null = null;
    if (typeof rawValue === 'string') {
      str = rawValue;
    } else if (rawValue && typeof rawValue === 'object') {
      const obj = rawValue as Record<string, unknown>;
      // Try the documented `value` field first, then a few common
      // alternatives the model sometimes invents.
      for (const k of ['value', 'text', 'content', 'body']) {
        const v = obj[k];
        if (typeof v === 'string') {
          str = v;
          break;
        }
      }
      // Some models emit { paragraphs: [{ text: "..." }, ...] }; flatten
      // into a single newline-joined string.
      if (str === null && Array.isArray(obj.paragraphs)) {
        const joined = obj.paragraphs
          .map((p) => (p && typeof p === 'object' && typeof (p as { text?: unknown }).text === 'string' ? (p as { text: string }).text : ''))
          .filter((s) => s.length > 0)
          .join('\n');
        if (joined.length > 0) str = joined;
      }
    }
    if (str === null) return;
    const trimmed = str.trim();
    if (!trimmed) return;
    out.set(canonical, trimmed);
  };

  // Shape 1 / 2: { fields: { id: ... } } — keyed object
  if (data.fields && typeof data.fields === 'object' && !Array.isArray(data.fields)) {
    for (const [id, val] of Object.entries(data.fields as Record<string, unknown>)) {
      tryAdd(id, val);
    }
  }
  // Shape 3: { fields: [ { section_id, value } ] } — array
  if (Array.isArray(data.fields)) {
    for (const entry of data.fields) {
      if (!entry || typeof entry !== 'object') continue;
      const obj = entry as Record<string, unknown>;
      const id = obj.section_id ?? obj.id ?? obj.key;
      tryAdd(id, obj);
    }
  }
  // Shape 4: top-level keys are section ids (no `fields` wrapper)
  for (const [k, v] of Object.entries(data)) {
    if (k === 'fields') continue;
    tryAdd(k, v);
  }
  return out;
}

const SYSTEM_PROMPT = `You fill in SHORT METADATA FIELDS for a formal U.S. government document being drafted from a template (Army memorandum, DHA policy, contracting packet, etc). Each field is a fixed-form item like a title, document number, addressee block, POC line, date, or signature block — never multi-paragraph prose.

YOUR CORE RESPONSIBILITY: REFORMAT, do not parrot. The user's notes and shared inputs are RAW INPUT — frequently lowercase, abbreviated, casually punctuated, in the wrong order. Your job is to RESHAPE that raw input into the conventional format for each section type. Names in signature blocks become ALL CAPS even when the notes wrote them lowercase. Dates become day-month-year military format even when the notes wrote them differently. Addressee blocks gain the literal "MEMORANDUM FOR " prefix even when the notes just listed names.

OUTPUT — strict JSON only, no markdown, no commentary:
{
  "fields": {
    "<section_id>": {
      "value": "<the filled-in text for this field, EXACTLY as it should appear in the document; preserve line breaks with \\n>"
    },
    ...
  }
}

SOURCES — in priority order:
  1. PROJECT SUBJECT — what the document is about
  2. PROJECT NOTES — user-authored chat-style guidance; for short documents (memos, transfer actions) this is FREQUENTLY the strongest source for addressee, soldier name, dates, office symbol. Treat as RAW INPUT — substance is authoritative, format is your job.
  3. SHARED INPUTS — fielded values the user (or pre-flight) already filled in
  4. REFERENCE INDEX — chunk titles + summaries only; chunk bodies are NOT shown, so use this to echo facts but never to quote from

ARMY MEMO FORMATTING CONVENTIONS — apply these whenever the section type matches:
- Header block (originating organization): line 1 "DEPARTMENT OF THE ARMY" ALL CAPS, line 2 organization name ALL CAPS, line 3 street address in title case, line 4 "City, ST ZIP" with the comma and proper state abbreviation. Example raw "department of army, troop command mrcp, 9040 jackson ave, tacoma wa 98433" → "DEPARTMENT OF THE ARMY\\nTROOP COMMAND, MEDICAL READINESS COMMAND, PACIFIC\\n9040 Jackson Avenue\\nTacoma, WA 98433".
- Date and reference (office symbol + date): line 1 office symbol ALL CAPS (e.g. "MCHJ"), line 2 day-month-year military date — day digit, full month name title case, four-digit year ("9 April 2026"). Example raw "mchj 9 apr 26" → "MCHJ\\n9 April 2026".
- Addressee block / MEMORANDUM FOR: line 1 begins with "MEMORANDUM FOR " followed by the first recipient. Subsequent recipients indented to align with the first recipient (15 spaces before each subsequent recipient). When there are 4+ recipients use "MEMORANDUM FOR SEE DISTRIBUTION" instead and rely on the distribution list. Example raw "commander b co, commander c co, troop command mrcp" → "MEMORANDUM FOR Commander, B Company, Troop Command, Medical Readiness Command, Pacific\\n               Commander, C Company, Troop Command, Medical Readiness Command, Pacific".
- Subject line: literal "SUBJECT: " prefix in ALL CAPS followed by the topic in ALL CAPS. Example raw "lateral transfer of jacob baumgartner" → "SUBJECT: LATERAL TRANSFER OF SPC JACOB BAUMGARTNER (when rank is known from notes)".
- Signature block: line 1 SIGNATORY FULL NAME in ALL CAPS, line 2 "RANK, BRANCH" with comma (e.g. "CPT, MS"), line 3 position title in title case (e.g. "Commanding"). Example raw "marivelle medellin, cpt ms, commanding" → "MARIVELLE MEDELLIN\\nCPT, MS\\nCommanding".
- Point of contact: full prose sentence — "The point of contact for this action is [Rank] [Full Name], [Position], at [phone] or [email]." DO NOT use a bulleted or fragment style; this is sentence prose. Example raw "peter le ncoic 123-456-6789 peter.le.mil@army.mil" → "The point of contact for this action is SFC Peter Le, NCOIC, at (123) 456-6789 or peter.le.mil@army.mil." (rank inferred from context if known; phone formatted with parentheses+dash).
- Distribution list: line 1 "DISTRIBUTION:" ALL CAPS, then each addressee on its own line, indented (no bullets, no commas at end-of-line). Example raw "spc baumgartner, s1" → "DISTRIBUTION:\\nSPC Jacob Baumgartner\\nS-1, Troop Command, Medical Readiness Command, Pacific".

GENERIC FALLBACK (when section type doesn't match an Army memo block):
- Title case headings, sentence case body prose, ALL CAPS for organizational names that customarily use it (e.g. DEPARTMENT OF, STATE OF).
- Preserve every name, date, number, and fact verbatim — only adjust formatting.
- Multi-line user input should produce multi-line output preserving the line break intent.

GENERAL GUIDANCE:
- Each field's "value" is the COMPLETE replacement text for that section. Multi-line blocks use literal \\n inside the JSON string.
- Respect the section's target_words range if provided. Most metadata fields are 5-30 words; signature blocks 5-15; POC lines 15-30.
- If a section has explicit format guidance in its intent (e.g. "MEMORANDUM FOR <recipient>"), the convention above takes precedence over the literal example unless the example is more specific.
- MISSING-CONTEXT POLICY: when you cannot ground a field's value in any of the four sources above, DO NOT omit the field. Instead, return a "value" that contains a SQUARE-BRACKET PLACEHOLDER naming exactly what's missing, e.g. "[INSERT: addressee organization name]" or "MEMORANDUM FOR [INSERT: recipient]". The user gets a complete document with obvious gaps to fill in, instead of fields silently missing. Use placeholders SPARINGLY — exhaust the four sources first.
- DO NOT change names, ranks, dates, numbers, organizations, phone numbers, or email addresses. Only adjust FORMATTING. Every fact in your output must be traceable to the user's input.
- Do NOT include any field id that wasn't in the REQUESTED FIELDS list. Do NOT add prose, headings, or commentary outside the JSON.

Return STRICT JSON only.`;

/**
 * Collect every inline_metadata section across the project's templates.
 * The classifier honors any supplied mapping so a section with
 * substantive matched reference content stays out of the batch even
 * when its template example is short.
 */
export async function collectMetadataFields(
  templates: TemplateRecord[],
  project_id: string,
  mappings?: SectionMapping[],
): Promise<CollectedField[]> {
  const mappingIndex = mappings ? indexMappings(mappings) : undefined;
  const out: CollectedField[] = [];
  for (const template of templates) {
    let paragraphs: Awaited<ReturnType<typeof extractParagraphs>> = [];
    try {
      paragraphs = await extractParagraphs(template.docx_bytes);
    } catch {
      // If we can't parse the template, fall through with no example
      // text — classifier will rely solely on target_words + mapping.
    }
    for (const section of template.schema_json.sections) {
      const example = sliceTemplateExampleForSection(paragraphs, section);
      const mapping = lookupMapping(mappingIndex, template.id, section.id);
      const cls = classifySectionSize({ section, template_example: example, mapping });
      if (cls !== 'inline_metadata') continue;
      out.push({
        template,
        section,
        template_example: example,
        draft_id: `${project_id}::${template.id}::${section.id}`,
      });
    }
  }
  return out;
}

/**
 * Run the one-shot metadata batch. Persists each filled field to the
 * `drafts` table as a `ready` DraftRecord matching the per-section
 * drafter's output shape, so downstream stages (cross-section review,
 * assembly) don't need to special-case metadata sections.
 */
export async function runMetadataBatch(
  client: LLMClient,
  args: MetadataBatchArgs,
): Promise<MetadataBatchResult> {
  const model = await resolveDraftingModel(client, args.model, 'drafting');
  const fields = await collectMetadataFields(
    args.templates,
    args.project.id,
    args.section_mappings,
  );

  if (fields.length === 0) {
    return {
      filled: 0,
      skipped: 0,
      errored: 0,
      tokens_in: 0,
      tokens_out: 0,
      usage_by_model: {},
      model,
    };
  }

  const message = buildMetadataBatchMessage({
    project: args.project,
    fields,
    reference_files: args.reference_files,
    notes_block: args.notes_block ?? null,
  });

  // Strip Ask-Sage-only knobs when the provider doesn't honor them.
  // OpenRouter would silently drop these but the cleaner request body
  // makes audit logs easier to read and avoids future surprises if we
  // start passing through unknown fields.
  const queryInput: Parameters<typeof client.queryJson>[0] = {
    message,
    system_prompt: SYSTEM_PROMPT,
    model,
    temperature: DEFAULT_DRAFTING_TEMPERATURE,
    usage: true,
  };
  if (client.capabilities.dataset) {
    queryInput.dataset = 'none';
    queryInput.limit_references = 0;
  }

  const { data, raw } = await client.queryJson<MetadataBatchLLMResponse>(queryInput);

  const usage = (raw.usage as { prompt_tokens?: number; completion_tokens?: number }) ?? {};
  const tokens_in = usage.prompt_tokens ?? 0;
  const tokens_out = usage.completion_tokens ?? 0;
  const usage_by_model: UsageByModel = {};
  recordUsage(usage_by_model, model, {
    tokens_in,
    tokens_out,
    web_search_results: raw.web_search_results,
  });

  const knownIds = fields.map((f) => f.section.id);
  const valuesById = extractFieldValues(data, knownIds);
  const generated_at = new Date().toISOString();

  let filled = 0;
  let skipped = 0;
  let errored = 0;

  for (const field of fields) {
    const value = valuesById.get(field.section.id) ?? '';
    if (!value) {
      skipped += 1;
      // Persist an error row that the user can see in the section
      // list AND that gives the assembly stage a sentinel to skip.
      // Include a [INSERT: ...] placeholder so the eventual assembled
      // document still has a marker the user can find-and-replace.
      try {
        const placeholder = `[INSERT: ${field.section.name || field.section.id}]`;
        const errRecord: DraftRecord = {
          id: field.draft_id,
          project_id: args.project.id,
          template_id: field.template.id,
          section_id: field.section.id,
          paragraphs: [{ role: 'body' as const, text: placeholder }],
          references: '',
          status: 'ready',
          generated_at,
          model,
          tokens_in: 0,
          tokens_out: 0,
        };
        await db.drafts.put(errRecord);
      } catch {
        errored += 1;
      }
      continue;
    }

    // Convert the flat string into the DraftParagraph shape used by
    // assembly. Multi-line blocks split on \n; each line becomes a
    // body paragraph. Single-line values become one paragraph.
    const lines = value.split(/\r?\n/).map((s) => s.trim()).filter((s) => s.length > 0);
    const paragraphs = lines.map((text) => ({
      role: 'body' as const,
      text,
    }));

    try {
      const ready: DraftRecord = {
        id: field.draft_id,
        project_id: args.project.id,
        template_id: field.template.id,
        section_id: field.section.id,
        paragraphs,
        references: '',
        prompt_sent: message,
        status: 'ready',
        generated_at,
        model,
        // Token cost is amortized across all metadata fields in this
        // single LLM call. Recording the full per-call total on every
        // row would double-count, so we attribute zero to each row and
        // surface the true total via the recipe stage's tokens_in/out.
        tokens_in: 0,
        tokens_out: 0,
        critic_iterations: undefined,
        critic_converged: undefined,
        critic_strictness: undefined,
        references_inlined_chars: 0,
        references_inlined_chunks: 0,
      };
      await db.drafts.put(ready);
      filled += 1;
    } catch {
      errored += 1;
    }
  }

  return { filled, skipped, errored, tokens_in, tokens_out, usage_by_model, model };
}

// ─── Prompt assembly ─────────────────────────────────────────────

function buildMetadataBatchMessage(args: {
  project: ProjectRecord;
  fields: CollectedField[];
  reference_files: ProjectContextFile[];
  notes_block?: string | null;
}): string {
  const lines: string[] = [];

  lines.push('=== PROJECT SUBJECT ===');
  lines.push(args.project.description?.trim() || '(empty)');
  lines.push('=== END PROJECT SUBJECT ===');
  lines.push('');

  // Notes are inlined verbatim, BEFORE shared inputs, because for
  // many short documents (memos, transfer actions) the user puts the
  // entire substance in the notes — addressee, soldier name, dates,
  // office symbol — and there are no attached files at all. Without
  // this the metadata batch would be unable to fill any of those
  // fields and they'd come back as "model returned no value".
  if (args.notes_block && args.notes_block.trim().length > 0) {
    lines.push(args.notes_block);
    lines.push('');
  }

  // Shared inputs (key/value pairs the user already filled in or that
  // pre-flight auto-filled). These are the strongest source for
  // metadata fields — most addressee/title/POC values come from here.
  const sharedKeys = Object.keys(args.project.shared_inputs ?? {});
  if (sharedKeys.length > 0) {
    lines.push(`=== SHARED INPUTS (${sharedKeys.length}) ===`);
    for (const k of sharedKeys) {
      const v = args.project.shared_inputs[k];
      if (typeof v === 'string' && v.trim().length > 0) {
        lines.push(`  ${k}: ${v.trim()}`);
      }
    }
    lines.push('=== END SHARED INPUTS ===');
    lines.push('');
  }

  // Reference INDEX only — chunk titles + summaries, never chunk text.
  const refLines: string[] = [];
  for (const f of args.reference_files) {
    const chunks = f.chunks ?? [];
    if (chunks.length === 0) {
      refLines.push(`  ${f.filename} (not yet chunked)`);
      continue;
    }
    refLines.push(`  ${f.filename}:`);
    for (const c of chunks) {
      const summary = c.summary?.trim() ? ` — ${c.summary.trim()}` : '';
      refLines.push(`    • ${c.title}${summary}`);
    }
  }
  if (refLines.length > 0) {
    lines.push(`=== REFERENCE INDEX (titles and summaries only — chunk bodies are NOT shown) ===`);
    lines.push(...refLines);
    lines.push('=== END REFERENCE INDEX ===');
    lines.push('');
  }

  lines.push(`=== REQUESTED FIELDS (${args.fields.length}) ===`);
  for (const f of args.fields) {
    const section = f.section;
    const tw = section.target_words ? `target_words: ${section.target_words[0]}-${section.target_words[1]}` : 'target_words: (unspecified)';
    lines.push(`--- ${section.id} ---`);
    lines.push(`  template: ${f.template.name}`);
    lines.push(`  name: ${section.name}`);
    if (section.intent && section.intent.trim().length > 0) {
      lines.push(`  intent: ${section.intent.trim()}`);
    }
    lines.push(`  ${tw}`);
    if (f.template_example && f.template_example.trim().length > 0) {
      // The template example is the strongest signal for what shape
      // the model should produce. Cap it so a misclassified section
      // can't blow the prompt.
      const capped = f.template_example.length > 600
        ? f.template_example.slice(0, 600) + '…'
        : f.template_example;
      lines.push(`  template_example: ${JSON.stringify(capped)}`);
    }
  }
  lines.push('=== END REQUESTED FIELDS ===');
  lines.push('');
  lines.push(
    `Fill in EVERY requested field using the project subject, project notes, shared inputs, and reference index. Return STRICT JSON per the OUTPUT SCHEMA in your system prompt. When you cannot ground a field, return a "[INSERT: <what's needed>]" placeholder instead of omitting the field — see the MISSING-CONTEXT POLICY in the system prompt.`,
  );

  return lines.join('\n');
}

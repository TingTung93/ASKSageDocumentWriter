// Per-slot drafter for document_part sections (page headers / page
// footers). Unlike the body-section drafter which emits a free-form
// DraftParagraph[], this drafter produces a narrow { slot_index, text }
// list targeting the parser-identified text slots in the header/footer
// XML. Drawing-bearing paragraphs (<w:drawing>, <w:pict>) are marked
// [FIXED] in the prompt and the drafter is told to skip them — the
// assembler refuses to rewrite those paragraphs anyway, so including
// them would just waste tokens.

import type { LLMClient } from '../provider/types';
import type { BodyFillRegion, TemplateSchema } from '../template/types';
import type { DocumentPartDraft, SlotDraftEntry } from './types';

export interface DraftDocumentPartArgs {
  template: TemplateSchema;
  section: BodyFillRegion & {
    fill_region: Extract<BodyFillRegion['fill_region'], { kind: 'document_part' }>;
  };
  /** Project subject so the drafter knows the document's topic. */
  project_description: string;
  /** Filled-in shared inputs (unit name, address, CUI banner, etc.). */
  shared_inputs: Record<string, string>;
}

/**
 * Build the per-slot prompt for a document_part section. Each
 * paragraph in the part appears as a numbered SLOT with its source
 * text, alignment, and font hint. Drawing / complex-content
 * paragraphs get a [FIXED] prefix and are excluded from the expected
 * output.
 */
export function buildDocumentPartPrompt(args: DraftDocumentPartArgs): string {
  const { template, section, project_description, shared_inputs } = args;
  const fr = section.fill_region;
  const lines: string[] = [];
  lines.push(`Template: ${template.name} (${template.source.filename})`);
  lines.push(``);
  lines.push(`=== SUBJECT ===`);
  lines.push(`This document is about: ${project_description || '(no subject)'}`);
  lines.push(`=== END SUBJECT ===`);

  if (Object.keys(shared_inputs).length > 0) {
    lines.push(``);
    lines.push(`=== SHARED INPUTS ===`);
    for (const [k, v] of Object.entries(shared_inputs)) {
      if (v && v.trim()) lines.push(`  ${k}: ${v}`);
    }
    lines.push(`=== END SHARED INPUTS ===`);
  }

  lines.push(``);
  lines.push(`=== SECTION ===`);
  lines.push(`id: ${section.id}`);
  lines.push(`name: ${section.name}`);
  lines.push(`placement: ${fr.placement}`);
  lines.push(`part_path: ${fr.part_path}`);
  if (section.intent) lines.push(`intent: ${section.intent}`);
  lines.push(``);

  lines.push(`SLOTS (one per paragraph in the ${fr.placement}):`);
  for (const d of fr.paragraph_details) {
    const slotSem = fr.slots?.find((s) => s.slot_index === d.slot_index);
    const fixed = d.has_drawing || d.has_complex_content;
    const prefix = fixed ? '[FIXED] ' : '';
    const fmt: string[] = [];
    if (d.alignment) fmt.push(d.alignment);
    if (d.font_family) fmt.push(d.font_family);
    if (d.font_size_pt) fmt.push(`${d.font_size_pt}pt`);
    const fmtPart = fmt.length > 0 ? `, ${fmt.join(', ')}` : '';
    lines.push(
      `${prefix}SLOT ${d.slot_index}  (source=${JSON.stringify(d.text)}${fmtPart})`,
    );
    if (slotSem) {
      if (slotSem.intent) lines.push(`  intent: ${slotSem.intent}`);
      if (slotSem.style_notes) lines.push(`  style_notes: ${slotSem.style_notes}`);
    }
  }

  lines.push(``);
  lines.push(
    `Respond with STRICT JSON: { "slots": [{ "slot_index": N, "text": "..." }, ...] }`,
  );
  lines.push(
    `Include ONLY slots whose text you want to change. Skip [FIXED] slots entirely — the assembler will not rewrite them. Write each slot's text to match the SUBJECT and SHARED INPUTS above, preserving the source style notes.`,
  );
  return lines.join('\n');
}

/**
 * Parse an LLM response body as a DocumentPartDraft. Accepts raw
 * text (possibly fenced as a markdown code block) and extracts the
 * embedded JSON. Throws on shape mismatch. When `section` is
 * supplied, rejects slots that point at a drawing / complex-content
 * paragraph (defense in depth — the assembler would reject them too).
 */
export function parseSlotsResponse(
  raw: string,
  section?: DraftDocumentPartArgs['section'],
): DocumentPartDraft {
  const jsonText = extractJsonFromText(raw);
  const parsed = JSON.parse(jsonText) as unknown;
  if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { slots?: unknown }).slots)) {
    throw new Error('parseSlotsResponse: expected { slots: [...] } object');
  }
  const slots: SlotDraftEntry[] = [];
  for (const s of (parsed as { slots: unknown[] }).slots) {
    if (!s || typeof s !== 'object') {
      throw new Error('invalid slot entry — not an object');
    }
    const obj = s as { slot_index?: unknown; text?: unknown };
    if (typeof obj.slot_index !== 'number' || typeof obj.text !== 'string') {
      throw new Error('invalid slot entry — missing slot_index or text');
    }
    if (section) {
      const d = section.fill_region.paragraph_details.find(
        (x) => x.slot_index === obj.slot_index,
      );
      if (d && (d.has_drawing || d.has_complex_content)) {
        throw new Error(`slot_index ${obj.slot_index} is non-draftable`);
      }
    }
    slots.push({ slot_index: obj.slot_index, text: obj.text });
  }
  return { kind: 'document_part', slots };
}

function extractJsonFromText(raw: string): string {
  // Strip leading / trailing whitespace and a markdown code fence if
  // present. Fall back to finding the first `{` … last `}`.
  let text = raw.trim();
  const fence = text.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  if (fence) text = fence[1]!.trim();
  const open = text.indexOf('{');
  const close = text.lastIndexOf('}');
  if (open >= 0 && close > open) return text.slice(open, close + 1);
  return text;
}

/**
 * Call the LLM to draft a document_part section into a per-slot
 * DocumentPartDraft. Thin wrapper — the interesting logic is in
 * buildDocumentPartPrompt and parseSlotsResponse.
 */
export async function draftDocumentPart(
  llm: LLMClient,
  args: DraftDocumentPartArgs,
  opts: { model?: string; temperature?: number } = {},
): Promise<DocumentPartDraft> {
  const prompt = buildDocumentPartPrompt(args);
  const { data, raw } = await llm.queryJson<unknown>({
    message: prompt,
    system_prompt:
      'You author letterhead slot rewrites for government DOCX headers and footers. Respond with STRICT JSON: { "slots": [{ "slot_index": N, "text": "..." }] }. Include ONLY slots you want to change. Skip [FIXED] slots.',
    model: opts.model ?? 'google-claude-46-sonnet',
    dataset: 'none',
    temperature: opts.temperature ?? 0,
    usage: true,
  });
  // queryJson returns already-parsed JSON. Re-validate via
  // parseSlotsResponse so drawing-slot checks apply uniformly.
  const text = JSON.stringify(data ?? raw.message ?? '');
  return parseSlotsResponse(text, args.section);
}

// Asks the LLM to review a finished document and propose surgical
// edits. The system prompt locks the model to a strict JSON output of
// `replace_paragraph_text` operations indexed against the paragraph
// list we send. The dispatcher applies them to a working state, and
// the writer eventually splices them into the original DOCX bytes.

import type { LLMClient } from '../provider/types';
import type { ParagraphInfo } from '../template/parser';
import type { DocumentEditOp, DocumentEditOutput } from './types';

export const DEFAULT_DOCUMENT_EDIT_MODEL = 'google-claude-46-sonnet';

const SYSTEM_PROMPT = `You are a careful editor reviewing a finished government document. Your job is to propose SURGICAL improvements — fix grammar, tighten wording, correct factual or formal errors, remove redundancy, and clean up obvious typos. You preserve the author's voice and intent and you NEVER rewrite paragraphs that are already clean.

You have a TYPED OP CATALOG you can emit. Pick the narrowest op for each change so the writer can preserve the maximum amount of surrounding formatting.

You output STRICT JSON only — no markdown code fences, no commentary outside the JSON:

{
  "edits": [ <op> , ... ],
  "rationale": "<optional one-sentence overall summary>"
}

OP CATALOG (use the narrowest op that does the job):

1. replace_paragraph_text — replace the entire visible text of one paragraph
   { "op": "replace_paragraph_text", "index": <int>, "new_text": "...", "rationale": "..." }

2. replace_run_text — replace the text of ONE run inside a paragraph (preserves bold/italic spans on other runs in the same paragraph). Prefer this over replace_paragraph_text when only part of a paragraph needs changing.
   { "op": "replace_run_text", "paragraph_index": <int>, "run_index": <int>, "new_text": "...", "rationale": "..." }

3. set_run_property — toggle bold / italic / underline / strike on a specific run
   { "op": "set_run_property", "paragraph_index": <int>, "run_index": <int>, "property": "bold" | "italic" | "underline" | "strike", "value": true | false, "rationale": "..." }

4. set_cell_text — replace the visible text of one table cell
   { "op": "set_cell_text", "table_index": <int>, "row_index": <int>, "cell_index": <int>, "new_text": "...", "rationale": "..." }

5. insert_table_row — clone a row and insert a new one after it (preserves the row's formatting / column widths / borders)
   { "op": "insert_table_row", "table_index": <int>, "after_row_index": <int>, "cells": ["cell 1 text", "cell 2 text", ...], "rationale": "..." }

6. delete_table_row — remove a row from a table
   { "op": "delete_table_row", "table_index": <int>, "row_index": <int>, "rationale": "..." }

7. set_content_control_value — update a Word content control by tag (CUI banner, document number, classification, dates, etc. that are stored as <w:sdt> elements)
   { "op": "set_content_control_value", "tag": "<sdt tag>", "value": "...", "rationale": "..." }

8. set_paragraph_style — change a paragraph's style id (e.g., promote a paragraph to a heading)
   { "op": "set_paragraph_style", "index": <int>, "style_id": "<style id>", "rationale": "..." }

9. set_paragraph_alignment — change a paragraph's alignment
   { "op": "set_paragraph_alignment", "index": <int>, "alignment": "left" | "center" | "right" | "justify" | "both", "rationale": "..." }

10. delete_paragraph — remove a paragraph entirely (use sparingly; prefer replacing with corrected text)
    { "op": "delete_paragraph", "index": <int>, "rationale": "..." }

CRITICAL CONSTRAINTS:
- Only emit edits where a change is actually warranted. A clean document yields an empty edits array.
- All paragraph indices MUST refer to paragraphs from the DOCUMENT BODY block below. Run indices MUST be valid for that paragraph. Out-of-range indices are silently dropped.
- Prefer replace_run_text over replace_paragraph_text when only one run changes — this preserves bold/italic spans elsewhere in the paragraph.
- Do NOT use markdown formatting (**, _, -). Inline formatting is encoded in run properties; use set_run_property to add/remove it.
- Preserve specialized terminology, acronyms, citations, dates, names, and section numbers exactly as written unless they are demonstrably wrong.
- Honor the user's instruction — it controls scope and tone of edits.

Return STRICT JSON only.`;

export interface DocumentEditRequest {
  document_name: string;
  paragraphs: ParagraphInfo[];
  /** Free-form user instruction. e.g. "tighten language" or "fix typos only" */
  instruction: string;
  model?: string;
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
  prompt_sent: string;
}

export async function requestDocumentEdits(
  client: LLMClient,
  args: DocumentEditRequest,
): Promise<DocumentEditResponse> {
  const model = args.model ?? DEFAULT_DOCUMENT_EDIT_MODEL;
  const message = buildEditMessage(args);

  const { data, raw } = await client.queryJson<DocumentEditOutput>({
    message,
    system_prompt: SYSTEM_PROMPT,
    model,
    dataset: 'none',
    temperature: 0,
    usage: true,
  });

  // Defensive: filter to indices that actually exist in the input
  const validIndices = new Set(args.paragraphs.map((p) => p.index));
  const allOps = data.edits ?? [];
  const all_valid_ops: DocumentEditOp[] = allOps.filter((op): op is DocumentEditOp => {
    if (!op || typeof op !== 'object' || !('op' in op)) return false;
    switch (op.op) {
      case 'replace_paragraph_text':
      case 'set_paragraph_style':
      case 'set_paragraph_alignment':
      case 'delete_paragraph':
        return typeof op.index === 'number' && validIndices.has(op.index);
      case 'replace_run_text':
      case 'set_run_property':
        return (
          typeof op.paragraph_index === 'number' &&
          validIndices.has(op.paragraph_index) &&
          typeof op.run_index === 'number' &&
          op.run_index >= 0
        );
      case 'set_cell_text':
      case 'insert_table_row':
      case 'delete_table_row':
      case 'set_content_control_value':
        return true; // table/sdt indices validated at writer time
      default:
        return false;
    }
  });

  const valid_edits: ReplaceParagraphTextOp[] = all_valid_ops.filter(
    (op): op is ReplaceParagraphTextOp => op.op === 'replace_paragraph_text',
  );

  const usage = (raw.usage as { prompt_tokens?: number; completion_tokens?: number }) ?? {};

  return {
    llm_output: data,
    valid_edits,
    all_valid_ops,
    tokens_in: usage.prompt_tokens ?? 0,
    tokens_out: usage.completion_tokens ?? 0,
    model,
    prompt_sent: message,
  };
}

function buildEditMessage(args: DocumentEditRequest): string {
  const { document_name, paragraphs, instruction } = args;
  // Filter to non-empty paragraphs (the LLM doesn't need to see blank
  // ones — the parser keeps them but they're not editable text).
  const significant = paragraphs.filter((p) => p.text.trim().length > 0);

  const lines: string[] = [];
  lines.push(`Document: ${document_name}`);
  lines.push(`Total paragraphs in source: ${paragraphs.length}`);
  lines.push(`Significant (non-empty) paragraphs sent below: ${significant.length}`);
  lines.push(``);
  lines.push(`User instruction: ${instruction || '(no specific instruction; perform a general cleanup pass for grammar, language, and obvious errors)'}`);
  lines.push(``);
  lines.push(`=== DOCUMENT BODY ===`);
  lines.push(
    `Each line is one paragraph. The format is: [<index>]<flags> <text>. Flags appear in {curly braces} only when present and describe the paragraph's formatting context (style id, alignment, indent, list level). Use them to understand the role of the paragraph — e.g. don't rewrite a centered title as left-aligned body text. Only edit paragraphs that need improvement; leave the rest alone.`,
  );
  lines.push(``);
  for (const p of significant) {
    lines.push(`[${p.index}]${formatParagraphFlags(p)} ${p.text}`);
  }
  lines.push(`=== END DOCUMENT BODY ===`);
  lines.push(``);
  lines.push(`Return STRICT JSON only with the edits array. Empty edits array is fine if the document is already clean.`);

  return lines.join('\n');
}

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

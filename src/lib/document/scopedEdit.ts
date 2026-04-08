// Selection-driven targeted edits.
//
// This is the "I know what's wrong, fix THIS part" counterpart to the
// chunked cleanup pass in lib/document/edit.ts. The user highlights a
// few paragraphs in the preview, types a brief instruction ("tighten
// this", "fix grammar"), and this module fires exactly ONE LLM call
// scoped to just that region. The returned ops land in the same
// accept/reject queue the chunked pass uses.
//
// Differences from requestDocumentEdits():
//   - No chunking. One LLM call, one small window.
//   - The user's instruction is the dominant signal — terse
//     instructions like "tighten" are respected literally and the
//     model is told NOT to introduce new content.
//   - A fixed number of read-only context paragraphs surrounds the
//     editable selection so tone/structure context is available
//     without giving the model room to edit outside the selection.
//   - No reference files / dataset grounding. Use the chunked pass
//     for grounded work; this is a fast targeted fix.

import type { LLMClient } from '../provider/types';
import type { ParagraphInfo } from '../template/parser';
import type { DocumentEditOp, DocumentEditOutput } from './types';

export const DEFAULT_SCOPED_EDIT_MODEL = 'google-claude-46-sonnet';

/** Default read-only context paragraphs rendered on either side of the selection. */
export const DEFAULT_SCOPED_CONTEXT_WINDOW = 2;

// MIRRORED FROM lib/document/edit.ts:SYSTEM_PROMPT — keep in sync.
// The scoped variant swaps the "CHUNK of the document" framing for
// "SELECTED REGION", tells the model the user instruction is dominant,
// forbids introducing new content for tightening-style instructions,
// and reminds it that [ctx] paragraphs are read-only.
const SCOPED_SYSTEM_PROMPT = `You are a careful editor making a TARGETED EDIT to a small REGION of a finished government document. The user has selected a handful of paragraphs and given you a brief instruction. You will ONLY edit the paragraphs labeled [edit]. Paragraphs labeled [ctx] are read-only context from the surrounding document — read them for tone, terminology, and structure, but do NOT propose edits against them.

The user's instruction is the DOMINANT signal. If the instruction says "tighten" or "shorten", REMOVE words; do NOT introduce new facts, sentences, or content. If the instruction says "fix grammar", fix grammar and typos only; do NOT rewrite otherwise-clean sentences. If the instruction says "make more formal", adjust tone and word choice; do NOT add or remove substance. Honor the instruction tightly — propose the narrowest set of ops that satisfies it.

You have a TYPED OP CATALOG you can emit. Pick the NARROWEST op for each change so the writer can preserve the maximum amount of surrounding formatting.

CRITICAL — UNDERSTAND WHAT A "RUN" IS BEFORE EMITTING replace_run_text
A "run" (<w:r> in OOXML) is a tiny formatting fragment, NOT a sentence or a paragraph. Word splits a paragraph into multiple runs whenever the formatting changes — at every bold span, italic span, hyperlink, font change, or color change. A typical paragraph has 1-10 runs. The SELECTED REGION below shows you each paragraph's runs explicitly with their actual text content. Read them carefully:
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
3. insert_paragraph_after — add a NEW paragraph after the given index. Use sparingly in scoped edits — only if the user's instruction explicitly calls for it.
   { "op": "insert_paragraph_after", "index": <int>, "new_text": "...", "style_id": "<optional pStyle id>", "rationale": "..." }

4. merge_paragraphs — combine paragraph N with paragraph N+1.
   { "op": "merge_paragraphs", "index": <int>, "separator": " ", "rationale": "..." }

5. split_paragraph — break one paragraph into two at a verbatim substring.
   { "op": "split_paragraph", "index": <int>, "split_at_text": "...", "rationale": "..." }

6. delete_paragraph — remove a paragraph entirely. Use sparingly.
   { "op": "delete_paragraph", "index": <int>, "rationale": "..." }

PARAGRAPH FORMATTING
7. set_paragraph_style — change pStyle. Common ids: Normal, Heading1..6, BodyText, Quote, ListBullet, ListNumber.
   { "op": "set_paragraph_style", "index": <int>, "style_id": "<style id>", "rationale": "..." }

8. set_paragraph_alignment — left | center | right | justify | both.
   { "op": "set_paragraph_alignment", "index": <int>, "alignment": "left", "rationale": "..." }

9. set_paragraph_indent — set left, first-line, or hanging indent in twips (1440 twips = 1 inch). Pass null to clear; omit to leave unchanged.
   { "op": "set_paragraph_indent", "paragraph_index": <int>, "left_twips": 720, "first_line_twips": 360, "rationale": "..." }

10. set_paragraph_spacing — space before/after and line spacing.
    { "op": "set_paragraph_spacing", "paragraph_index": <int>, "before_twips": 0, "after_twips": 240, "line_value": 360, "line_rule": "auto", "rationale": "..." }

RUN FORMATTING
11. set_run_property — toggle bold / italic / underline / strike on a run.
    { "op": "set_run_property", "paragraph_index": <int>, "run_index": <int>, "property": "bold", "value": true, "rationale": "..." }

12. set_run_font — change a run's font family and/or size.
    { "op": "set_run_font", "paragraph_index": <int>, "run_index": <int>, "family": "Times New Roman", "size_pt": 12, "rationale": "..." }

13. set_run_color — set a run's text color (hex without #) and/or highlight.
    { "op": "set_run_color", "paragraph_index": <int>, "run_index": <int>, "color": "FF0000", "highlight": null, "rationale": "..." }

TABLES
14. set_cell_text — replace one table cell's text.
    { "op": "set_cell_text", "table_index": <int>, "row_index": <int>, "cell_index": <int>, "new_text": "...", "rationale": "..." }

15. insert_table_row — clone a row and insert a new one after it.
    { "op": "insert_table_row", "table_index": <int>, "after_row_index": <int>, "cells": ["cell 1", "cell 2"], "rationale": "..." }

16. delete_table_row — remove a row from a table.
    { "op": "delete_table_row", "table_index": <int>, "row_index": <int>, "rationale": "..." }

CONTENT CONTROLS
17. set_content_control_value — update a Word content control by tag.
    { "op": "set_content_control_value", "tag": "<sdt tag>", "value": "...", "rationale": "..." }

CRITICAL CONSTRAINTS:
- A clean selection yields { "edits": [] }. Do not invent edits to look productive.
- ONLY emit edits for paragraphs labeled [edit]. Paragraphs labeled [ctx] are READ-ONLY context.
- All paragraph indices MUST refer to the exact integer labels shown in the SELECTED REGION below. Out-of-range indices are silently dropped.
- replace_run_text new_text length must be COMPARABLE to the original run's text length. Use replace_paragraph_text for longer rewrites.
- Do NOT use markdown formatting (**, _, -). Inline formatting is encoded in run properties.
- Preserve specialized terminology, acronyms, citations, dates, names, and section numbers exactly as written unless they are demonstrably wrong.
- Honor the user's instruction tightly. "Tighten" means REMOVE words. "Fix grammar" means fix grammar only. Do not expand scope.

Return STRICT JSON only.`;

export interface ScopedEditArgs {
  /** Significant paragraphs the WHOLE document — needed for index resolution. */
  all_paragraphs: ParagraphInfo[];
  /**
   * Absolute indices in `all_paragraphs` the user selected. Editable
   * scope. Must be non-empty.
   */
  selected_indices: number[];
  /**
   * User's free-form instruction for this region. Must be non-empty.
   */
  instruction: string;
  /**
   * Number of context paragraphs to include around the selection on
   * each side. Defaults to 2. Read-only context: the model sees them
   * but is told not to edit them.
   */
  context_window?: number;
  model?: string;
}

export interface ScopedEditResult {
  /** Edit ops the model emitted for the selection. Already validated. */
  ops: DocumentEditOp[];
  tokens_in: number;
  tokens_out: number;
  model: string;
  prompt_sent: string;
  raw_output: unknown;
}

/**
 * Run a single LLM call against a small region of the document with
 * a user-supplied instruction. Returns validated ops the caller can
 * fold into the existing accept/reject queue.
 */
export async function runScopedEdit(
  client: LLMClient,
  args: ScopedEditArgs,
): Promise<ScopedEditResult> {
  // ─── Input validation ─────────────────────────────────────────
  if (!Array.isArray(args.selected_indices) || args.selected_indices.length === 0) {
    throw new Error('runScopedEdit: selected_indices must be a non-empty array');
  }
  if (typeof args.instruction !== 'string' || args.instruction.trim().length === 0) {
    throw new Error('runScopedEdit: instruction must be a non-empty string');
  }
  const validIndexSet = new Set(args.all_paragraphs.map((p) => p.index));
  for (const idx of args.selected_indices) {
    if (!validIndexSet.has(idx)) {
      throw new Error(
        `runScopedEdit: selected index ${idx} is not present in all_paragraphs`,
      );
    }
  }

  const model = args.model ?? DEFAULT_SCOPED_EDIT_MODEL;
  const contextWindow = Math.max(0, args.context_window ?? DEFAULT_SCOPED_CONTEXT_WINDOW);

  // ─── Build the window around the selection ───────────────────
  // Work in significant-paragraph space (edit.ts does the same — it
  // filters blanks before chunking). Sort significants by absolute
  // index and find the positions of each selected paragraph.
  const significant = args.all_paragraphs
    .filter((p) => p.text.trim().length > 0)
    .sort((a, b) => a.index - b.index);
  const editableSet = new Set(args.selected_indices);

  // Positions of the selected paragraphs within `significant`.
  const sigPositionsForSelection: number[] = [];
  for (let i = 0; i < significant.length; i++) {
    if (editableSet.has(significant[i]!.index)) sigPositionsForSelection.push(i);
  }

  // Fallback: if none of the selected indices are "significant" (e.g.
  // the user selected a blank-only paragraph), keep the selection
  // itself as editable and render it without context.
  let windowParagraphs: ParagraphInfo[];
  if (sigPositionsForSelection.length === 0) {
    windowParagraphs = args.all_paragraphs.filter((p) => editableSet.has(p.index));
  } else {
    const firstPos = sigPositionsForSelection[0]!;
    const lastPos = sigPositionsForSelection[sigPositionsForSelection.length - 1]!;
    const winStart = Math.max(0, firstPos - contextWindow);
    const winEnd = Math.min(significant.length, lastPos + 1 + contextWindow);
    windowParagraphs = significant.slice(winStart, winEnd);
  }

  // ─── Build the user message ──────────────────────────────────
  const message = buildScopedEditMessage({
    instruction: args.instruction,
    window: windowParagraphs,
    editable: editableSet,
  });

  // ─── Single LLM call ─────────────────────────────────────────
  const { data, raw } = await client.queryJson<DocumentEditOutput>({
    message,
    system_prompt: SCOPED_SYSTEM_PROMPT,
    model,
    dataset: 'none',
    temperature: 0,
    usage: true,
  });

  // ─── Validate + auto-promote ─────────────────────────────────
  const rawOps = Array.isArray(data?.edits) ? data.edits : [];
  const validated: DocumentEditOp[] = [];
  for (const op of rawOps) {
    if (!isValidOpScoped(op, validIndexSet, editableSet)) continue;
    validated.push(maybePromoteRunOpScoped(op, args.all_paragraphs));
  }

  const usage =
    (raw?.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined) ??
    {};

  return {
    ops: validated,
    tokens_in: usage.prompt_tokens ?? 0,
    tokens_out: usage.completion_tokens ?? 0,
    model,
    prompt_sent: message,
    raw_output: data,
  };
}

// ─── Prompt assembly ──────────────────────────────────────────────

interface BuildScopedMessageArgs {
  instruction: string;
  window: ParagraphInfo[];
  editable: Set<number>;
}

function buildScopedEditMessage(a: BuildScopedMessageArgs): string {
  const lines: string[] = [];
  lines.push(`User instruction: ${a.instruction.trim()}`);
  lines.push(``);
  lines.push(
    `You are editing the SELECTED REGION of a longer document. Only emit edits for paragraphs labeled [edit]. Paragraphs labeled [ctx] are read-only context from the surrounding document — read them for tone and structure but do NOT propose edits against them.`,
  );
  lines.push(``);
  lines.push(`=== SELECTED REGION ===`);
  lines.push(
    `Each paragraph is rendered as a header line plus one indented line per <w:r> run (when the paragraph has more than one run). The header format is: <gate>[<index>]<flags> <text>. The gate is "[edit]" for paragraphs you may propose edits against, or "[ctx]" for read-only context paragraphs. Indices are absolute over the full document. Flags appear in {curly braces} only when present.`,
  );
  lines.push(``);
  for (const p of a.window) {
    const gate = a.editable.has(p.index) ? '[edit]' : '[ctx] ';
    lines.push(`${gate}[${p.index}]${formatParagraphFlagsScoped(p)} ${p.text}`);
    if (p.runs && p.runs.length > 1) {
      for (let i = 0; i < p.runs.length; i++) {
        const run = p.runs[i]!;
        const text = run.text.length > 0 ? JSON.stringify(run.text) : '""';
        lines.push(`    run[${i}] (${run.text.length} chars): ${text}`);
      }
    }
  }
  lines.push(`=== END SELECTED REGION ===`);
  lines.push(``);
  lines.push(
    `Return STRICT JSON only with the edits array. Empty edits array is fine if the selection is already clean or the instruction cannot be satisfied without adding content.`,
  );
  return lines.join('\n');
}

// ─── MIRRORED FROM lib/document/edit.ts:isValidOp — keep in sync ──
function isValidOpScoped(
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
      // validates them at apply time. In scoped mode we still allow
      // them so a user can target a single cell inside a selection.
      return true;
    default:
      return false;
  }
}

// ─── MIRRORED FROM lib/document/edit.ts:maybePromoteRunOp — keep in sync ──
function maybePromoteRunOpScoped(
  op: DocumentEditOp,
  paragraphs: ParagraphInfo[],
): DocumentEditOp {
  if (op.op !== 'replace_run_text') return op;
  const p = paragraphs.find((para) => para.index === op.paragraph_index);
  if (!p) return op;
  const targetRun = p.runs?.[op.run_index];
  if (!targetRun) return op;
  const runLen = targetRun.text.length;
  const newLen = op.new_text.length;
  if (newLen < 80) return op;
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

// ─── MIRRORED FROM lib/document/edit.ts:formatParagraphFlags — keep in sync ──
function formatParagraphFlagsScoped(p: ParagraphInfo): string {
  const flags: string[] = [];
  if (p.style_id) flags.push(`style=${p.style_id}`);
  if (p.alignment && p.alignment !== 'left') flags.push(`align=${p.alignment}`);
  if (p.indent_left_twips && p.indent_left_twips > 0) {
    flags.push(`indent=${twipsToInchesScoped(p.indent_left_twips)}in`);
  }
  if (p.indent_first_line_twips && p.indent_first_line_twips > 0) {
    flags.push(`first_line=${twipsToInchesScoped(p.indent_first_line_twips)}in`);
  }
  if (p.indent_hanging_twips && p.indent_hanging_twips > 0) {
    flags.push(`hanging=${twipsToInchesScoped(p.indent_hanging_twips)}in`);
  }
  if (p.numbering_id !== null && p.numbering_id !== undefined) {
    flags.push(`list=${p.numbering_id}.${p.numbering_level ?? 0}`);
  }
  if (p.in_table) flags.push(`in_table`);
  if (p.content_control_tag) flags.push(`sdt=${p.content_control_tag}`);
  return flags.length > 0 ? ` {${flags.join(', ')}}` : '';
}

function twipsToInchesScoped(twips: number): string {
  return (twips / 1440).toFixed(2);
}

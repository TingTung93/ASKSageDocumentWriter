// style_consistency.ts — document-level formatting/style review pass.
//
// Phase 4.5 of the drafting pipeline. After every section is drafted
// (and converged through the critic loop) and after the cross-section
// content review, this pass takes ONE more LLM call to look at the
// FORMATTING of the whole drafted document and emit structured fix
// ops to normalize style consistency before the assembler runs.
//
// The user-visible problem this solves:
//
//   "The resulting output has a mix of different fonts, formatting
//    styles and horribly malformed tables."
//
// Each section was drafted independently. The drafter does not see
// what other sections did. So one section emits bullets, another
// emits inline body text for the same shaped content; one section
// marks a header row with is_header, another forgets; one drafter
// sneaks **bold** markdown into text after we told it not to; one
// drafter splits a 3-cell row across two table_row paragraphs.
//
// Design notes:
//
//   - OP-BASED, NOT WHOLE-DOC REWRITE. We send the whole document
//     JSON to the model, but we DO NOT ask the model to send the
//     whole document back. Instead it returns a list of structured
//     fix ops keyed by `section_id` + `paragraph_index`. The applier
//     mutates the in-memory drafts locally. This avoids:
//       - content loss from output truncation
//       - cost surprises (output volume is bounded by op count)
//       - token bloat from echoing unchanged paragraphs
//       - drift from the model "improving" content silently
//
//   - SUBJECT-AGNOSTIC PROMPT. Like cross_section.ts and critique.ts,
//     this pass MUST NOT name any specific topic. The model is told
//     to look for FORMATTING and STRUCTURE issues only — content
//     review is out of scope (cross_section.ts handles that).
//
//   - DETERMINISTIC SANITIZATION. Every op the model emits is
//     validated against the actual draft map (known section ids,
//     in-range paragraph indices, valid role values). Malformed ops
//     are dropped — never partially applied.
//
//   - REVERSE-ORDER DELETE. delete_paragraph ops within the same
//     section are applied highest-index-first so earlier indices
//     stay valid. All other ops are stable across application order.
//
//   - DATASET=NONE. No RAG. The drafted document IS the source.

import type { LLMClient } from '../provider/types';
import type { BodyFillRegion, TemplateSchema } from '../template/types';
import type { DraftParagraph, DraftRun, ParagraphRole } from './types';
import { type UsageByModel, recordUsage } from '../usage';
import { resolveDraftingModel } from '../provider/resolve_model';

// ─── Public types ────────────────────────────────────────────────

export type StyleFixOpKind =
  | 'set_role'
  | 'set_runs'
  | 'clear_runs'
  | 'set_text'
  | 'set_level'
  | 'set_table_header'
  | 'set_cell'
  | 'pad_table_row'
  | 'delete_paragraph'
  | 'set_page_break_before';

/**
 * One structured fix the style reviewer wants applied. Every op is
 * keyed by `section_id` + `paragraph_index` so the applier can locate
 * the target paragraph in the draft map.
 *
 * The discriminator field is `kind`. The other fields depend on the
 * op type — see the SYSTEM_PROMPT below for the exact contract the
 * model is held to.
 */
export interface StyleFixOp {
  kind: StyleFixOpKind;
  section_id: string;
  paragraph_index: number;
  /** Optional rationale (used for diagnostics + UI surfacing). */
  reason?: string;

  // ── set_role ──
  role?: ParagraphRole;

  // ── set_runs ──
  runs?: DraftRun[];

  // ── set_text ──
  text?: string;

  // ── set_level ──
  level?: number;

  // ── set_table_header ──
  is_header?: boolean;

  // ── set_cell ──
  cell_index?: number;
  cell_text?: string;

  // ── pad_table_row ──
  target_cell_count?: number;

  // ── set_page_break_before ──
  page_break_before?: boolean;
}

export interface StyleConsistencyResult {
  /** Ops the model proposed (after sanitization). */
  ops: StyleFixOp[];
  /** Ops we actually applied (a subset of `ops` — anything that survived range checks at apply time). */
  ops_applied: StyleFixOp[];
  /** Ops we dropped during sanitization (unknown section, out of range, malformed, etc.). */
  ops_dropped: Array<{ op: unknown; reason: string }>;
  /** Updated draft map after applying the ops. */
  updated: Map<string, DraftParagraph[]>;
  tokens_in: number;
  tokens_out: number;
  usage_by_model: UsageByModel;
  model: string;
  /** Prompt sent to the model (audit/diagnostics). */
  prompt_sent: string;
  /** Raw model JSON before sanitization. */
  raw_output: unknown;
}

/**
 * One drafted section's content packaged for the style review pass.
 * Same shape as DraftedSectionInput in cross_section.ts but kept
 * separate so the two passes can evolve independently.
 */
export interface StyleReviewSectionInput {
  template_id: string;
  template_name: string;
  section: BodyFillRegion;
  paragraphs: DraftParagraph[];
}

export interface StyleConsistencyArgs {
  client: LLMClient;
  /** SUBJECT one-liner — used to anchor the model on the right document, not for content judgment. */
  project_description: string;
  /** Templates included in the project (for style metadata: voice, tense, register, named_styles). */
  templates: TemplateSchema[];
  /** Every drafted section in the project. */
  sections: StyleReviewSectionInput[];
  /** Optional model override. Defaults via resolveDraftingModel. */
  model?: string;
  /** Optional cap on the total number of ops we'll accept. Default 200. */
  max_ops?: number;
}

export const DEFAULT_STYLE_REVIEW_TEMPERATURE = 0;
export const DEFAULT_STYLE_REVIEW_MAX_OPS = 200;

// ─── System prompt (subject-agnostic, formatting-only) ───────────

const STYLE_REVIEW_SYSTEM_PROMPT = `You are a FORMATTING and STRUCTURE reviewer for a formal government document that was drafted one section at a time. Each section was drafted by an independent LLM call with no awareness of how other sections were formatted. Your job is to look across the WHOLE document at once and emit a list of structured FIX OPS to normalize style consistency before the document is assembled into a Word file.

You are NOT a content reviewer. A separate cross-section pass already checked for contradictions, terminology drift, and missing references. You only care about formatting and structural shape.

You output ONLY structured ops. You NEVER output revised paragraphs or rewritten text — instead you emit one op per change you want made.

OUTPUT SCHEMA — strict JSON only, no markdown code fences, no commentary:

{
  "ops": [
    {
      "kind": "<op kind>",
      "section_id": "<exact id from the SECTION LIST>",
      "paragraph_index": <integer index into that section's paragraphs[]>,
      "reason": "<one short sentence — why this fix is needed>",
      ... op-specific fields ...
    }
  ]
}

OP CATALOG — exact field requirements:

  - "set_role"           — fix a misclassified paragraph. Required: { role: "<one of: heading,body,step,bullet,note,caution,warning,definition,table_row,quote>" }
  - "set_runs"           — replace a paragraph's text with rich-text runs. Required: { runs: [ { text, bold?, italic?, underline?, strike? }, ... ] }
  - "clear_runs"         — strip all rich-text runs and revert to plain text. No additional fields.
  - "set_text"           — replace plain text (e.g. to strip leaked **markdown** asterisks/underscores). Required: { text: "<new plain text>" }
  - "set_level"          — fix nesting/indent level. Required: { level: <integer 0..3> }
  - "set_table_header"   — mark or unmark a table_row as a header row. Required: { is_header: true | false }
  - "set_cell"           — replace one cell of a table_row. Required: { cell_index: <int>, cell_text: "<new cell text>" }
  - "pad_table_row"      — pad a table_row to a target column count by appending empty cells. Required: { target_cell_count: <int> }
  - "delete_paragraph"   — drop a paragraph entirely (e.g. duplicate heading, accidental empty paragraph, leaked markdown noise). No additional fields.
  - "set_page_break_before" — toggle the page_break_before flag. Required: { page_break_before: true | false }

WHAT TO LOOK FOR:

  1. Inconsistent table structure across what should be ONE table:
     - Rows with different cells.length
     - First row of a table missing is_header=true (header row was emitted as a body row)
     - A table_row that should NOT be a header is marked is_header=true
     - A multi-cell row that was accidentally split into two table_row paragraphs (collapse via delete_paragraph + set_cell)

  2. Leaked markdown formatting in text fields:
     - "**bold**" / "__bold__" / "_italic_" / "*italic*" inside text or runs
       → emit set_text (plain) or set_runs (rich) to replace with proper run formatting

  3. Inconsistent role usage across the document:
     - One section uses "bullet" for action items, another uses "body" for the same shape
     - A line that's clearly a heading ("Section 3 — Background") tagged as body
     - A line that's clearly a step in a numbered procedure tagged as body or bullet

  4. Inconsistent heading hierarchy:
     - A sub-heading inside a section emitted at level 0 (same as the section title)
     - Heading levels jumping (level 0 → level 3 with no level 1/2 in between)

  5. Inconsistent bullet/step nesting:
     - Sub-bullets at the same level as their parent
     - Bullets inside a clearly numbered procedure (or vice versa)

  6. Page break placement:
     - A page_break_before set on something that isn't a major section start
     - A major section (cover page, signature page, appendix) missing a page break before its first paragraph

  7. Stray empty / cruft paragraphs:
     - Empty body paragraphs between sections (delete_paragraph)
     - Duplicate headings (delete_paragraph on the dup)

WHAT YOU DO NOT TOUCH:

  - Content. Do not edit text to change meaning, fix grammar, or add/remove information. Use set_text ONLY to remove leaked markdown noise like ** or _ or to fix obvious typos in formatting (extra whitespace, doubled punctuation introduced by tokenization).
  - Subject matter. The cross-section pass handles content drift.
  - Length. Length validation is the per-section critic's job.

GUIDELINES:

  - Be CONSERVATIVE. If a paragraph's formatting is reasonable, leave it alone. Only emit ops for problems you can NAME and POINT TO. The user will see your reason field.
  - One issue → one op. Do not bundle multiple changes into a single op.
  - Cap your output at 60 ops total even if more issues exist. Pick the highest-impact fixes first (table structure > leaked markdown > role mismatches > heading levels > bullet nesting > stray empties).
  - Section ids and paragraph indices MUST be exact — copy them verbatim from the SECTION LIST below.
  - Return STRICT JSON only. No commentary outside the JSON object.`;

interface BuiltStyleReviewPrompt {
  system_prompt: string;
  message: string;
}

// ─── Prompt builder ──────────────────────────────────────────────

function buildStyleReviewPrompt(args: StyleConsistencyArgs): BuiltStyleReviewPrompt {
  const { project_description, templates, sections } = args;
  const lines: string[] = [];

  // ── 1. SUBJECT (one line — anchors the model, not for content judgment) ──
  lines.push(`=== SUBJECT ===`);
  lines.push(
    `This document is about: ${project_description || '(no subject set)'}`,
  );
  lines.push(
    `You are reviewing FORMATTING and STRUCTURE only. Do not edit content for meaning, grammar, or accuracy.`,
  );
  lines.push(`=== END SUBJECT ===`);

  // ── 2. TEMPLATE STYLE METADATA ──
  // Tells the model what voice/tense/register the document is supposed
  // to use AND which named paragraph styles the template provides. The
  // applier doesn't act on style names, but the model uses them to
  // judge whether a section's role choices are reasonable.
  if (templates.length > 0) {
    lines.push(``);
    lines.push(`=== TEMPLATES ===`);
    for (const t of templates) {
      const styleBits: string[] = [];
      if (t.style.voice) styleBits.push(`voice=${t.style.voice}`);
      if (t.style.tense) styleBits.push(`tense=${t.style.tense}`);
      if (t.style.register) styleBits.push(`register=${t.style.register}`);
      const style = styleBits.length > 0 ? `  [${styleBits.join(', ')}]` : '';
      lines.push(`- ${t.id}: ${t.name}${style}`);
      const namedStyles = (t.formatting?.named_styles ?? []).map((s) => s.id);
      if (namedStyles.length > 0) {
        // Cap at 20 to keep token usage bounded.
        const shown = namedStyles.slice(0, 20);
        lines.push(`  styles: ${shown.join(', ')}${namedStyles.length > 20 ? ', ...' : ''}`);
      }
    }
    lines.push(`=== END TEMPLATES ===`);
  }

  // ── 3. SECTION LIST (the actual draft, with paragraph indices) ──
  lines.push(``);
  lines.push(`=== SECTION LIST (document order) ===`);
  lines.push(`Total sections: ${sections.length}`);
  for (const s of sections) {
    lines.push(``);
    lines.push(`--- section_id=${s.section.id} ---`);
    lines.push(`name: ${s.section.name}`);
    lines.push(`template: ${s.template_name} (${s.template_id})`);
    const allowed = s.section.fill_region.permitted_roles ?? ['body'];
    lines.push(`permitted_roles: ${allowed.join(', ')}`);
    lines.push(`paragraphs:`);
    s.paragraphs.forEach((p, idx) => {
      lines.push(`  ${formatParagraphLine(idx, p)}`);
    });
  }
  lines.push(``);
  lines.push(`=== END SECTION LIST ===`);

  // ── 4. Closing instruction ──
  lines.push(``);
  lines.push(
    `Review the SECTION LIST above for FORMATTING and STRUCTURAL issues only. Emit a list of ops in the schema specified by your system prompt. section_id and paragraph_index MUST exactly match the values shown above. If everything is consistent, return {"ops": []}.`,
  );

  return {
    system_prompt: STYLE_REVIEW_SYSTEM_PROMPT,
    message: lines.join('\n'),
  };
}

/**
 * Compact one-line representation of a paragraph for the prompt.
 * Includes role, level (when nonzero), is_header (when true),
 * page_break_before (when true), and the text or cells. Runs are
 * collapsed by joining their text but the per-run formatting is
 * preserved as inline markers `[b]`/`[i]`/`[u]`/`[s]` so the model
 * can spot inconsistent rich-text application without us shipping
 * the full runs[] structure.
 */
function formatParagraphLine(idx: number, p: DraftParagraph): string {
  const tags: string[] = [`role=${p.role}`];
  if (typeof p.level === 'number' && p.level > 0) tags.push(`level=${p.level}`);
  if (p.is_header === true) tags.push(`is_header=true`);
  if (p.page_break_before === true) tags.push(`page_break_before=true`);

  let body: string;
  if (p.role === 'table_row' && Array.isArray(p.cells)) {
    body = `cells=[${p.cells.map((c) => JSON.stringify(c)).join(', ')}]`;
  } else if (Array.isArray(p.runs) && p.runs.length > 0) {
    body = 'runs=' + p.runs
      .map((r) => {
        const marks: string[] = [];
        if (r.bold) marks.push('b');
        if (r.italic) marks.push('i');
        if (r.underline) marks.push('u');
        if (r.strike) marks.push('s');
        const tag = marks.length > 0 ? `[${marks.join('')}]` : '';
        return `${tag}${JSON.stringify(r.text ?? '')}`;
      })
      .join('+');
  } else {
    const text = (p.text ?? '').replace(/\s+/g, ' ').trim();
    body = `text=${JSON.stringify(text)}`;
  }
  return `[${idx}] ${tags.join(' ')} ${body}`;
}

// ─── Sanitization ────────────────────────────────────────────────

const VALID_OP_KINDS: ReadonlySet<StyleFixOpKind> = new Set([
  'set_role',
  'set_runs',
  'clear_runs',
  'set_text',
  'set_level',
  'set_table_header',
  'set_cell',
  'pad_table_row',
  'delete_paragraph',
  'set_page_break_before',
]);

const VALID_ROLES: ReadonlySet<ParagraphRole> = new Set<ParagraphRole>([
  'heading',
  'body',
  'step',
  'bullet',
  'note',
  'caution',
  'warning',
  'definition',
  'table_row',
  'quote',
]);

interface RawStyleResponse {
  ops?: unknown;
}

/**
 * Validate one raw op object against the live draft map. Returns the
 * sanitized op or a string describing why it was dropped.
 *
 * Validation rules per kind:
 *   - section_id MUST exist in the draft map
 *   - paragraph_index MUST be an integer in [0, length)
 *   - kind-specific required fields MUST be present and well-typed
 *   - role / level / cell counts are clamped/coerced like the assembler
 */
function sanitizeOp(
  raw: unknown,
  drafts: Map<string, DraftParagraph[]>,
): StyleFixOp | string {
  if (!raw || typeof raw !== 'object') return 'op is not an object';
  const o = raw as Record<string, unknown>;

  const kindRaw = String(o.kind ?? '').trim() as StyleFixOpKind;
  if (!VALID_OP_KINDS.has(kindRaw)) return `unknown kind: ${kindRaw}`;

  const section_id = typeof o.section_id === 'string' ? o.section_id : '';
  if (!section_id) return 'missing section_id';
  const sectionDraft = drafts.get(section_id);
  if (!sectionDraft) return `unknown section_id: ${section_id}`;

  const idxRaw = o.paragraph_index;
  const paragraph_index = typeof idxRaw === 'number' ? Math.floor(idxRaw) : NaN;
  if (
    !Number.isFinite(paragraph_index) ||
    paragraph_index < 0 ||
    paragraph_index >= sectionDraft.length
  ) {
    return `paragraph_index out of range: ${idxRaw}`;
  }

  const reason =
    typeof o.reason === 'string' && o.reason.trim().length > 0
      ? o.reason.trim().slice(0, 280)
      : undefined;

  const base: StyleFixOp = {
    kind: kindRaw,
    section_id,
    paragraph_index,
    reason,
  };

  switch (kindRaw) {
    case 'set_role': {
      const role = String(o.role ?? '') as ParagraphRole;
      if (!VALID_ROLES.has(role)) return `set_role: unknown role ${o.role}`;
      return { ...base, role };
    }
    case 'set_runs': {
      if (!Array.isArray(o.runs) || o.runs.length === 0) {
        return 'set_runs: runs must be a non-empty array';
      }
      const runs: DraftRun[] = [];
      for (const r of o.runs) {
        if (!r || typeof r !== 'object') continue;
        const rr = r as Record<string, unknown>;
        const text = typeof rr.text === 'string' ? rr.text : '';
        if (!text) continue;
        const run: DraftRun = { text };
        if (typeof rr.bold === 'boolean') run.bold = rr.bold;
        if (typeof rr.italic === 'boolean') run.italic = rr.italic;
        if (typeof rr.underline === 'boolean') run.underline = rr.underline;
        if (typeof rr.strike === 'boolean') run.strike = rr.strike;
        runs.push(run);
      }
      if (runs.length === 0) return 'set_runs: no usable runs after sanitization';
      return { ...base, runs };
    }
    case 'clear_runs': {
      // No extra fields. Validate that the target paragraph actually
      // has runs to clear — otherwise the op is a no-op and we drop it
      // to keep the applied count meaningful.
      const target = sectionDraft[paragraph_index]!;
      if (!Array.isArray(target.runs) || target.runs.length === 0) {
        return 'clear_runs: target has no runs to clear';
      }
      return base;
    }
    case 'set_text': {
      if (typeof o.text !== 'string') return 'set_text: text must be a string';
      return { ...base, text: o.text };
    }
    case 'set_level': {
      const level = typeof o.level === 'number' ? Math.floor(o.level) : NaN;
      if (!Number.isFinite(level) || level < 0 || level > 8) {
        return `set_level: level out of range ${o.level}`;
      }
      return { ...base, level };
    }
    case 'set_table_header': {
      if (typeof o.is_header !== 'boolean') {
        return 'set_table_header: is_header must be a boolean';
      }
      const target = sectionDraft[paragraph_index]!;
      if (target.role !== 'table_row') {
        return 'set_table_header: target is not a table_row';
      }
      return { ...base, is_header: o.is_header };
    }
    case 'set_cell': {
      const cell_index = typeof o.cell_index === 'number' ? Math.floor(o.cell_index) : NaN;
      if (!Number.isFinite(cell_index) || cell_index < 0) {
        return `set_cell: cell_index out of range ${o.cell_index}`;
      }
      if (typeof o.cell_text !== 'string') {
        return 'set_cell: cell_text must be a string';
      }
      const target = sectionDraft[paragraph_index]!;
      if (target.role !== 'table_row') {
        return 'set_cell: target is not a table_row';
      }
      return { ...base, cell_index, cell_text: o.cell_text };
    }
    case 'pad_table_row': {
      const target_cell_count =
        typeof o.target_cell_count === 'number' ? Math.floor(o.target_cell_count) : NaN;
      if (!Number.isFinite(target_cell_count) || target_cell_count < 1 || target_cell_count > 32) {
        return `pad_table_row: target_cell_count out of range ${o.target_cell_count}`;
      }
      const target = sectionDraft[paragraph_index]!;
      if (target.role !== 'table_row') {
        return 'pad_table_row: target is not a table_row';
      }
      return { ...base, target_cell_count };
    }
    case 'delete_paragraph': {
      return base;
    }
    case 'set_page_break_before': {
      if (typeof o.page_break_before !== 'boolean') {
        return 'set_page_break_before: page_break_before must be a boolean';
      }
      return { ...base, page_break_before: o.page_break_before };
    }
  }
  return `unhandled kind: ${kindRaw}`;
}

// ─── Op applier ──────────────────────────────────────────────────

/**
 * Apply a list of sanitized ops to a draft map. Returns a NEW Map
 * (the input is not mutated) plus the subset of ops that actually
 * applied — anything that became out-of-range due to a prior delete
 * is silently skipped.
 *
 * Order of application:
 *   1. Group ops by section_id.
 *   2. Within each section, apply non-delete ops in input order
 *      (they're independent — none of them change indices).
 *   3. Then apply delete_paragraph ops in DESCENDING paragraph_index
 *      order so earlier indices stay valid.
 *
 * Mutating in two passes (non-deletes, then deletes) keeps the index
 * math simple and matches how every other op-based mutator in the
 * codebase handles deletion.
 */
export function applyStyleFixOps(
  drafts: Map<string, DraftParagraph[]>,
  ops: StyleFixOp[],
): { updated: Map<string, DraftParagraph[]>; applied: StyleFixOp[] } {
  // Deep-clone the draft map so callers can compare before/after.
  const updated = new Map<string, DraftParagraph[]>();
  for (const [id, paragraphs] of drafts) {
    updated.set(id, paragraphs.map((p) => ({ ...p })));
  }

  const applied: StyleFixOp[] = [];

  // Group by section.
  const bySection = new Map<string, StyleFixOp[]>();
  for (const op of ops) {
    const bucket = bySection.get(op.section_id);
    if (bucket) bucket.push(op);
    else bySection.set(op.section_id, [op]);
  }

  for (const [section_id, sectionOps] of bySection) {
    const draft = updated.get(section_id);
    if (!draft) continue;

    // Pass 1: non-delete ops, in input order.
    for (const op of sectionOps) {
      if (op.kind === 'delete_paragraph') continue;
      if (op.paragraph_index < 0 || op.paragraph_index >= draft.length) continue;
      const target = draft[op.paragraph_index]!;
      const next = applySingleOp(target, op);
      if (next === null) continue;
      draft[op.paragraph_index] = next;
      applied.push(op);
    }

    // Pass 2: delete ops, descending so earlier indices remain valid.
    const deletes = sectionOps
      .filter((o) => o.kind === 'delete_paragraph')
      .sort((a, b) => b.paragraph_index - a.paragraph_index);
    for (const op of deletes) {
      if (op.paragraph_index < 0 || op.paragraph_index >= draft.length) continue;
      draft.splice(op.paragraph_index, 1);
      applied.push(op);
    }
  }

  return { updated, applied };
}

/**
 * Apply ONE op to ONE paragraph. Returns the updated paragraph or
 * null when the op turned out to be a no-op (e.g. set_role to the
 * same role). Pure — does not mutate `target`.
 */
function applySingleOp(target: DraftParagraph, op: StyleFixOp): DraftParagraph | null {
  switch (op.kind) {
    case 'set_role': {
      if (!op.role || op.role === target.role) return null;
      return { ...target, role: op.role };
    }
    case 'set_runs': {
      if (!op.runs || op.runs.length === 0) return null;
      // Replacing runs implicitly invalidates `text` — leave the
      // existing text in place as a fallback (the assembler ignores
      // text when runs is set), but null it out for clarity.
      return { ...target, runs: op.runs, text: '' };
    }
    case 'clear_runs': {
      if (!Array.isArray(target.runs) || target.runs.length === 0) return null;
      // Recover plain text from the runs we're dropping so the
      // assembler still has something to render.
      const recovered = target.runs.map((r) => r.text ?? '').join('');
      const next: DraftParagraph = { ...target, text: recovered };
      delete next.runs;
      return next;
    }
    case 'set_text': {
      if (typeof op.text !== 'string') return null;
      if (op.text === target.text) return null;
      // set_text takes priority over runs[] — if runs were leaking
      // markdown, dropping them is the right thing.
      const next: DraftParagraph = { ...target, text: op.text };
      delete next.runs;
      return next;
    }
    case 'set_level': {
      if (typeof op.level !== 'number') return null;
      if (op.level === target.level) return null;
      return { ...target, level: op.level };
    }
    case 'set_table_header': {
      if (target.role !== 'table_row') return null;
      if (typeof op.is_header !== 'boolean') return null;
      if (op.is_header === (target.is_header ?? false)) return null;
      return { ...target, is_header: op.is_header };
    }
    case 'set_cell': {
      if (target.role !== 'table_row') return null;
      if (typeof op.cell_index !== 'number') return null;
      if (typeof op.cell_text !== 'string') return null;
      const cells = Array.isArray(target.cells) ? target.cells.slice() : [];
      // Pad with empties up to cell_index so the write is always valid.
      while (cells.length <= op.cell_index) cells.push('');
      if (cells[op.cell_index] === op.cell_text) return null;
      cells[op.cell_index] = op.cell_text;
      return { ...target, cells };
    }
    case 'pad_table_row': {
      if (target.role !== 'table_row') return null;
      if (typeof op.target_cell_count !== 'number') return null;
      const cells = Array.isArray(target.cells) ? target.cells.slice() : [];
      if (cells.length >= op.target_cell_count) return null;
      while (cells.length < op.target_cell_count) cells.push('');
      return { ...target, cells };
    }
    case 'set_page_break_before': {
      if (typeof op.page_break_before !== 'boolean') return null;
      if (op.page_break_before === (target.page_break_before ?? false)) return null;
      return { ...target, page_break_before: op.page_break_before };
    }
    case 'delete_paragraph': {
      // Handled in pass 2 — never called from this branch.
      return null;
    }
  }
  return null;
}

// ─── Public entrypoint ───────────────────────────────────────────

/**
 * Run the full style consistency review pass: build the prompt, call
 * the LLM, sanitize the ops, apply them to a fresh draft map, and
 * return both the audit data (raw + dropped) and the updated drafts.
 *
 * The caller (the recipe runner) is responsible for persisting the
 * updated drafts back to Dexie before invoking the assembler.
 */
export async function runStyleConsistencyReview(
  args: StyleConsistencyArgs,
): Promise<StyleConsistencyResult> {
  const built = buildStyleReviewPrompt(args);
  const model = await resolveDraftingModel(args.client, args.model, 'drafting');
  const maxOps = args.max_ops ?? DEFAULT_STYLE_REVIEW_MAX_OPS;

  // Build the live draft map for sanitization.
  const draftMap = new Map<string, DraftParagraph[]>();
  for (const s of args.sections) draftMap.set(s.section.id, s.paragraphs);

  // Strip Ask-Sage-only knobs the provider doesn't support.
  const queryInput: Parameters<typeof args.client.queryJson>[0] = {
    message: built.message,
    system_prompt: built.system_prompt,
    model,
    temperature: DEFAULT_STYLE_REVIEW_TEMPERATURE,
    usage: true,
  };
  if (args.client.capabilities.dataset) {
    queryInput.dataset = 'none';
    queryInput.limit_references = 0;
  }
  if (args.client.capabilities.liveSearch) {
    queryInput.live = 0;
  }

  const { data, raw } = await args.client.queryJson<unknown>(queryInput);

  const ops: StyleFixOp[] = [];
  const dropped: Array<{ op: unknown; reason: string }> = [];
  const r = (data ?? {}) as RawStyleResponse;
  const rawOps = Array.isArray(r.ops) ? r.ops : [];
  for (const rop of rawOps) {
    const result = sanitizeOp(rop, draftMap);
    if (typeof result === 'string') {
      dropped.push({ op: rop, reason: result });
      continue;
    }
    ops.push(result);
    if (ops.length >= maxOps) break;
  }

  const { updated, applied } = applyStyleFixOps(draftMap, ops);

  const usage =
    (raw.usage as { prompt_tokens?: number; completion_tokens?: number } | null | undefined) ?? {};
  const tokens_in = usage.prompt_tokens ?? 0;
  const tokens_out = usage.completion_tokens ?? 0;
  const usage_by_model: UsageByModel = {};
  recordUsage(usage_by_model, model, {
    tokens_in,
    tokens_out,
    web_search_results: raw.web_search_results,
  });

  return {
    ops,
    ops_applied: applied,
    ops_dropped: dropped,
    updated,
    tokens_in,
    tokens_out,
    usage_by_model,
    model,
    prompt_sent: built.message,
    raw_output: data,
  };
}

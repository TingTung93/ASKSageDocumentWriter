// Builds the prompt for drafting a single section. The drafter calls
// Ask Sage's /server/query with this prompt + the project's reference
// dataset name so RAG can inject relevant context. The model emits
// structured paragraphs with role tags (see PRD §6).

import type { BodyFillRegion, TemplateSchema } from '../template/types';
import type { PriorSectionSummary } from './types';
import type { DraftingStrategy } from '../agent/section_mapping';

export interface BuildDraftingPromptArgs {
  template: TemplateSchema;
  section: BodyFillRegion;
  /**
   * The user's authoritative subject statement for THIS document
   * (e.g. "Performance Work Statement for Diasorin Liaison MDX
   * maintenance"). Goes at the very top of the prompt, framed as a
   * hard constraint that overrides any subject hints baked into the
   * section spec from synthesis.
   */
  project_description: string;
  /** Filled-in shared inputs (cui_banner, doc_number, dates, etc.) */
  shared_inputs: Record<string, string>;
  /**
   * Summaries of sections that depend_on resolves to. Sent verbatim so
   * the model knows what was said upstream without us re-sending full
   * body text per call.
   */
  prior_summaries: PriorSectionSummary[];
  /**
   * Pre-rendered NOTES block from lib/project/context.renderNotesBlock.
   * Short user-authored guidance (quotes, salient characteristics).
   */
  notes_block?: string | null;
  /**
   * Pre-rendered ATTACHED REFERENCES block built from
   * lib/project/context.renderInlinedReferences using the orchestrator's
   * once-per-run extraction cache. This is the full text of every
   * file the user attached — the model literally sees the source
   * material instead of relying on opaque RAG retrieval.
   */
  references_block?: string | null;
  /**
   * The actual paragraphs of THIS section as they appear in the
   * template, joined with newlines. Sliced from the parsed DOCX by
   * the orchestrator using the section's anchor_paragraph_index range.
   * Tells the model what the section's tone, depth, and structure
   * look like in the source template — without baking subject matter.
   */
  template_example?: string | null;
  /**
   * Revision notes from the critic loop. When non-null, this is a
   * pre-formatted block listing the issues from the previous attempt
   * the drafter must fix this iteration. Inlined immediately after
   * the SUBJECT block so it carries SUBJECT-level priority. Built by
   * `lib/draft/critique.formatRevisionNotes`.
   */
  revision_notes_block?: string | null;
  /**
   * The reference→section mapper's drafting strategy for THIS section.
   * When supplied, the prompt inlines a DRAFTING STRATEGY guidance
   * line so the model knows whether to absorb the matched references
   * verbatim (policy migrations), summarize them (overflowing source
   * content), expand on them (sparse references), or rely entirely
   * on the template (use_template_only). Optional — when omitted the
   * model just falls back to the existing prompt instructions.
   */
  drafting_strategy?: DraftingStrategy | null;
  /**
   * Optional explicit word-count target supplied by the mapping
   * stage. When the mapper estimates a section needs much more
   * content than the template's target_words range (a bare-bones
   * template absorbing a content-rich source), this overrides the
   * target_words line so the model produces the right output volume.
   */
  effective_word_target?: number | null;
}

export interface BuiltDraftingPrompt {
  system_prompt: string;
  message: string;
}

const SYSTEM_PROMPT = `You are drafting a single section of a formal government document. Your output is a strict JSON object containing structured paragraphs with role tags. The export pipeline maps each role tag to a template-defined paragraph style, so you NEVER pick fonts or formatting — only content and role.

OUTPUT SCHEMA — strict JSON only, no markdown code fences, no commentary:

{
  "paragraphs": [
    {
      "role": "<role>",
      "text": "<paragraph text>",
      "level": <0..3, optional>,
      "runs": [ { "text": "...", "bold": true, "italic": false, "underline": false, "strike": false } ],   // optional, see INLINE FORMATTING below
      "page_break_before": false,                                                                             // optional
      "cells": ["c1","c2"],                                                                                   // table_row only
      "is_header": false                                                                                      // table_row only
    }
  ],
  "self_summary": "<one short sentence summarizing what you wrote, used to feed forward to dependent sections>"
}

Available roles:
  - "heading"   — section title or sub-heading text
  - "body"      — normal prose paragraph
  - "step"      — one step in a numbered procedure
  - "bullet"    — one bullet point
  - "note"      — informational note / aside (formatted distinctly)
  - "caution"   — caution callout
  - "warning"   — warning callout
  - "definition" — term definition
  - "table_row" — one row of a table; use the "cells" field instead of "text". Consecutive table_row paragraphs are collapsed into a single real Word table at export time.
  - "quote"     — block quote

Use the role that matches the writer's intent. Do NOT use markdown formatting (no **bold**, no _italic_, no - bullets) — those are role-encoded or run-encoded, not text-encoded.

INLINE FORMATTING — bold, italic, underline, strike:

Most paragraphs should leave inline formatting alone — the template's run properties already produce the right look. When a paragraph needs MIXED formatting (a single bold term inside an otherwise normal sentence, an italicized standard reference, an underlined defined term), supply a "runs" array INSTEAD OF the "text" field. Each run is a contiguous span of text with optional toggles. The toggles layer onto whatever bold/italic/etc. the template's run style already had — so you only flip what you want to change.

  Example — one bold term inside a body paragraph:
    { "role": "body", "runs": [
      { "text": "The contractor shall comply with " },
      { "text": "FAR 52.204-21", "bold": true },
      { "text": " for all CUI handling." }
    ] }

  Example — underlined defined term followed by its definition:
    { "role": "definition", "runs": [
      { "text": "Performance Work Statement", "underline": true },
      { "text": ": A statement that describes the required results in clear, specific, measurable terms." }
    ] }

Use "text" (not "runs") for any paragraph that has uniform formatting — that's the vast majority. Only use "runs" when you genuinely need a formatting change inside one paragraph.

PAGE BREAKS:

Set "page_break_before": true on a paragraph to force Word to start that paragraph on a new page. Use this ONLY when the document structure clearly demands it — typically the first paragraph after a cover page, the start of a signature page, or the first paragraph of a major appendix. Do NOT scatter page breaks for visual padding; Word handles ordinary pagination.

TABLES:

Real tables are built by emitting CONSECUTIVE "table_row" paragraphs. Each row provides its column data in the "cells" array. The export pipeline collapses every run of consecutive table_row paragraphs into ONE real Word table with proper borders — column count is taken from the longest row.

  - Mark the FIRST row of a table with "is_header": true. Header rows render bold and repeat across page breaks.
  - Every row in the same table must have the same "cells" length when possible — short rows get padded with empty cells, long rows extend the column count for the whole table.
  - To start a SECOND table in the same section, separate the two row groups with at least one non-table_row paragraph (a heading or a body intro line).

  Example — a small responsibilities table:
    { "role": "heading", "text": "Roles and Responsibilities", "level": 1 },
    { "role": "table_row", "is_header": true, "cells": ["Role", "Responsibility"] },
    { "role": "table_row", "cells": ["Contracting Officer (CO)", "Award and administer the contract."] },
    { "role": "table_row", "cells": ["COR", "Monitor performance and validate deliverables."] },
    { "role": "body", "text": "Each role above is staffed in writing prior to contract award." }

LEVEL — optional nesting / indent depth. Default 0. The export pipeline maps it to OOXML formatting per role:

  - bullet / step → list nesting. level 0 is a top-level bullet, level 1 is a sub-bullet under the most recent level 0, level 2 is a sub-sub-bullet, etc. The visual bullet glyph and indent come from the template's list definition. Use this when the source material has nested list structure.
      Example:
        { "role": "bullet", "text": "Acquisition phase", "level": 0 }
        { "role": "bullet", "text": "Market research",   "level": 1 }
        { "role": "bullet", "text": "Survey vendors",    "level": 2 }
        { "role": "bullet", "text": "Solicitation",      "level": 1 }
        { "role": "bullet", "text": "Award phase",       "level": 0 }

  - heading → heading hierarchy. level 0 = top section heading (Heading1), level 1 = sub-heading (Heading2), level 2 = sub-sub-heading (Heading3). Use sub-headings when the section spec calls for multiple subsections of prose.
      Example:
        { "role": "heading", "text": "1. Background", "level": 0 }
        { "role": "heading", "text": "1.1 History",    "level": 1 }
        { "role": "heading", "text": "1.2 Scope",      "level": 1 }

  - body / note / caution / warning / definition / quote → left-indent in 0.5"-per-level steps. level 0 is flush body text, level 1 is indented 0.5", level 2 is indented 1", etc. Use this for inset / quoted material that isn't a bullet.
      Example:
        { "role": "body",  "text": "The contracting officer determined…", "level": 0 }
        { "role": "quote", "text": "Per FAR 13.106-1(b)…",                "level": 1 }

  - table_row → level is ignored.

Use level SPARINGLY — most sections are flat. Only nest when the source material or the template example clearly shows nested structure. Cap your levels at 3 unless you have a specific reason to go deeper.

PROMPT STRUCTURE — every drafting prompt has these blocks in this priority order:

  1. SUBJECT          — what THIS document is about. Authoritative. Overrides everything else.
  2. ATTACHED REFERENCES — the user's source documents. Authoritative subject-matter content.
  3. PROJECT NOTES    — short user guidance (quotes, scope hints).
  4. TEMPLATE EXAMPLE — the section's text from the source template. Use for STRUCTURE and TONE only — its subject matter is from a different document and MUST be ignored.
  5. SHARED INPUTS    — fielded facts (CUI banner, document number, dates, POC).
  6. STYLE BLOCK      — voice, tense, register, banned phrases.
  7. SECTION SPEC     — id, name, intent, target words, depends_on, role list.
  8. PRIOR SECTIONS   — summaries of upstream drafted sections.

DRAFTING GUIDANCE:

- The SUBJECT block at the top is the only correct topic for this draft. If the section's intent, the template example, or any other input suggests a different topic, IGNORE that — write about the SUBJECT.
- The ATTACHED REFERENCES contain the authoritative source material. Quote, paraphrase, and synthesize from them. Do NOT invent facts that aren't grounded in the references, the SUBJECT, or the SHARED INPUTS.
- The TEMPLATE EXAMPLE shows what THIS section looked like in the source template. Match its tone, depth, register, structure, and required components. Do NOT copy its subject matter — its subject is a different document being reused for structure.
- Write in the voice, tense, and register specified by the style block. Avoid every banned_phrase verbatim.
- Stay within the target_words range when given. Honor must_not_exceed_words and must_be_at_least_words length caps when present.
- IGNORE any "must_mention" or "must_not_mention" entries in the section spec — those fields are deprecated and frequently contain stale subject-matter terms from a different document.
- Use shared_inputs as ground truth for fielded facts (organization names, dates, document numbers, classification markings).
- Reference the prior section summaries when relevant; do NOT repeat their content verbatim.
- If your section requires a fact not present in the SUBJECT, REFERENCES, SHARED INPUTS, or PRIOR SECTIONS, write a placeholder like "[INSERT: <what's needed>]" rather than inventing the fact.
- self_summary should be one sentence focused on the substance of what you wrote, useful as a "prior section" hint for downstream dependent sections.

Return STRICT JSON only. No markdown code fences. No commentary outside the JSON object.`;

export function buildDraftingPrompt(args: BuildDraftingPromptArgs): BuiltDraftingPrompt {
  const {
    template,
    section,
    project_description,
    shared_inputs,
    prior_summaries,
    notes_block,
    references_block,
    template_example,
    revision_notes_block,
    drafting_strategy,
    effective_word_target,
  } = args;
  const lines: string[] = [];

  // ─── 0. Header — which template, which document ──────────────────
  lines.push(`Template: ${template.name} (${template.source.filename})`);
  lines.push(``);

  // ─── 1. SUBJECT (top of body, framed as a hard constraint) ───────
  lines.push(`=== SUBJECT ===`);
  lines.push(
    `This document is about: ${project_description || '(no subject provided — REFUSE to draft and emit a single paragraph asking the user to set the project description)'}`,
  );
  lines.push(
    `Every section is about THIS subject. The section spec, template example, and any other input below are reused from a DIFFERENT document for STRUCTURE only — IGNORE any topic hints they contain that conflict with the subject above.`,
  );
  lines.push(`=== END SUBJECT ===`);

  // ─── 1.5. REVISION NOTES from the critic loop (when present) ──────
  // Inlined immediately after SUBJECT so it carries the same priority
  // weight: the model must address every flagged issue from the prior
  // attempt before producing a new draft.
  if (revision_notes_block && revision_notes_block.trim().length > 0) {
    lines.push(``);
    lines.push(revision_notes_block);
  }

  // ─── 2. ATTACHED REFERENCES (the user's source material) ──────────
  if (references_block) {
    lines.push(``);
    lines.push(references_block);
  }

  // ─── 3. PROJECT NOTES (short user-authored guidance) ──────────────
  if (notes_block) {
    lines.push(``);
    lines.push(notes_block);
  }

  // ─── 4. TEMPLATE EXAMPLE for THIS section ─────────────────────────
  if (template_example && template_example.trim().length > 0) {
    lines.push(``);
    lines.push(`=== TEMPLATE EXAMPLE FOR THIS SECTION ===`);
    lines.push(
      `Below is the actual text of this section as it appeared in the source template "${template.name}". Use it as a guide for TONE, DEPTH, STRUCTURE, and required STRUCTURAL components (headings, signature blocks, tables, lists). Its subject matter is from a different document — DO NOT copy any topical content. Write about the SUBJECT above in the example's style.`,
    );
    lines.push(``);
    lines.push(template_example);
    lines.push(`=== END TEMPLATE EXAMPLE ===`);
  }

  // ─── 5. SHARED INPUTS (fielded project-wide facts) ────────────────
  if (Object.keys(shared_inputs).length > 0) {
    lines.push(``);
    lines.push(`=== SHARED INPUTS ===`);
    lines.push(`Use these as ground truth for fielded facts.`);
    for (const [k, v] of Object.entries(shared_inputs)) {
      if (v && v.trim()) lines.push(`  ${k}: ${v}`);
    }
    lines.push(`=== END SHARED INPUTS ===`);
  }

  // ─── 6. STYLE BLOCK (document-wide voice) ─────────────────────────
  lines.push(``);
  lines.push(`=== STYLE BLOCK ===`);
  lines.push(`  voice: ${template.style.voice ?? 'third_person'}`);
  lines.push(`  tense: ${template.style.tense ?? 'present'}`);
  lines.push(`  register: ${template.style.register ?? 'formal_government'}`);
  if (template.style.jargon_policy) {
    lines.push(`  jargon_policy: ${template.style.jargon_policy}`);
  }
  if (template.style.banned_phrases && template.style.banned_phrases.length > 0) {
    lines.push(`  banned_phrases: ${template.style.banned_phrases.join(', ')}`);
  }
  lines.push(`=== END STYLE BLOCK ===`);

  // ─── 7. SECTION SPEC ──────────────────────────────────────────────
  lines.push(``);
  lines.push(`=== SECTION TO DRAFT ===`);
  lines.push(`id: ${section.id}`);
  lines.push(`name: ${section.name}`);
  lines.push(`order: ${section.order}`);
  if (section.intent) {
    lines.push(
      `intent: ${section.intent}  (NOTE: if this intent contains subject matter unrelated to the SUBJECT block above, ignore the topical part — the intent's COMMUNICATIVE GOAL is what matters)`,
    );
  }
  if (effective_word_target && effective_word_target > 0) {
    // The reference mapping stage overrode target_words because the
    // matched source material has substantively more (or less)
    // content than the template's example anticipated. Drop a wider
    // ±25% range around the estimate so the model has room to land.
    const lo = Math.max(5, Math.round(effective_word_target * 0.75));
    const hi = Math.round(effective_word_target * 1.25);
    lines.push(
      `target_words: ${lo}-${hi}  (overridden by reference mapping; absorb the matched source content into this range)`,
    );
  } else if (section.target_words) {
    lines.push(`target_words: ${section.target_words[0]}-${section.target_words[1]}`);
  }
  if (drafting_strategy) {
    lines.push(`drafting_strategy: ${drafting_strategy}  ${strategyHint(drafting_strategy)}`);
  }
  if (section.depends_on && section.depends_on.length > 0) {
    lines.push(`depends_on: ${section.depends_on.join(', ')}`);
  }
  // Render only the structural validation rules (length caps). Drop
  // must_mention / must_not_mention — those frequently contain stale
  // subject-matter terms baked in by synthesis from a different
  // template's example content.
  const structuralValidation = pickStructuralValidation(section.validation);
  if (structuralValidation) {
    lines.push(`length_validation: ${JSON.stringify(structuralValidation)}`);
  }
  const allowed = section.fill_region.permitted_roles ?? ['body'];
  lines.push(`permitted_roles: ${allowed.join(', ')}`);
  if (section.style_notes && section.style_notes.trim().length > 0) {
    lines.push(``);
    lines.push(`STYLE NOTES:`);
    lines.push(`  ${section.style_notes.trim()}`);
  }
  if (section.visual_style) {
    const vs = section.visual_style;
    const vsLines: string[] = [];
    if (vs.font_family || vs.font_size_pt) {
      vsLines.push(
        `font: ${vs.font_family ?? 'default'}${vs.font_size_pt ? ` ${vs.font_size_pt}pt` : ''}`.trim(),
      );
    }
    if (vs.alignment) vsLines.push(`alignment: ${vs.alignment}`);
    if (vs.numbering_convention && vs.numbering_convention !== 'none') {
      vsLines.push(`numbering: ${vs.numbering_convention}`);
    }
    if (vsLines.length > 0) {
      lines.push(``);
      lines.push(`VISUAL STYLE:`);
      for (const l of vsLines) lines.push(`  ${l}`);
    }
  }
  lines.push(`=== END SECTION TO DRAFT ===`);

  // ─── 8. PRIOR SECTION SUMMARIES (for context, not repetition) ─────
  if (prior_summaries.length > 0) {
    lines.push(``);
    lines.push(`=== PRIOR SECTIONS (summaries — for continuity, do not repeat) ===`);
    for (const ps of prior_summaries) {
      lines.push(`  - ${ps.name} (${ps.section_id}): ${ps.summary}`);
    }
    lines.push(`=== END PRIOR SECTIONS ===`);
  }

  lines.push(``);
  lines.push(
    `Now draft this section. Return STRICT JSON in the schema specified by the system prompt. Use only the roles listed in permitted_roles. Aim for the target_words range. Write about the SUBJECT block at the top of this prompt, drawing from the user-attached source material above. Output only the JSON object.`,
  );

  return {
    system_prompt: SYSTEM_PROMPT,
    message: lines.join('\n'),
  };
}

/**
 * Inline guidance line shown to the model alongside the
 * drafting_strategy enum value, so the model knows exactly what to do
 * with the matched reference content for THIS section.
 */
function strategyHint(strategy: DraftingStrategy): string {
  switch (strategy) {
    case 'absorb_verbatim':
      return '(the ATTACHED REFERENCES contain substantively the same subject matter as this section — preserve their wording, technical terms, numerical thresholds, and procedural ordering wherever possible; you are migrating the source content into this template, NOT rewriting it from scratch)';
    case 'summarize':
      return '(the ATTACHED REFERENCES have substantively MORE content than this section needs — condense the matched material into the target_words range without dropping any required facts)';
    case 'expand':
      return '(the ATTACHED REFERENCES touch on this topic but are not enough on their own — use them as supporting facts and expand into a full section using the SUBJECT and SHARED INPUTS as well)';
    case 'use_template_only':
      return '(no useful reference content was matched to this section — rely on the SUBJECT, SHARED INPUTS, and TEMPLATE EXAMPLE; do NOT invent facts beyond those sources)';
    default:
      return '';
  }
}

/**
 * Strip subject-matter validation fields (must_mention, must_not_mention)
 * from a section's validation object, keeping only the structural
 * length-cap rules. Returns null if nothing structural remains.
 *
 * Background: synthesis used to populate must_mention with topical
 * terms from the template's example content (e.g., ["SHARP",
 * "harassment prevention"]). When the user reused the template for a
 * different subject, those terms forced the drafter to write off-topic.
 * The new synthesis prompt no longer produces them, but old schemas
 * still have them — this filter keeps the existing schemas usable
 * without re-synthesis.
 */
function pickStructuralValidation(
  validation: BodyFillRegion['validation'],
): Record<string, unknown> | null {
  if (!validation) return null;
  const out: Record<string, unknown> = {};
  if (typeof validation.must_not_exceed_words === 'number' && validation.must_not_exceed_words > 0) {
    out.must_not_exceed_words = validation.must_not_exceed_words;
  }
  if (typeof validation.must_be_at_least_words === 'number' && validation.must_be_at_least_words > 0) {
    out.must_be_at_least_words = validation.must_be_at_least_words;
  }
  return Object.keys(out).length > 0 ? out : null;
}

// Builds the prompt for drafting a single section. The drafter calls
// Ask Sage's /server/query with this prompt + the project's reference
// dataset name so RAG can inject relevant context. The model emits
// structured paragraphs with role tags (see PRD §6).

import type { BodyFillRegion, TemplateSchema } from '../template/types';
import type { PriorSectionSummary } from './types';

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
}

export interface BuiltDraftingPrompt {
  system_prompt: string;
  message: string;
}

const SYSTEM_PROMPT = `You are drafting a single section of a formal government document. Your output is a strict JSON object containing structured paragraphs with role tags. The export pipeline maps each role tag to a template-defined paragraph style, so you NEVER pick fonts or formatting — only content and role.

OUTPUT SCHEMA — strict JSON only, no markdown code fences, no commentary:

{
  "paragraphs": [
    { "role": "<role>", "text": "<paragraph text>" }
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
  - "table_row" — one row of a table; use the "cells" field instead of "text"
  - "quote"     — block quote

Use the role that matches the writer's intent. Do NOT use markdown formatting (no **bold**, no _italic_, no - bullets) — those are role-encoded, not text-encoded.

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
  if (section.target_words) {
    lines.push(`target_words: ${section.target_words[0]}-${section.target_words[1]}`);
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

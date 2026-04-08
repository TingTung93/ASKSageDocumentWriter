// Builds the prompt for drafting a single section. The drafter calls
// Ask Sage's /server/query with this prompt + the project's reference
// dataset name so RAG can inject relevant context. The model emits
// structured paragraphs with role tags (see PRD §6).

import type { BodyFillRegion, TemplateSchema } from '../template/types';
import type { PriorSectionSummary } from './types';

export interface BuildDraftingPromptArgs {
  template: TemplateSchema;
  section: BodyFillRegion;
  /** Free-form project intent — e.g. "Maintenance contract for ..." */
  project_description: string;
  /** Filled-in shared inputs (cui_banner, doc_number, dates, etc.) */
  shared_inputs: Record<string, string>;
  /**
   * Summaries of sections that depend_on resolves to. Sent verbatim so
   * the model knows what was said upstream without us re-sending full
   * body text per call.
   */
  prior_summaries: PriorSectionSummary[];
}

export interface BuiltDraftingPrompt {
  system_prompt: string;
  message: string;
}

const SYSTEM_PROMPT = `You are drafting a single section of a formal government document. Your output is a strict JSON object containing structured paragraphs with role tags. The export pipeline maps each role tag to a template-defined paragraph style, so the LLM never picks fonts or formatting — only content and role.

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

DRAFTING GUIDANCE:
- Write in the voice, tense, and register specified by the section's style block
- Stay within the target_words range (a soft target, not a hard cap unless validation says otherwise)
- Honor every validation rule (must_mention, must_not_mention, length caps)
- Use the project_description and shared_inputs as ground truth for facts (organization names, dates, document numbers, classification)
- Reference the prior section summaries when relevant; do NOT repeat their content verbatim
- If your section depends on a fact that's not in the project inputs or prior summaries, write a placeholder like "[INSERT: <what's needed>]" rather than inventing the fact
- The retrieval-augmented context (Ask Sage references) below the message body provides authoritative source material — quote or paraphrase from it where appropriate; do not make up citations
- self_summary should be one sentence focused on the substance of what you wrote, useful as a "prior section" hint for downstream sections that depend on this one

Return STRICT JSON only.`;

export function buildDraftingPrompt(args: BuildDraftingPromptArgs): BuiltDraftingPrompt {
  const { template, section, project_description, shared_inputs, prior_summaries } = args;
  const lines: string[] = [];

  // ─── Document context ─────────────────────────────────────────────
  lines.push(`Template: ${template.name} (${template.source.filename})`);
  lines.push(`Project description: ${project_description || '(none provided)'}`);

  // ─── Shared inputs (project-wide facts) ───────────────────────────
  if (Object.keys(shared_inputs).length > 0) {
    lines.push(``);
    lines.push(`Project shared inputs (use these as ground truth):`);
    for (const [k, v] of Object.entries(shared_inputs)) {
      if (v && v.trim()) lines.push(`  ${k}: ${v}`);
    }
  }

  // ─── Style block (overall document voice) ─────────────────────────
  lines.push(``);
  lines.push(`Document style block:`);
  lines.push(`  voice: ${template.style.voice ?? 'third_person'}`);
  lines.push(`  tense: ${template.style.tense ?? 'present'}`);
  lines.push(`  register: ${template.style.register ?? 'formal_government'}`);
  if (template.style.jargon_policy) {
    lines.push(`  jargon_policy: ${template.style.jargon_policy}`);
  }
  if (template.style.banned_phrases && template.style.banned_phrases.length > 0) {
    lines.push(`  banned_phrases: ${template.style.banned_phrases.join(', ')}`);
  }

  // ─── This section's spec ──────────────────────────────────────────
  lines.push(``);
  lines.push(`=== SECTION TO DRAFT ===`);
  lines.push(`id: ${section.id}`);
  lines.push(`name: ${section.name}`);
  lines.push(`order: ${section.order}`);
  if (section.intent) {
    lines.push(`intent: ${section.intent}`);
  }
  if (section.target_words) {
    lines.push(`target_words: ${section.target_words[0]}-${section.target_words[1]}`);
  }
  if (section.depends_on && section.depends_on.length > 0) {
    lines.push(`depends_on: ${section.depends_on.join(', ')}`);
  }
  if (section.validation && Object.keys(section.validation).length > 0) {
    lines.push(`validation: ${JSON.stringify(section.validation)}`);
  }
  const allowed = section.fill_region.permitted_roles ?? ['body'];
  lines.push(`permitted_roles: ${allowed.join(', ')}`);

  // ─── Prior section summaries (for context, not repetition) ────────
  if (prior_summaries.length > 0) {
    lines.push(``);
    lines.push(`Prior sections (summaries — for context only, do not repeat):`);
    for (const ps of prior_summaries) {
      lines.push(`  - ${ps.name} (${ps.section_id}): ${ps.summary}`);
    }
  }

  lines.push(``);
  lines.push(
    `Now draft this section. Return STRICT JSON in the schema specified by the system prompt. Use only the roles listed in permitted_roles above. Aim for the target_words range. Honor the validation rules. Output only the JSON object.`,
  );

  return {
    system_prompt: SYSTEM_PROMPT,
    message: lines.join('\n'),
  };
}

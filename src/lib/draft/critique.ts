// critique.ts — section-level draft critic loop.
//
// Phase 3 of the drafting pipeline. Wraps the existing single-shot
// drafter (lib/draft/drafter.draftSection) with a draft → critique →
// revise loop. The critic is a separate LLM call that reads the same
// SUBJECT, REFERENCES, TEMPLATE EXAMPLE and SECTION SPEC the drafter
// saw, then judges the produced paragraphs and emits a strict-JSON
// list of issues. If any medium-or-high severity issue survives the
// strictness filter, we ask the drafter to revise (the orchestrator-
// supplied draftFn closure inlines the structured "revision notes"
// block into the next drafting prompt).
//
// Design notes:
//
//   - The critic prompt is SUBJECT-AGNOSTIC. It MUST NOT mention any
//     specific topic (no SHARP, no transfusion, no contracting jargon)
//     because the same prompt is reused across every template the user
//     loads. Bad-example illustrations are written in placeholder form
//     ("the term <X>", "the section <Y>") so they never bias the model.
//
//   - The critic shares the drafter's SUBJECT-block-dominant philosophy
//     from lib/draft/prompt.ts: the SUBJECT block at the top of the
//     drafting prompt is the only correct topic. The critic must flag
//     any drift away from it (off_subject) and any claim not grounded
//     in SUBJECT / REFERENCES / SHARED INPUTS (hallucination).
//
//   - The critic NEVER rewrites. It only emits issues. Revision is the
//     drafter's job, on the next iteration, with the structured revision
//     notes block prepended to its prompt.
//
//   - Strictness ('lenient' | 'moderate' | 'strict') is injected into
//     the critic system prompt. Same prompt body, three different
//     thresholds:
//       - lenient  → only flag concrete, demonstrable problems
//       - moderate → flag concrete problems and clear style/structure issues
//       - strict   → flag any aspect that could be improved
//     The critic itself decides severity per issue; the loop runner
//     filters issues using the strictness level before deciding whether
//     to revise.

import type { LLMClient } from '../provider/types';
import type { BodyFillRegion, TemplateSchema } from '../template/types';
import type { DraftParagraph, PriorSectionSummary } from './types';
import { type UsageByModel, emptyUsage, mergeUsage, recordUsage } from '../usage';

// ─── Public types ────────────────────────────────────────────────

export type CritiqueStrictness = 'lenient' | 'moderate' | 'strict';

export type CritiqueSeverity = 'low' | 'medium' | 'high';

export type CritiqueCategory =
  | 'hallucination'        // a claim not grounded in references / SUBJECT
  | 'off_subject'          // drifted from the project SUBJECT
  | 'structural'           // missing a required structural component
  | 'banned_phrase'        // used a banned phrase from the style block
  | 'length_violation'     // outside target_words or hard cap
  | 'role_violation'       // used a role not in permitted_roles
  | 'vague'                // content is too vague to be useful
  | 'placeholder_residue'  // forgot to replace [INSERT:...] markers
  | 'other';

export interface CritiqueIssue {
  severity: CritiqueSeverity;
  category: CritiqueCategory;
  /** One-sentence specific issue. Must reference a span/claim, not be generic. */
  message: string;
  /** Optional one-sentence suggestion the drafter can act on. */
  suggested_fix?: string;
}

export interface CritiqueResult {
  /** True iff zero medium-or-high severity issues survived the strictness filter. */
  passed: boolean;
  issues: CritiqueIssue[];
  tokens_in: number;
  tokens_out: number;
  /** Per-model usage breakdown. Always a single entry — the critic model. */
  usage_by_model: UsageByModel;
  model: string;
  /** The prompt body that was sent to the critic (for diagnostics / audit). */
  prompt_sent: string;
  /** Raw parsed JSON from the critic call, before normalization. */
  raw_output: unknown;
}

export interface CritiqueArgs {
  template: TemplateSchema;
  section: BodyFillRegion;
  /** The drafted paragraphs being critiqued. */
  draft: DraftParagraph[];
  /** The project's authoritative subject statement. */
  project_description: string;
  /** Same references the drafter saw — passed verbatim so the critic can verify groundedness. */
  references_block: string | null;
  /** Same template example the drafter saw. */
  template_example: string | null;
  /** Same prior section summaries the drafter saw. */
  prior_summaries: PriorSectionSummary[];
  /** Strictness controls the critic's tolerance. Defaults to 'moderate'. */
  strictness?: CritiqueStrictness;
  /** Defaults to the drafter's model when omitted. */
  model?: string;
}

// ─── Constants ───────────────────────────────────────────────────

export const DEFAULT_CRITIC_MODEL = 'google-claude-46-sonnet';
export const DEFAULT_CRITIC_TEMPERATURE = 0;
export const DEFAULT_STRICTNESS: CritiqueStrictness = 'moderate';
export const DEFAULT_MAX_ITERATIONS = 2;
export const HARD_MAX_ITERATIONS = 3;

// ─── Critic system prompt (subject-agnostic) ─────────────────────

const CRITIC_SYSTEM_PROMPT = `You are a critic for a single section of a formal government document. Another LLM ("the drafter") was given a strict set of inputs (SUBJECT, ATTACHED REFERENCES, TEMPLATE EXAMPLE, SHARED INPUTS, STYLE BLOCK, SECTION SPEC, PRIOR SECTIONS) and produced a draft of role-tagged paragraphs. Your job is to read those same inputs and the drafter's output, then emit a list of concrete issues with the draft.

You are NOT a rewriter. You do not produce revised text. You only emit issues. A separate revise step will hand your issues back to the drafter.

OUTPUT SCHEMA — strict JSON only, no markdown code fences, no commentary:

{
  "issues": [
    {
      "severity": "low" | "medium" | "high",
      "category": "<one of the categories listed below>",
      "message": "<one sentence; must reference a specific span, claim, role, or structural component in the draft>",
      "suggested_fix": "<optional one-sentence suggestion; omit this field if you have nothing concrete to suggest>"
    }
  ]
}

If the draft has no issues, return: {"issues": []}

CORE PHILOSOPHY — read this carefully:

The drafter operates under a SUBJECT-block-dominant philosophy. The SUBJECT block at the top of its prompt is the ONLY correct topic for the draft. The TEMPLATE EXAMPLE is structural/tonal scaffolding from a DIFFERENT document and its subject matter must be ignored. Your job is to enforce this philosophy from the other side: flag any place where the draft has drifted toward the template example's topic instead of the SUBJECT, and flag any claim that isn't grounded in SUBJECT / ATTACHED REFERENCES / SHARED INPUTS / PRIOR SECTIONS.

You NEVER:
  - Rewrite the section. Issues only.
  - Make subjective style judgments ("this could be more professional", "the tone feels off"). Either it violates a stated style rule from the STYLE BLOCK, or it doesn't.
  - Hallucinate issues. Every issue MUST reference a specific span, claim, role tag, or structural component. If you cannot point at the exact text, do not raise the issue.
  - Re-flag the same problem under multiple categories. Pick the best category.
  - Return more than 8 issues per critique. If you would emit more than 8, keep the highest-severity 8.

CATEGORIES — one bad example each (placeholder topics, never real ones):

  - hallucination
      A claim with no grounding in SUBJECT / REFERENCES / SHARED INPUTS / PRIOR SECTIONS.
      Bad: paragraph 3 states "the contract value is $X" when neither REFERENCES nor SHARED INPUTS mention a contract value.

  - off_subject
      Content that talks about the topic of the TEMPLATE EXAMPLE instead of the SUBJECT.
      Bad: SUBJECT is "<topic A>" but paragraph 2 discusses "<topic B>" (the template example's subject).

  - structural
      A required structural component (per SECTION SPEC, TEMPLATE EXAMPLE, or permitted_roles) is missing or in the wrong place.
      Bad: SECTION SPEC requires a heading role first, but the draft starts with a body paragraph.

  - banned_phrase
      A phrase listed in STYLE BLOCK.banned_phrases appears verbatim in the draft.
      Bad: STYLE BLOCK bans "<phrase>", but paragraph 4 contains "<phrase>".

  - length_violation
      Total word count is outside target_words, or exceeds must_not_exceed_words / falls below must_be_at_least_words.
      Bad: target_words is 80-150 but the draft totals 312 words.

  - role_violation
      The draft uses a role tag not in permitted_roles.
      Bad: permitted_roles is ["body","bullet"] but paragraph 5 uses role "warning".

  - vague
      Content is so generic it conveys no information specific to the SUBJECT.
      Bad: paragraph 2 says only "this section ensures compliance with applicable requirements" without naming any of the requirements.

  - placeholder_residue
      The draft contains an unresolved [INSERT:...] marker that the user will need to fill in. (This is sometimes acceptable — emit at most LOW severity unless the marker is in a critical role like a heading.)
      Bad: paragraph 1 contains "[INSERT: organization name]".

  - other
      Anything concrete that doesn't fit above. Use sparingly.

SEVERITY:

  - high   — must-fix. The draft is unusable as-is. Examples: hallucinated facts, wrong subject, missing required structural component.
  - medium — should-fix. The draft will need editing before delivery. Examples: banned phrase used, length cap exceeded, vague paragraphs, role violations.
  - low    — nice-to-fix. The draft is acceptable but could be improved. Examples: a placeholder marker that the user could reasonably fill in, a single mildly vague sentence in an otherwise solid section.

STRICTNESS LEVELS:

You will be told one of three strictness levels in the user message. Apply this decision rule when deciding whether to RAISE an issue at all:

  - lenient  — Only raise issues you are highly confident about. Concrete demonstrable problems only (hallucinated facts, wrong subject, banned phrase used, length cap blown, role not permitted, [INSERT:...] residue). Skip "vague" and "structural" unless the violation is unambiguous. When in doubt, do not raise the issue.

  - moderate — Raise concrete problems AND clear style/structure issues. Flag vague paragraphs, missing structural components implied by the TEMPLATE EXAMPLE, and content that drifts subtly off-subject. Default level.

  - strict   — Raise any aspect of the draft that could be improved. Flag tonal mismatches with the TEMPLATE EXAMPLE, flag mild vagueness, flag any sentence that doesn't tie back to a specific anchor in SUBJECT or REFERENCES. Even minor issues should be raised at low severity.

SEVERITY does not change with strictness — a banned phrase is always medium, a hallucination is always high. Strictness only changes whether you raise a borderline issue at all.

Return STRICT JSON only. No markdown code fences. No commentary outside the JSON object.`;

// ─── Critic prompt builder ───────────────────────────────────────

interface BuiltCritiquePrompt {
  system_prompt: string;
  message: string;
}

function buildCritiquePrompt(args: CritiqueArgs): BuiltCritiquePrompt {
  const {
    template,
    section,
    draft,
    project_description,
    references_block,
    template_example,
    prior_summaries,
  } = args;
  const strictness = args.strictness ?? DEFAULT_STRICTNESS;
  const lines: string[] = [];

  // ─── Strictness directive (top of message, very explicit) ─────
  lines.push(`=== STRICTNESS ===`);
  lines.push(`strictness_level: ${strictness}`);
  lines.push(strictnessGuidance(strictness));
  lines.push(`=== END STRICTNESS ===`);
  lines.push(``);

  // ─── 1. SUBJECT (mirrors the drafter's prompt) ─────────────────
  lines.push(`=== SUBJECT ===`);
  lines.push(
    `This document is about: ${project_description || '(no subject provided — flag every paragraph as off_subject if any topical content is present)'}`,
  );
  lines.push(
    `Every section must be about THIS subject. The TEMPLATE EXAMPLE below is reused from a DIFFERENT document for STRUCTURE only — flag any drift toward its topic as off_subject.`,
  );
  lines.push(`=== END SUBJECT ===`);

  // ─── 2. ATTACHED REFERENCES (verbatim) ─────────────────────────
  if (references_block) {
    lines.push(``);
    lines.push(references_block);
  } else {
    lines.push(``);
    lines.push(`=== ATTACHED REFERENCES ===`);
    lines.push(
      `(none — the drafter had no source material. Treat any specific factual claim as a hallucination unless it derives from SHARED INPUTS or PRIOR SECTIONS.)`,
    );
    lines.push(`=== END ATTACHED REFERENCES ===`);
  }

  // ─── 3. TEMPLATE EXAMPLE for THIS section ──────────────────────
  if (template_example && template_example.trim().length > 0) {
    lines.push(``);
    lines.push(`=== TEMPLATE EXAMPLE FOR THIS SECTION ===`);
    lines.push(
      `Below is the source-template text for this section. Use it ONLY to judge whether the draft matches its STRUCTURE, TONE, DEPTH, and required structural components (headings, signature blocks, tables, lists). Its subject matter is from a different document — flag any topical overlap with the draft as off_subject.`,
    );
    lines.push(``);
    lines.push(template_example);
    lines.push(`=== END TEMPLATE EXAMPLE ===`);
  }

  // ─── 4. STYLE BLOCK ────────────────────────────────────────────
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

  // ─── 5. SECTION SPEC ───────────────────────────────────────────
  lines.push(``);
  lines.push(`=== SECTION SPEC ===`);
  lines.push(`id: ${section.id}`);
  lines.push(`name: ${section.name}`);
  lines.push(`order: ${section.order}`);
  if (section.intent) {
    lines.push(`intent: ${section.intent}`);
  }
  if (section.target_words) {
    lines.push(`target_words: ${section.target_words[0]}-${section.target_words[1]}`);
  }
  const validation = pickStructuralValidation(section.validation);
  if (validation) {
    lines.push(`length_validation: ${JSON.stringify(validation)}`);
  }
  const allowed = section.fill_region.permitted_roles ?? ['body'];
  lines.push(`permitted_roles: ${allowed.join(', ')}`);
  lines.push(`=== END SECTION SPEC ===`);

  // ─── 6. PRIOR SECTIONS ─────────────────────────────────────────
  if (prior_summaries.length > 0) {
    lines.push(``);
    lines.push(`=== PRIOR SECTIONS ===`);
    for (const ps of prior_summaries) {
      lines.push(`  - ${ps.name} (${ps.section_id}): ${ps.summary}`);
    }
    lines.push(`=== END PRIOR SECTIONS ===`);
  }

  // ─── 7. THE DRAFT TO CRITIQUE ──────────────────────────────────
  lines.push(``);
  lines.push(`=== DRAFT TO CRITIQUE ===`);
  lines.push(`Total paragraphs: ${draft.length}`);
  const totalWords = countWords(draft);
  lines.push(`Total words: ${totalWords}`);
  lines.push(``);
  draft.forEach((p, i) => {
    if (p.role === 'table_row' && Array.isArray(p.cells)) {
      lines.push(`[${i}] role=table_row cells=${JSON.stringify(p.cells)}`);
    } else {
      lines.push(`[${i}] role=${p.role} text=${JSON.stringify(p.text ?? '')}`);
    }
  });
  lines.push(`=== END DRAFT TO CRITIQUE ===`);

  lines.push(``);
  lines.push(
    `Critique the draft above using the rules in your system prompt. Apply the STRICTNESS level at the top of this message. Return STRICT JSON in the schema {"issues":[...]}. No commentary outside the JSON.`,
  );

  return {
    system_prompt: CRITIC_SYSTEM_PROMPT,
    message: lines.join('\n'),
  };
}

function strictnessGuidance(level: CritiqueStrictness): string {
  switch (level) {
    case 'lenient':
      return 'Only raise issues you are highly confident about. Concrete, demonstrable problems only. When in doubt, do not raise the issue.';
    case 'strict':
      return 'Raise any aspect of the draft that could be improved, even minor ones. Flag borderline cases at low severity.';
    case 'moderate':
    default:
      return 'Raise concrete problems and clear style/structure issues. Skip purely subjective tonal judgments.';
  }
}

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

function countWords(paragraphs: DraftParagraph[]): number {
  let n = 0;
  for (const p of paragraphs) {
    if (p.role === 'table_row' && Array.isArray(p.cells)) {
      for (const c of p.cells) n += wordCount(c);
    } else {
      n += wordCount(p.text ?? '');
    }
  }
  return n;
}

function wordCount(s: string): number {
  if (!s) return 0;
  const trimmed = s.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

// ─── Critic response normalization ───────────────────────────────

const VALID_SEVERITIES: ReadonlySet<CritiqueSeverity> = new Set([
  'low',
  'medium',
  'high',
]);

const VALID_CATEGORIES: ReadonlySet<CritiqueCategory> = new Set([
  'hallucination',
  'off_subject',
  'structural',
  'banned_phrase',
  'length_violation',
  'role_violation',
  'vague',
  'placeholder_residue',
  'other',
]);

interface RawCritiqueResponse {
  issues?: unknown;
  passed?: unknown;
}

function normalizeIssues(raw: unknown): CritiqueIssue[] {
  if (!raw || typeof raw !== 'object') return [];
  const r = raw as RawCritiqueResponse;
  if (!Array.isArray(r.issues)) return [];
  const out: CritiqueIssue[] = [];
  for (const item of r.issues) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const sev = String(obj.severity ?? '').toLowerCase() as CritiqueSeverity;
    const cat = String(obj.category ?? '').toLowerCase() as CritiqueCategory;
    const message = typeof obj.message === 'string' ? obj.message.trim() : '';
    if (!message) continue;
    const severity: CritiqueSeverity = VALID_SEVERITIES.has(sev) ? sev : 'medium';
    const category: CritiqueCategory = VALID_CATEGORIES.has(cat) ? cat : 'other';
    const fix = typeof obj.suggested_fix === 'string' && obj.suggested_fix.trim().length > 0
      ? obj.suggested_fix.trim()
      : undefined;
    out.push({ severity, category, message, suggested_fix: fix });
  }
  // Cap at 8 even if the model emitted more.
  return out.slice(0, 8);
}

/**
 * Apply the strictness filter and decide if the critique passed. The
 * model assigns severity per issue; strictness only affects whether
 * borderline LOW issues survive to be displayed (medium+ are always
 * counted toward the pass/fail decision).
 *
 * passed = true iff zero medium-or-high severity issues remain.
 */
function decidePassed(issues: CritiqueIssue[]): boolean {
  return !issues.some((i) => i.severity === 'medium' || i.severity === 'high');
}

// ─── Public API: critiqueDraft ───────────────────────────────────

/**
 * Run one critique pass over a drafted section. Returns passed=true
 * iff zero medium-or-high severity issues survived. The caller (the
 * loop runner) is responsible for deciding whether to revise.
 */
export async function critiqueDraft(
  client: LLMClient,
  args: CritiqueArgs,
): Promise<CritiqueResult> {
  const built = buildCritiquePrompt(args);
  const model = args.model ?? DEFAULT_CRITIC_MODEL;

  const { data, raw } = await client.queryJson<unknown>({
    message: built.message,
    system_prompt: built.system_prompt,
    model,
    dataset: 'none',
    limit_references: 0,
    temperature: DEFAULT_CRITIC_TEMPERATURE,
    live: 0,
    usage: true,
  });

  const issues = normalizeIssues(data);
  const passed = decidePassed(issues);
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
    passed,
    issues,
    tokens_in,
    tokens_out,
    usage_by_model,
    model,
    prompt_sent: built.message,
    raw_output: data,
  };
}

// ─── Loop runner: types ──────────────────────────────────────────

export interface CriticLoopArgs {
  client: LLMClient;
  /**
   * Closure provided by the orchestrator. Receives optional revision
   * notes (the structured block produced by `formatRevisionNotes`)
   * and is responsible for inlining them into the drafting prompt.
   * On the first iteration, revisionNotes is null.
   */
  draftFn: (revisionNotes: string | null) => Promise<{
    paragraphs: DraftParagraph[];
    prompt_sent: string;
    references: string;
    tokens_in: number;
    tokens_out: number;
    model: string;
    /** Optional: number of OpenRouter web-search results invoked by this draft call. */
    web_search_results?: number;
  }>;
  template: TemplateSchema;
  section: BodyFillRegion;
  project_description: string;
  references_block: string | null;
  template_example: string | null;
  prior_summaries: PriorSectionSummary[];
  /**
   * Max critique → revise iterations.
   *   0 = single-pass (no critic at all)
   *   1 = critique once but never revise (diagnostic only)
   *   2 = default — initial draft + up to 2 revisions = up to 3 drafts total
   * Capped at HARD_MAX_ITERATIONS (3).
   */
  max_iterations?: number;
  strictness?: CritiqueStrictness;
  /** Defaults to the drafter's model. */
  model?: string;
}

export interface CriticLoopIteration {
  iteration: number;
  draft: DraftParagraph[];
  prompt_sent: string;
  /** Null when max_iterations === 0 (no critic ran). */
  critique: CritiqueResult | null;
  /** True if a revision draft was generated AFTER this iteration. */
  was_revised: boolean;
}

export interface CriticLoopResult {
  /** Final accepted paragraphs (last iteration). */
  paragraphs: DraftParagraph[];
  /** Final prompt sent to the drafter. */
  prompt_sent: string;
  /** References returned by the LAST drafting call. */
  references: string;
  /**
   * True iff the LAST critique passed (or max_iterations === 0). False
   * means we hit max_iterations with medium+ issues remaining.
   */
  converged: boolean;
  /** Full iteration history for diagnostics. */
  iterations: CriticLoopIteration[];
  /** Sum of tokens across every draft + critique call. */
  total_tokens_in: number;
  total_tokens_out: number;
  /**
   * Per-model usage across every draft + critique call in the loop.
   * Drafts and critiques may run on different model ids when the
   * Settings tab has a separate critic override; this records each.
   */
  usage_by_model: UsageByModel;
  /** Last drafting model used. */
  model: string;
}

// ─── Revision-notes builder ──────────────────────────────────────

/**
 * Format the critic's issues into a structured block that the drafter's
 * closure can inline into its next prompt. The drafter is responsible
 * for choosing where to insert this block (typically near the top of
 * the message body, after the SUBJECT block, so it carries weight).
 */
export function formatRevisionNotes(issues: CritiqueIssue[]): string {
  if (issues.length === 0) return '';
  const lines: string[] = [];
  lines.push(
    `=== REVISION NOTES (your previous attempt had these issues, fix them) ===`,
  );
  // High-severity first, then medium, then low — drafter sees the
  // most important fixes at the top of the block.
  const ranked = [...issues].sort(severityRank);
  for (const i of ranked) {
    const fix = i.suggested_fix ? ` Fix: ${i.suggested_fix}` : '';
    lines.push(`- [${i.severity}] ${i.category}: ${i.message}${fix}`);
  }
  lines.push(`=== END REVISION NOTES ===`);
  return lines.join('\n');
}

function severityRank(a: CritiqueIssue, b: CritiqueIssue): number {
  const order: Record<CritiqueSeverity, number> = { high: 0, medium: 1, low: 2 };
  return order[a.severity] - order[b.severity];
}

// ─── Public API: runDraftWithCriticLoop ──────────────────────────

/**
 * The full draft → critique → revise loop. The caller provides a
 * `draftFn` closure that knows how to call draftSection() with the
 * orchestrator's per-section setup; this module just decides when to
 * stop and what to feed back as revision notes.
 *
 * Loop semantics:
 *   iteration 0: draftFn(null), then critique
 *   if critique passes OR max_iterations === 0 → return
 *   else iteration N+1: draftFn(formatRevisionNotes(issues)), critique again
 *   if last iteration's critique still fails → return with converged: false
 *
 * Hard cap: HARD_MAX_ITERATIONS (3) revisions, regardless of input.
 */
export async function runDraftWithCriticLoop(
  args: CriticLoopArgs,
): Promise<CriticLoopResult> {
  const requested = args.max_iterations ?? DEFAULT_MAX_ITERATIONS;
  const maxIterations = Math.max(0, Math.min(HARD_MAX_ITERATIONS, requested));
  const strictness = args.strictness ?? DEFAULT_STRICTNESS;

  const iterations: CriticLoopIteration[] = [];
  let totalTokensIn = 0;
  let totalTokensOut = 0;
  const usage_by_model: UsageByModel = emptyUsage();

  // ── Iteration 0: initial draft ──
  let lastDraft = await args.draftFn(null);
  totalTokensIn += lastDraft.tokens_in;
  totalTokensOut += lastDraft.tokens_out;
  recordUsage(usage_by_model, lastDraft.model, {
    tokens_in: lastDraft.tokens_in,
    tokens_out: lastDraft.tokens_out,
    web_search_results: lastDraft.web_search_results,
  });

  // No-critic mode: single-pass, return immediately.
  if (maxIterations === 0) {
    iterations.push({
      iteration: 0,
      draft: lastDraft.paragraphs,
      prompt_sent: lastDraft.prompt_sent,
      critique: null,
      was_revised: false,
    });
    return {
      paragraphs: lastDraft.paragraphs,
      prompt_sent: lastDraft.prompt_sent,
      references: lastDraft.references,
      converged: true,
      iterations,
      total_tokens_in: totalTokensIn,
      total_tokens_out: totalTokensOut,
      usage_by_model,
      model: lastDraft.model,
    };
  }

  // Iterative critique → revise loop.
  //
  // `maxIterations` semantics (from the spec):
  //   0 → no critic at all (handled above; we never enter this loop)
  //   1 → critique once but NEVER revise (1 draft, 1 critique, 0 revises)
  //   N≥2 → up to N revisions allowed; total drafts ≤ N+1, total
  //          critiques ≤ N+1, iterations.length ≤ N+1.
  //
  // So with the default maxIterations=2: initial draft + critique;
  // up to 2 revisions each followed by another critique → at most
  // 3 drafts and 3 critiques. iterations.length ≤ 3.
  //
  // Each "pass" through the loop is one critique on the latest draft.
  // A failing critique that isn't the last allowed pass triggers one
  // revision draft, which becomes the input for the next pass.
  let converged = false;
  const maxPasses = maxIterations === 1 ? 1 : maxIterations + 1;

  for (let pass = 0; pass < maxPasses; pass++) {
    const critique = await critiqueDraft(args.client, {
      template: args.template,
      section: args.section,
      draft: lastDraft.paragraphs,
      project_description: args.project_description,
      references_block: args.references_block,
      template_example: args.template_example,
      prior_summaries: args.prior_summaries,
      strictness,
      model: args.model,
    });
    totalTokensIn += critique.tokens_in;
    totalTokensOut += critique.tokens_out;
    mergeUsage(usage_by_model, critique.usage_by_model);

    if (critique.passed) {
      iterations.push({
        iteration: pass,
        draft: lastDraft.paragraphs,
        prompt_sent: lastDraft.prompt_sent,
        critique,
        was_revised: false,
      });
      converged = true;
      break;
    }

    // Critique failed. If this was the last allowed pass, stop.
    const isLastPass = pass === maxPasses - 1;
    if (isLastPass) {
      iterations.push({
        iteration: pass,
        draft: lastDraft.paragraphs,
        prompt_sent: lastDraft.prompt_sent,
        critique,
        was_revised: false,
      });
      converged = false;
      break;
    }

    // Revise: feed the issues back to the drafter and loop.
    iterations.push({
      iteration: pass,
      draft: lastDraft.paragraphs,
      prompt_sent: lastDraft.prompt_sent,
      critique,
      was_revised: true,
    });
    const notes = formatRevisionNotes(critique.issues);
    lastDraft = await args.draftFn(notes);
    totalTokensIn += lastDraft.tokens_in;
    totalTokensOut += lastDraft.tokens_out;
    recordUsage(usage_by_model, lastDraft.model, {
      tokens_in: lastDraft.tokens_in,
      tokens_out: lastDraft.tokens_out,
      web_search_results: lastDraft.web_search_results,
    });
  }

  return {
    paragraphs: lastDraft.paragraphs,
    prompt_sent: lastDraft.prompt_sent,
    references: lastDraft.references,
    converged,
    iterations,
    total_tokens_in: totalTokensIn,
    total_tokens_out: totalTokensOut,
    usage_by_model,
    model: lastDraft.model,
  };
}

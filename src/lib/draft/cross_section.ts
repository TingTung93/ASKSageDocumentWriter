// cross_section.ts — document-level cross-section review pass.
//
// Phase 4 of the drafting pipeline. After every section has been drafted
// (and — in the default pipeline — converged through the Phase 3 critic
// loop), the orchestrator makes ONE final LLM call that looks across
// EVERY drafted section at once for issues that can only be detected at
// the document level:
//
//   - contradictions between sections
//   - terminology drift (same concept, different names)
//   - missing cross-references implied by the template structure
//   - unnecessary redundancy
//   - tone drift between sections
//
// Design notes:
//
//   - The prompt is SUBJECT-AGNOSTIC. It MUST NOT name any specific
//     topic (no SHARP, no transfusion, no contracting jargon). Every
//     bad/good example uses placeholders like "<topic A>" / "section
//     <X>". Same convention as lib/draft/critique.ts and
//     lib/template/synthesis/prompt.ts.
//
//   - This pass enforces the drafter's SUBJECT-block-dominant philosophy
//     from the OTHER side: single-section issues (off_subject, internal
//     vagueness, section-level length, banned phrases) are OUT OF SCOPE
//     here — Phase 3's section critic already caught them. Issues here
//     must span 2+ sections.
//
//   - The model NEVER rewrites. It only emits structured issues. Humans
//     review the list in the UI and decide which to address by hand.
//     Auto-fixing a cross-section issue would require orchestrated
//     multi-section re-drafts, which is out of scope.
//
//   - Token budget: we omit template_example content (the pass doesn't
//     need structural scaffolding) and per-section references (those
//     were a Phase 2/3 concern). Drafted paragraphs are compressed to
//     `[role] text` lines with no extra whitespace. A 30-section 200-
//     word/section project lands comfortably under 50k input tokens.
//
//   - Dataset is explicitly 'none' — no RAG for this pass. The drafted
//     document IS the source material.

import type { LLMClient } from '../provider/types';
import type { BodyFillRegion, TemplateSchema } from '../template/types';
import type { DraftParagraph } from './types';
import { type UsageByModel, recordUsage } from '../usage';
import { resolveDraftingModel } from '../provider/resolve_model';

// ─── Public types ────────────────────────────────────────────────

export type CrossSectionCategory =
  | 'contradiction'      // two sections state inconsistent facts
  | 'terminology_drift'  // same concept named differently across sections
  | 'missing_reference'  // a cross-reference implied by template structure but absent
  | 'redundancy'         // same content repeated unnecessarily across sections
  | 'tone_drift'         // register or voice shifts noticeably between sections
  | 'other';

export type CrossSectionSeverity = 'low' | 'medium' | 'high';

export interface CrossSectionIssue {
  severity: CrossSectionSeverity;
  category: CrossSectionCategory;
  /** One-sentence specific issue. Must NAME the affected section ids. */
  message: string;
  /** Section ids the issue touches (1 or more). */
  affected_section_ids: string[];
  /** Optional one-sentence suggested fix. */
  suggested_fix?: string;
}

export interface CrossSectionResult {
  /** True if zero medium+ issues found. */
  passed: boolean;
  issues: CrossSectionIssue[];
  tokens_in: number;
  tokens_out: number;
  /** Per-model usage breakdown. Always a single entry. */
  usage_by_model: UsageByModel;
  model: string;
  /** Prompt sent (for diagnostics + audit). */
  prompt_sent: string;
  /** Raw model output. */
  raw_output: unknown;
}

/**
 * One drafted section's content packaged for the cross-section pass.
 * The orchestrator builds these from DraftRecord rows that completed
 * the critic loop.
 */
export interface DraftedSectionInput {
  template_id: string;
  template_name: string;
  section: BodyFillRegion;
  paragraphs: DraftParagraph[];
}

export interface CrossSectionArgs {
  client: LLMClient;
  /** The user's authoritative SUBJECT statement — overrides everything. */
  project_description: string;
  /** Templates included in the project (for structural context). */
  templates: TemplateSchema[];
  /** Every drafted section in the project (typically already converged via the critic loop). */
  sections: DraftedSectionInput[];
  /** Defaults to 'google-claude-46-sonnet'. */
  model?: string;
}

// ─── Constants ───────────────────────────────────────────────────

export const DEFAULT_CROSS_SECTION_MODEL = 'google-claude-46-sonnet';
export const DEFAULT_CROSS_SECTION_TEMPERATURE = 0;

// ─── System prompt (subject-agnostic) ────────────────────────────

const CROSS_SECTION_SYSTEM_PROMPT = `You are a document-level reviewer for a formal government document that was drafted one section at a time. A separate per-section critic already checked each individual section for grounding, subject drift, length, banned phrases, structural components, and role violations — those single-section concerns are OUT OF SCOPE for you.

Your job is to look across EVERY drafted section AT ONCE and flag only issues that span TWO OR MORE sections. You will see every drafted section in document order with its id, name, intent, and compressed role-tagged paragraphs.

OUTPUT SCHEMA — strict JSON only, no markdown code fences, no commentary:

{
  "passed": <true if you found no medium-or-high severity issues, else false>,
  "issues": [
    {
      "severity": "low" | "medium" | "high",
      "category": "<one of: contradiction | terminology_drift | missing_reference | redundancy | tone_drift | other>",
      "message": "<one sentence. MUST name the affected section ids verbatim from the spec list>",
      "affected_section_ids": ["<id_1>", "<id_2>", ...],
      "suggested_fix": "<optional one-sentence suggestion; omit this field if you have nothing concrete to suggest>"
    }
  ]
}

If the document has no cross-section issues, return: {"passed": true, "issues": []}

CORE PHILOSOPHY — read carefully:

The drafter operates under a SUBJECT-block-dominant philosophy. The SUBJECT block at the top of this message is the only correct topic for the whole document. If a single section drifted from the SUBJECT, that is a SECTION-LEVEL issue and the per-section critic (Phase 3) already caught it — DO NOT flag it here.

You flag only issues that span 2+ sections. If you cannot tie an issue to at least one specific section id from the spec list, DO NOT include it.

You NEVER:
  - Rewrite any section. Issues only.
  - Propose subjective improvements ("this could be more concise", "the tone feels off"). Only flag CONCRETE inconsistencies, contradictions, or structural omissions.
  - Flag a single-section problem (length, vagueness, banned phrase, off-subject drift). Out of scope.
  - Invent section ids. The affected_section_ids array MUST contain only ids that appear in the SECTION LIST below.
  - Return more than 12 issues total. If you would emit more than 12, keep the highest-severity 12.
  - Fence your JSON output or add any commentary outside the JSON object.

CATEGORIES — one bad and one good example each (placeholder topics, never real ones):

  - contradiction
      Two sections state facts that cannot both be true.
      Bad:  section <A> says "<field X> is 30 days" but section <B> says "<field X> is 60 days".
      Good: every appearance of <field X> across sections uses the same value.

  - terminology_drift
      The same concept is named differently in different sections.
      Bad:  section <A> calls it "<term P>" but section <B> calls the same thing "<term Q>" without defining them as synonyms.
      Good: the document uses one canonical name for each concept, or defines synonyms explicitly.

  - missing_reference
      The template structure implies a cross-reference between sections that the draft does not make.
      Bad:  section <A> promises "<responsibilities are defined in the roles section>" but section <B> (the roles section) does not exist or does not contain the promised content.
      Good: every forward-reference in one section is satisfied by the content of the referenced section.

  - redundancy
      The same substantive content is repeated across sections without purpose.
      Bad:  section <A> and section <B> both contain the same three-sentence description of <concept Y> verbatim or near-verbatim.
      Good: each fact is stated once in its home section and referenced (not repeated) from others.

  - tone_drift
      Voice, tense, or register shifts noticeably between sections in a way the STYLE BLOCK does not permit.
      Bad:  sections <A> and <B> are in formal third-person passive but section <C> shifts to first-person active ("we will…").
      Good: every section sustains the same voice, tense, and register.

  - other
      Any concrete cross-section defect that doesn't fit above. Use sparingly.

SEVERITY:

  - high   — must-fix. The document is unusable as-is. Example: direct numeric contradiction between two sections.
  - medium — should-fix. The document needs editing before delivery. Example: terminology drift that would confuse a reviewer, a missing cross-reference.
  - low    — nice-to-fix. Example: a single minor tonal shift, a single near-duplicate sentence across two sections.

The top-level "passed" field must equal true if and only if there are zero medium-or-high severity issues in the "issues" array.

Return STRICT JSON only. No markdown code fences. No commentary outside the JSON object.`;

// ─── Prompt body builder ─────────────────────────────────────────

interface BuiltCrossSectionPrompt {
  system_prompt: string;
  message: string;
}

function buildCrossSectionPrompt(args: CrossSectionArgs): BuiltCrossSectionPrompt {
  const { project_description, templates, sections } = args;
  const lines: string[] = [];

  // ─── 1. SUBJECT (top of body, framed as a hard constraint) ─────
  lines.push(`=== SUBJECT ===`);
  lines.push(
    `This document is about: ${project_description || '(no subject provided — treat the whole document as suspect and flag aggressively)'}`,
  );
  lines.push(
    `Every section is about THIS subject. Single-section drift is NOT your concern — the section-level critic already handled it. You look only for cross-section issues (contradictions, terminology drift, missing references, redundancy, tone drift).`,
  );
  lines.push(`=== END SUBJECT ===`);

  // ─── 2. TEMPLATES (structural context only, no example bodies) ──
  if (templates.length > 0) {
    lines.push(``);
    lines.push(`=== TEMPLATES IN THIS PROJECT ===`);
    for (const t of templates) {
      const styleBits: string[] = [];
      if (t.style.voice) styleBits.push(`voice=${t.style.voice}`);
      if (t.style.tense) styleBits.push(`tense=${t.style.tense}`);
      if (t.style.register) styleBits.push(`register=${t.style.register}`);
      if (t.style.banned_phrases && t.style.banned_phrases.length > 0) {
        styleBits.push(`banned=[${t.style.banned_phrases.join(', ')}]`);
      }
      const style = styleBits.length > 0 ? `  [${styleBits.join(', ')}]` : '';
      lines.push(`- ${t.id}: ${t.name}${style}`);
    }
    lines.push(`=== END TEMPLATES ===`);
  }

  // ─── 3. SECTION LIST (document order, with compressed drafts) ──
  lines.push(``);
  lines.push(`=== SECTION LIST (document order) ===`);
  lines.push(`Total sections: ${sections.length}`);
  lines.push(``);
  sections.forEach((s, idx) => {
    lines.push(`--- [${idx}] id=${s.section.id} ---`);
    lines.push(`name: ${s.section.name}`);
    lines.push(`template: ${s.template_name} (${s.template_id})`);
    if (s.section.intent) {
      lines.push(`intent: ${s.section.intent}`);
    }
    // Compressed drafted paragraphs: one line per paragraph,
    // `[role] text` with no extra whitespace. table_row rows use
    // the cells array since they have no text field.
    for (const p of s.paragraphs) {
      if (p.role === 'table_row' && Array.isArray(p.cells)) {
        lines.push(`[${p.role}] ${p.cells.join(' | ')}`);
      } else {
        const text = (p.text ?? '').replace(/\s+/g, ' ').trim();
        lines.push(`[${p.role}] ${text}`);
      }
    }
  });
  lines.push(`=== END SECTION LIST ===`);

  // ─── 4. Closing instruction ────────────────────────────────────
  lines.push(``);
  lines.push(
    `Review the section list above for cross-section issues ONLY. Remember: single-section problems are out of scope. Every issue you raise MUST reference at least one section id from the list verbatim in its affected_section_ids array AND name the affected section id(s) in the message text. Return STRICT JSON in the schema {"passed": bool, "issues": [...]}. No commentary outside the JSON.`,
  );

  return {
    system_prompt: CROSS_SECTION_SYSTEM_PROMPT,
    message: lines.join('\n'),
  };
}

// ─── Response normalization ──────────────────────────────────────

const VALID_SEVERITIES: ReadonlySet<CrossSectionSeverity> = new Set([
  'low',
  'medium',
  'high',
]);

const VALID_CATEGORIES: ReadonlySet<CrossSectionCategory> = new Set([
  'contradiction',
  'terminology_drift',
  'missing_reference',
  'redundancy',
  'tone_drift',
  'other',
]);

interface RawCrossSectionResponse {
  passed?: unknown;
  issues?: unknown;
}

/**
 * Parse + sanitize the raw model JSON into CrossSectionIssue[]. Drops
 * any malformed entries: missing/empty message, missing or empty
 * affected_section_ids, unknown severity (normalized to 'medium'),
 * unknown category (normalized to 'other').
 */
function normalizeIssues(raw: unknown, knownSectionIds: Set<string>): CrossSectionIssue[] {
  if (!raw || typeof raw !== 'object') return [];
  const r = raw as RawCrossSectionResponse;
  if (!Array.isArray(r.issues)) return [];
  const out: CrossSectionIssue[] = [];
  for (const item of r.issues) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;

    const message = typeof obj.message === 'string' ? obj.message.trim() : '';
    if (!message) continue;

    // affected_section_ids is REQUIRED and must be a non-empty array.
    // Filter to only ids we actually know about — the model sometimes
    // hallucinates neighbour ids.
    const rawIds = obj.affected_section_ids;
    if (!Array.isArray(rawIds) || rawIds.length === 0) continue;
    const ids: string[] = [];
    for (const id of rawIds) {
      if (typeof id !== 'string') continue;
      const trimmed = id.trim();
      if (!trimmed) continue;
      if (knownSectionIds.size > 0 && !knownSectionIds.has(trimmed)) continue;
      ids.push(trimmed);
    }
    if (ids.length === 0) continue;

    const sev = String(obj.severity ?? '').toLowerCase() as CrossSectionSeverity;
    const cat = String(obj.category ?? '').toLowerCase() as CrossSectionCategory;
    const severity: CrossSectionSeverity = VALID_SEVERITIES.has(sev) ? sev : 'medium';
    const category: CrossSectionCategory = VALID_CATEGORIES.has(cat) ? cat : 'other';

    const fix =
      typeof obj.suggested_fix === 'string' && obj.suggested_fix.trim().length > 0
        ? obj.suggested_fix.trim()
        : undefined;

    out.push({
      severity,
      category,
      message,
      affected_section_ids: ids,
      suggested_fix: fix,
    });
  }
  // Cap at 12 (matches system prompt contract).
  return out.slice(0, 12);
}

function decidePassed(issues: CrossSectionIssue[]): boolean {
  return !issues.some((i) => i.severity === 'medium' || i.severity === 'high');
}

// ─── Public API: runCrossSectionReview ───────────────────────────

/**
 * Run a single LLM pass that looks across the entire drafted document
 * for cross-section issues. Returns a structured list. The agent does
 * NOT auto-fix — humans review.
 */
export async function runCrossSectionReview(
  args: CrossSectionArgs,
): Promise<CrossSectionResult> {
  const built = buildCrossSectionPrompt(args);
  // Route through the model resolver so the cross-section pass uses
  // the same provider-aware id selection as the per-section drafter.
  // The legacy hardcoded DEFAULT_CROSS_SECTION_MODEL was an Ask Sage
  // id and crashed every OpenRouter run with a 400 "not a valid model
  // ID" — see #28.
  const model = await resolveDraftingModel(args.client, args.model, 'drafting');

  const knownSectionIds = new Set<string>();
  for (const s of args.sections) knownSectionIds.add(s.section.id);

  // Strip Ask-Sage-only knobs when the provider doesn't honor them.
  // OpenRouter would silently drop these but a clean request body
  // makes audit logs easier to read.
  const queryInput: Parameters<typeof args.client.queryJson>[0] = {
    message: built.message,
    system_prompt: built.system_prompt,
    model,
    temperature: DEFAULT_CROSS_SECTION_TEMPERATURE,
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

  const issues = normalizeIssues(data, knownSectionIds);
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

// ─── Public API: groupIssuesBySection ────────────────────────────

/**
 * Helper for the UI: group cross-section issues by affected section
 * id so the per-section diagnostics view can show issues that touch
 * a section without rendering the same issue under multiple sections.
 *
 * Each issue is fanned out to EVERY id in its affected_section_ids
 * array. The returned Map preserves insertion order of the first time
 * each id is seen, which is useful for deterministic UI rendering.
 */
export function groupIssuesBySection(
  issues: CrossSectionIssue[],
): Map<string, CrossSectionIssue[]> {
  const out = new Map<string, CrossSectionIssue[]>();
  for (const issue of issues) {
    for (const id of issue.affected_section_ids) {
      const bucket = out.get(id);
      if (bucket) {
        bucket.push(issue);
      } else {
        out.set(id, [issue]);
      }
    }
  }
  return out;
}

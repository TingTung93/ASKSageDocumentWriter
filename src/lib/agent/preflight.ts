// Phase 2 — gap analysis & readiness report.
//
// Before the recipe runner kicks off Phase 3 drafting, the agent does
// a one-shot LLM pre-flight against the project: which shared inputs
// are missing, is the subject specific enough to draft from, do the
// attached references actually cover every section in every selected
// template, and which template (if multiple are loaded) is the best
// match for what the user described?
//
// Three exported entry points, all single-LLM-call:
//
//   - runReadinessCheck   — produce a ReadinessReport
//   - suggestTemplate     — pick the best-matching template
//   - proposeSharedInputs — auto-fill blanks from subject + references
//
// Design rationale:
//
// 1. We deterministically compute `missing_shared_inputs` from
//    deriveSharedInputFields(templates) vs project.shared_inputs.
//    The LLM CANNOT be trusted with this — it will skip fields, invent
//    keys, or hallucinate values. The LLM's job is the soft, fuzzy
//    work: coverage maps, vague-subject warnings, advisory actions.
//
// 2. All system prompts are subject-agnostic per the same convention as
//    lib/template/synthesis/prompt.ts. We never bake topical subjects
//    (SHARP, transfusion, mission essential) into the spec. The user
//    will reuse this code for ANY contracting subject.
//
// 3. Strict JSON, temperature 0, OUTPUT SCHEMA inlined into the system
//    prompt. Mirrors the pattern from lib/draft/prompt.ts.
//
// 4. We use the structural LLMClient interface so the same module
//    works against Ask Sage and OpenRouter. The Ask Sage tenant is the
//    only path that supports datasets/files, but pre-flight only needs
//    completion + queryJson.

import type { LLMClient } from '../provider/types';
import type { ProjectRecord, TemplateRecord, ProjectContextFile } from '../db/schema';
import type { SharedInputField } from '../project/helpers';
import { deriveSharedInputFields } from '../project/helpers';
import { AskSageClient } from '../asksage/client';
import { blobToFile, extractedTextFromRet } from '../asksage/extract';

// ─── Public types ────────────────────────────────────────────────────

/**
 * Coverage map for a single template's sections vs the project's
 * attached references. The agent uses this to spot sections that
 * have no source material (will need [INSERT: ...] placeholders).
 */
export interface ReferenceCoverage {
  template_id: string;
  template_name: string;
  covered_sections: string[];
  thin_coverage_sections: string[];
  no_coverage_sections: string[];
}

/**
 * One actionable item the agent surfaces to the user during pre-flight.
 * The runner converts these into UI checklist rows.
 */
export interface ReadinessAction {
  severity: 'info' | 'warning' | 'error';
  message: string;
  /** Optional machine-readable hint the UI can act on. */
  hint?: Record<string, unknown>;
}

export interface ReadinessReport {
  ready_to_draft: boolean;
  missing_shared_inputs: string[];
  vague_subject: boolean;
  subject_warnings: string[];
  coverage: ReferenceCoverage[];
  actions: ReadinessAction[];
  tokens_in: number;
  tokens_out: number;
  model: string;
  raw_output: unknown;
}

export interface ReadinessCheckArgs {
  project: ProjectRecord;
  templates: TemplateRecord[];
  reference_files: ProjectContextFile[];
  model?: string;
}

export interface TemplateSuggestion {
  template_id: string;
  template_name: string;
  confidence: number;
  reasoning: string;
}

export interface ProposedSharedInput {
  value: string;
  source: 'project_subject' | 'reference_file' | 'inferred' | 'default';
  source_label?: string;
  confidence: number;
}

// ─── Internal: model-side response shapes ────────────────────────────

interface ReadinessLLMResponse {
  vague_subject?: boolean;
  subject_warnings?: string[];
  coverage?: Array<{
    template_id?: string;
    template_name?: string;
    covered_sections?: string[];
    thin_coverage_sections?: string[];
    no_coverage_sections?: string[];
  }>;
  actions?: Array<{
    severity?: 'info' | 'warning' | 'error';
    message?: string;
    hint?: Record<string, unknown>;
  }>;
}

interface TemplateSuggestionLLMResponse {
  template_id?: string;
  confidence?: number;
  reasoning?: string;
}

interface ProposedSharedInputsLLMResponse {
  proposals?: Record<
    string,
    {
      value?: string;
      source?: 'project_subject' | 'reference_file' | 'inferred' | 'default';
      source_label?: string;
      confidence?: number;
    }
  >;
}

// ─── System prompts (strict JSON, subject-agnostic) ──────────────────

const READINESS_SYSTEM_PROMPT = `You are a pre-flight reviewer for a government document drafting pipeline. The user is about to draft one or more formal documents (PWS, J&A, market research report, memo, SOP, policy) from selected templates and a set of attached reference files. Your job is to look at the project subject, template section list, and reference file metadata, and produce a STRUCTURED readiness report telling the user what is missing or risky BEFORE drafting starts.

You always respond with STRICT JSON only. No markdown code fences, no prose, no explanation. The JSON must parse on the first attempt with JSON.parse().

OUTPUT SCHEMA — produce JSON in exactly this shape:
{
  "vague_subject": <boolean>,
  "subject_warnings": ["<one-line specific complaint>", ...],
  "coverage": [
    {
      "template_id": "<id from input>",
      "template_name": "<name from input>",
      "covered_sections": ["<section_id>", ...],
      "thin_coverage_sections": ["<section_id>", ...],
      "no_coverage_sections": ["<section_id>", ...]
    }
  ],
  "actions": [
    { "severity": "info" | "warning" | "error", "message": "<one short sentence>", "hint": { "kind": "<machine_hint>", ... } }
  ]
}

GUIDANCE per field:

- vague_subject: true if the project description is empty, generic ("a contract"), under ~10 meaningful words, or fails to identify what is being acquired/done. False if the subject is concrete enough to draft a section from.

- subject_warnings: be SPECIFIC. "Missing the equipment make/model" — not "needs more detail". "Does not state the period of performance" — not "vague timeframe". Each warning is one line, actionable, no apology language. Empty array if vague_subject is false.

- coverage: for EVERY template in the input, produce one entry. Bucket each section_id into exactly one of covered / thin / no_coverage based on whether the attached reference files appear to contain source material the drafter could pull from for that section. The reference block below contains the actual extracted text of each file (or a leading excerpt for very long files), or chunk titles+summaries when the file has been semantically chunked — read the content carefully and judge coverage on substance, not on filename. A "Definitions" or "Signature Block" section with no reference material is usually fine and should be marked covered. A "Performance Requirements" section with no relevant references is no_coverage.

- actions: mixed advisories. Severities:
    "error"   — drafting will probably fail or produce a useless document
    "warning" — drafting will work but the output will need significant rework
    "info"    — auto-fixable hints, suggestions, opportunities
  Each action MUST be specific. Bad: "missing some metadata". Good: "No reference file mentions the contracting officer's name — drafting will leave a [INSERT: contracting officer] placeholder in the signature block." Use the optional "hint" object when the UI could act on the action automatically (e.g., {"kind": "fill_shared_input", "key": "document_number"}).

CRITICAL CONSTRAINTS:
- Be SUBJECT-AGNOSTIC in your reasoning style. Do not assume any particular acquisition topic; reason from what the user actually provided.
- Never invent section_ids. Only emit ids that appear in the input.
- Never invent template_ids. Only emit ids that appear in the input.
- Do NOT compute or emit "missing_shared_inputs" or "ready_to_draft" — those are computed deterministically by the caller.
- Files do NOT need to be "semantically chunked" to be usable. The drafter inlines the full extracted text of every attached file into every section prompt at draft time. NEVER emit an action that says missing chunks make a file unusable. NEVER recommend "reprocess_files" / chunking as a prerequisite for drafting — at most, mention it as an info-severity optimization for very long files.
- Judge file content from the EXTRACTED TEXT shown in the reference block, not from the filename alone. If a file's extracted text covers a section's topic, that section is covered.
- Return STRICT JSON. No markdown, no commentary.`;

const TEMPLATE_SUGGEST_SYSTEM_PROMPT = `You are matching a project description to the best-fitting template from a small library of government document templates. The user has loaded several templates and described what they need to draft. Your job is to pick ONE template — the strongest match — and explain in one sentence why.

You always respond with STRICT JSON only. No markdown code fences, no prose, no explanation. The JSON must parse on the first attempt with JSON.parse().

OUTPUT SCHEMA — produce JSON in exactly this shape:
{
  "template_id": "<id from the input list>",
  "confidence": <float from 0.0 to 1.0>,
  "reasoning": "<one short sentence, subject-agnostic phrasing>"
}

GUIDANCE:

- template_id MUST be one of the ids in the input list. Do not invent.
- confidence reflects how clearly the project subject matches the template's document type. 0.9+ = unambiguous (the user said "PWS" and there is a PWS template). 0.6-0.9 = strong match by content. 0.3-0.6 = weak / could go either way. <0.3 = no good match (still pick the closest).
- reasoning is one short sentence focused on the document TYPE match, not the subject matter. GOOD: "User asked for a market research report and this template's section list (Background, Methodology, Findings, Recommendations) matches that document type." BAD: "Best for SHARP-related work."
- Only one template returned. Pick the strongest. The caller will display the confidence so the user can override if low.

Return STRICT JSON. No markdown, no commentary.`;

const PROPOSE_INPUTS_SYSTEM_PROMPT = `You are auto-filling fielded metadata for a government document by extracting values from a project subject and a set of attached reference files. The user has a set of REQUESTED FIELDS (e.g. document_number, contracting_officer_name, period_of_performance, cui_banner). For each field, find the best-supported value from the source material and report a confidence score and provenance. SKIP fields you cannot ground in the source material — do not guess.

You always respond with STRICT JSON only. No markdown code fences, no prose, no explanation. The JSON must parse on the first attempt with JSON.parse().

OUTPUT SCHEMA — produce JSON in exactly this shape:
{
  "proposals": {
    "<field_key>": {
      "value": "<extracted value as string>",
      "source": "project_subject" | "reference_file" | "inferred" | "default",
      "source_label": "<optional, e.g. filename of the reference>",
      "confidence": <float from 0.0 to 1.0>
    }
  }
}

GUIDANCE:

- Only emit a key for a field you have actual evidence for. If the subject + references contain nothing about a field, OMIT it entirely (do not emit a null/empty entry).
- source values:
    "project_subject"  — value comes directly from the user's project description
    "reference_file"   — value comes from one of the attached reference files (set source_label to the filename)
    "inferred"         — value is a reasonable inference from context (lower confidence)
    "default"          — value is a known boilerplate default for the field (e.g. cui_banner = "CUI" when CUI material is referenced)
- confidence:
    >= 0.9 — value appears verbatim in the source
    0.7-0.9 — value is paraphrased / formatted from the source
    0.5-0.7 — inference from clear context
    < 0.5 — guess; usually you should OMIT instead
- Be SUBJECT-AGNOSTIC. Do not assume any particular acquisition topic. Reason only from the input you are given.
- Values are always strings. Format dates as ISO YYYY-MM-DD when possible. Format dollar amounts with the leading $.

Return STRICT JSON. No markdown, no commentary.`;

// ─── Helpers ─────────────────────────────────────────────────────────

const DEFAULT_MODEL = 'google-claude-46-sonnet';

/** Per-file extracted-text cap when inlining into the preflight prompt. */
const PREFLIGHT_FILE_CAP_CHARS = 12_000;
/** Aggregate cap across ALL files in the preflight prompt. */
const PREFLIGHT_TOTAL_CAP_CHARS = 60_000;

function summarizeFile(
  file: ProjectContextFile,
  extractedText: string | null,
  remainingBudget: number,
): { rendered: string; chars_used: number } {
  // Priority order: chunks > extracted text > metadata-only stub.
  if (file.chunks && file.chunks.length > 0) {
    const chunkLines = file.chunks
      .slice(0, 20)
      .map((c) => `    - ${c.title}: ${c.summary}`)
      .join('\n');
    const rendered = `  - ${file.filename} (${file.chunks.length} chunks)\n${chunkLines}`;
    return { rendered, chars_used: rendered.length };
  }

  if (extractedText && extractedText.trim().length > 0) {
    const cap = Math.max(0, Math.min(PREFLIGHT_FILE_CAP_CHARS, remainingBudget));
    const truncated =
      extractedText.length > cap
        ? extractedText.slice(0, Math.max(0, cap - 1)).trimEnd() + '…'
        : extractedText;
    const header = `  - ${file.filename} (${file.mime_type}, ${file.size_bytes.toLocaleString()} bytes, ${extractedText.length.toLocaleString()} chars extracted${extractedText.length > cap ? `, showing first ${truncated.length.toLocaleString()}` : ''})`;
    const body = truncated
      .split('\n')
      .map((line) => `    ${line}`)
      .join('\n');
    const rendered = `${header}\n${body}`;
    return { rendered, chars_used: rendered.length };
  }

  // Last resort: extraction failed AND no chunks available. The model
  // is told the file exists but has no content visibility — it should
  // NOT treat this as drafter-blocking per the system prompt.
  const rendered = `  - ${file.filename} (${file.mime_type}, ${file.size_bytes.toLocaleString()} bytes; extraction unavailable in preflight — drafter will still inline this file at draft time)`;
  return { rendered, chars_used: rendered.length };
}

function compactTemplateForReadiness(tpl: TemplateRecord): string {
  const lines: string[] = [];
  lines.push(`  - id: ${tpl.id}`);
  lines.push(`    name: ${tpl.name}`);
  lines.push(`    source_filename: ${tpl.schema_json.source.filename}`);
  lines.push(`    sections:`);
  for (const s of tpl.schema_json.sections) {
    const intent = s.intent ? ` — ${s.intent}` : '';
    lines.push(`      - ${s.id}: ${s.name}${intent}`);
  }
  return lines.join('\n');
}

function compactTemplateForSuggest(tpl: TemplateRecord): string {
  const sectionNames = tpl.schema_json.sections.map((s) => s.name).join(' | ');
  return `  - id: ${tpl.id}\n    name: ${tpl.name}\n    source_filename: ${tpl.schema_json.source.filename}\n    sections: ${sectionNames || '(none parsed)'}`;
}

function buildReferenceCorpus(
  files: ProjectContextFile[],
  extractedById: Map<string, string>,
): string {
  if (files.length === 0) return '(no attached reference files)';
  const sections: string[] = [];
  let used = 0;
  for (const f of files) {
    const remaining = PREFLIGHT_TOTAL_CAP_CHARS - used;
    if (remaining <= 200) {
      sections.push(
        `  - ${f.filename} (truncated — total preflight reference budget exhausted; drafter will still see the full file at draft time)`,
      );
      continue;
    }
    const text = extractedById.get(f.id) ?? null;
    const { rendered, chars_used } = summarizeFile(f, text, remaining);
    sections.push(rendered);
    used += chars_used;
  }
  return sections.join('\n');
}

/**
 * Upload + extract every reference file via /server/file ONCE so the
 * preflight prompt can see actual file content (not just filenames).
 * Mirrors the same pattern used by lib/draft/orchestrator and
 * lib/document/edit. Failures are non-fatal — the file falls back to
 * the metadata-only stub and the preflight prompt warns the model not
 * to gate drafting on those.
 */
async function extractReferencesForPreflight(
  client: LLMClient,
  files: ProjectContextFile[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (files.length === 0) return out;
  // /server/file is Ask-Sage-only. On OpenRouter we skip extraction
  // entirely; the preflight prompt still tells the model that missing
  // text is not a blocker, so it should not over-flag.
  if (!(client instanceof AskSageClient)) {
    return out;
  }
  for (const f of files) {
    try {
      const fileObj = blobToFile(f.bytes, f.filename, f.mime_type);
      const upload = await client.uploadFile(fileObj);
      const text = extractedTextFromRet(upload.ret);
      if (text && text.trim().length > 0) {
        out.set(f.id, text);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[preflight] failed to extract ${f.filename}; falling back to metadata-only stub:`,
        err,
      );
    }
  }
  return out;
}

/**
 * Deterministic computation of missing shared inputs. The LLM never
 * touches this — required fields whose project value is empty/whitespace
 * are flagged. Optional fields are not flagged even when blank.
 */
function computeMissingSharedInputs(
  templates: TemplateRecord[],
  project: ProjectRecord,
): string[] {
  const fields = deriveSharedInputFields(templates);
  const missing: string[] = [];
  for (const f of fields) {
    if (!f.required) continue;
    const v = project.shared_inputs[f.key];
    if (!v || !v.trim()) missing.push(f.key);
  }
  return missing;
}

// ─── runReadinessCheck ───────────────────────────────────────────────

export async function runReadinessCheck(
  client: LLMClient,
  args: ReadinessCheckArgs,
): Promise<ReadinessReport> {
  const model = args.model ?? DEFAULT_MODEL;

  // Pre-flight pre-flight: extract reference file text once so the
  // LLM can judge coverage on actual content, not on filenames.
  const extractedById = await extractReferencesForPreflight(client, args.reference_files);

  const messageLines: string[] = [];
  messageLines.push(`=== PROJECT SUBJECT ===`);
  messageLines.push(args.project.description?.trim() || '(empty)');
  messageLines.push(`=== END PROJECT SUBJECT ===`);
  messageLines.push('');
  messageLines.push(`=== SELECTED TEMPLATES (${args.templates.length}) ===`);
  if (args.templates.length === 0) {
    messageLines.push('(no templates selected)');
  } else {
    for (const tpl of args.templates) {
      messageLines.push(compactTemplateForReadiness(tpl));
    }
  }
  messageLines.push(`=== END SELECTED TEMPLATES ===`);
  messageLines.push('');
  messageLines.push(`=== ATTACHED REFERENCE FILES (${args.reference_files.length}) ===`);
  messageLines.push(buildReferenceCorpus(args.reference_files, extractedById));
  messageLines.push(`=== END ATTACHED REFERENCE FILES ===`);
  messageLines.push('');
  messageLines.push(
    `Now produce the readiness report JSON per the OUTPUT SCHEMA in your system prompt. Return STRICT JSON only.`,
  );

  const { data, raw } = await client.queryJson<ReadinessLLMResponse>({
    message: messageLines.join('\n'),
    model,
    system_prompt: READINESS_SYSTEM_PROMPT,
    temperature: 0,
    limit_references: 0,
    usage: true,
  });

  // Normalize the LLM coverage. Make sure every selected template has
  // an entry — if the model dropped one, fill in an empty coverage row
  // so the UI doesn't have to special-case it.
  const llmCoverageById = new Map<string, ReferenceCoverage>();
  for (const c of data.coverage ?? []) {
    if (!c.template_id) continue;
    llmCoverageById.set(c.template_id, {
      template_id: c.template_id,
      template_name: c.template_name ?? c.template_id,
      covered_sections: Array.isArray(c.covered_sections) ? c.covered_sections : [],
      thin_coverage_sections: Array.isArray(c.thin_coverage_sections)
        ? c.thin_coverage_sections
        : [],
      no_coverage_sections: Array.isArray(c.no_coverage_sections)
        ? c.no_coverage_sections
        : [],
    });
  }
  const coverage: ReferenceCoverage[] = args.templates.map((tpl) => {
    const existing = llmCoverageById.get(tpl.id);
    if (existing) return existing;
    return {
      template_id: tpl.id,
      template_name: tpl.name,
      covered_sections: [],
      thin_coverage_sections: [],
      no_coverage_sections: tpl.schema_json.sections.map((s) => s.id),
    };
  });

  const actions: ReadinessAction[] = [];
  for (const a of data.actions ?? []) {
    if (!a.message) continue;
    actions.push({
      severity: a.severity ?? 'info',
      message: a.message,
      hint: a.hint,
    });
  }

  const missing_shared_inputs = computeMissingSharedInputs(args.templates, args.project);
  const vague_subject = Boolean(data.vague_subject);
  const subject_warnings = Array.isArray(data.subject_warnings) ? data.subject_warnings : [];

  // ready_to_draft is the AND of: nothing missing, subject not vague,
  // and no error-severity actions. Warnings and thin coverage are OK.
  const hasError = actions.some((a) => a.severity === 'error');
  const ready_to_draft =
    missing_shared_inputs.length === 0 && !vague_subject && !hasError;

  return {
    ready_to_draft,
    missing_shared_inputs,
    vague_subject,
    subject_warnings,
    coverage,
    actions,
    tokens_in: raw.usage?.prompt_tokens ?? 0,
    tokens_out: raw.usage?.completion_tokens ?? 0,
    model,
    raw_output: data,
  };
}

// ─── suggestTemplate ─────────────────────────────────────────────────

export async function suggestTemplate(
  client: LLMClient,
  args: {
    project: ProjectRecord;
    templates: TemplateRecord[];
    reference_files: ProjectContextFile[];
    model?: string;
  },
): Promise<TemplateSuggestion | null> {
  if (args.templates.length === 0) return null;
  const model = args.model ?? DEFAULT_MODEL;

  const messageLines: string[] = [];
  messageLines.push(`=== PROJECT SUBJECT ===`);
  messageLines.push(args.project.description?.trim() || '(empty)');
  messageLines.push(`=== END PROJECT SUBJECT ===`);
  messageLines.push('');
  messageLines.push(`=== AVAILABLE TEMPLATES (${args.templates.length}) ===`);
  for (const tpl of args.templates) {
    messageLines.push(compactTemplateForSuggest(tpl));
  }
  messageLines.push(`=== END AVAILABLE TEMPLATES ===`);
  if (args.reference_files.length > 0) {
    messageLines.push('');
    messageLines.push(`=== ATTACHED REFERENCE FILES (${args.reference_files.length}, names only for matching) ===`);
    for (const f of args.reference_files) {
      messageLines.push(`  - ${f.filename}`);
    }
    messageLines.push(`=== END ATTACHED REFERENCE FILES ===`);
  }
  messageLines.push('');
  messageLines.push(
    `Pick the single best-matching template for this project. Return STRICT JSON per the OUTPUT SCHEMA in your system prompt.`,
  );

  const { data } = await client.queryJson<TemplateSuggestionLLMResponse>({
    message: messageLines.join('\n'),
    model,
    system_prompt: TEMPLATE_SUGGEST_SYSTEM_PROMPT,
    temperature: 0,
    limit_references: 0,
    usage: true,
  });

  const picked = args.templates.find((t) => t.id === data.template_id);
  // If the model returned an unknown id, fall back to the first
  // template with a low confidence rather than throwing.
  if (!picked) {
    const fallback = args.templates[0]!;
    return {
      template_id: fallback.id,
      template_name: fallback.name,
      confidence: 0,
      reasoning: 'Model returned an unrecognized template id; defaulting to first.',
    };
  }
  const rawConf = typeof data.confidence === 'number' ? data.confidence : 0;
  const confidence = Math.max(0, Math.min(1, rawConf));
  return {
    template_id: picked.id,
    template_name: picked.name,
    confidence,
    reasoning: data.reasoning?.trim() || '(no reasoning provided)',
  };
}

// ─── proposeSharedInputs ─────────────────────────────────────────────

export async function proposeSharedInputs(
  client: LLMClient,
  args: {
    project: ProjectRecord;
    shared_fields: SharedInputField[];
    reference_files: ProjectContextFile[];
    model?: string;
  },
): Promise<Record<string, ProposedSharedInput>> {
  if (args.shared_fields.length === 0) return {};
  const model = args.model ?? DEFAULT_MODEL;

  // Same pre-flight pre-flight: extract file text so the model can
  // actually find values to propose.
  const extractedById = await extractReferencesForPreflight(client, args.reference_files);

  const messageLines: string[] = [];
  messageLines.push(`=== REQUESTED FIELDS (${args.shared_fields.length}) ===`);
  for (const f of args.shared_fields) {
    const allowed = f.allowed_values?.length
      ? ` (allowed values: ${f.allowed_values.join(' | ')})`
      : '';
    messageLines.push(`  - ${f.key}: "${f.display_name}" [${f.control_type}]${allowed}`);
  }
  messageLines.push(`=== END REQUESTED FIELDS ===`);
  messageLines.push('');
  messageLines.push(`=== PROJECT SUBJECT ===`);
  messageLines.push(args.project.description?.trim() || '(empty)');
  messageLines.push(`=== END PROJECT SUBJECT ===`);
  messageLines.push('');
  messageLines.push(`=== ATTACHED REFERENCE FILES (${args.reference_files.length}) ===`);
  messageLines.push(buildReferenceCorpus(args.reference_files, extractedById));
  messageLines.push(`=== END ATTACHED REFERENCE FILES ===`);
  messageLines.push('');
  messageLines.push(
    `For each requested field, find the best-supported value from the source material. SKIP fields with no evidence. Return STRICT JSON per the OUTPUT SCHEMA in your system prompt.`,
  );

  const { data } = await client.queryJson<ProposedSharedInputsLLMResponse>({
    message: messageLines.join('\n'),
    model,
    system_prompt: PROPOSE_INPUTS_SYSTEM_PROMPT,
    temperature: 0,
    limit_references: 0,
    usage: true,
  });

  const requestedKeys = new Set(args.shared_fields.map((f) => f.key));
  const out: Record<string, ProposedSharedInput> = {};
  for (const [key, raw] of Object.entries(data.proposals ?? {})) {
    if (!requestedKeys.has(key)) continue; // ignore hallucinated keys
    if (!raw || typeof raw.value !== 'string' || raw.value.trim().length === 0) continue;
    const conf = typeof raw.confidence === 'number' ? raw.confidence : 0;
    out[key] = {
      value: raw.value,
      source: raw.source ?? 'inferred',
      source_label: raw.source_label,
      confidence: Math.max(0, Math.min(1, conf)),
    };
  }
  return out;
}

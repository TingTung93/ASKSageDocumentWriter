// prepass.ts — pre-pass problem identification for the document
// cleanup pipeline.
//
// The single-pass cleanup module (lib/document/edit.ts) sends each
// chunk to the LLM with "find and fix any issues you see" in ONE
// request. That forces the model to spend attention scanning every
// paragraph in the window whether it needs editing or not.
//
// This module implements the cheaper two-call alternative:
//
//   1. runProblemIdentificationPass — a narrow "flag locations" call
//      that asks the model which paragraphs in the window need
//      editing and what category of issue each one has. No edit body,
//      no rationales, just `{paragraph_index, category, hint,
//      severity}` markers. Small, cheap, fast.
//
//   2. narrowChunkToFocus — a local helper that turns those flagged
//      indices into a narrowed paragraph chunk with neighbor context,
//      mirroring the existing `EditChunk.editableIndices` shape so
//      the caller can drop it into the existing chunk loop. The edit
//      pass then only has to look at the flagged paragraphs (plus a
//      small neighbor window for continuity).
//
// Design notes:
//
//   - The system prompt is INTENTIONALLY NARROW. It tells the model:
//     "you are NOT proposing edits in this pass. Only flag locations
//     and categories. The fix pass comes next." This frees the model
//     from having to draft replacement text and keeps the response
//     small.
//
//   - The prompt is SUBJECT-AGNOSTIC (no SHARP / transfusion /
//     contracting references). It is reused across every document the
//     user cleans up. The user's free-form cleanup instruction is the
//     only thing that biases which categories get flagged.
//
//   - The output shape is strict JSON and the categories are fixed.
//     Unknown categories collapse to 'other'; unknown severities
//     collapse to 'medium'.
//
//   - This module does NOT call the edit pass and does NOT know about
//     DocumentEditOp. The integrator wires it in front of the existing
//     chunk loop in lib/document/edit.ts.

import type { LLMClient } from '../provider/types';
import type { ParagraphInfo } from '../template/parser';

// ─── Public types ────────────────────────────────────────────────

export type ProblemCategory =
  | 'grammar'
  | 'tone'
  | 'wordiness'
  | 'factual'
  | 'banned_phrase'
  | 'structure'
  | 'formatting'
  | 'other';

export interface ProblemMarker {
  /** Absolute paragraph index (the same indices used elsewhere in the pipeline) */
  paragraph_index: number;
  /** Short category for the kind of issue. */
  category: ProblemCategory;
  /** One-line description of the specific issue. Used for UI breadcrumbs. */
  hint: string;
  /** 'low' | 'medium' | 'high' — drives downstream prioritization. */
  severity: 'low' | 'medium' | 'high';
}

export interface PrepassResult {
  markers: ProblemMarker[];
  /** Indices the user should focus on (de-duped, sorted ascending). */
  focus_indices: number[];
  tokens_in: number;
  tokens_out: number;
  model: string;
  prompt_sent: string;
  raw_output: unknown;
}

export interface PrepassArgs {
  /** Significant paragraphs in this chunk window (already filtered to non-empty by the caller). */
  paragraphs: ParagraphInfo[];
  /** Free-form user instruction the cleanup pass is following — informs which categories to flag. */
  instruction: string;
  /** Optional model override; falls back to the cleanup model. */
  model?: string;
}

// ─── Constants ───────────────────────────────────────────────────

/**
 * Default model for the pre-pass. Mirrors the edit pipeline's default
 * so the caller doesn't have to think about it — the pre-pass is a
 * cheap narrow call, so the same strong model is fine. Override per
 * call if a cheaper tier is desired.
 */
export const DEFAULT_PREPASS_MODEL = 'google-claude-46-sonnet';

export const DEFAULT_PREPASS_TEMPERATURE = 0;

// ─── System prompt (subject-agnostic, narrow, "flag only") ───────

const PREPASS_SYSTEM_PROMPT = `You are a triage reviewer for a formal document cleanup pipeline. You will be shown a chunk of a finished document (one paragraph per line, each labeled with its absolute index) and a free-form user instruction describing what kind of cleanup is desired.

Your ONLY job in this pass is to FLAG LOCATIONS. You are NOT proposing edits. You are NOT rewriting text. You are NOT producing replacement paragraphs. A separate fix pass — which only runs AFTER yours — will take the paragraphs you flag and do the actual editing. Keep your output small and focused.

OUTPUT SCHEMA — strict JSON only, no markdown code fences, no commentary outside the JSON:

{
  "markers": [
    {
      "paragraph_index": <int>,
      "category": "<one of: grammar | tone | wordiness | factual | banned_phrase | structure | formatting | other>",
      "hint": "<one short sentence describing the issue in this paragraph>",
      "severity": "low" | "medium" | "high"
    }
  ]
}

If a paragraph is clean, DO NOT include it. An empty markers array ({"markers": []}) is the correct answer for a clean chunk — do not invent problems to look productive.

CATEGORIES — one-line definitions:

  - grammar       — grammar, punctuation, agreement, or typo errors.
  - tone          — wrong register for a formal document (too casual, editorializing, first-person, marketing language).
  - wordiness     — redundant, padded, or unnecessarily long phrasing that can be tightened without losing meaning.
  - factual       — a claim that is internally inconsistent, contradicts another paragraph, or is a clear factual error on its face.
  - banned_phrase — the user's instruction explicitly forbids a word or phrase and this paragraph uses it.
  - structure     — paragraph is in the wrong place, accidentally fragmented, accidentally merged, or missing a required component.
  - formatting    — visible formatting artifacts in the text itself (stray markdown, double spaces, mis-punctuated lists).
  - other         — anything concrete that doesn't fit above. Use sparingly.

SEVERITY:
  - high   — must-fix. Breaks meaning, factual error, banned phrase used, clearly wrong grammar.
  - medium — should-fix. Wordy, off-tone, or structural issue the fix pass should address.
  - low    — nice-to-fix. Minor stylistic tightening, borderline cases.

RULES:
  - Use ONLY the absolute paragraph indices shown in the chunk. Do not invent indices.
  - Each paragraph should appear at most ONCE in markers. Pick the most important issue and the best category.
  - hint must be one short sentence describing THIS paragraph's issue. Do not propose the fix, do not quote the replacement text, do not write more than one sentence.
  - If the user's instruction narrows the scope (e.g. "fix typos only"), only flag paragraphs that violate that scope. Do not flag issues outside the requested scope.
  - Return STRICT JSON only. No markdown code fences. No commentary outside the JSON.`;

// ─── Prompt assembly ─────────────────────────────────────────────

interface BuiltPrepassPrompt {
  system_prompt: string;
  message: string;
}

function buildPrepassMessage(args: PrepassArgs): BuiltPrepassPrompt {
  const lines: string[] = [];
  lines.push(
    `User instruction: ${args.instruction || '(no specific instruction; perform a general cleanup triage for grammar, tone, wordiness, and obvious errors)'}`,
  );
  lines.push(``);
  lines.push(`=== DOCUMENT CHUNK ===`);
  lines.push(
    `Each line is one paragraph, formatted as [<absolute_index>] <text>. Indices are absolute over the full document and are the only values you may use in "paragraph_index".`,
  );
  lines.push(``);
  for (const p of args.paragraphs) {
    // Compact single-line rendering. No run breakdown — this pass
    // doesn't propose edits, so run boundaries are irrelevant.
    lines.push(`[${p.index}] ${p.text}`);
  }
  lines.push(`=== END DOCUMENT CHUNK ===`);
  lines.push(``);
  lines.push(
    `Flag only paragraphs that need editing. Return STRICT JSON in the schema {"markers":[...]}. Empty markers array is fine if this chunk is already clean.`,
  );

  return {
    system_prompt: PREPASS_SYSTEM_PROMPT,
    message: lines.join('\n'),
  };
}

// ─── Response normalization ──────────────────────────────────────

const VALID_CATEGORIES: ReadonlySet<ProblemCategory> = new Set([
  'grammar',
  'tone',
  'wordiness',
  'factual',
  'banned_phrase',
  'structure',
  'formatting',
  'other',
]);

const VALID_SEVERITIES: ReadonlySet<ProblemMarker['severity']> = new Set([
  'low',
  'medium',
  'high',
]);

interface RawPrepassResponse {
  markers?: unknown;
}

/**
 * Coerce the raw LLM JSON into a clean ProblemMarker[], dropping
 * malformed entries and de-duplicating by paragraph_index (first
 * occurrence wins). Valid paragraph_index values must be present in
 * the `validIndices` set — entries that reference an index not in the
 * chunk are silently dropped.
 */
function normalizeMarkers(
  raw: unknown,
  validIndices: Set<number>,
): ProblemMarker[] {
  if (!raw || typeof raw !== 'object') return [];
  const r = raw as RawPrepassResponse;
  if (!Array.isArray(r.markers)) return [];
  const seen = new Set<number>();
  const out: ProblemMarker[] = [];
  for (const item of r.markers) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const idx = obj.paragraph_index;
    if (typeof idx !== 'number' || !Number.isFinite(idx)) continue;
    const paragraph_index = Math.trunc(idx);
    if (!validIndices.has(paragraph_index)) continue;
    if (seen.has(paragraph_index)) continue;
    seen.add(paragraph_index);

    const catRaw = String(obj.category ?? '').toLowerCase() as ProblemCategory;
    const sevRaw = String(obj.severity ?? '').toLowerCase() as ProblemMarker['severity'];
    const category: ProblemCategory = VALID_CATEGORIES.has(catRaw) ? catRaw : 'other';
    const severity: ProblemMarker['severity'] = VALID_SEVERITIES.has(sevRaw)
      ? sevRaw
      : 'medium';
    const hint =
      typeof obj.hint === 'string' && obj.hint.trim().length > 0
        ? obj.hint.trim()
        : '(no hint)';

    out.push({ paragraph_index, category, hint, severity });
  }
  return out;
}

// ─── Public API: runProblemIdentificationPass ────────────────────

/**
 * Run a single LLM pass that identifies which paragraphs in the chunk
 * need editing and what category of issue each one has. Strict JSON.
 *
 * The system prompt is intentionally narrow: the model is told NOT to
 * propose edits, only to flag locations. Output is small (one line
 * per flagged paragraph, no edit body), so this call is cheap.
 *
 * Returns markers + a deduped focus_indices list the chunked cleanup
 * loop can use to narrow which paragraphs get the full edit pass.
 */
export async function runProblemIdentificationPass(
  client: LLMClient,
  args: PrepassArgs,
): Promise<PrepassResult> {
  const model = args.model ?? DEFAULT_PREPASS_MODEL;
  const built = buildPrepassMessage(args);

  const { data, raw } = await client.queryJson<unknown>({
    message: built.message,
    system_prompt: built.system_prompt,
    model,
    dataset: 'none',
    limit_references: 0,
    temperature: DEFAULT_PREPASS_TEMPERATURE,
    live: 0,
    usage: true,
  });

  const validIndices = new Set(args.paragraphs.map((p) => p.index));
  const markers = normalizeMarkers(data, validIndices);
  const focus_indices = Array.from(
    new Set(markers.map((m) => m.paragraph_index)),
  ).sort((a, b) => a - b);

  const usage =
    (raw.usage as
      | { prompt_tokens?: number; completion_tokens?: number }
      | null
      | undefined) ?? {};

  return {
    markers,
    focus_indices,
    tokens_in: usage.prompt_tokens ?? 0,
    tokens_out: usage.completion_tokens ?? 0,
    model,
    prompt_sent: built.message,
    raw_output: data,
  };
}

// ─── Public API: narrowChunkToFocus ──────────────────────────────

/**
 * Filter a paragraph chunk down to ONLY the focus indices, preserving
 * a small context window of N neighbors on either side so the second-
 * pass model still has surrounding context. Default N = 1.
 *
 * Returns the narrowed list of paragraphs PLUS a Set of which of
 * those indices the model is allowed to actually edit (the original
 * focus indices). Mirrors the existing `EditChunk.editableIndices`
 * shape so the caller can drop this into the existing chunk loop.
 *
 * The neighbor window is measured in POSITIONS within the input
 * `paragraphs` array — not in absolute paragraph index arithmetic —
 * because the paragraphs array may already be filtered to significant
 * (non-blank) paragraphs, so consecutive positions can have
 * non-consecutive absolute indices. This matches how the existing
 * chunk loop in lib/document/edit.ts walks its windows.
 *
 * Focus indices that don't appear in the input paragraph list are
 * silently skipped (graceful: callers can feed stale indices without
 * exploding).
 */
export function narrowChunkToFocus(args: {
  paragraphs: ParagraphInfo[];
  focus_indices: number[];
  neighbor_window?: number;
}): {
  paragraphs: ParagraphInfo[];
  editable_indices: Set<number>;
} {
  const window = Math.max(0, args.neighbor_window ?? 1);
  const focusSet = new Set(args.focus_indices);

  // Map from absolute paragraph index → position in the input array.
  const positionByIndex = new Map<number, number>();
  args.paragraphs.forEach((p, pos) => positionByIndex.set(p.index, pos));

  // Collect the set of positions to keep: every focus paragraph's
  // position, plus every position within `window` of a focus position.
  const keepPositions = new Set<number>();
  const editableIndices = new Set<number>();
  for (const idx of focusSet) {
    const pos = positionByIndex.get(idx);
    if (pos === undefined) continue; // stale focus index — skip gracefully
    editableIndices.add(idx);
    const from = Math.max(0, pos - window);
    const to = Math.min(args.paragraphs.length - 1, pos + window);
    for (let i = from; i <= to; i++) keepPositions.add(i);
  }

  const narrowed: ParagraphInfo[] = [];
  const sortedPositions = Array.from(keepPositions).sort((a, b) => a - b);
  for (const pos of sortedPositions) {
    const p = args.paragraphs[pos];
    if (p) narrowed.push(p);
  }

  return {
    paragraphs: narrowed,
    editable_indices: editableIndices,
  };
}

// normalize_resolutions.ts — LLM normalization pass for user-supplied
// values from the fill-placeholders intervention form.
//
// Why this exists: when the user types values into the placeholder
// intervention form, the raw input goes straight to Dexie and into
// the assembled DOCX. That's a problem when the user types quick,
// informal input ("marivelle medellin", "MCHJ 9 April 2026") that
// needs to be reshaped into formal document text per Army memo
// conventions (ALL CAPS names in signature blocks, day-MON-YYYY
// dates, "POC for this action is [Rank] [Name]..." prose, etc).
//
// This module makes ONE LLM call per Apply & Continue click,
// passing every (section, raw_value) pair at once and getting back
// normalized values keyed by the same input id. Substance is
// preserved verbatim — only formatting changes. The caller
// substitutes the normalized values back into the resolutions list
// before calling applyPlaceholderResolutions.
//
// On any failure (network, parse, model unavailable) the caller
// should fall back to the raw values and emit a toast — better to
// land an unformatted draft than to lose the user's input entirely.

import type { LLMClient } from '../provider/types';
import { resolveDraftingModel } from '../provider/resolve_model';
import { DEFAULT_DRAFTING_TEMPERATURE } from './drafter';
import { type UsageByModel, recordUsage } from '../usage';

/**
 * One field the normalizer should clean up. The caller pairs this
 * with a stable key so the response can be matched back to the
 * original placeholder occurrences.
 */
export interface ResolutionToNormalize {
  /** Stable id assigned by the caller. Echoed back in the response. */
  key: string;
  /** Display name of the section the value will be inlined into. */
  section_name: string;
  /** Section intent (one-sentence communicative goal). */
  section_intent?: string;
  /** Description text from the placeholder, e.g. "addressee organization". */
  description: string;
  /** What the user typed, verbatim. */
  raw_value: string;
}

export interface NormalizeResolutionsArgs {
  client: LLMClient;
  /** Document type / template name for context (e.g. "Lateral Transfer Memo"). */
  document_kind: string;
  /** Project subject — the doc-level topic. */
  project_subject?: string;
  resolutions: ResolutionToNormalize[];
  model?: string;
}

export interface NormalizeResolutionsResult {
  /** Map from input key → normalized value. Always contains every
   *  input key (falling back to the raw value when the model dropped
   *  one), so the caller can blindly look up by key. */
  normalized: Map<string, string>;
  tokens_in: number;
  tokens_out: number;
  usage_by_model: UsageByModel;
  model: string;
  /** Human-readable count of values whose formatting changed. */
  changed: number;
  /** True when the normalization fell back to raw values entirely. */
  fellBack: boolean;
}

const SYSTEM_PROMPT = `You are NORMALIZING formatting on user-supplied values for fields in a formal U.S. government document (Army memorandum, DHA policy, contracting packet). The user typed quick, informal input into a fill-in form; your job is to reshape each value into the conventional format for its section type WITHOUT changing the substance.

CRITICAL — what you can and cannot change:
- You MAY change: capitalization, punctuation, line breaks, prefix/suffix words, date format, abbreviation expansion, name ordering (Last, First → First Last), structural prose around facts.
- You MAY NOT change: names, ranks, dates, numbers, organizations, phone numbers, email addresses, or ANY substantive fact. Every name, date, and number in the user's raw input must appear UNCHANGED in your normalized output (after format adjustments).
- You MAY NOT invent any fact the user did not provide. If a field's raw value is empty, return an empty string for that key.

OUTPUT — strict JSON only, no markdown, no commentary:
{
  "values": {
    "<input_key>": "<normalized value, preserving \\n line breaks where the section needs multiple lines>",
    ...
  }
}

ARMY MEMO FORMATTING CONVENTIONS:
- Signature block: SIGNATORY NAME ALL CAPS on its own line, then "RANK, BRANCH" on the next line, then position title (e.g. "Commanding") on the third line. Example raw "marivelle medellin, CPT MS, Commanding" → "MARIVELLE MEDELLIN\\nCPT, MS\\nCommanding".
- Header block: Department line ALL CAPS, then organization name ALL CAPS, then street address in title case, then "City ST ZIP" on the last line. Example raw "dept of army, troop command mrcp, 9040 Jackson Ave, Tacoma WA 98433" → "DEPARTMENT OF THE ARMY\\nTROOP COMMAND, MEDICAL READINESS COMMAND, PACIFIC\\n9040 Jackson Avenue\\nTacoma, WA 98433".
- Date and reference (office symbol + date): office symbol on the first line ALL CAPS, then ISO-style military date "DD MON YYYY" (with three-letter month abbreviation in title case) on the next line. Example raw "MCHJ 9 April 2026" → "MCHJ\\n9 April 2026".
- Subject line: "SUBJECT: " prefix in ALL CAPS followed by the topic in ALL CAPS. Example raw "lateral transfer of jacob baumgartner" → "SUBJECT: LATERAL TRANSFER OF SPC JACOB BAUMGARTNER".
- Memorandum-for / addressee block: each line begins with "MEMORANDUM FOR " for the first recipient (or "MEMORANDUM FOR SEE DISTRIBUTION" when there are many), with subsequent recipients indented (no prefix). Example raw "commander b co, commander c co" → "MEMORANDUM FOR Commander, B Company, Troop Command, Medical Readiness Command, Pacific\\n               Commander, C Company, Troop Command, Medical Readiness Command, Pacific".
- Point of contact: full prose sentence — "The point of contact for this action is [Rank] [Full Name], [Position], at [phone] or [email]." Use the section's target_words minimum if hinted in section_intent.
- Distribution list: "DISTRIBUTION:" header line in ALL CAPS, then each addressee on its own indented line. Example raw "spc baumgartner, s1" → "DISTRIBUTION:\\nSPC Jacob Baumgartner\\nS-1, Troop Command, Medical Readiness Command, Pacific".

GENERIC FALLBACK RULES (when the section type doesn't match an Army memo block):
- Title case headings, sentence case body prose, ALL CAPS for organizational names that customarily use it.
- Preserve line break intent — multi-line user input should produce multi-line output.

Return STRICT JSON only.`;

interface NormalizeLLMResponse {
  values?: Record<string, unknown>;
}

export async function normalizePlaceholderResolutions(
  args: NormalizeResolutionsArgs,
): Promise<NormalizeResolutionsResult> {
  const model = await resolveDraftingModel(args.client, args.model, 'drafting');

  // Build a deterministic fallback map up front. If the LLM call
  // fails or the parser drops a key, we still return SOMETHING usable
  // for every input — the user's raw value.
  const fallback = new Map<string, string>();
  for (const r of args.resolutions) fallback.set(r.key, r.raw_value);

  if (args.resolutions.length === 0) {
    return {
      normalized: fallback,
      tokens_in: 0,
      tokens_out: 0,
      usage_by_model: {},
      model,
      changed: 0,
      fellBack: false,
    };
  }

  const messageLines: string[] = [];
  messageLines.push(`=== DOCUMENT KIND ===`);
  messageLines.push(args.document_kind || '(unspecified)');
  messageLines.push(`=== END DOCUMENT KIND ===`);
  messageLines.push('');
  if (args.project_subject && args.project_subject.trim().length > 0) {
    messageLines.push(`=== PROJECT SUBJECT ===`);
    messageLines.push(args.project_subject.trim());
    messageLines.push(`=== END PROJECT SUBJECT ===`);
    messageLines.push('');
  }
  messageLines.push(`=== FIELDS TO NORMALIZE (${args.resolutions.length}) ===`);
  for (const r of args.resolutions) {
    messageLines.push(`--- key="${r.key}" ---`);
    messageLines.push(`  section_name: ${r.section_name}`);
    if (r.section_intent && r.section_intent.trim().length > 0) {
      messageLines.push(`  section_intent: ${r.section_intent.trim()}`);
    }
    messageLines.push(`  description: ${r.description}`);
    messageLines.push(`  raw_value: ${JSON.stringify(r.raw_value)}`);
  }
  messageLines.push(`=== END FIELDS TO NORMALIZE ===`);
  messageLines.push('');
  messageLines.push(
    `Return one normalized value per input key. Preserve every name, date, number, and fact verbatim — only adjust formatting per the conventions in your system prompt. Return STRICT JSON.`,
  );

  const queryInput: Parameters<typeof args.client.queryJson>[0] = {
    message: messageLines.join('\n'),
    system_prompt: SYSTEM_PROMPT,
    model,
    temperature: DEFAULT_DRAFTING_TEMPERATURE,
    usage: true,
  };
  if (args.client.capabilities.dataset) {
    queryInput.dataset = 'none';
    queryInput.limit_references = 0;
  }

  let data: NormalizeLLMResponse;
  let raw: { usage?: unknown; web_search_results?: unknown };
  try {
    const result = await args.client.queryJson<NormalizeLLMResponse>(queryInput);
    data = result.data;
    raw = result.raw;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[normalizePlaceholderResolutions] LLM call failed; falling back to raw values:', err);
    return {
      normalized: fallback,
      tokens_in: 0,
      tokens_out: 0,
      usage_by_model: {},
      model,
      changed: 0,
      fellBack: true,
    };
  }

  const normalized = new Map<string, string>(fallback); // start from fallback
  const valuesObj = (data.values && typeof data.values === 'object' && !Array.isArray(data.values))
    ? (data.values as Record<string, unknown>)
    : {};
  let changed = 0;
  for (const r of args.resolutions) {
    const v = valuesObj[r.key];
    if (typeof v !== 'string') continue;
    const trimmed = v.trim();
    if (!trimmed) continue;
    normalized.set(r.key, trimmed);
    if (trimmed !== r.raw_value.trim()) changed += 1;
  }

  const usage = (raw.usage as { prompt_tokens?: number; completion_tokens?: number }) ?? {};
  const tokens_in = usage.prompt_tokens ?? 0;
  const tokens_out = usage.completion_tokens ?? 0;
  const usage_by_model: UsageByModel = {};
  recordUsage(usage_by_model, model, {
    tokens_in,
    tokens_out,
    web_search_results:
      typeof raw.web_search_results === 'number' ? raw.web_search_results : undefined,
  });

  return {
    normalized,
    tokens_in,
    tokens_out,
    usage_by_model,
    model,
    changed,
    fellBack: false,
  };
}

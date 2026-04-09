// Per-model usage tracking.
//
// Every LLM call in the drafting chain runs against ONE specific
// model id. The recipe runner used to roll up call tokens into a
// single (tokens_in, tokens_out) pair on RecipeRun, which was fine
// when "the model" was always Claude 4.6 Sonnet on Ask Sage but
// breaks down once:
//
//   - Settings exposes per-stage model overrides (drafting + critic
//     can be different OpenRouter ids with different per-token cost)
//   - OpenRouter prices vary across orders of magnitude (Gemini Flash
//     vs Claude Opus vs GPT-5.1) so applying ONE model's pricing to
//     a mixed-model run is wildly inaccurate
//   - The OpenRouter `web` plugin adds a flat per-result charge that
//     has nothing to do with token cost
//
// UsageByModel is a Record keyed by model id. Each phase function
// (drafter, metadata batch, critic, cross-section review, preflight,
// chunker, mapper) returns its own UsageByModel; the recipe runner
// merges them into a single per-run breakdown that the cost helpers
// in lib/settings/cost.ts can convert into an accurate dollar figure.

import type { ModelInfo, ModelPricing } from './asksage/types';

export interface ModelUsageEntry {
  /** Sum of prompt tokens across every call to this model. */
  tokens_in: number;
  /** Sum of completion tokens. */
  tokens_out: number;
  /** Number of LLM calls billed against this model. */
  calls: number;
  /**
   * OpenRouter web plugin: total search results requested across
   * every call for this model. We use the requested max_results
   * (not the actual return count) for cost projection — it's an
   * upper bound and matches the budget the user opted into.
   */
  web_search_results?: number;
}

export type UsageByModel = Record<string, ModelUsageEntry>;

/** Default empty record. Helper so call sites read cleanly. */
export function emptyUsage(): UsageByModel {
  return {};
}

/**
 * Record one LLM call against a model id. Mutates `usage` in place.
 * Pass tokens_in / tokens_out from the call's `usage` field; pass
 * web_search_results when the OpenRouter web plugin was included
 * in the request body. Calls counter increments by 1 each time.
 */
export function recordUsage(
  usage: UsageByModel,
  model: string,
  delta: {
    tokens_in?: number;
    tokens_out?: number;
    web_search_results?: number;
  },
): void {
  if (!model) return;
  const cur = usage[model] ?? { tokens_in: 0, tokens_out: 0, calls: 0 };
  cur.tokens_in += delta.tokens_in ?? 0;
  cur.tokens_out += delta.tokens_out ?? 0;
  cur.calls += 1;
  if (delta.web_search_results && delta.web_search_results > 0) {
    cur.web_search_results = (cur.web_search_results ?? 0) + delta.web_search_results;
  }
  usage[model] = cur;
}

/**
 * Merge `source` into `target`. Used by the recipe runner to combine
 * per-stage usage into the run total, and by phase modules that
 * delegate to inner helpers (e.g. orchestrator combining drafter +
 * critic + cross-section review). Mutates `target`.
 */
export function mergeUsage(target: UsageByModel, source: UsageByModel | undefined | null): void {
  if (!source) return;
  for (const [model, entry] of Object.entries(source)) {
    const cur = target[model] ?? { tokens_in: 0, tokens_out: 0, calls: 0 };
    cur.tokens_in += entry.tokens_in;
    cur.tokens_out += entry.tokens_out;
    cur.calls += entry.calls;
    if (entry.web_search_results && entry.web_search_results > 0) {
      cur.web_search_results = (cur.web_search_results ?? 0) + entry.web_search_results;
    }
    target[model] = cur;
  }
}

/**
 * Aggregate totals across every model in the breakdown. Used by the
 * UI to render the run-level "X tokens · $Y" header without having
 * to walk the per-model rows itself.
 */
export function totalUsage(usage: UsageByModel | undefined | null): {
  tokens_in: number;
  tokens_out: number;
  calls: number;
  web_search_results: number;
} {
  let tokens_in = 0;
  let tokens_out = 0;
  let calls = 0;
  let web_search_results = 0;
  if (!usage) return { tokens_in, tokens_out, calls, web_search_results };
  for (const e of Object.values(usage)) {
    tokens_in += e.tokens_in;
    tokens_out += e.tokens_out;
    calls += e.calls;
    web_search_results += e.web_search_results ?? 0;
  }
  return { tokens_in, tokens_out, calls, web_search_results };
}

// ─── Cost computation ───────────────────────────────────────────

/**
 * OpenRouter web plugin pricing. Documented at
 * https://openrouter.ai/docs/features/web-search — most providers
 * route through Exa which charges $4 per 1000 results, i.e. $0.004
 * per result. Constant rather than configurable because it's a
 * platform fact, not a per-tenant tunable.
 */
export const WEB_SEARCH_USD_PER_RESULT = 0.004;

export interface ModelCostRow {
  model: string;
  tokens_in: number;
  tokens_out: number;
  calls: number;
  web_search_results: number;
  pricing: ModelPricing | null;
  /** USD from token cost only (null when pricing is unavailable). */
  usd_tokens: number | null;
  /** USD from web search results only. Always known when results > 0. */
  usd_web: number;
  /** Sum of usd_tokens (treated as 0 if null) + usd_web. null when both are null. */
  usd_total: number | null;
}

export interface RunCostBreakdown {
  per_model: ModelCostRow[];
  /** Aggregate row totals. usd_total is null if no row had any priced cost. */
  tokens_in: number;
  tokens_out: number;
  calls: number;
  web_search_results: number;
  usd_tokens: number | null;
  usd_web: number;
  usd_total: number | null;
}

/**
 * Convert a UsageByModel breakdown into a cost report. Each row's
 * pricing comes from the matching ModelInfo in `models` (the auth
 * store's cached /v1/models response). Rows whose model isn't in
 * the model list — or whose model is from Ask Sage which doesn't
 * publish pricing — get `pricing: null` and `usd_tokens: null`.
 * Web search cost is computed from the constant
 * WEB_SEARCH_USD_PER_RESULT and is always known.
 */
export function computeRunCost(
  usage: UsageByModel | undefined | null,
  models: ModelInfo[] | null | undefined,
): RunCostBreakdown {
  const rows: ModelCostRow[] = [];
  let tokens_in = 0;
  let tokens_out = 0;
  let calls = 0;
  let web_search_results = 0;
  let usd_tokens_total: number | null = null;
  let usd_web_total = 0;

  if (usage) {
    const modelById = new Map<string, ModelInfo>();
    if (models) {
      for (const m of models) modelById.set(m.id, m);
    }
    // Sort largest to smallest by token count so the UI shows the
    // hot path first. Stable for ties; falls back to model id.
    const entries = Object.entries(usage).sort((a, b) => {
      const ta = a[1].tokens_in + a[1].tokens_out;
      const tb = b[1].tokens_in + b[1].tokens_out;
      if (ta !== tb) return tb - ta;
      return a[0] < b[0] ? -1 : 1;
    });
    for (const [model, entry] of entries) {
      const pricing = modelById.get(model)?.pricing ?? null;
      const wsr = entry.web_search_results ?? 0;
      const usd_web = wsr * WEB_SEARCH_USD_PER_RESULT;
      let usd_tokens: number | null = null;
      if (pricing) {
        usd_tokens =
          entry.tokens_in * pricing.prompt_per_token +
          entry.tokens_out * pricing.completion_per_token;
      }
      const has_priced = usd_tokens !== null || usd_web > 0;
      const usd_total = has_priced ? (usd_tokens ?? 0) + usd_web : null;
      rows.push({
        model,
        tokens_in: entry.tokens_in,
        tokens_out: entry.tokens_out,
        calls: entry.calls,
        web_search_results: wsr,
        pricing,
        usd_tokens,
        usd_web,
        usd_total,
      });
      tokens_in += entry.tokens_in;
      tokens_out += entry.tokens_out;
      calls += entry.calls;
      web_search_results += wsr;
      if (usd_tokens !== null) {
        usd_tokens_total = (usd_tokens_total ?? 0) + usd_tokens;
      }
      usd_web_total += usd_web;
    }
  }

  const has_any_priced = usd_tokens_total !== null || usd_web_total > 0;
  return {
    per_model: rows,
    tokens_in,
    tokens_out,
    calls,
    web_search_results,
    usd_tokens: usd_tokens_total,
    usd_web: usd_web_total,
    usd_total: has_any_priced ? (usd_tokens_total ?? 0) + usd_web_total : null,
  };
}

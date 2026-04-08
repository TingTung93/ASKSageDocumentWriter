// Cost / token projection helpers. Estimates are intentionally rough —
// they exist to give the user a sanity check before kicking off a long
// drafting or cleanup pass, not to be billed against.

import type { CostAssumptions } from './types';

export interface CostEstimate {
  tokens_in: number;
  tokens_out: number;
  tokens_total: number;
  usd_in: number;
  usd_out: number;
  usd_total: number;
}

export function estimateProjectDrafting(
  sectionCount: number,
  cost: CostAssumptions,
): CostEstimate {
  const tokens_in = sectionCount * cost.drafting_tokens_in_per_section;
  const tokens_out = sectionCount * cost.drafting_tokens_out_per_section;
  return finalize(tokens_in, tokens_out, cost);
}

export function estimateDocumentCleanup(
  paragraphCount: number,
  cost: CostAssumptions,
): CostEstimate {
  const tokens_in = paragraphCount * cost.cleanup_tokens_in_per_paragraph;
  const tokens_out = paragraphCount * cost.cleanup_tokens_out_per_paragraph;
  return finalize(tokens_in, tokens_out, cost);
}

function finalize(tokens_in: number, tokens_out: number, cost: CostAssumptions): CostEstimate {
  const usd_in = (tokens_in / 1000) * cost.usd_per_1k_in;
  const usd_out = (tokens_out / 1000) * cost.usd_per_1k_out;
  return {
    tokens_in,
    tokens_out,
    tokens_total: tokens_in + tokens_out,
    usd_in,
    usd_out,
    usd_total: usd_in + usd_out,
  };
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function formatUsd(n: number): string {
  if (n === 0) return '$0';
  if (n < 0.01) return '<$0.01';
  return `$${n.toFixed(2)}`;
}

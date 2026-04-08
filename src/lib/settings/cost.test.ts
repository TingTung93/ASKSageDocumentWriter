import { describe, expect, it } from 'vitest';
import {
  estimateDocumentCleanup,
  estimateProjectDrafting,
  formatTokens,
  formatUsd,
} from './cost';
import { DEFAULT_COST_ASSUMPTIONS } from './types';

describe('cost projection', () => {
  it('multiplies sections by per-section assumptions for drafting', () => {
    const est = estimateProjectDrafting(10, DEFAULT_COST_ASSUMPTIONS);
    expect(est.tokens_in).toBe(10 * DEFAULT_COST_ASSUMPTIONS.drafting_tokens_in_per_section);
    expect(est.tokens_out).toBe(10 * DEFAULT_COST_ASSUMPTIONS.drafting_tokens_out_per_section);
    expect(est.tokens_total).toBe(est.tokens_in + est.tokens_out);
  });

  it('multiplies paragraphs by per-paragraph assumptions for cleanup', () => {
    const est = estimateDocumentCleanup(50, DEFAULT_COST_ASSUMPTIONS);
    expect(est.tokens_in).toBe(50 * DEFAULT_COST_ASSUMPTIONS.cleanup_tokens_in_per_paragraph);
    expect(est.tokens_out).toBe(50 * DEFAULT_COST_ASSUMPTIONS.cleanup_tokens_out_per_paragraph);
  });

  it('zero counts produce zero estimates', () => {
    const est = estimateProjectDrafting(0, DEFAULT_COST_ASSUMPTIONS);
    expect(est.tokens_total).toBe(0);
    expect(est.usd_total).toBe(0);
  });

  it('honors usd-per-1k pricing', () => {
    const cost = { ...DEFAULT_COST_ASSUMPTIONS, usd_per_1k_in: 3, usd_per_1k_out: 15 };
    const est = estimateProjectDrafting(2, cost);
    const expectedIn = (2 * cost.drafting_tokens_in_per_section / 1000) * 3;
    const expectedOut = (2 * cost.drafting_tokens_out_per_section / 1000) * 15;
    expect(est.usd_in).toBeCloseTo(expectedIn);
    expect(est.usd_out).toBeCloseTo(expectedOut);
    expect(est.usd_total).toBeCloseTo(expectedIn + expectedOut);
  });

  it('formats tokens with k/M suffixes', () => {
    expect(formatTokens(500)).toBe('500');
    expect(formatTokens(1500)).toBe('1.5k');
    expect(formatTokens(2_500_000)).toBe('2.5M');
  });

  it('formats USD respecting zero and tiny amounts', () => {
    expect(formatUsd(0)).toBe('$0');
    expect(formatUsd(0.003)).toBe('<$0.01');
    expect(formatUsd(1.234)).toBe('$1.23');
  });
});

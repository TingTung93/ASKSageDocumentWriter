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

  it('cleanup estimate scales with character count, not just paragraph count', () => {
    // 200 characters across 5 paragraphs at 4 chars/token = 50 content tokens.
    // Plus 600 system prompt + 5*5 framing = 675 input tokens.
    const est = estimateDocumentCleanup(5, 200, DEFAULT_COST_ASSUMPTIONS);
    expect(est.tokens_in).toBe(675);
    // Output ratio = 0.15 → ceil(675 * 0.15) = 102
    expect(est.tokens_out).toBe(102);
  });

  it('cleanup estimate is dominated by content for large documents', () => {
    // 40,000 characters / 4 = 10,000 content tokens — overhead becomes noise.
    const est = estimateDocumentCleanup(100, 40_000, DEFAULT_COST_ASSUMPTIONS);
    expect(est.tokens_in).toBe(600 + 10_000 + 500);
  });

  it('a tiny memo (200 chars) is not estimated as 8k tokens', () => {
    const est = estimateDocumentCleanup(8, 200, DEFAULT_COST_ASSUMPTIONS);
    expect(est.tokens_in).toBeLessThan(1000);
  });

  it('zero counts produce a baseline (system-prompt-only) estimate', () => {
    const est = estimateProjectDrafting(0, DEFAULT_COST_ASSUMPTIONS);
    expect(est.tokens_total).toBe(0);
    expect(est.usd_total).toBe(0);
    const cleanupEst = estimateDocumentCleanup(0, 0, DEFAULT_COST_ASSUMPTIONS);
    expect(cleanupEst.tokens_in).toBe(DEFAULT_COST_ASSUMPTIONS.cleanup_system_prompt_tokens);
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

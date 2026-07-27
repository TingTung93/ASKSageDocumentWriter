import { describe, expect, it } from 'vitest';
import { DEFAULT_EDITING_WORKFLOW_LIMITS } from './limits';
import { makeAgentId } from './ids';

describe('agentic editing contracts', () => {
  it('uses bounded default workflow limits', () => {
    expect(DEFAULT_EDITING_WORKFLOW_LIMITS).toMatchObject({
      maxModelCalls: 12,
      maxToolCycles: 8,
      maxToolCalls: 12,
      maxRepairPasses: 2,
    });
  });

  it('creates prefixed opaque identifiers', () => {
    expect(makeAgentId('turn')).toMatch(/^turn_/);
  });
});

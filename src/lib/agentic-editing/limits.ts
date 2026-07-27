import type { EditingWorkflowLimits } from './types';

export const DEFAULT_EDITING_WORKFLOW_LIMITS: EditingWorkflowLimits = {
  maxModelCalls: 12,
  maxToolCycles: 8,
  maxToolCalls: 12,
  maxRepairPasses: 2,
  maxElapsedMs: 10 * 60 * 1000,
  maxContextCharacters: 160_000,
};

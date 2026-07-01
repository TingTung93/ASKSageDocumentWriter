import { describe, expect, it } from 'vitest';
import { researchDepthLabel, researchPackHasUncitedFindings } from './ProjectDetail';

describe('ProjectDetail research helpers', () => {
  it('labels research depth options', () => {
    expect(researchDepthLabel('quick')).toContain('Quick');
    expect(researchDepthLabel('standard')).toContain('Standard');
    expect(researchDepthLabel('deep')).toContain('Deep');
  });

  it('detects uncited findings', () => {
    expect(researchPackHasUncitedFindings({
      id: 'r1',
      objective: 'obj',
      depth: 'quick',
      generated_at: '2026-07-01T00:00:00.000Z',
      query_plan: [],
      findings: [{ id: 'f1', text: 'Fact', citation_ids: [] }],
      citations: [],
      gaps: [],
      markdown: '# Research',
    })).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { dedupeCitations, extractUrls, validateResearchPack } from './citations';
import type { ResearchPack } from './types';

describe('research citations', () => {
  it('extracts URLs and strips trailing punctuation', () => {
    expect(extractUrls('See https://example.mil/report, and https://site.gov/a).')).toEqual([
      'https://example.mil/report',
      'https://site.gov/a',
    ]);
  });

  it('deduplicates citations by normalized URL', () => {
    const out = dedupeCitations([
      { id: 'a', title: 'A', url: 'https://EXAMPLE.mil/report/', source_type: 'model_cited' },
      { id: 'b', title: 'B', url: 'https://example.mil/report', source_type: 'ask_sage_reference' },
    ]);

    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ title: 'A', url: 'https://example.mil/report/' });
  });

  it('flags findings without matching citations', () => {
    const pack: ResearchPack = {
      id: 'research_1',
      objective: 'Assess market',
      depth: 'quick',
      generated_at: '2026-07-01T00:00:00.000Z',
      query_plan: ['market search'],
      findings: [{ id: 'finding_1', text: 'Fact', citation_ids: [] }],
      citations: [],
      gaps: [],
      markdown: '# Research Pack',
    };

    expect(validateResearchPack(pack)).toEqual({
      finding_count: 1,
      citation_count: 0,
      uncited_finding_ids: ['finding_1'],
    });
  });
});

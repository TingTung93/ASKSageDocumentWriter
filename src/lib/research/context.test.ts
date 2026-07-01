import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectRecord } from '../db/schema';
import { saveResearchPackToProject } from './context';
import type { ResearchPack } from './types';

const ts = '2026-07-01T00:00:00.000Z';
const store = vi.hoisted(() => ({
  project: null as ProjectRecord | null,
  put: vi.fn(),
}));

vi.mock('../db/schema', () => ({
  db: {
    projects: {
      get: vi.fn(async () => store.project),
      put: store.put,
    },
  },
}));

function project(): ProjectRecord {
  return {
    id: 'p1',
    name: 'Research Project',
    description: 'desc',
    template_ids: [],
    reference_dataset_names: [],
    shared_inputs: {},
    model_overrides: {},
    live_search: 2,
    context_items: [],
    created_at: ts,
    updated_at: ts,
  };
}

describe('saveResearchPackToProject', () => {
  beforeEach(() => {
    store.project = project();
    store.put.mockImplementation(async (next: ProjectRecord) => {
      store.project = next;
    });
  });

  it('stores the pack and attaches Markdown as an extracted context file', async () => {
    const pack: ResearchPack = {
      id: 'research_abc',
      objective: 'Research current guidance',
      depth: 'standard',
      generated_at: ts,
      query_plan: ['guidance'],
      findings: [],
      citations: [],
      gaps: [],
      markdown: '# Research Pack\n\nUseful content.',
    };

    const saved = await saveResearchPackToProject('p1', pack);
    const updated = store.project;

    expect(saved.filename).toBe('research-pack-2026-07-01.md');
    expect(updated?.research_packs).toHaveLength(1);
    expect(updated?.context_items?.[0]).toMatchObject({
      kind: 'file',
      filename: 'research-pack-2026-07-01.md',
      mime_type: 'text/markdown',
      extracted_text: pack.markdown,
    });
  });
});

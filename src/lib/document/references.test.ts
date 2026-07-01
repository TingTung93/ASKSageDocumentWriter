import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocumentRecord } from '../db/schema';
import type { ResearchPack } from '../research/types';
import { saveDocumentResearchPack } from './references';

const ts = '2026-07-01T00:00:00.000Z';
const store = vi.hoisted(() => ({
  document: null as DocumentRecord | null,
  put: vi.fn(),
}));

vi.mock('../db/schema', () => ({
  db: {
    documents: {
      get: vi.fn(async () => store.document),
      put: store.put,
    },
  },
}));

function document(): DocumentRecord {
  return {
    id: 'd1',
    name: 'Draft Memo',
    filename: 'draft.docx',
    ingested_at: ts,
    docx_bytes: new Blob(['docx']),
    paragraph_count: 4,
    edits: [],
    total_tokens_in: 0,
    total_tokens_out: 0,
    reference_files: [],
  };
}

describe('saveDocumentResearchPack', () => {
  beforeEach(() => {
    store.document = document();
    store.put.mockImplementation(async (next: DocumentRecord) => {
      store.document = next;
    });
  });

  it('stores the research pack and attaches its Markdown as an extracted reference file', async () => {
    const pack: ResearchPack = {
      id: 'research_doc',
      objective: 'Support this cleanup edit',
      depth: 'standard',
      generated_at: ts,
      query_plan: ['current policy'],
      findings: [],
      citations: [],
      gaps: [],
      markdown: '# Research Pack\n\nReference support.',
    };

    const file = await saveDocumentResearchPack('d1', pack);

    expect(file.filename).toBe('document-research-pack-2026-07-01.md');
    expect(store.document?.research_packs).toHaveLength(1);
    expect(store.document?.reference_files?.[0]).toMatchObject({
      kind: 'file',
      filename: 'document-research-pack-2026-07-01.md',
      mime_type: 'text/markdown',
      extracted_text: pack.markdown,
    });
  });
});

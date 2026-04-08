import { describe, expect, it } from 'vitest';
import {
  hasOrphanedV4Files,
  renderInlinedReferences,
  renderNotesBlock,
} from './context';
import type { ProjectContextItem, ProjectRecord } from '../db/schema';

const ts = '2026-04-08T12:00:00.000Z';

function makeNote(text: string, role: 'user' | 'assistant' = 'user'): ProjectContextItem {
  return { kind: 'note', id: `n_${text.slice(0, 5)}`, role, text, created_at: ts };
}

function makeFile(id: string, filename: string): ProjectContextItem {
  return {
    kind: 'file',
    id,
    filename,
    mime_type: 'text/plain',
    size_bytes: 100,
    bytes: new Blob(['hello']),
    created_at: ts,
  };
}

describe('renderNotesBlock', () => {
  it('returns null when there are no notes', () => {
    expect(renderNotesBlock([])).toBeNull();
    expect(renderNotesBlock([makeFile('f1', 'a.txt')])).toBeNull();
  });

  it('renders notes only, ignoring files', () => {
    const block = renderNotesBlock([
      makeFile('f1', 'a.txt'),
      makeNote('emphasize cybersecurity'),
    ])!;
    expect(block).toContain('PROJECT NOTES');
    expect(block).toContain('emphasize cybersecurity');
    expect(block).not.toContain('a.txt');
  });
});

describe('renderInlinedReferences', () => {
  it('returns null when no files have extracted text', () => {
    const items = [makeFile('f1', 'a.txt')];
    expect(renderInlinedReferences(items, new Map())).toBeNull();
  });

  it('renders the full text of every extracted file', () => {
    const items = [makeFile('f1', 'quote_sheet.md'), makeFile('f2', 'prior_pws.docx')];
    const extracted = new Map<string, string>([
      ['f1', 'These are the salient quotes.'],
      ['f2', 'This is the body of the prior PWS.\nIt has multiple lines.'],
    ]);
    const block = renderInlinedReferences(items, extracted)!;
    expect(block).toContain('ATTACHED REFERENCES (2 files');
    expect(block).toContain('quote_sheet.md');
    expect(block).toContain('These are the salient quotes.');
    expect(block).toContain('prior_pws.docx');
    expect(block).toContain('This is the body of the prior PWS.');
    expect(block).toContain('multiple lines');
  });

  it('skips files whose extraction returned empty text', () => {
    const items = [makeFile('f1', 'good.txt'), makeFile('f2', 'bad.txt')];
    const extracted = new Map<string, string>([
      ['f1', 'usable content'],
      ['f2', '   '],
    ]);
    const block = renderInlinedReferences(items, extracted)!;
    expect(block).toContain('1 file');
    expect(block).toContain('good.txt');
    expect(block).not.toContain('bad.txt');
  });
});

describe('hasOrphanedV4Files', () => {
  it('detects v4-shaped file entries (missing bytes)', () => {
    // Build a project with one v5 file and one v4-shaped file (no bytes).
    const v5File: ProjectContextItem = {
      kind: 'file',
      id: 'good',
      filename: 'good.docx',
      mime_type: 'application/octet-stream',
      size_bytes: 100,
      bytes: new Blob(['x']),
      created_at: ts,
    };
    // Cast through unknown to fake the v4 shape — TS won't let us
    // construct one directly because the schema dropped the fields.
    const v4File = {
      kind: 'file',
      id: 'orphan',
      filename: 'orphan.docx',
      mime_type: 'application/octet-stream',
      size_bytes: 100,
      created_at: ts,
      // no bytes field — this is the v4 shape
    } as unknown as ProjectContextItem;

    const project: ProjectRecord = {
      id: 'p1',
      name: 'P',
      description: '',
      template_ids: [],
      reference_dataset_names: [],
      shared_inputs: {},
      model_overrides: {},
      live_search: 0,
      context_items: [v5File, v4File],
      created_at: ts,
      updated_at: ts,
    };
    expect(hasOrphanedV4Files(project)).toBe(true);
  });

  it('returns false when every file has bytes', () => {
    const project: ProjectRecord = {
      id: 'p2',
      name: 'P',
      description: '',
      template_ids: [],
      reference_dataset_names: [],
      shared_inputs: {},
      model_overrides: {},
      live_search: 0,
      context_items: [
        {
          kind: 'file',
          id: 'good',
          filename: 'good.docx',
          mime_type: 'application/octet-stream',
          size_bytes: 100,
          bytes: new Blob(['x']),
          created_at: ts,
        },
      ],
      created_at: ts,
      updated_at: ts,
    };
    expect(hasOrphanedV4Files(project)).toBe(false);
  });
});

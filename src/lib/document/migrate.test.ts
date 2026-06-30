import { describe, it, expect } from 'vitest';
import { migrateDocumentEdits, migrateAll } from './migrate';
import type { DocumentRecord } from '../db/schema';
import type { StoredEdit } from './types';

describe('document migration', () => {
  it('handles missing or non-array edits', () => {
    const doc = { id: '1', edits: null } as unknown as DocumentRecord;
    expect(migrateDocumentEdits(doc).edits).toEqual([]);
  });

  it('handles empty edits array', () => {
    const doc = { id: '1', edits: [] } as unknown as DocumentRecord;
    expect(migrateDocumentEdits(doc).edits).toEqual([]);
  });

  it('leaves already-migrated edits untouched', () => {
    const doc = {
      id: '1',
      template_id: 't1',
      name: 'test',
      status: 'drafting',
      updated_at: '',
      created_at: '',
      drafts: {},
      assembled_paragraphs: [],
      edits: [
        { op: { op: 'replace_paragraph_text' }, id: 'edit1', status: 'pending', created_at: '' } as unknown as StoredEdit
      ]
    } as unknown as DocumentRecord;
    
    expect(migrateDocumentEdits(doc).edits[0].id).toBe('edit1');
  });

  it('migrates legacy paragraph edits to stored edits', () => {
    const doc = {
      id: '1',
      edits: [
        {
          index: 5,
          original_text: 'Old text',
          new_text: 'New text',
          rationale: 'Reasoning',
          status: 'pending'
        }
      ]
    } as unknown as DocumentRecord;

    const migrated = migrateDocumentEdits(doc);
    expect(migrated.edits).toHaveLength(1);
    
    const edit = migrated.edits[0];
    expect(edit.id).toBe('legacy_0_5');
    expect(edit.status).toBe('pending');
    expect(edit.before_text).toBe('Old text');
    expect(edit.rationale).toBe('Reasoning');
    
    if (edit.op.op === 'replace_paragraph_text') {
      expect(edit.op.index).toBe(5);
      expect(edit.op.new_text).toBe('New text');
      expect(edit.op.rationale).toBe('Reasoning');
    } else {
      expect.fail('Wrong operation type');
    }
  });

  it('migrates multiple documents', () => {
    const docs = [
      { id: '1', edits: null },
      { id: '2', edits: [{ index: 1, original_text: '', new_text: '', rationale: '', status: 'applied' }] }
    ] as unknown as DocumentRecord[];

    const migrated = migrateAll(docs);
    expect(migrated[0].edits).toEqual([]);
    expect(migrated[1].edits).toHaveLength(1);
  });
});

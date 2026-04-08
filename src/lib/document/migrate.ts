// Read-time migration from legacy ParagraphEdit[] storage to the new
// StoredEdit[] discriminated-union shape. Existing DocumentRecord
// objects in IndexedDB may have either shape; the loaders run them
// through this helper before handing them to React.

import type { DocumentRecord } from '../db/schema';
import type { ParagraphEdit, StoredEdit } from './types';

/**
 * If `edits` contains legacy ParagraphEdit objects (no `op` field),
 * convert them to StoredEdit wrappers. Idempotent.
 */
export function migrateDocumentEdits(record: DocumentRecord): DocumentRecord {
  if (!Array.isArray(record.edits)) {
    return { ...record, edits: [] };
  }
  if (record.edits.length === 0) return record;
  // Check the first entry — if it has an `op` field that's an object,
  // it's already the new shape.
  const first = record.edits[0] as unknown as { op?: unknown };
  if (first && typeof first === 'object' && first.op && typeof first.op === 'object') {
    return record;
  }
  // Otherwise convert
  const legacy = record.edits as unknown as ParagraphEdit[];
  const migrated: StoredEdit[] = legacy.map((p, i) => ({
    id: `legacy_${i}_${p.index}`,
    op: {
      op: 'replace_paragraph_text',
      index: p.index,
      new_text: p.new_text,
      rationale: p.rationale,
    },
    status: p.status,
    before_text: p.original_text,
    rationale: p.rationale,
    created_at: new Date().toISOString(),
  }));
  return { ...record, edits: migrated };
}

export function migrateAll(records: DocumentRecord[]): DocumentRecord[] {
  return records.map(migrateDocumentEdits);
}

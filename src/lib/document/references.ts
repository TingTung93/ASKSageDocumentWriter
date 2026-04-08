// Helpers for managing per-document reference files attached to the
// inline cleanup pass. Mirrors lib/project/context's file-attach API
// but writes to the `documents` table and the new
// DocumentRecord.reference_files field (Dexie v6).

import { db, type DocumentRecord, type ProjectContextFile } from '../db/schema';
import { MAX_AV_BYTES, MAX_DOC_BYTES } from '../project/context';

/** Attach a reference file to a document. */
export async function attachDocumentReference(
  documentId: string,
  file: File,
): Promise<ProjectContextFile> {
  const doc = await db.documents.get(documentId);
  if (!doc) throw new Error(`Document not found: ${documentId}`);

  if (file.size > MAX_AV_BYTES) {
    throw new Error(
      `File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Ask Sage hard caps are ${(MAX_DOC_BYTES / 1024 / 1024).toFixed(0)} MB for documents and ${(MAX_AV_BYTES / 1024 / 1024).toFixed(0)} MB for audio/video.`,
    );
  }

  const bytes = new Blob([file], { type: file.type });
  const item: ProjectContextFile = {
    kind: 'file',
    id: newId('docref'),
    filename: file.name,
    mime_type: file.type || guessMime(file.name),
    size_bytes: file.size,
    bytes,
    created_at: new Date().toISOString(),
  };

  const next: DocumentRecord = {
    ...doc,
    reference_files: [...(doc.reference_files ?? []), item],
  };
  await db.documents.put(next);
  return item;
}

/** Remove a reference file from a document. */
export async function removeDocumentReference(
  documentId: string,
  fileId: string,
): Promise<void> {
  const doc = await db.documents.get(documentId);
  if (!doc) return;
  const next: DocumentRecord = {
    ...doc,
    reference_files: (doc.reference_files ?? []).filter((f) => f.id !== fileId),
  };
  await db.documents.put(next);
}

/** Update a document's cleanup-context settings (dataset / live / cap). */
export async function updateDocumentCleanupContext(
  documentId: string,
  patch: Pick<
    DocumentRecord,
    'cleanup_dataset_name' | 'cleanup_live_search' | 'cleanup_limit_references'
  >,
): Promise<void> {
  const doc = await db.documents.get(documentId);
  if (!doc) return;
  await db.documents.put({ ...doc, ...patch });
}

function guessMime(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.docx'))
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.txt')) return 'text/plain';
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'text/markdown';
  if (lower.endsWith('.csv')) return 'text/csv';
  return 'application/octet-stream';
}

function newId(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    return `${prefix}_${crypto.randomUUID()}`;
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e9)}`;
}

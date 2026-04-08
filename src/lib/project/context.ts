// Project context — chat notes and inlined-file references.
//
// Two flavors live on the project record, both inlined directly into
// every drafting prompt:
//
//   1. Notes: short user-authored chat messages (quotes, salient
//      characteristics, scope hints). Inlined verbatim, no Ask Sage
//      round-trip.
//
//   2. Files: reference documents the user attached. We store the raw
//      bytes locally as a Blob on the project row. At drafting time,
//      lib/draft/orchestrator uploads each file to /server/file ONCE
//      per draft run, caches the extracted text in memory, and feeds
//      it into every per-section prompt. The model literally sees the
//      reference content — no chunking, no caps, no RAG opacity.
//
// This module owns the local storage + render side. The actual
// extraction at draft time lives in lib/draft/orchestrator so it can
// be cached for the duration of one drafting run.

import {
  db,
  type ProjectContextFile,
  type ProjectContextItem,
  type ProjectContextNote,
  type ProjectRecord,
} from '../db/schema';

/** Ask Sage's hard cap on document upload size. */
export const MAX_DOC_BYTES = 250 * 1024 * 1024; // 250 MB
/** Ask Sage's hard cap on audio/video upload size. */
export const MAX_AV_BYTES = 500 * 1024 * 1024; // 500 MB

// ─── Read helpers ─────────────────────────────────────────────────

/**
 * Always-defined accessor for a project's context items. Also performs
 * the v4 → v5 normalization: file entries from the old train-into-
 * dataset shape (which lacked `bytes`) are dropped silently. The UI
 * surfaces a one-time toast separately when it detects the same
 * condition so the user knows to re-attach.
 */
export function getContextItems(project: ProjectRecord): ProjectContextItem[] {
  const items = project.context_items ?? [];
  return items.filter((i) => i.kind !== 'file' || isV5File(i));
}

/**
 * True if `project.context_items` contains any v4-shaped file entry
 * (no `bytes` field). Used by the UI to show a re-attach warning.
 */
export function hasOrphanedV4Files(project: ProjectRecord): boolean {
  return (project.context_items ?? []).some((i) => i.kind === 'file' && !isV5File(i));
}

function isV5File(item: ProjectContextItem): boolean {
  return item.kind === 'file' && item.bytes instanceof Blob;
}

// ─── Mutators ─────────────────────────────────────────────────────

/** Append a chat note to the project. */
export async function addProjectNote(
  projectId: string,
  text: string,
  role: 'user' | 'assistant' = 'user',
): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;
  const note: ProjectContextNote = {
    kind: 'note',
    id: newId('note'),
    role,
    text: trimmed,
    created_at: new Date().toISOString(),
  };
  await mutateContext(projectId, (items) => [...items, note]);
}

/**
 * Attach a file to the project. The bytes are stored as a Blob on the
 * project row; no Ask Sage call happens here. Drafting will upload
 * via /server/file ONCE per run and cache the extracted text in
 * memory for all section calls.
 */
export async function attachProjectFile(
  projectId: string,
  file: File,
): Promise<ProjectContextFile> {
  const project = await db.projects.get(projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);

  if (file.size > MAX_AV_BYTES) {
    throw new Error(
      `File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Ask Sage hard caps are ${(MAX_DOC_BYTES / 1024 / 1024).toFixed(0)} MB for documents and ${(MAX_AV_BYTES / 1024 / 1024).toFixed(0)} MB for audio/video.`,
    );
  }

  // Wrap the File in a Blob so the type system stops conflating the
  // two — File extends Blob in the browser but jsdom's shim is fussier
  // about that distinction in tests.
  const bytes = new Blob([file], { type: file.type });

  const item: ProjectContextFile = {
    kind: 'file',
    id: newId('file'),
    filename: file.name,
    mime_type: file.type || guessMime(file.name),
    size_bytes: file.size,
    bytes,
    created_at: new Date().toISOString(),
  };
  await mutateContext(projectId, (items) => [...items, item]);
  return item;
}

/** Remove a context item by id. */
export async function removeContextItem(projectId: string, itemId: string): Promise<void> {
  await mutateContext(projectId, (items) => items.filter((i) => i.id !== itemId));
}

/**
 * Drop every v4-shaped file record from a project. Called when the
 * user clicks "Clear orphaned files" in the migration warning UI so
 * the warning goes away.
 */
export async function clearOrphanedFiles(projectId: string): Promise<void> {
  await mutateContext(projectId, (items) =>
    items.filter((i) => i.kind !== 'file' || isV5File(i)),
  );
}

async function mutateContext(
  projectId: string,
  mutator: (items: ProjectContextItem[]) => ProjectContextItem[],
): Promise<void> {
  const project = await db.projects.get(projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);
  // Important: read the RAW context_items here, not via getContextItems,
  // so a write doesn't accidentally drop other rows during migration.
  const next = mutator(project.context_items ?? []);
  await db.projects.put({
    ...project,
    context_items: next,
    updated_at: new Date().toISOString(),
  });
}

// ─── Prompt rendering ─────────────────────────────────────────────

/**
 * Render the project's chat notes as a NOTES block to inline into the
 * drafting prompt. Returns null if there are no notes. Files are
 * rendered separately by `renderInlinedReferences` so the orchestrator
 * can pass extracted text in (we don't have it here).
 */
export function renderNotesBlock(items: ProjectContextItem[]): string | null {
  const notes = items.filter((i): i is ProjectContextNote => i.kind === 'note');
  if (notes.length === 0) return null;

  const lines: string[] = [];
  lines.push(`=== PROJECT NOTES ===`);
  lines.push(
    `Short user-authored guidance for this project. Treat as authoritative scope and tone hints. Where these conflict with the section spec, the SUBJECT block above is authoritative.`,
  );
  for (const n of notes) {
    lines.push(``);
    lines.push(`--- Note (${n.role}, ${n.created_at}) ---`);
    lines.push(n.text);
  }
  lines.push(`=== END PROJECT NOTES ===`);
  return lines.join('\n');
}

/**
 * Render attached files as an INLINED REFERENCES block. The
 * orchestrator passes a Map<fileId, extractedText> populated by a
 * single /server/file pass at the start of the drafting run.
 *
 * Files with no extracted text (e.g., extraction failed for one but
 * not others) are skipped. Returns null if zero usable files.
 */
export function renderInlinedReferences(
  items: ProjectContextItem[],
  extractedById: Map<string, string>,
): string | null {
  const files = items.filter((i): i is ProjectContextFile => i.kind === 'file');
  const usable = files.filter((f) => {
    const text = extractedById.get(f.id);
    return text && text.trim().length > 0;
  });
  if (usable.length === 0) return null;

  const totalChars = usable.reduce(
    (acc, f) => acc + (extractedById.get(f.id)?.length ?? 0),
    0,
  );

  const lines: string[] = [];
  lines.push(
    `=== ATTACHED REFERENCES (${usable.length} file${usable.length === 1 ? '' : 's'}, ${totalChars.toLocaleString()} chars) ===`,
  );
  lines.push(
    `These are the user's source documents for this project. Use them as authoritative subject-matter content. Quote, paraphrase, and synthesize from them as needed. Do NOT invent facts that aren't grounded in this material or the SUBJECT statement above.`,
  );
  for (const f of usable) {
    const text = extractedById.get(f.id) ?? '';
    lines.push(``);
    lines.push(
      `--- File: ${f.filename} (${f.mime_type}, ${f.size_bytes.toLocaleString()} bytes, ${text.length.toLocaleString()} chars extracted) ---`,
    );
    lines.push(text);
  }
  lines.push(`=== END ATTACHED REFERENCES ===`);
  return lines.join('\n');
}

// ─── Helpers ──────────────────────────────────────────────────────

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

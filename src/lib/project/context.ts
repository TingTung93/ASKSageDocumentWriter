// Project context — chat notes and file attachments.
//
// Two flavors live on the project record:
//
//   1. Notes: short user-authored chat messages. Inlined verbatim into
//      every drafting prompt as a PROJECT CONTEXT block. Cheap and
//      high-signal.
//
//   2. Files: reference documents the user attached. We hand the bytes
//      to Ask Sage's /server/file endpoint, which runs its own
//      extractor (DOCX, PDF, audio, video, etc.) and returns the text
//      inline. We then call /server/train with force_dataset set to
//      the project's owned dataset name. From that point on, every
//      drafting call's /server/query passes that dataset name and Ask
//      Sage's RAG handles retrieval.
//
// This module owns NONE of the parsing or chunking — Ask Sage does it
// all. We just store metadata locally so the UI can list and remove
// attachments.

import type { AskSageClient } from '../asksage/client';
import {
  db,
  type ProjectContextFile,
  type ProjectContextItem,
  type ProjectContextNote,
  type ProjectRecord,
} from '../db/schema';

/** Hard upper bound on the per-attachment file size (Ask Sage's own limit). */
export const MAX_DOC_BYTES = 250 * 1024 * 1024; // 250 MB
export const MAX_AV_BYTES = 500 * 1024 * 1024; // 500 MB

// ─── Read helpers ─────────────────────────────────────────────────

export function getContextItems(project: ProjectRecord): ProjectContextItem[] {
  return project.context_items ?? [];
}

export function getProjectDataset(project: ProjectRecord): string | null {
  return project.dataset_name ?? null;
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

/** Set or clear the project's owned Ask Sage dataset name. */
export async function setProjectDataset(
  projectId: string,
  datasetName: string | null,
): Promise<void> {
  const project = await db.projects.get(projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);
  await db.projects.put({
    ...project,
    dataset_name: datasetName ?? null,
    updated_at: new Date().toISOString(),
  });
}

/**
 * Attach a file to a project: upload to Ask Sage, train into the
 * project's dataset, record the metadata locally.
 *
 * Throws if the project doesn't have a dataset_name set yet — pick or
 * create one in the UI before calling this. The two-step error message
 * is intentional so the caller can render a clear "set a dataset
 * first" affordance.
 */
export async function attachProjectFile(
  client: AskSageClient,
  projectId: string,
  file: File,
): Promise<ProjectContextFile> {
  const project = await db.projects.get(projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);
  const dataset = getProjectDataset(project);
  if (!dataset) {
    throw new Error(
      'This project has no Ask Sage dataset yet. Pick or create one in the Project context section before attaching files.',
    );
  }

  // Size guard. We err on the side of the more permissive A/V limit
  // since /server/file accepts both shapes; Ask Sage will reject if
  // we're wrong about the type.
  if (file.size > MAX_AV_BYTES) {
    throw new Error(
      `File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Ask Sage hard cap is ${(MAX_AV_BYTES / 1024 / 1024).toFixed(0)} MB for audio/video and ${(MAX_DOC_BYTES / 1024 / 1024).toFixed(0)} MB for documents.`,
    );
  }

  // Step 1 — upload, get extracted text back inline.
  const upload = await client.uploadFile(file);
  const extracted = (upload.ret ?? '').trim();
  if (!extracted) {
    throw new Error(
      `Ask Sage returned no extractable text from ${file.name}. The file may be empty, image-only, or in an unsupported format.`,
    );
  }

  // Step 2 — train into the project's dataset. Ask Sage handles
  // chunking, embedding, and storage.
  const train = await client.train({
    context: `Project ${projectId} attachment: ${file.name}`,
    content: extracted,
    force_dataset: dataset,
  });

  // Step 3 — persist metadata locally so the UI can list it.
  const item: ProjectContextFile = {
    kind: 'file',
    id: newId('file'),
    filename: file.name,
    mime_type: file.type || guessMime(file.name),
    size_bytes: file.size,
    extracted_chars: extracted.length,
    embedding_id: train.embedding,
    trained_into_dataset: dataset,
    created_at: new Date().toISOString(),
  };
  await mutateContext(projectId, (items) => [...items, item]);
  return item;
}

/**
 * Remove a context item from the project record. NOTE: for files this
 * only removes the local registry entry — the trained content stays in
 * the Ask Sage dataset. We don't have a /server/* endpoint that can
 * delete a single embedding by id (only /user/delete-filename-from-dataset,
 * which is CORS-blocked). Document this in the UI.
 */
export async function removeContextItem(projectId: string, itemId: string): Promise<void> {
  await mutateContext(projectId, (items) => items.filter((i) => i.id !== itemId));
}

async function mutateContext(
  projectId: string,
  mutator: (items: ProjectContextItem[]) => ProjectContextItem[],
): Promise<void> {
  const project = await db.projects.get(projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);
  const next = mutator(getContextItems(project));
  await db.projects.put({
    ...project,
    context_items: next,
    updated_at: new Date().toISOString(),
  });
}

// ─── Prompt rendering (notes only) ────────────────────────────────

/**
 * Render the project's chat notes as a PROJECT CONTEXT block to inline
 * into the drafting prompt. Files are NOT included here — they reach
 * the LLM via the dataset/RAG path. Returns null if there are no
 * notes.
 */
export function renderContextBlock(items: ProjectContextItem[]): string | null {
  const notes = items.filter((i): i is ProjectContextNote => i.kind === 'note');
  if (notes.length === 0) return null;

  const lines: string[] = [];
  lines.push(`=== PROJECT CONTEXT NOTES ===`);
  lines.push(
    `User-authored guidance for this project. Treat as authoritative scope and tone hints. Where these conflict with the template's section spec, the section spec wins.`,
  );
  for (const n of notes) {
    lines.push(``);
    lines.push(`--- Note (${n.role}, ${n.created_at}) ---`);
    lines.push(n.text);
  }
  lines.push(`=== END PROJECT CONTEXT NOTES ===`);
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
  return 'application/octet-stream';
}

function newId(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    return `${prefix}_${crypto.randomUUID()}`;
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e9)}`;
}

// ─── Dataset name suggestion ──────────────────────────────────────

/**
 * Suggest a dataset name for a new project. Ask Sage's stored format
 * is `user_custom_<USERID>_<NAME>_content`, but we don't always know
 * the user id (no /user/* surface). Instead we suggest a clean,
 * project-derived stem and let `force_dataset` route content into
 * whatever name the server actually creates.
 */
export function suggestDatasetName(projectName: string): string {
  const slug = projectName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return `asd_${slug || 'project'}`;
}

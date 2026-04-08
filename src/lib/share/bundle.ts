// Shareable bundle format for templates and projects.
//
// Bundles are versioned JSON files. Templates carry their schema +
// base64-encoded DOCX bytes (the writer needs the original as a
// clone-and-mutate skeleton, so the schema alone isn't enough). Project
// bundles embed every referenced template and optionally the drafts.
//
// Bundle JSON is intentionally human-skimmable: top-level fields name
// the kind, version, exported_at, and origin so a reviewer can read it
// without booting the app.

import type {
  DraftRecord,
  ProjectContextItem,
  ProjectRecord,
  TemplateRecord,
} from '../db/schema';
import type { TemplateSchema } from '../template/types';

export const BUNDLE_VERSION = 1;

/** Common header on every bundle file. */
export interface BundleHeader {
  /** Schema version of THIS bundle format. Bump on any breaking change. */
  bundle_version: number;
  /** Discriminator: `template` or `project`. */
  kind: BundleKind;
  /** ISO timestamp at the time of export. */
  exported_at: string;
  /** Free-form note on what tool produced it. */
  exported_by: string;
}

export type BundleKind = 'template' | 'project';

export interface TemplateBundle extends BundleHeader {
  kind: 'template';
  template: ExportedTemplate;
}

export interface ProjectBundle extends BundleHeader {
  kind: 'project';
  project: ExportedProject;
  /**
   * Every template the project references, embedded fully so the
   * recipient ends up with a complete working setup after one import.
   */
  templates: ExportedTemplate[];
  /** Optional — drafted sections, if the exporter chose to include them. */
  drafts?: ExportedDraft[];
}

export interface ExportedTemplate {
  /** Stable id at export time. The importer may rewrite this on conflict. */
  id: string;
  name: string;
  filename: string;
  ingested_at: string;
  /** Base64-encoded original DOCX bytes. */
  docx_base64: string;
  schema_json: TemplateSchema;
}

export interface ExportedProject {
  id: string;
  name: string;
  description: string;
  template_ids: string[];
  reference_dataset_names: string[];
  shared_inputs: Record<string, string>;
  model_overrides: ProjectRecord['model_overrides'];
  live_search: ProjectRecord['live_search'];
  /**
   * Notes + file metadata. As of v5, file `bytes` are NOT serialized
   * here yet — sharing reference files between users is a follow-up.
   * For now, the recipient sees the file metadata (filename, size,
   * created_at) but no bytes, and re-attaches the originals.
   */
  context_items?: ProjectContextItem[];
  created_at: string;
  updated_at: string;
}

export interface ExportedDraft {
  template_id: string;
  section_id: string;
  paragraphs: DraftRecord['paragraphs'];
  references: string;
  status: DraftRecord['status'];
  error?: string;
  validation_issues?: string[];
  generated_at: string;
  model: string;
  tokens_in: number;
  tokens_out: number;
}

// ─── Encoding helpers ────────────────────────────────────────────

/** Convert a Blob to a base64 string (no data: prefix). */
export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = await blobToBytes(blob);
  // Encode in chunks to avoid the 65536-arg limit on String.fromCharCode.
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/**
 * Cross-environment Blob → Uint8Array. Real browsers have
 * `Blob.prototype.arrayBuffer()`; jsdom (used by vitest) does not but
 * does implement FileReader. We try the modern path first, then fall
 * back to FileReader. As a last resort we treat anything with a
 * pre-existing `bytes` field as already-decoded (the parser's
 * test-stub blob path).
 */
async function blobToBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof (blob as Blob).arrayBuffer === 'function') {
    return new Uint8Array(await blob.arrayBuffer());
  }
  if (typeof FileReader !== 'undefined') {
    return new Promise<Uint8Array>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => {
        const result = fr.result as ArrayBuffer | null;
        if (!result) return reject(new Error('FileReader returned null'));
        resolve(new Uint8Array(result));
      };
      fr.onerror = () => reject(fr.error ?? new Error('FileReader failed'));
      fr.readAsArrayBuffer(blob);
    });
  }
  throw new Error('Cannot read Blob: no arrayBuffer() and no FileReader.');
}

/** Decode a base64 string to a Blob (no data: prefix expected). */
export function base64ToBlob(b64: string, type = 'application/octet-stream'): Blob {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

// ─── Builders ────────────────────────────────────────────────────

export async function buildTemplateBundle(
  template: TemplateRecord,
): Promise<TemplateBundle> {
  return {
    bundle_version: BUNDLE_VERSION,
    kind: 'template',
    exported_at: new Date().toISOString(),
    exported_by: 'ASKSageDocumentWriter',
    template: await exportedFromRecord(template),
  };
}

export async function buildProjectBundle(
  project: ProjectRecord,
  templates: TemplateRecord[],
  drafts: DraftRecord[],
  options?: { includeDrafts?: boolean },
): Promise<ProjectBundle> {
  const includeDrafts = options?.includeDrafts ?? false;
  // Note: cast to ProjectContextItem[] for the wire type — recipients
  // see ExportedContextFile entries (with bytes_base64) which the
  // importer rehydrates into v5 ProjectContextFile records (with bytes).
  const serializedContext = await serializeContextItems(project.context_items ?? []);
  return {
    bundle_version: BUNDLE_VERSION,
    kind: 'project',
    exported_at: new Date().toISOString(),
    exported_by: 'ASKSageDocumentWriter',
    project: {
      id: project.id,
      name: project.name,
      description: project.description,
      template_ids: project.template_ids,
      reference_dataset_names: project.reference_dataset_names,
      shared_inputs: project.shared_inputs,
      model_overrides: project.model_overrides,
      live_search: project.live_search,
      context_items: serializedContext as ProjectContextItem[],
      created_at: project.created_at,
      updated_at: project.updated_at,
    },
    templates: await Promise.all(templates.map(exportedFromRecord)),
    drafts: includeDrafts
      ? drafts.map((d) => ({
          template_id: d.template_id,
          section_id: d.section_id,
          paragraphs: d.paragraphs,
          references: d.references,
          status: d.status,
          error: d.error,
          validation_issues: d.validation_issues,
          generated_at: d.generated_at,
          model: d.model,
          tokens_in: d.tokens_in,
          tokens_out: d.tokens_out,
        }))
      : undefined,
  };
}

/**
 * File context item shape used in the bundle JSON. Same as
 * ProjectContextFile but with `bytes_base64` instead of `bytes: Blob`,
 * because Blobs don't JSON-serialize.
 */
interface ExportedContextFile {
  kind: 'file';
  id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  /** Base64-encoded file bytes. Empty string if the exporter chose to strip them. */
  bytes_base64: string;
  created_at: string;
}

/**
 * Convert each file context item's `bytes` Blob to a base64 string so
 * the bundle is JSON-serializable. Notes pass through unchanged.
 * Recipients can rehydrate the Blob via base64ToBlob() at import time
 * and end up with a fully working project, no re-attach required.
 */
async function serializeContextItems(
  items: ProjectContextItem[],
): Promise<Array<ProjectContextItem | ExportedContextFile>> {
  const out: Array<ProjectContextItem | ExportedContextFile> = [];
  for (const item of items) {
    if (item.kind === 'file') {
      const bytes_base64 = item.bytes ? await blobToBase64(item.bytes) : '';
      out.push({
        kind: 'file',
        id: item.id,
        filename: item.filename,
        mime_type: item.mime_type,
        size_bytes: item.size_bytes,
        bytes_base64,
        created_at: item.created_at,
      });
    } else {
      out.push(item);
    }
  }
  return out;
}

async function exportedFromRecord(template: TemplateRecord): Promise<ExportedTemplate> {
  return {
    id: template.id,
    name: template.name,
    filename: template.filename,
    ingested_at: template.ingested_at,
    docx_base64: await blobToBase64(template.docx_bytes),
    schema_json: template.schema_json,
  };
}

// ─── Validation ──────────────────────────────────────────────────

/**
 * Validate that an arbitrary parsed-JSON value is a bundle. Returns
 * the typed bundle on success, or throws with a precise reason on
 * failure. Doesn't trust any field; the caller may be loading a file
 * from a co-worker, an old version, or random JSON.
 */
export function validateBundle(input: unknown): TemplateBundle | ProjectBundle {
  if (!input || typeof input !== 'object') {
    throw new Error('Bundle must be a JSON object.');
  }
  const obj = input as Record<string, unknown>;
  const version = obj.bundle_version;
  if (typeof version !== 'number') {
    throw new Error('Bundle is missing bundle_version.');
  }
  if (version > BUNDLE_VERSION) {
    throw new Error(
      `Bundle is version ${version}, but this app only understands up to ${BUNDLE_VERSION}. Upgrade to read it.`,
    );
  }
  const kind = obj.kind;
  if (kind === 'template') {
    const t = obj.template as ExportedTemplate | undefined;
    if (!t || typeof t !== 'object') throw new Error('Template bundle missing `template` field.');
    if (typeof t.docx_base64 !== 'string' || t.docx_base64.length === 0) {
      throw new Error('Template bundle missing docx_base64.');
    }
    if (!t.schema_json) throw new Error('Template bundle missing schema_json.');
    return obj as unknown as TemplateBundle;
  }
  if (kind === 'project') {
    const p = obj.project as ExportedProject | undefined;
    const ts = obj.templates as ExportedTemplate[] | undefined;
    if (!p || typeof p !== 'object') throw new Error('Project bundle missing `project` field.');
    if (!Array.isArray(ts)) throw new Error('Project bundle missing `templates` array.');
    return obj as unknown as ProjectBundle;
  }
  throw new Error(`Unknown bundle kind: ${String(kind)}`);
}

// Import side of the bundle format. Reads a bundle JSON, rehydrates
// Blobs from base64, and writes new Dexie rows with collision-safe ids.
//
// Strategy on id collisions: ALWAYS rewrite ids during import. The
// recipient's local IndexedDB is the source of truth, so we generate a
// fresh id for every imported template (and the project), and remap any
// internal references (project.template_ids, drafts.template_id) to the
// new ids. This guarantees that an import never overwrites the
// recipient's existing data.

import { db, type DraftRecord, type ProjectRecord, type TemplateRecord } from '../db/schema';
import {
  base64ToBlob,
  validateBundle,
  type ExportedDraft,
  type ExportedTemplate,
  type ProjectBundle,
  type TemplateBundle,
} from './bundle';

export interface ImportSummary {
  kind: 'template' | 'project';
  template_count: number;
  draft_count: number;
  project_id?: string;
  template_ids: string[];
  /** Names of items that were imported, for the toast / UI feedback. */
  display_name: string;
}

/** Top-level entry point: parse arbitrary text as a bundle and import. */
export async function importBundleFromText(text: string): Promise<ImportSummary> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(
      `Bundle is not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  const bundle = validateBundle(parsed);
  if (bundle.kind === 'template') return importTemplateBundle(bundle);
  return importProjectBundle(bundle);
}

export async function importTemplateBundle(bundle: TemplateBundle): Promise<ImportSummary> {
  const newRecord = templateRecordFromExport(bundle.template);
  await db.templates.put(newRecord);
  return {
    kind: 'template',
    template_count: 1,
    draft_count: 0,
    template_ids: [newRecord.id],
    display_name: newRecord.name,
  };
}

export async function importProjectBundle(bundle: ProjectBundle): Promise<ImportSummary> {
  // Build the id remap from old → new for every template in the bundle.
  const idMap = new Map<string, string>();
  const newTemplates: TemplateRecord[] = [];
  for (const t of bundle.templates) {
    const rec = templateRecordFromExport(t);
    idMap.set(t.id, rec.id);
    newTemplates.push(rec);
  }

  // Build the new project record with remapped template ids and a
  // fresh project id.
  const newProjectId = newId('proj');
  const project: ProjectRecord = {
    id: newProjectId,
    name: bundle.project.name,
    description: bundle.project.description,
    template_ids: bundle.project.template_ids
      .map((id) => idMap.get(id))
      .filter((id): id is string => !!id),
    reference_dataset_names: bundle.project.reference_dataset_names,
    shared_inputs: bundle.project.shared_inputs,
    model_overrides: bundle.project.model_overrides,
    live_search: bundle.project.live_search,
    context_items: bundle.project.context_items ?? [],
    dataset_name: bundle.project.dataset_name ?? null,
    created_at: bundle.project.created_at,
    updated_at: new Date().toISOString(),
  };

  // Remap drafts onto the new project + template ids.
  const newDrafts: DraftRecord[] = [];
  if (bundle.drafts) {
    for (const d of bundle.drafts) {
      const newTemplateId = idMap.get(d.template_id);
      if (!newTemplateId) continue; // orphan draft, skip
      newDrafts.push(draftRecordFromExport(d, newProjectId, newTemplateId));
    }
  }

  // Atomically write everything (Dexie transaction across the three
  // tables so a partial import can't leave dangling references).
  await db.transaction('rw', db.templates, db.projects, db.drafts, async () => {
    for (const t of newTemplates) await db.templates.put(t);
    await db.projects.put(project);
    for (const d of newDrafts) await db.drafts.put(d);
  });

  return {
    kind: 'project',
    template_count: newTemplates.length,
    draft_count: newDrafts.length,
    project_id: newProjectId,
    template_ids: newTemplates.map((t) => t.id),
    display_name: project.name,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────

function templateRecordFromExport(t: ExportedTemplate): TemplateRecord {
  const newId_ = newId('tpl');
  // Rewrite the schema's id field to match the new record id, so the
  // schema and record stay aligned for downstream code that reads
  // schema.id.
  const schema = { ...t.schema_json, id: newId_ };
  return {
    id: newId_,
    name: t.name,
    filename: t.filename,
    ingested_at: t.ingested_at,
    docx_bytes: base64ToBlob(t.docx_base64, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    schema_json: schema,
  };
}

function draftRecordFromExport(
  d: ExportedDraft,
  newProjectId: string,
  newTemplateId: string,
): DraftRecord {
  return {
    id: `${newProjectId}::${newTemplateId}::${d.section_id}`,
    project_id: newProjectId,
    template_id: newTemplateId,
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
  };
}

function newId(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e9)}`;
}

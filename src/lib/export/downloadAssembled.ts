// downloadAssembled.ts — re-assemble a project's drafted sections on
// demand and trigger a browser download for each template's DOCX.
//
// Why this exists separately from the recipe runner: the runner stores
// `URL.createObjectURL` blob pointers on the recipe_run record for the
// in-session download path, but those URLs do NOT survive a page
// reload. After reload, the run record is loaded from Dexie but the
// blob URLs point at memory that no longer exists.
//
// This helper takes the persistent inputs (template + draft records
// from Dexie) and re-runs `assembleProjectDocx` to produce a fresh
// Blob. Drafts are deterministic content, the assembler is
// deterministic, so re-assembly produces the same DOCX every time.
// The user can download or preview from any past run.

import { db, type DraftRecord, type ProjectRecord, type TemplateRecord } from '../db/schema';
import { assembleProjectDocx, type AssembleProjectDocxResult } from './assemble';

export interface AssembleProjectResult {
  template_id: string;
  template_name: string;
  filename: string;
  blob: Blob;
  result: AssembleProjectDocxResult;
}

/**
 * Re-assemble every template in the project from its current drafts.
 * Returns one entry per template. Templates with zero drafted
 * sections are skipped silently — caller can display "no drafts" if
 * the result is empty.
 */
export async function assembleProjectFromDrafts(
  project: ProjectRecord,
  templates: TemplateRecord[],
): Promise<AssembleProjectResult[]> {
  const allDrafts = await db.drafts.where('project_id').equals(project.id).toArray();
  const byTemplate = groupDraftsByTemplate(allDrafts);

  const out: AssembleProjectResult[] = [];
  for (const tpl of templates) {
    const sectionMap = byTemplate.get(tpl.id);
    if (!sectionMap || sectionMap.size === 0) continue;
    const draftedBySectionId = new Map<string, DraftRecord['paragraphs']>();
    for (const [sid, d] of sectionMap) draftedBySectionId.set(sid, d.paragraphs);

    const result = await assembleProjectDocx({ template: tpl, draftedBySectionId });
    out.push({
      template_id: tpl.id,
      template_name: tpl.name,
      filename: buildFilename(project.name, tpl.name),
      blob: result.blob,
      result,
    });
  }
  return out;
}

/**
 * Trigger a browser download for a single Blob. Same pattern as
 * lib/share/download.ts and lib/export/index.ts: object URL + anchor
 * click, with a deferred revoke.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function groupDraftsByTemplate(drafts: DraftRecord[]): Map<string, Map<string, DraftRecord>> {
  const out = new Map<string, Map<string, DraftRecord>>();
  for (const d of drafts) {
    if (d.status !== 'ready') continue;
    let m = out.get(d.template_id);
    if (!m) {
      m = new Map();
      out.set(d.template_id, m);
    }
    m.set(d.section_id, d);
  }
  return out;
}

function buildFilename(projectName: string, templateName: string): string {
  const safeProject = projectName.replace(/[^a-z0-9]+/gi, '_').toLowerCase().slice(0, 40);
  const safeTemplate = templateName.replace(/[^a-z0-9]+/gi, '_').toLowerCase().slice(0, 40);
  const ts = new Date().toISOString().slice(0, 10);
  return `${safeProject || 'project'}_${safeTemplate || 'template'}_${ts}.docx`;
}

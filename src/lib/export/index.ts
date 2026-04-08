// Phase 3 export STUB. The eventual implementation clones the
// template's original DOCX bytes and walks the OOXML to inject each
// drafted section's paragraphs into the matching fill region (preserving
// every formatting node we don't touch). For now, this exports the
// project's drafts as a JSON dump so the user can verify the data
// pipeline end-to-end and we have a clear interface to swap the real
// assembler into.

import type { DraftRecord, ProjectRecord, TemplateRecord } from '../db/schema';

export interface ExportedProjectJson {
  exported_at: string;
  project: ProjectRecord;
  templates: Array<{
    template_id: string;
    template_name: string;
    sections: Array<{
      section_id: string;
      name: string;
      intent: string | undefined;
      status: DraftRecord['status'];
      paragraphs: DraftRecord['paragraphs'];
      validation_issues?: string[];
      tokens_in: number;
      tokens_out: number;
    }>;
  }>;
}

export function exportProjectAsJson(
  project: ProjectRecord,
  templates: TemplateRecord[],
  drafts: DraftRecord[],
): ExportedProjectJson {
  const draftsBySectionKey = new Map<string, DraftRecord>();
  for (const d of drafts) {
    draftsBySectionKey.set(`${d.template_id}::${d.section_id}`, d);
  }

  return {
    exported_at: new Date().toISOString(),
    project,
    templates: templates.map((tpl) => ({
      template_id: tpl.id,
      template_name: tpl.name,
      sections: tpl.schema_json.sections.map((s) => {
        const d = draftsBySectionKey.get(`${tpl.id}::${s.id}`);
        return {
          section_id: s.id,
          name: s.name,
          intent: s.intent,
          status: d?.status ?? 'pending',
          paragraphs: d?.paragraphs ?? [],
          validation_issues: d?.validation_issues,
          tokens_in: d?.tokens_in ?? 0,
          tokens_out: d?.tokens_out ?? 0,
        };
      }),
    })),
  };
}

/**
 * Trigger a browser file download containing the JSON export. Uses an
 * object URL + anchor click pattern that works on file:// origins.
 */
export function downloadJsonExport(filename: string, payload: unknown): void {
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer revoke so the click handler completes first.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

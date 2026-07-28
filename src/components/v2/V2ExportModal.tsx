import { useState, useEffect } from 'react';
import { type ProjectRecord, type TemplateRecord } from '../../lib/db/schema';
import { assembleProjectFromDrafts, downloadBlob, type AssembleProjectReport, type AssembleProjectResult } from '../../lib/export/downloadAssembled';
import { toast } from '../../lib/state/toast';
import { Modal } from './Modal';
import { assembleFreeformDocx } from '../../lib/freeform/assemble';

interface V2ExportModalProps {
  project: ProjectRecord;
  templates: TemplateRecord[];
  onClose: () => void;
}

export function V2ExportModal({ project, templates, onClose }: V2ExportModalProps) {
  const [busy, setBusy] = useState(true);
  const [report, setReport] = useState<AssembleProjectReport>({ successes: [], failures: [], skipped: [] });
  const [freeformResult, setFreeformResult] = useState<{ blob: Blob; filename: string } | null>(null);

  useEffect(() => {
    async function run() {
      try {
        if (project.mode === 'freeform') {
          if (!project.freeform_draft?.length) {
            setFreeformResult(null);
            return;
          }
          const result = await assembleFreeformDocx(project.freeform_draft);
          const safeName = project.name.replace(/[^a-z0-9]+/gi, '_').toLowerCase() || 'document';
          setFreeformResult({ blob: result.blob, filename: `${safeName}.docx` });
          return;
        }
        const out = await assembleProjectFromDrafts(project, templates);
        setReport(out);
      } catch (err) {
        toast.error(`Assembly failed: ${err instanceof Error ? err.message : String(err)}`);
        onClose();
        return;
      } finally {
        setBusy(false);
      }
    }
    run();
  }, [project, templates, onClose]);

  const handleDownload = (r: AssembleProjectResult) => {
    downloadBlob(r.blob, r.filename);
    toast.success(`Downloaded ${r.filename}`);
  };

  const handleDownloadAll = () => {
    for (const r of report.successes) {
      handleDownload(r);
    }
  };

  return (
    <Modal onClose={onClose} ariaLabelledBy="v2-export-title" cardStyle={{ width: 520 }}>
      <div style={{ padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 id="v2-export-title" style={{ margin: 0 }}>Export to Word</h3>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>×</button>
        </div>

        <div aria-live="polite" aria-busy={busy}>
          {busy ? (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
               <div className="spinner-small" style={{ margin: '0 auto 12px' }} />
               <div style={{ color: 'var(--ink-4)', fontSize: 13 }}>Assembling documents...</div>
            </div>
          ) : freeformResult ? (
            <>
              <div className="export-result">
                <div>
                  <div className="er-name">{project.name}</div>
                  <div className="er-meta">{project.freeform_draft?.length ?? 0} paragraphs assembled</div>
                </div>
                <button
                  className="btn btn-sm"
                  onClick={() => downloadBlob(freeformResult.blob, freeformResult.filename)}
                >
                  Download
                </button>
              </div>
              <div style={{ marginTop: 24 }}>
                <button
                  className="btn btn-accent"
                  style={{ width: '100%' }}
                  onClick={() => downloadBlob(freeformResult.blob, freeformResult.filename)}
                >
                  Download Word document
                </button>
              </div>
            </>
          ) : report.successes.length === 0 && report.failures.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--ink-4)' }}>
               No drafts ready for export.
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {report.successes.map(r => (
                  <div key={r.template_id} className="export-result">
                    <div>
                       <div className="er-name">{r.template_name}</div>
                       <div className="er-meta">{r.result.total_assembled} sections assembled</div>
                    </div>
                    <button className="btn btn-sm" onClick={() => handleDownload(r)}>Download</button>
                  </div>
                ))}
                {[...report.failures, ...report.skipped].map(r => (
                  <div key={r.template_id} className="export-result">
                    <div>
                      <div className="er-name">{r.template_name}</div>
                      <div className="er-meta">{r.reason}</div>
                    </div>
                    <span role="status">{report.failures.includes(r) ? 'Failed' : 'Skipped'}</span>
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 24, display: 'flex', gap: 12 }}>
                <button className="btn btn-accent" style={{ flex: 1 }} onClick={handleDownloadAll} disabled={report.successes.length === 0}>
                  {report.failures.length || report.skipped.length ? 'Download Available' : 'Download All'}
                </button>
                <button className="btn btn-ghost" style={{ flex: 1 }} onClick={onClose}>Close</button>
              </div>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

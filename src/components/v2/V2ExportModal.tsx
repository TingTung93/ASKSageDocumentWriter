import { useState, useEffect } from 'react';
import { type ProjectRecord, type TemplateRecord } from '../../lib/db/schema';
import { assembleProjectFromDrafts, downloadBlob, type AssembleProjectResult } from '../../lib/export/downloadAssembled';
import { toast } from '../../lib/state/toast';

interface V2ExportModalProps {
  project: ProjectRecord;
  templates: TemplateRecord[];
  onClose: () => void;
}

export function V2ExportModal({ project, templates, onClose }: V2ExportModalProps) {
  const [busy, setBusy] = useState(true);
  const [results, setResults] = useState<AssembleProjectResult[]>([]);

  useEffect(() => {
    async function run() {
      try {
        const out = await assembleProjectFromDrafts(project, templates);
        setResults(out);
      } catch (err) {
        toast.error(`Assembly failed: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setBusy(false);
      }
    }
    run();
  }, [project, templates]);

  const handleDownload = (r: AssembleProjectResult) => {
    downloadBlob(r.blob, r.filename);
    toast.success(`Downloaded ${r.filename}`);
  };

  const handleDownloadAll = () => {
    for (const r of results) {
      handleDownload(r);
    }
  };

  return (
    <div className="command-palette-overlay" onClick={onClose}>
      <div className="command-palette" onClick={e => e.stopPropagation()} style={{ width: 450 }}>
        <div style={{ padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <h3 style={{ margin: 0 }}>Export to Word</h3>
            <button className="icon-btn" onClick={onClose}>×</button>
          </div>

          {busy ? (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
               <div className="spinner-small" style={{ margin: '0 auto 12px' }} />
               <div style={{ color: 'var(--ink-4)', fontSize: 13 }}>Assembling documents...</div>
            </div>
          ) : results.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--ink-4)' }}>
               No drafts ready for export.
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {results.map(r => (
                  <div key={r.template_id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--surface)', padding: '12px 16px', borderRadius: 6, border: '1px solid var(--line)' }}>
                    <div style={{ minWidth: 0 }}>
                       <div style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.template_name}</div>
                       <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 2 }}>{r.result.total_assembled} sections assembled</div>
                    </div>
                    <button className="btn btn-sm" onClick={() => handleDownload(r)}>Download</button>
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 24, display: 'flex', gap: 12 }}>
                <button className="btn btn-accent" style={{ flex: 1 }} onClick={handleDownloadAll}>Download All</button>
                <button className="btn btn-ghost" style={{ flex: 1 }} onClick={onClose}>Close</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../lib/db/schema';
import { inferTemplateKind, summarizeTemplateChips } from './helpers';

interface V2LibraryViewProps {
  onOpenIngest: () => void;
}

export function V2LibraryView({ onOpenIngest }: V2LibraryViewProps) {
  const [tab, setTab] = useState<'templates' | 'datasets'>('templates');
  const templates = useLiveQuery(() => db.templates.orderBy('ingested_at').reverse().toArray(), []);

  return (
    <div className="lib-wrap">
      <div className="lib-inner">
        <div className="lib-head">
          <div>
            <div className="settings-eyebrow">Library</div>
            <h1 className="settings-title">Templates &amp; sources</h1>
            <p className="settings-lead">
              Your DOCX templates and source libraries. Upload a template to capture document
              structure; add project references when drafting so the model has the right facts.
            </p>
          </div>
        </div>
        <div className="lib-tabs">
          <button className={tab === 'templates' ? 'on' : ''} onClick={() => setTab('templates')}>
            Templates ({templates?.length ?? 0})
          </button>
          <button className={tab === 'datasets' ? 'on' : ''} onClick={() => setTab('datasets')}>
            Datasets &amp; sources
          </button>
        </div>
        <div className="lib-grid">
          {tab === 'templates' && (templates ?? []).map((t) => {
            const meta = summarizeTemplateChips(t);
            return (
              <div key={t.id} className="lib-card">
                <div className="lc-kind">{inferTemplateKind(t)}</div>
                <div className="lc-title">{t.name}</div>
                <div className="lc-desc">{t.filename}</div>
                <div className="lc-meta">{meta.map((m, j) => <span key={j}>{m}</span>)}</div>
              </div>
            );
          })}
          {tab === 'datasets' && (
            <div className="lib-card" role="status">
              <div className="lc-kind">Provider capability</div>
              <div className="lc-title">Dataset management is unavailable here</div>
              <div className="lc-desc">
                V2 shows dataset names selected on each project, but does not currently list or
                modify provider datasets. Use project references for portable grounding.
              </div>
            </div>
          )}
          {tab === 'templates' && <button type="button" className="lib-card new" onClick={onOpenIngest}>
            <div>
              <div style={{ fontSize: 22, marginBottom: 6 }}>＋</div>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>
                Upload DOCX template
              </div>
              <div style={{ fontSize: 11, marginTop: 4, fontFamily: 'var(--font-mono)', color: 'var(--ink-4)' }}>
                parses structure + placeholders
              </div>
            </div>
          </button>}
        </div>
      </div>
    </div>
  );
}

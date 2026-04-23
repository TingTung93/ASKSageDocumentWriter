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

  // Datasets in this build are not yet persisted — empty list with the
  // "Connect dataset" card in place so the UI reads complete.
  const datasets: { kind: string; title: string; desc: string; meta: string[] }[] = [];

  return (
    <div className="lib-wrap">
      <div className="lib-inner">
        <div className="lib-head">
          <div>
            <div className="settings-eyebrow">Library</div>
            <h1 className="settings-title">Templates &amp; sources</h1>
            <p className="settings-lead">
              Your DOCX templates and connected reference corpora. Upload a template to start a
              new draft; connect datasets to make them available to RAG.
            </p>
          </div>
        </div>
        <div className="lib-tabs">
          <button className={tab === 'templates' ? 'on' : ''} onClick={() => setTab('templates')}>
            Templates ({templates?.length ?? 0})
          </button>
          <button className={tab === 'datasets' ? 'on' : ''} onClick={() => setTab('datasets')}>
            Datasets &amp; sources ({datasets.length})
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
          {tab === 'datasets' && datasets.map((c, i) => (
            <div key={i} className="lib-card">
              <div className="lc-kind">{c.kind}</div>
              <div className="lc-title">{c.title}</div>
              <div className="lc-desc">{c.desc}</div>
              <div className="lc-meta">{c.meta.map((m, j) => <span key={j}>{m}</span>)}</div>
            </div>
          ))}
          <div className="lib-card new" onClick={() => tab === 'templates' && onOpenIngest()}>
            <div>
              <div style={{ fontSize: 22, marginBottom: 6 }}>＋</div>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>
                {tab === 'templates' ? 'Upload DOCX template' : 'Connect dataset'}
              </div>
              <div style={{ fontSize: 11, marginTop: 4, fontFamily: 'var(--font-mono)', color: 'var(--ink-4)' }}>
                {tab === 'templates' ? 'parses structure + placeholders' : 'Ask Sage, folder, or pinned URL'}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

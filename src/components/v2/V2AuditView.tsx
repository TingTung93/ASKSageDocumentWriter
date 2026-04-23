import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type AuditRecord } from '../../lib/db/schema';
import { toast } from '../../lib/state/toast';

type KindPill = 'draft' | 'critic' | 'review' | 'embed';

function inferKind(endpoint: string): KindPill {
  const e = endpoint.toLowerCase();
  if (e.includes('embed')) return 'embed';
  if (e.includes('critic') || e.includes('critique')) return 'critic';
  if (e.includes('models') || e.includes('synthes')) return 'review';
  return 'draft';
}

function formatTime(ts: string): string {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return ts;
  }
}

function summaryLine(r: AuditRecord): string {
  const parts: string[] = [];
  parts.push(r.endpoint);
  if (r.model) parts.push(r.model);
  if (r.prompt_excerpt) parts.push(r.prompt_excerpt.slice(0, 80).replace(/\s+/g, ' '));
  return parts.join(' · ');
}

export function V2AuditView() {
  const records = useLiveQuery(
    () => db.audit.orderBy('id').reverse().limit(500).toArray(),
    [],
  );
  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState<'all' | KindPill>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'ok' | 'err'>('all');

  const filtered = useMemo(() => {
    if (!records) return [];
    const q = search.trim().toLowerCase();
    return records.filter((r) => {
      const kind = inferKind(r.endpoint);
      if (kindFilter !== 'all' && kind !== kindFilter) return false;
      if (statusFilter === 'ok' && !r.ok) return false;
      if (statusFilter === 'err' && r.ok) return false;
      if (!q) return true;
      return (
        r.endpoint.toLowerCase().includes(q) ||
        (r.model ?? '').toLowerCase().includes(q) ||
        (r.error ?? '').toLowerCase().includes(q) ||
        r.prompt_excerpt.toLowerCase().includes(q) ||
        r.response_excerpt.toLowerCase().includes(q)
      );
    });
  }, [records, search, kindFilter, statusFilter]);

  const handleExport = () => {
    const payload = JSON.stringify(filtered, null, 2);
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${filtered.length} audit entries`);
  };

  return (
    <div className="audit-wrap">
      <div className="audit-inner">
        <div className="settings-eyebrow">Activity log</div>
        <h1 className="settings-title">Audit trail</h1>
        <p className="settings-lead">
          Every request made to your AI provider, with tokens and timing. Stored locally; never uploaded.
          Exportable as JSON for records retention.
        </p>
        <div className="audit-tools">
          <input
            className="audit-search"
            placeholder="Filter by endpoint, model, prompt, response, or error…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="btn"
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value as 'all' | KindPill)}
          >
            <option value="all">All kinds</option>
            <option value="draft">Draft</option>
            <option value="critic">Critic</option>
            <option value="review">Review</option>
            <option value="embed">Embed</option>
          </select>
          <select
            className="btn"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | 'ok' | 'err')}
          >
            <option value="all">All statuses</option>
            <option value="ok">OK only</option>
            <option value="err">Errors only</option>
          </select>
          <button className="btn btn-primary" onClick={handleExport}>Export JSON</button>
        </div>
        <div className="audit-list">
          <div className="audit-row head">
            <span>time</span>
            <span>kind</span>
            <span>summary</span>
            <span>tokens</span>
            <span>ms</span>
            <span>status</span>
          </div>
          {filtered.length === 0 && (
            <div style={{ padding: 28, fontSize: 12.5, color: 'var(--ink-3)', textAlign: 'center' }}>
              {records?.length === 0
                ? 'No activity yet — drafting, critique, or synthesis calls will show up here.'
                : 'No entries match the current filters.'}
            </div>
          )}
          {filtered.map((r) => {
            const kind = inferKind(r.endpoint);
            const tokens = (r.tokens_in ?? 0) + (r.tokens_out ?? 0);
            return (
              <div key={r.id} className="audit-row">
                <span className="time">{formatTime(r.ts)}</span>
                <span><span className={"kind-pill " + kind}>{kind}</span></span>
                <span className="summary" title={r.error ?? summaryLine(r)}>
                  {r.error ? `ERROR · ${r.error}` : summaryLine(r)}
                </span>
                <span className="tok">{tokens ? tokens.toLocaleString() : '—'}</span>
                <span className="cost">{r.ms}ms</span>
                <span className={"status " + (r.ok ? 'ok' : 'err')}>
                  {r.ok ? '✓ ok' : '× err'}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

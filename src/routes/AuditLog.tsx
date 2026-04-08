// Audit log viewer — read-only list of every Ask Sage call recorded
// by the client wrapper. Filterable by endpoint and status. Each row
// expands to show the prompt and response excerpts.

import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type AuditRecord } from '../lib/db/schema';

export function AuditLog() {
  const records = useLiveQuery(
    () => db.audit.orderBy('id').reverse().limit(500).toArray(),
    [],
  );
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'ok' | 'error'>('all');
  const [endpointFilter, setEndpointFilter] = useState<string>('all');

  const endpoints = useMemo(() => {
    if (!records) return [];
    return Array.from(new Set(records.map((r) => r.endpoint))).sort();
  }, [records]);

  const filtered = useMemo(() => {
    if (!records) return [];
    return records.filter((r) => {
      if (statusFilter === 'ok' && !r.ok) return false;
      if (statusFilter === 'error' && r.ok) return false;
      if (endpointFilter !== 'all' && r.endpoint !== endpointFilter) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        return (
          r.endpoint.toLowerCase().includes(q) ||
          (r.model ?? '').toLowerCase().includes(q) ||
          (r.error ?? '').toLowerCase().includes(q) ||
          r.prompt_excerpt.toLowerCase().includes(q) ||
          r.response_excerpt.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [records, search, statusFilter, endpointFilter]);

  const totals = useMemo(() => {
    if (!records) return { calls: 0, ok: 0, errors: 0, tokens_in: 0, tokens_out: 0 };
    return records.reduce(
      (acc, r) => ({
        calls: acc.calls + 1,
        ok: acc.ok + (r.ok ? 1 : 0),
        errors: acc.errors + (r.ok ? 0 : 1),
        tokens_in: acc.tokens_in + (r.tokens_in ?? 0),
        tokens_out: acc.tokens_out + (r.tokens_out ?? 0),
      }),
      { calls: 0, ok: 0, errors: 0, tokens_in: 0, tokens_out: 0 },
    );
  }, [records]);

  async function onClearAll() {
    if (!window.confirm('Delete all audit log entries? This cannot be undone.')) return;
    await db.audit.clear();
  }

  return (
    <main>
      <h1>Audit log</h1>
      <p className="note">
        Every <code>/server/*</code> call this app makes is recorded here:
        endpoint, model, prompt and response excerpts, token usage, and
        timing. The audit table lives entirely in IndexedDB on this
        machine — nothing is sent off-device.
      </p>

      <h2>Totals (last {records?.length ?? 0} calls)</h2>
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', fontSize: 13, marginBottom: '1rem' }}>
        <Stat label="Calls" value={totals.calls.toLocaleString()} />
        <Stat label="OK" value={totals.ok.toLocaleString()} color="#060" />
        <Stat label="Errors" value={totals.errors.toLocaleString()} color="#900" />
        <Stat label="Tokens in" value={totals.tokens_in.toLocaleString()} />
        <Stat label="Tokens out" value={totals.tokens_out.toLocaleString()} />
        <Stat label="Total tokens" value={(totals.tokens_in + totals.tokens_out).toLocaleString()} />
      </div>

      <h2>Filter</h2>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '1rem' }}>
        <input
          type="text"
          placeholder="Search endpoint, model, prompt, response, error…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: 280 }}
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as 'all' | 'ok' | 'error')}
          style={{ padding: '0.5rem', font: 'inherit' }}
        >
          <option value="all">All statuses</option>
          <option value="ok">OK only</option>
          <option value="error">Errors only</option>
        </select>
        <select
          value={endpointFilter}
          onChange={(e) => setEndpointFilter(e.target.value)}
          style={{ padding: '0.5rem', font: 'inherit' }}
        >
          <option value="all">All endpoints</option>
          {endpoints.map((ep) => (
            <option key={ep} value={ep}>
              {ep}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={onClearAll}
          style={{ background: '#a33', borderColor: '#a33' }}
        >
          Clear all
        </button>
      </div>

      <h2>Calls ({filtered.length})</h2>
      {(!records || records.length === 0) && (
        <p className="note">
          No calls recorded yet. Make any Ask Sage request from another tab —
          synthesis, drafting, document cleanup, dataset verify — and it will
          show up here.
        </p>
      )}
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {filtered.map((r) => (
          <AuditRow key={r.id} record={r} />
        ))}
      </ul>
    </main>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div
      style={{
        padding: '0.5rem 0.75rem',
        background: '#f5f5f5',
        border: '1px solid #ddd',
        borderRadius: 4,
        minWidth: 100,
      }}
    >
      <div style={{ fontSize: 11, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: color ?? '#1a1a1a' }}>{value}</div>
    </div>
  );
}

function AuditRow({ record }: { record: AuditRecord }) {
  const [expanded, setExpanded] = useState(false);
  const borderColor = record.ok ? '#0a0' : '#b00';
  return (
    <li
      style={{
        padding: '0.5rem 0.75rem',
        border: '1px solid #ddd',
        borderLeft: `3px solid ${borderColor}`,
        borderRadius: 4,
        marginBottom: '0.25rem',
        fontSize: 12,
        background: '#fff',
      }}
    >
      <div
        style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', cursor: 'pointer' }}
        onClick={() => setExpanded(!expanded)}
      >
        <span style={{ fontFamily: 'ui-monospace, Consolas, monospace', color: '#666', fontSize: 11 }}>
          {new Date(record.ts).toLocaleString()}
        </span>
        <strong style={{ color: borderColor }}>{record.ok ? 'OK' : 'ERR'}</strong>
        <code>{record.endpoint}</code>
        {record.model && <span style={{ color: '#446' }}>· {record.model}</span>}
        <span style={{ color: '#666' }}>· {record.ms}ms</span>
        {(record.tokens_in || record.tokens_out) && (
          <span style={{ color: '#666' }}>
            · {record.tokens_in ?? 0}+{record.tokens_out ?? 0} tokens
          </span>
        )}
        {record.error && <span style={{ color: '#900', marginLeft: '0.5rem' }}>{record.error}</span>}
        <span style={{ marginLeft: 'auto', color: '#888' }}>{expanded ? '▾' : '▸'}</span>
      </div>
      {expanded && (
        <div style={{ marginTop: '0.5rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 600, color: '#666' }}>REQUEST</div>
            <pre
              style={{
                background: '#f4f4f4',
                padding: '0.5rem',
                fontSize: 11,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                maxHeight: 240,
                overflow: 'auto',
                margin: 0,
              }}
            >
              {record.prompt_excerpt || '(empty)'}
            </pre>
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 600, color: '#666' }}>RESPONSE</div>
            <pre
              style={{
                background: '#f4f4f4',
                padding: '0.5rem',
                fontSize: 11,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                maxHeight: 240,
                overflow: 'auto',
                margin: 0,
              }}
            >
              {record.response_excerpt || '(empty)'}
            </pre>
          </div>
        </div>
      )}
    </li>
  );
}

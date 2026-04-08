// Datasets — lists Ask Sage datasets available to the user, or
// gracefully falls back to a verify-by-name probe when /user/* is
// CORS-blocked. The verify probe uses /server/query (always reachable)
// to confirm a dataset name is valid and returns reference material.

import { useState, type FormEvent } from 'react';
import { useAuth } from '../lib/state/auth';
import { AskSageClient } from '../lib/asksage/client';
import type { DatasetInfo, VerifyDatasetResult } from '../lib/asksage/types';

export function Datasets() {
  const apiKey = useAuth((s) => s.apiKey);
  const baseUrl = useAuth((s) => s.baseUrl);

  const [datasets, setDatasets] = useState<DatasetInfo[] | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [verifyName, setVerifyName] = useState('');
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [verifyResults, setVerifyResults] = useState<VerifyDatasetResult[]>([]);

  async function onListDatasets() {
    if (!apiKey) {
      setListError('Connect on the Connection tab first.');
      return;
    }
    setListError(null);
    setListLoading(true);
    setDatasets(null);
    // eslint-disable-next-line no-console
    console.info('[Datasets] calling /user/get-datasets');
    try {
      const client = new AskSageClient(baseUrl, apiKey);
      const list = await client.getDatasets();
      setDatasets(list);
      // eslint-disable-next-line no-console
      console.info(`[Datasets] received ${list.length} datasets`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.error('[Datasets] list failed:', err);
      setListError(message);
    } finally {
      setListLoading(false);
    }
  }

  async function onVerify(e: FormEvent) {
    e.preventDefault();
    if (!apiKey || !verifyName.trim()) return;
    setVerifyLoading(true);
    // eslint-disable-next-line no-console
    console.info(`[Datasets] verifying dataset "${verifyName.trim()}"`);
    try {
      const client = new AskSageClient(baseUrl, apiKey);
      const result = await client.verifyDataset(verifyName.trim());
      setVerifyResults((prev) => [result, ...prev].slice(0, 20));
      setVerifyName('');
    } finally {
      setVerifyLoading(false);
    }
  }

  return (
    <main>
      <h1>Datasets</h1>
      <p>
        Ask Sage datasets are reference corpora you've curated through Ask
        Sage's own UI (FAR clauses, DHA Issuances, prior packets, etc.).
        Drafting passes a dataset name on every <code>/server/query</code>{' '}
        call so RAG injects relevant context.
      </p>

      <h2>List datasets via API</h2>
      <p className="note">
        Calls <code>/user/get-datasets</code>. On the DHA health.mil tenant
        this endpoint is CORS-blocked from the browser, so the call will
        most likely fail with a network error — that's expected. If you're
        on a different tenant or Ask Sage updated their CORS config it may
        succeed.
      </p>
      <button type="button" onClick={onListDatasets} disabled={listLoading || !apiKey}>
        {listLoading ? 'Loading…' : 'List datasets'}
      </button>
      {listError && (
        <div className="error">
          List failed: {listError}
          {'\n\n'}
          Use "Verify dataset by name" below to check that a dataset you
          already know about is reachable.
        </div>
      )}
      {datasets && datasets.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, marginTop: '0.5rem' }}>
          {datasets.map((d) => (
            <li
              key={d.name}
              style={{ padding: '0.5rem 0.75rem', border: '1px solid #ddd', borderRadius: 4, marginBottom: '0.25rem' }}
            >
              <strong>{d.name}</strong>
              {d.description && <div className="note">{d.description}</div>}
              {typeof d.file_count === 'number' && (
                <div className="note">{d.file_count} file{d.file_count === 1 ? '' : 's'}</div>
              )}
            </li>
          ))}
        </ul>
      )}
      {datasets && datasets.length === 0 && (
        <p className="note">API returned an empty list.</p>
      )}

      <h2>Verify dataset by name</h2>
      <p className="note">
        Issues a tiny <code>/server/query</code> call against the dataset
        name and reports whether it's reachable and whether it returned
        reference material. This is the practical way to check dataset
        names on tenants where <code>/user/*</code> is blocked.
      </p>
      <form onSubmit={onVerify}>
        <label htmlFor="verify-name">Dataset name</label>
        <input
          id="verify-name"
          type="text"
          value={verifyName}
          onChange={(e) => setVerifyName(e.target.value)}
          placeholder="e.g. far-clauses, dha-issuances"
          disabled={verifyLoading || !apiKey}
        />
        <button type="submit" disabled={verifyLoading || !apiKey || !verifyName.trim()}>
          {verifyLoading ? 'Verifying…' : 'Verify'}
        </button>
      </form>

      {verifyResults.length > 0 && (
        <div style={{ marginTop: '1rem' }}>
          {verifyResults.map((r, i) => (
            <VerifyResultCard key={`${r.name}-${i}`} result={r} />
          ))}
        </div>
      )}
    </main>
  );
}

function VerifyResultCard({ result }: { result: VerifyDatasetResult }) {
  const ok = result.reachable;
  const hasRefs = result.has_references;
  const color = !ok ? '#b00' : hasRefs ? '#0a0' : '#a60';
  const label = !ok ? 'unreachable' : hasRefs ? 'verified · returned references' : 'reachable but no references';
  return (
    <div
      style={{
        marginBottom: '0.5rem',
        padding: '0.5rem 0.75rem',
        border: '1px solid #ccd',
        borderLeft: `4px solid ${color}`,
        background: '#fafbff',
        borderRadius: 4,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
        <strong>{result.name}</strong>
        <span style={{ color, fontSize: 12 }}>{label}</span>
      </div>
      {result.error && (
        <pre style={{ background: '#fee', padding: '0.4rem', fontSize: 11, marginTop: '0.4rem', whiteSpace: 'pre-wrap' }}>
          {result.error}
        </pre>
      )}
      {result.embedding_down && (
        <div className="note" style={{ color: '#a60' }}>warning: embeddings_down=true on this tenant</div>
      )}
      {result.references_excerpt && (
        <details style={{ marginTop: '0.4rem' }}>
          <summary style={{ cursor: 'pointer', fontSize: 12 }}>References excerpt</summary>
          <pre style={{ background: '#f4f4f4', padding: '0.4rem', fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 200, overflow: 'auto' }}>
            {result.references_excerpt}
          </pre>
        </details>
      )}
    </div>
  );
}

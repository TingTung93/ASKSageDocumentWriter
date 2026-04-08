// Datasets — verify-by-name probe for Ask Sage datasets. Uses
// /server/query (always reachable) to confirm a dataset name is valid
// and returns reference material. Programmatic listing is not possible
// because /user/get-datasets is CORS-blocked on the health.mil tenant.

import { useState, type FormEvent } from 'react';
import { useAuth } from '../lib/state/auth';
import { AskSageClient } from '../lib/asksage/client';
import type { VerifyDatasetResult } from '../lib/asksage/types';

export function Datasets() {
  const apiKey = useAuth((s) => s.apiKey);
  const baseUrl = useAuth((s) => s.baseUrl);

  const [verifyName, setVerifyName] = useState('');
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [verifyResults, setVerifyResults] = useState<VerifyDatasetResult[]>([]);

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
        Ask Sage datasets are reference corpora (FAR clauses, DHA Issuances,
        prior packets, etc.). Drafting passes a dataset name on every{' '}
        <code>/server/query</code> call so RAG injects relevant context.
      </p>

      <div className="panel" style={{ marginBottom: 'var(--space-4)' }}>
        <strong>Why can't I create or upload to a dataset from here?</strong>
        <p className="note" style={{ marginTop: '0.4rem' }}>
          Dataset creation, file uploads, and file listing all live under
          Ask Sage's <code>/user/*</code> API surface, which is CORS-blocked
          from the browser on the DHA health.mil tenant. A zero-backend
          single-page app architecturally can't reach those endpoints — it
          would need a server proxy, which the workstation network forbids.
        </p>
        <p className="note">
          <strong>How to curate datasets:</strong> create and populate them in
          the Ask Sage web UI directly, then enter the name on the{' '}
          <a href="#/projects">Projects</a> tab so drafting can reference them
          via RAG. Use "Verify dataset by name" below to confirm a name is
          reachable from this app before relying on it.
        </p>
      </div>

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

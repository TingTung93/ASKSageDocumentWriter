// Datasets — verify-by-name probe for Ask Sage datasets. Uses
// /server/query (always reachable) to confirm a dataset name is valid
// and returns reference material. Per swagger v1.56, dataset listing
// and management endpoints (get-datasets, dataset DELETE,
// delete-filename-from-dataset, get-all-files-ingested) all live on
// /server/* and are reachable; the Project Detail page uses
// getServerDatasets() for the picker.

import { useState, type FormEvent } from 'react';
import { useAuth } from '../lib/state/auth';
import { AskSageClient } from '../lib/asksage/client';
import type { VerifyDatasetResult } from '../lib/asksage/types';

export function Datasets() {
  const apiKey = useAuth((s) => s.apiKey);
  const baseUrl = useAuth((s) => s.baseUrl);
  const provider = useAuth((s) => s.provider);
  const onAskSage = provider === 'asksage';

  const [verifyName, setVerifyName] = useState('');
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [verifyResults, setVerifyResults] = useState<VerifyDatasetResult[]>([]);

  async function onVerify(e: FormEvent) {
    e.preventDefault();
    if (!apiKey || !verifyName.trim() || !onAskSage) return;
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

      {!onAskSage && (
        <div className="error" style={{ marginBottom: 'var(--space-4)' }}>
          <strong>Datasets are an Ask Sage feature.</strong> You're currently
          connected via <strong>OpenRouter</strong>, which has no concept of
          datasets, RAG, or knowledge-base ingest. Switch back to Ask Sage on
          the <a href="#/">Connection</a> tab to use this page.
        </div>
      )}

      <div className="panel" style={{ marginBottom: 'var(--space-4)' }}>
        <strong>Where do I create or populate a dataset?</strong>
        <p className="note" style={{ marginTop: '0.4rem' }}>
          Dataset listing, file upload, training, and file deletion all
          live on Ask Sage's <code>/server/*</code> API surface, which is
          reachable from the browser on the DHA health.mil tenant. The{' '}
          <a href="#/projects">Project</a> page exposes the picker
          (<code>/server/get-datasets</code>) and file attachment flow
          (<code>/server/file</code> + <code>/server/train</code>) — pick
          or create a dataset on a project, then attach files there.
        </p>
        <p className="note">
          Use "Verify dataset by name" below as a quick reachability
          check for a dataset you already know about — it issues a tiny{' '}
          <code>/server/query</code> against the name and reports whether
          RAG returned any reference material.
        </p>
      </div>

      <h2>Verify dataset by name</h2>
      <p className="note">
        Issues a tiny <code>/server/query</code> call against the dataset
        name and reports whether it's reachable and whether it returned
        reference material.
      </p>
      <form onSubmit={onVerify}>
        <label htmlFor="verify-name">Dataset name</label>
        <input
          id="verify-name"
          type="text"
          value={verifyName}
          onChange={(e) => setVerifyName(e.target.value)}
          placeholder="e.g. far-clauses, dha-issuances"
          disabled={verifyLoading || !apiKey || !onAskSage}
        />
        <button type="submit" disabled={verifyLoading || !apiKey || !verifyName.trim() || !onAskSage}>
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

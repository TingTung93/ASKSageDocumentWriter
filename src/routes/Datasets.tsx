// Datasets — list, verify, and inspect Ask Sage datasets. Uses
// /server/get-datasets to fetch the full list, and /server/query to
// verify individual datasets return reference material.

import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../lib/state/auth';
import { AskSageClient } from '../lib/asksage/client';
import type { VerifyDatasetResult } from '../lib/asksage/types';
import { Spinner } from '../components/Spinner';
import { EmptyState } from '../components/EmptyState';
import { SearchFilter, matchesSearch } from '../components/SearchFilter';
import { toast } from '../lib/state/toast';

export function Datasets() {
  const apiKey = useAuth((s) => s.apiKey);
  const baseUrl = useAuth((s) => s.baseUrl);
  const provider = useAuth((s) => s.provider);
  const onAskSage = provider === 'asksage';

  // ── Dataset listing state ────────────────────────────────────────
  const [datasets, setDatasets] = useState<string[] | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [listSearch, setListSearch] = useState('');

  // ── Verify-by-name state ─────────────────────────────────────────
  const [verifyName, setVerifyName] = useState('');
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [verifyResults, setVerifyResults] = useState<VerifyDatasetResult[]>([]);
  // Track which datasets from the list are currently being verified
  const [verifyingNames, setVerifyingNames] = useState<Set<string>>(new Set());

  // Auto-fetch the dataset list when the user connects via Ask Sage
  useEffect(() => {
    if (!apiKey || !onAskSage) {
      setDatasets(null);
      return;
    }
    void fetchDatasets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey, baseUrl, onAskSage]);

  async function fetchDatasets() {
    setListLoading(true);
    setListError(null);
    try {
      const client = new AskSageClient(baseUrl, apiKey!);
      const names = await client.getServerDatasets();
      setDatasets(names);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setListError(message);
      toast.error(`Failed to load datasets: ${message}`);
    } finally {
      setListLoading(false);
    }
  }

  async function onVerify(e: FormEvent) {
    e.preventDefault();
    if (!apiKey || !verifyName.trim() || !onAskSage) return;
    await verifyDatasetByName(verifyName.trim());
    setVerifyName('');
  }

  async function verifyDatasetByName(name: string) {
    if (!apiKey || !onAskSage) return;
    setVerifyingNames((prev) => new Set(prev).add(name));
    setVerifyLoading(true);
    // eslint-disable-next-line no-console
    console.info(`[Datasets] verifying dataset "${name}"`);
    try {
      const client = new AskSageClient(baseUrl, apiKey);
      const result = await client.verifyDataset(name);
      setVerifyResults((prev) => {
        // Replace any existing result for the same name, then prepend
        const filtered = prev.filter((r) => r.name !== name);
        return [result, ...filtered].slice(0, 20);
      });
    } catch (err) {
      toast.error(`Verify failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setVerifyLoading(false);
      setVerifyingNames((prev) => {
        const next = new Set(prev);
        next.delete(name);
        return next;
      });
    }
  }

  /**
   * Prettify the raw Ask Sage dataset name for display. The API returns
   * names like `user_custom_<USERID>_<NAME>_content` — strip the
   * prefix/suffix to show just the user-meaningful part.
   */
  function displayName(raw: string): string {
    // Common pattern: user_custom_<UUID>_<name>_content
    const m = raw.match(/^user_custom_[^_]+_(.+?)_content$/);
    if (m) return m[1].replace(/_/g, ' ');
    // Fallback: return as-is
    return raw;
  }

  const filteredDatasets = (datasets ?? []).filter(
    (d) => matchesSearch(d, listSearch) || matchesSearch(displayName(d), listSearch),
  );

  // Look up whether we already have a verify result for a given dataset name
  function getVerifyStatus(name: string): VerifyDatasetResult | undefined {
    return verifyResults.find((r) => r.name === name);
  }

  return (
    <main>
      <h1>Datasets</h1>
      <p>
        Ask Sage datasets are collections of reference material (FAR clauses,
        DHA Issuances, prior packets, etc.). When drafting, this tool uses
        your datasets to automatically pull in relevant supporting content.
      </p>

      {!onAskSage && (
        <div className="error" style={{ marginBottom: 'var(--space-4)' }}>
          <strong>Datasets are an Ask Sage feature.</strong> You're currently
          connected via <strong>OpenRouter</strong>, which does not support
          datasets or reference material lookups. Switch back to Ask Sage on
          the <a href="#/">Connection</a> tab to use this page.
        </div>
      )}

      {/* ── Your datasets (listing) ──────────────────────────────── */}
      <h2>
        Your datasets
        {datasets !== null && ` (${datasets.length})`}
      </h2>
      <p className="note">
        These are the datasets associated with your Ask Sage account. Click
        a dataset name to verify it contains reference material.
      </p>

      {!apiKey && !onAskSage && (
        <EmptyState
          title="Not connected"
          body="Connect to Ask Sage on the Connection tab to see your datasets."
        />
      )}

      {apiKey && onAskSage && listLoading && !datasets && (
        <div style={{ padding: 'var(--space-3)' }}>
          <Spinner label="Loading datasets…" />
        </div>
      )}

      {listError && (
        <div className="error" style={{ marginBottom: 'var(--space-3)' }}>
          Failed to load datasets: {listError}
          <div style={{ marginTop: '0.4rem' }}>
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => void fetchDatasets()}
              disabled={listLoading}
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {datasets !== null && datasets.length === 0 && (
        <EmptyState
          title="No datasets found"
          body="Your Ask Sage account has no datasets yet. You can create one from the Projects page by attaching files, or use the Ask Sage portal directly."
        />
      )}

      {datasets !== null && datasets.length > 0 && (
        <>
          {datasets.length > 5 && (
            <SearchFilter
              value={listSearch}
              onChange={setListSearch}
              placeholder="Filter datasets…"
            />
          )}
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {filteredDatasets.map((name) => {
              const status = getVerifyStatus(name);
              const isVerifying = verifyingNames.has(name);
              return (
                <DatasetRow
                  key={name}
                  rawName={name}
                  displayName={displayName(name)}
                  status={status}
                  verifying={isVerifying}
                  onVerify={() => void verifyDatasetByName(name)}
                />
              );
            })}
          </ul>
          {filteredDatasets.length === 0 && datasets.length > 0 && (
            <EmptyState title="No matches" body={`No datasets match "${listSearch}".`} />
          )}
          <div style={{ marginTop: 'var(--space-2)' }}>
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => void fetchDatasets()}
              disabled={listLoading}
            >
              {listLoading ? <Spinner light label="Refreshing…" /> : 'Refresh list'}
            </button>
          </div>
        </>
      )}

      {/* ── Verify by name (manual) ──────────────────────────────── */}
      <h2 style={{ marginTop: 'var(--space-4)' }}>Verify dataset by name</h2>
      <p className="note">
        Enter a dataset name manually to check whether it's accessible and
        contains reference material. Use this for datasets that don't appear
        in the list above, or to test a name before adding it to a project.
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

      {/* ── Verification results ─────────────────────────────────── */}
      {verifyResults.length > 0 && (
        <div style={{ marginTop: '1rem' }}>
          <h2>Verification results</h2>
          {verifyResults.map((r, i) => (
            <VerifyResultCard key={`${r.name}-${i}`} result={r} />
          ))}
        </div>
      )}

      {/* ── Help panel ───────────────────────────────────────────── */}
      <div className="panel" style={{ marginTop: 'var(--space-4)' }}>
        <strong>Where do I create or populate a dataset?</strong>
        <p className="note" style={{ marginTop: '0.4rem' }}>
          You can manage datasets from the{' '}
          <a href="#/projects">Project</a> page — pick or create a dataset,
          then attach files there. The tool handles the upload and indexing
          for you using your Ask Sage account.
        </p>
      </div>
    </main>
  );
}

// ── Dataset row in the listing ────────────────────────────────────

function DatasetRow({
  rawName,
  displayName: friendly,
  status,
  verifying,
  onVerify,
}: {
  rawName: string;
  displayName: string;
  status: VerifyDatasetResult | undefined;
  verifying: boolean;
  onVerify: () => void;
}) {
  const statusColor =
    status === undefined
      ? '#999'
      : !status.reachable
        ? '#b00'
        : status.has_references
          ? '#0a0'
          : '#a60';
  const statusLabel =
    status === undefined
      ? null
      : !status.reachable
        ? 'not found'
        : status.has_references
          ? 'has content'
          : 'empty';
  return (
    <li
      style={{
        padding: '0.5rem 0.75rem',
        border: '1px solid #ddd',
        borderLeft: status ? `4px solid ${statusColor}` : '1px solid #ddd',
        borderRadius: 4,
        marginBottom: '0.25rem',
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        background: '#fff',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <strong style={{ display: 'block' }}>{friendly}</strong>
        {friendly !== rawName && (
          <span className="note" style={{ fontSize: 11, wordBreak: 'break-all' }}>
            {rawName}
          </span>
        )}
      </div>
      {statusLabel && (
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: statusColor,
            whiteSpace: 'nowrap',
          }}
        >
          {statusLabel}
        </span>
      )}
      <button
        type="button"
        className="btn-secondary btn-sm"
        onClick={onVerify}
        disabled={verifying}
        title="Check this dataset for reference material"
      >
        {verifying ? <Spinner light label="…" /> : status ? 're-check' : 'check'}
      </button>
    </li>
  );
}

// ── Verification result card ──────────────────────────────────────

function VerifyResultCard({ result }: { result: VerifyDatasetResult }) {
  const ok = result.reachable;
  const hasRefs = result.has_references;
  const color = !ok ? '#b00' : hasRefs ? '#0a0' : '#a60';
  const label = !ok ? 'not found' : hasRefs ? 'verified · has reference material' : 'found but empty';
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
        <div className="note" style={{ color: '#a60' }}>Warning: the search index is currently unavailable on this server. Dataset lookups may not return results.</div>
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

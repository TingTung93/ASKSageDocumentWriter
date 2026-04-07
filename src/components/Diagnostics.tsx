import { useState } from 'react';

// Self-contained in-app diagnostics. Replicates probe.html inside the
// SPA so the user can debug network/auth issues on a workstation that
// blocks DevTools. Each probe records the full request shape, response
// status, response body excerpt, and any error — all rendered in the
// page itself.

interface ProbeResult {
  name: string;
  url: string;
  startedAt: number;
  ms: number;
  ok: boolean;
  // Network-level failure (no HTTP response at all)
  networkError: { name: string; message: string } | null;
  // HTTP-level result
  status: number | null;
  statusText: string | null;
  responseBodyExcerpt: string | null;
  // Browser-visible response headers (CORS hides most of them)
  visibleHeaders: Record<string, string>;
  // Echo of what we sent
  requestHeaders: Record<string, string>;
  requestBody: string;
}

interface DiagnosticsProps {
  baseUrl: string;
  apiKey: string;
}

async function runProbe(
  name: string,
  baseUrl: string,
  path: string,
  apiKey: string,
  body: unknown,
): Promise<ProbeResult> {
  const url = baseUrl.replace(/\/$/, '') + path;
  const requestHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-access-tokens': apiKey,
  };
  const requestBody = JSON.stringify(body ?? {});
  const startedAt = Date.now();

  let res: Response | null = null;
  let networkError: { name: string; message: string } | null = null;

  try {
    res = await globalThis.fetch(url, {
      method: 'POST',
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      redirect: 'follow',
      headers: requestHeaders,
      body: requestBody,
    });
  } catch (e) {
    networkError = {
      name: e instanceof Error ? e.name : 'UnknownError',
      message: e instanceof Error ? e.message : String(e),
    };
  }

  const ms = Date.now() - startedAt;
  let responseBodyExcerpt: string | null = null;
  const visibleHeaders: Record<string, string> = {};

  if (res) {
    try {
      const text = await res.text();
      responseBodyExcerpt = text.length > 800 ? text.slice(0, 800) + '… [truncated]' : text;
    } catch (e) {
      responseBodyExcerpt = `<error reading body: ${e instanceof Error ? e.message : String(e)}>`;
    }
    res.headers.forEach((v, k) => {
      visibleHeaders[k] = v;
    });
  }

  return {
    name,
    url,
    startedAt,
    ms,
    ok: !!res && res.ok,
    networkError,
    status: res?.status ?? null,
    statusText: res?.statusText ?? null,
    responseBodyExcerpt,
    visibleHeaders,
    requestHeaders: { ...requestHeaders, 'x-access-tokens': '<redacted>' },
    requestBody,
  };
}

export function Diagnostics({ baseUrl, apiKey }: DiagnosticsProps) {
  const [results, setResults] = useState<ProbeResult[]>([]);
  const [running, setRunning] = useState(false);

  async function runAll() {
    setRunning(true);
    setResults([]);
    const out: ProbeResult[] = [];
    const probes: Array<[string, string, unknown]> = [
      ['get-models (POST /server/get-models)', '/server/get-models', {}],
      [
        'query ping (POST /server/query)',
        '/server/query',
        { message: 'ping', model: 'google-claude-45-haiku', dataset: 'none', temperature: 0 },
      ],
    ];
    for (const [name, path, body] of probes) {
      const r = await runProbe(name, baseUrl, path, apiKey, body);
      out.push(r);
      setResults([...out]);
    }
    setRunning(false);
  }

  return (
    <section style={{ marginTop: '2rem', borderTop: '1px solid #ddd', paddingTop: '1rem' }}>
      <h2>Diagnostics</h2>
      <p className="note">
        Runs the same probes as <code>probe.html</code> but renders the
        results inline so you can debug without DevTools. The API key is
        sent only to the base URL above and is shown as <code>&lt;redacted&gt;</code>{' '}
        in the output below.
      </p>
      <button type="button" onClick={runAll} disabled={running || !apiKey}>
        {running ? 'Running probes…' : 'Run all probes'}
      </button>
      {results.length > 0 && (
        <div style={{ marginTop: '1rem' }}>
          {results.map((r, i) => (
            <ProbeView key={i} r={r} />
          ))}
        </div>
      )}
    </section>
  );
}

function ProbeView({ r }: { r: ProbeResult }) {
  const headerCount = Object.keys(r.visibleHeaders).length;
  return (
    <div
      style={{
        border: '1px solid #ccc',
        borderLeft: `4px solid ${r.ok ? '#0a0' : '#b00'}`,
        background: '#fff',
        padding: '0.75rem 1rem',
        marginBottom: '0.5rem',
        borderRadius: '4px',
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>
        {r.ok ? '✓' : '✗'} {r.name} — {r.ms}ms
      </div>
      <div style={{ fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 12, color: '#444' }}>
        URL: {r.url}
      </div>
      <div style={{ fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 12, color: '#444' }}>
        Status: {r.status === null ? '(no response)' : `${r.status} ${r.statusText ?? ''}`}
      </div>
      {r.networkError && (
        <pre
          style={{
            background: '#fee',
            border: '1px solid #c33',
            padding: '0.5rem',
            marginTop: '0.5rem',
            fontSize: 12,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          NETWORK ERROR: {r.networkError.name}: {r.networkError.message}
          {'\n\n'}
          The browser refused or could not complete the request. Common
          causes from a file:// origin against api.asksage.health.mil:
          {'\n'}
          • CORS preflight rejected by the server (no
          Access-Control-Allow-Origin for this origin){'\n'}
          • Network unreachable (firewall, VPN, proxy){'\n'}
          • DNS resolution failure{'\n'}
          • Browser security policy on file://{'\n'}
          • Mixed content / certificate issue{'\n'}
        </pre>
      )}
      {r.responseBodyExcerpt !== null && (
        <details style={{ marginTop: '0.5rem' }}>
          <summary style={{ cursor: 'pointer', fontSize: 12 }}>Response body ({r.responseBodyExcerpt.length} chars)</summary>
          <pre style={{ background: '#f4f4f4', padding: '0.5rem', fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 240, overflow: 'auto' }}>
            {r.responseBodyExcerpt || '(empty)'}
          </pre>
        </details>
      )}
      <details style={{ marginTop: '0.25rem' }}>
        <summary style={{ cursor: 'pointer', fontSize: 12 }}>
          Visible response headers ({headerCount}) — most are hidden by CORS
        </summary>
        <pre style={{ background: '#f4f4f4', padding: '0.5rem', fontSize: 11 }}>
          {headerCount === 0
            ? '(none visible to JavaScript)'
            : Object.entries(r.visibleHeaders)
                .map(([k, v]) => `${k}: ${v}`)
                .join('\n')}
        </pre>
      </details>
      <details style={{ marginTop: '0.25rem' }}>
        <summary style={{ cursor: 'pointer', fontSize: 12 }}>Request shape</summary>
        <pre style={{ background: '#f4f4f4', padding: '0.5rem', fontSize: 11 }}>
          POST {r.url}
          {'\n'}
          {Object.entries(r.requestHeaders).map(([k, v]) => `${k}: ${v}`).join('\n')}
          {'\n\n'}
          {r.requestBody}
        </pre>
      </details>
    </div>
  );
}

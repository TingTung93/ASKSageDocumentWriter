import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/state/auth';
import { AskSageClient } from '../lib/asksage/client';
import { Diagnostics } from '../components/Diagnostics';
import { Spinner } from '../components/Spinner';
import { toast } from '../lib/state/toast';

export function Welcome() {
  const {
    apiKey,
    baseUrl,
    models,
    isValidating,
    error,
    setApiKey,
    setBaseUrl,
    setModels,
    setValidating,
    setError,
    clear,
  } = useAuth();

  const [draftKey, setDraftKey] = useState(apiKey ?? '');
  const [draftBase, setDraftBase] = useState(baseUrl);
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  async function validate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setValidating(true);
    setModels(null);
    try {
      const client = new AskSageClient(draftBase.trim(), draftKey.trim());
      const list = await client.getModels();
      setBaseUrl(draftBase.trim());
      setApiKey(draftKey.trim());
      setModels(list);
      toast.success(`Connected — ${list.length} models available`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      toast.error('Connection failed — see error below');
    } finally {
      setValidating(false);
    }
  }

  function onClear() {
    clear();
    setDraftKey('');
    toast.info('Stored API key cleared');
  }

  const connected = !!apiKey && !!models;

  return (
    <main>
      <h1>Connection</h1>
      <p>
        Connect to your Ask Sage tenant. The API key is stored only in this
        tab's session storage and is sent directly to the base URL below in
        the <code>x-access-tokens</code> header. Closing the tab forgets it.
      </p>

      {connected && (
        <div className="success-banner">
          <strong>Connected.</strong> {models?.length ?? 0} models available
          on <code>{(() => { try { return new URL(baseUrl).host; } catch { return baseUrl; } })()}</code>.
          You can now use{' '}
          <Link to="/documents">Documents</Link>,{' '}
          <Link to="/templates">Templates</Link>, and{' '}
          <Link to="/projects">Projects</Link>.
        </div>
      )}

      <div className="card" style={{ marginTop: 'var(--space-4)' }}>
        <form onSubmit={validate}>
          <label htmlFor="baseUrl">Base URL</label>
          <input
            id="baseUrl"
            type="text"
            className="mono"
            value={draftBase}
            onChange={(e) => setDraftBase(e.target.value)}
            spellCheck={false}
            autoComplete="off"
          />
          <p className="note">
            Default is the DHA health tenant. Change if you're testing against a different Ask Sage tenant.
          </p>

          <label htmlFor="apiKey">API key</label>
          <input
            id="apiKey"
            type="password"
            value={draftKey}
            onChange={(e) => setDraftKey(e.target.value)}
            placeholder="paste your long-lived Ask Sage API key"
            spellCheck={false}
            autoComplete="off"
          />

          <div className="btn-row" style={{ marginTop: 'var(--space-3)' }}>
            <button type="submit" disabled={isValidating || !draftKey.trim()}>
              {isValidating ? <Spinner light label="Validating…" /> : connected ? 'Re-validate' : 'Validate connection'}
            </button>
            {apiKey && (
              <button type="button" className="btn-secondary" onClick={onClear}>
                Clear stored key
              </button>
            )}
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setShowDiagnostics((v) => !v)}
            >
              {showDiagnostics ? 'Hide' : 'Show'} diagnostics
            </button>
          </div>
        </form>
      </div>

      {error && (
        <div className="error">
          <strong>Connection failed.</strong>
          {'\n\n'}
          {error}
          {'\n\n'}
          Click "Show diagnostics" above for full per-probe detail.
        </div>
      )}

      {showDiagnostics && (
        <Diagnostics baseUrl={draftBase.trim()} apiKey={draftKey.trim()} />
      )}

      {models && (
        <section>
          <h2>Available models ({models.length})</h2>
          <p className="note">From <code>/server/get-models</code>. Pick per-stage overrides on the <Link to="/settings">Settings</Link> tab.</p>
          <ul className="models">
            {models.map((m) => (
              <li key={m.id}>{m.id}</li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

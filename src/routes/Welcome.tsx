import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/state/auth';
import { createLLMClient, defaultBaseUrlFor } from '../lib/provider/factory';
import type { ProviderId } from '../lib/provider/types';
import { Diagnostics } from '../components/Diagnostics';
import { Spinner } from '../components/Spinner';
import { toast } from '../lib/state/toast';

export function Welcome() {
  const {
    provider,
    apiKey,
    baseUrl,
    models,
    isValidating,
    error,
    setProvider,
    setApiKey,
    setBaseUrl,
    setModels,
    setValidating,
    setError,
    clear,
  } = useAuth();

  const [draftKey, setDraftKey] = useState(apiKey ?? '');
  const [draftBase, setDraftBase] = useState(baseUrl);
  const [draftProvider, setDraftProvider] = useState<ProviderId>(provider);
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  function onPickProvider(next: ProviderId) {
    if (next === draftProvider) return;
    // Reset the base URL field to the new provider's default ONLY if
    // the user was still on the old provider's default. Custom URLs
    // (e.g. a Cloudflare-fronted Ask Sage tenant) are preserved.
    const wasOnDefault = draftBase.trim() === defaultBaseUrlFor(draftProvider);
    setDraftProvider(next);
    if (wasOnDefault) setDraftBase(defaultBaseUrlFor(next));
  }

  async function validate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setValidating(true);
    setModels(null);
    try {
      // Persist provider FIRST so the connected state matches the
      // client we built. Order matters: setProvider also resets baseUrl
      // when the user is on the default URL, which would clobber what
      // we wrote below if it ran second.
      if (draftProvider !== provider) setProvider(draftProvider);
      const client = createLLMClient({
        provider: draftProvider,
        baseUrl: draftBase.trim(),
        apiKey: draftKey.trim(),
      });
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
        Connect to a completion provider. The API key is stored only in
        this tab's session storage and is sent directly to the base URL
        below. Closing the tab forgets it.
      </p>

      <div className="panel" style={{ marginBottom: 'var(--space-4)' }}>
        <strong style={{ display: 'block', marginBottom: '0.4rem' }}>
          ⚠ CUI / non-CUI boundary
        </strong>
        <p className="note" style={{ marginTop: 0 }}>
          <strong>Ask Sage</strong> is the only CUI-authorized path. Use it
          for any DHA contracting work that touches CUI (PWS drafts, market
          research, J&amp;A, prior packets).{' '}
          <strong>OpenRouter</strong> routes to commercial Claude/GPT/Gemini
          via <code>openrouter.ai</code> — use it ONLY for non-CUI material
          (public docs, generic templates, your own draft scratch). It is
          your responsibility to keep CUI off the OpenRouter path.
        </p>
      </div>

      {connected && (
        <div className="success-banner">
          <strong>Connected via {provider === 'openrouter' ? 'OpenRouter' : 'Ask Sage'}.</strong>{' '}
          {models?.length ?? 0} models available on{' '}
          <code>{(() => { try { return new URL(baseUrl).host; } catch { return baseUrl; } })()}</code>.
          You can now use{' '}
          <Link to="/documents">Documents</Link>,{' '}
          <Link to="/templates">Templates</Link>, and{' '}
          <Link to="/projects">Projects</Link>.
          {provider === 'openrouter' && (
            <>
              {' '}<strong>OpenRouter mode:</strong> dataset listing, file
              ingest, and the full project drafting flow are disabled
              (Ask Sage features). One-off template synthesis, schema
              refine, and document cleanup work normally.
            </>
          )}
        </div>
      )}

      <div className="card" style={{ marginTop: 'var(--space-4)' }}>
        <form onSubmit={validate}>
          <fieldset style={{ border: 'none', padding: 0, margin: '0 0 var(--space-3) 0' }}>
            <legend style={{ fontWeight: 600, padding: 0 }}>Provider</legend>
            <label style={{ display: 'block', marginTop: '0.4rem', fontWeight: 'normal' }}>
              <input
                type="radio"
                name="provider"
                value="asksage"
                checked={draftProvider === 'asksage'}
                onChange={() => onPickProvider('asksage')}
              />{' '}
              Ask Sage <span className="note">(DHA health.mil tenant — CUI authorized)</span>
            </label>
            <label style={{ display: 'block', marginTop: '0.2rem', fontWeight: 'normal' }}>
              <input
                type="radio"
                name="provider"
                value="openrouter"
                checked={draftProvider === 'openrouter'}
                onChange={() => onPickProvider('openrouter')}
              />{' '}
              OpenRouter <span className="note">(commercial — non-CUI only)</span>
            </label>
          </fieldset>

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
            {draftProvider === 'asksage'
              ? "Default is the DHA health tenant. Change if you're testing against a different Ask Sage tenant."
              : 'Default is OpenRouter\'s public API. Change only if you\'re fronting it with a proxy.'}
          </p>

          <label htmlFor="apiKey">API key</label>
          <input
            id="apiKey"
            type="password"
            value={draftKey}
            onChange={(e) => setDraftKey(e.target.value)}
            placeholder={
              draftProvider === 'asksage'
                ? 'paste your long-lived Ask Sage API key'
                : 'paste your OpenRouter API key (sk-or-...)'
            }
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
          <p className="note">
            From{' '}
            <code>{provider === 'openrouter' ? '/v1/models' : '/server/get-models'}</code>
            . Pick per-stage overrides on the <Link to="/settings">Settings</Link> tab.
          </p>
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

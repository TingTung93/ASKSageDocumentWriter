import { useState, type FormEvent } from 'react';
import { useAuth } from '../lib/state/auth';
import { AskSageClient } from '../lib/asksage/client';
import { Diagnostics } from '../components/Diagnostics';

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

  async function validate(e: FormEvent) {
    // eslint-disable-next-line no-console
    console.info('[Welcome.validate] handler entered');
    try {
      e.preventDefault();
    } catch (preventErr) {
      // eslint-disable-next-line no-console
      console.error('[Welcome.validate] preventDefault threw:', preventErr);
    }
    // eslint-disable-next-line no-console
    console.info(
      `[Welcome.validate] base="${draftBase.trim()}" keyLength=${draftKey.trim().length}`,
    );

    setError(null);
    setValidating(true);
    setModels(null);
    // eslint-disable-next-line no-console
    console.info('[Welcome.validate] state set: validating=true');

    try {
      // eslint-disable-next-line no-console
      console.info('[Welcome.validate] constructing AskSageClient');
      const client = new AskSageClient(draftBase.trim(), draftKey.trim());
      // eslint-disable-next-line no-console
      console.info('[Welcome.validate] calling client.getModels()');
      const list = await client.getModels();
      // eslint-disable-next-line no-console
      console.info(`[Welcome.validate] getModels resolved with ${list.length} models`);
      setBaseUrl(draftBase.trim());
      setApiKey(draftKey.trim());
      setModels(list);
      // eslint-disable-next-line no-console
      console.info('[Welcome.validate] state updated; success');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.error('[Welcome.validate] caught error:', err);
      setError(message);
    } finally {
      setValidating(false);
      // eslint-disable-next-line no-console
      console.info('[Welcome.validate] handler complete');
    }
  }

  return (
    <main>
      <h1>Phase 0 — Connection check</h1>
      <p>
        Paste your Ask Sage API key and click validate. The app will call{' '}
        <code>/server/get-models</code> with your key in the{' '}
        <code>x-access-tokens</code> header. If the call succeeds, the model
        list appears below and the rest of the tool can use the same client.
      </p>

      <form onSubmit={validate}>
        <label htmlFor="baseUrl">Base URL</label>
        <input
          id="baseUrl"
          type="text"
          value={draftBase}
          onChange={(e) => setDraftBase(e.target.value)}
          spellCheck={false}
          autoComplete="off"
        />
        <p className="note">
          Default is the DHA health tenant. Change if you're testing against
          a different Ask Sage tenant.
        </p>

        <label htmlFor="apiKey">Ask Sage API key</label>
        <input
          id="apiKey"
          type="password"
          value={draftKey}
          onChange={(e) => setDraftKey(e.target.value)}
          placeholder="paste your long-lived Ask Sage API key"
          spellCheck={false}
          autoComplete="off"
        />
        <p className="note">
          Stored in this tab's session storage only. Never sent anywhere
          except directly to the Ask Sage base URL above. Closing the tab
          forgets it.
        </p>

        <button type="submit" disabled={isValidating || !draftKey.trim()}>
          {isValidating ? 'Validating…' : 'Validate connection'}
        </button>
        {apiKey && (
          <button
            type="button"
            onClick={() => {
              clear();
              setDraftKey('');
            }}
            style={{ marginLeft: '0.5rem', background: '#666', borderColor: '#666' }}
          >
            Clear stored key
          </button>
        )}
      </form>

      {error && (
        <div className="error">
          <strong>Connection failed.</strong>
          {'\n\n'}
          {error}
          {'\n\n'}
          Try the diagnostics panel below for full per-probe detail —
          it surfaces the same info DevTools would show.
        </div>
      )}

      <Diagnostics baseUrl={draftBase.trim()} apiKey={draftKey.trim()} />

      {models && (
        <section>
          <h2>Available models ({models.length})</h2>
          <p className="note">Pulled from <code>/server/get-models</code>.</p>
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

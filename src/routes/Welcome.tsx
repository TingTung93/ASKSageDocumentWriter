import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/state/auth';
import { createLLMClient, defaultBaseUrlFor } from '../lib/provider/factory';
import type { ProviderId } from '../lib/provider/types';
import { Diagnostics } from '../components/Diagnostics';
import { Spinner } from '../components/Spinner';
import { StepIndicator } from '../components/StepIndicator';
import { HelpTip } from '../components/HelpTip';
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
  const [showAdvanced, setShowAdvanced] = useState(false);

  function onPickProvider(next: ProviderId) {
    if (next === draftProvider) return;
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
  const hasKey = draftKey.trim().length > 0;

  return (
    <main>
      <h1>Welcome to Ask Sage Document Writer</h1>
      <p>
        This tool helps you draft, review, and polish contracting documents
        (PWS, market research, J&amp;A, and more) using AI. Follow the steps
        below to get started.
      </p>

      {/* ── Getting started steps ────────────────────────────────── */}
      <StepIndicator
        steps={[
          {
            label: 'Connect to Ask Sage',
            description: 'Paste your API key below and click "Connect".',
            done: connected,
            active: !connected,
          },
          {
            label: 'Upload a template or document',
            description: 'Go to Templates (to draft from scratch) or Documents (to polish an existing file).',
            done: false,
            active: connected,
          },
          {
            label: 'Create a project and draft',
            description: 'Combine templates with your project details and let the AI generate content.',
          },
        ]}
      />

      {/* ── CUI notice (simplified) ──────────────────────────────── */}
      <div className="callout" style={{ marginTop: 'var(--space-4)' }}>
        <strong>Important: CUI handling</strong>
        <p className="note" style={{ marginTop: '0.3rem', marginBottom: 0 }}>
          For any work involving <strong>Controlled Unclassified Information (CUI)</strong> —
          PWS drafts, market research, J&amp;A, prior contract packets — you <strong>must</strong> use
          the <strong>Ask Sage</strong> provider. It is the only CUI-authorized option.
        </p>
      </div>

      {/* ── Success banner ───────────────────────────────────────── */}
      {connected && (
        <div className="success-banner" style={{ marginTop: 'var(--space-4)' }}>
          <strong>You're connected!</strong> Using{' '}
          {provider === 'openrouter' ? 'OpenRouter' : 'Ask Sage'} with{' '}
          {models?.length ?? 0} AI models available.
          <div style={{ marginTop: '0.4rem' }}>
            <strong>What to do next:</strong>{' '}
            Go to <Link to="/templates">Templates</Link> to upload a DOCX template,
            or <Link to="/documents">Documents</Link> to polish an existing document.
          </div>
          {provider === 'openrouter' && (
            <p className="note" style={{ marginTop: '0.4rem', marginBottom: 0, color: 'inherit' }}>
              <strong>Note:</strong> You're using OpenRouter (non-CUI only). Dataset listing,
              file upload, and full project drafting are only available with Ask Sage.
            </p>
          )}
        </div>
      )}

      {/* ── Connection form ──────────────────────────────────────── */}
      <div className="card" style={{ marginTop: 'var(--space-4)' }}>
        <form onSubmit={validate}>

          {/* Provider */}
          <fieldset style={{ border: 'none', padding: 0, margin: '0 0 var(--space-3) 0' }}>
            <legend style={{ fontWeight: 600, padding: 0 }}>
              Which AI service do you use?
            </legend>
            <label style={{ display: 'block', marginTop: '0.5rem', fontWeight: 'normal', fontSize: 14 }}>
              <input
                type="radio"
                name="provider"
                value="asksage"
                checked={draftProvider === 'asksage'}
                onChange={() => onPickProvider('asksage')}
              />{' '}
              <strong>Ask Sage</strong>{' '}
              <span className="note" style={{ fontSize: 12 }}>
                — DHA health.mil tenant (recommended for CUI work)
              </span>
            </label>
            <label style={{ display: 'block', marginTop: '0.35rem', fontWeight: 'normal', fontSize: 14 }}>
              <input
                type="radio"
                name="provider"
                value="openrouter"
                checked={draftProvider === 'openrouter'}
                onChange={() => onPickProvider('openrouter')}
              />{' '}
              <strong>OpenRouter</strong>{' '}
              <span className="note" style={{ fontSize: 12 }}>
                — commercial AI service (non-CUI only)
              </span>
            </label>
          </fieldset>

          {/* API key */}
          <label htmlFor="apiKey" style={{ marginTop: 'var(--space-4)' }}>
            API key{' '}
            <HelpTip label="Where do I find this?">
              {draftProvider === 'asksage' ? (
                <>
                  <strong>Ask Sage API key:</strong>
                  <ol style={{ margin: '0.4rem 0 0', paddingLeft: '1.2rem', fontSize: 12 }}>
                    <li>Go to the Ask Sage portal on your DHA workstation</li>
                    <li>Open your account settings or profile page</li>
                    <li>Look for "API Key" or "Access Token"</li>
                    <li>Copy the long key string and paste it here</li>
                  </ol>
                  <p style={{ margin: '0.4rem 0 0', fontSize: 12 }}>
                    Your key stays in this browser tab only and is erased when
                    you close the tab. It is never saved to disk.
                  </p>
                </>
              ) : (
                <>
                  <strong>OpenRouter API key:</strong>
                  <ol style={{ margin: '0.4rem 0 0', paddingLeft: '1.2rem', fontSize: 12 }}>
                    <li>Go to openrouter.ai and sign in</li>
                    <li>Open your account settings</li>
                    <li>Create or copy an API key (starts with sk-or-...)</li>
                    <li>Paste it here</li>
                  </ol>
                </>
              )}
            </HelpTip>
          </label>
          <input
            id="apiKey"
            type="password"
            value={draftKey}
            onChange={(e) => setDraftKey(e.target.value)}
            placeholder={
              draftProvider === 'asksage'
                ? 'Paste your Ask Sage API key here'
                : 'Paste your OpenRouter API key here (starts with sk-or-...)'
            }
            spellCheck={false}
            autoComplete="off"
            style={{ fontSize: 14 }}
          />
          <p className="note">
            Your key is stored only in this browser tab and is never saved to
            your computer. Closing the tab erases it.
          </p>

          {/* Advanced: Base URL (hidden by default) */}
          <details
            open={showAdvanced}
            onToggle={(e) => setShowAdvanced((e.target as HTMLDetailsElement).open)}
            style={{ marginTop: 'var(--space-3)' }}
          >
            <summary className="note" style={{ cursor: 'pointer', fontWeight: 500 }}>
              Advanced: Server URL (most users don't need to change this)
            </summary>
            <div style={{ marginTop: '0.4rem' }}>
              <label htmlFor="baseUrl">Server URL</label>
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
                  ? 'This points to the DHA health.mil Ask Sage server. Only change it if IT gave you a different address.'
                  : 'This points to the OpenRouter service. Only change it if you have a custom setup.'}
              </p>
            </div>
          </details>

          {/* Action buttons */}
          <div className="btn-row" style={{ marginTop: 'var(--space-4)' }}>
            <button type="submit" disabled={isValidating || !hasKey} style={{ fontSize: 14 }}>
              {isValidating ? (
                <Spinner light label="Connecting…" />
              ) : connected ? (
                'Reconnect'
              ) : (
                'Connect'
              )}
            </button>
            {apiKey && (
              <button type="button" className="btn-secondary" onClick={onClear}>
                Disconnect
              </button>
            )}
          </div>
        </form>
      </div>

      {/* ── Error display (friendlier) ───────────────────────────── */}
      {error && (
        <div style={{ marginTop: 'var(--space-3)' }}>
          <div className="callout" style={{ borderLeftColor: 'var(--color-danger)', background: 'var(--color-danger-soft)' }}>
            <strong>Could not connect.</strong>
            <p style={{ margin: '0.4rem 0 0', fontSize: 13, color: 'var(--color-text)' }}>
              {friendlyErrorMessage(error)}
            </p>
            <details style={{ marginTop: '0.5rem' }}>
              <summary className="note" style={{ cursor: 'pointer' }}>
                Show technical details
              </summary>
              <pre style={{
                marginTop: '0.4rem',
                background: '#fff',
                border: '1px solid var(--color-border)',
                padding: '0.5rem',
                fontSize: 11,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                maxHeight: 200,
                overflow: 'auto',
              }}>
                {error}
              </pre>
            </details>
            <p className="note" style={{ marginTop: '0.5rem', marginBottom: 0 }}>
              <strong>Things to try:</strong> Check that your API key is correct,
              make sure you're on the right network (VPN if needed), and try
              again. If it still doesn't work, click the button below to run
              detailed connection tests.
            </p>
          </div>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => setShowDiagnostics(true)}
            style={{ marginTop: 'var(--space-2)' }}
          >
            Run connection tests
          </button>
        </div>
      )}

      {showDiagnostics && (
        <Diagnostics baseUrl={draftBase.trim()} apiKey={draftKey.trim()} />
      )}

      {/* ── Model list (collapsed by default for simplicity) ─────── */}
      {models && (
        <details style={{ marginTop: 'var(--space-4)' }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 14 }}>
            Available AI models ({models.length})
          </summary>
          <p className="note" style={{ marginTop: '0.3rem' }}>
            These are the AI models your account can use.
            You can choose which model to use for each task on the{' '}
            <Link to="/settings">Settings</Link> page. The defaults work well
            for most users.
          </p>
          <ul className="models">
            {models.map((m) => (
              <li key={m.id}>{m.id}</li>
            ))}
          </ul>
        </details>
      )}
    </main>
  );
}

/**
 * Turn raw API error messages into something a non-technical user
 * can understand and act on.
 */
function friendlyErrorMessage(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes('401') || lower.includes('unauthorized') || lower.includes('invalid') && lower.includes('key')) {
    return 'Your API key was not accepted. Double-check that you copied the full key and that it hasn\'t expired.';
  }
  if (lower.includes('403') || lower.includes('forbidden')) {
    return 'Your account doesn\'t have permission to access this service. Contact your Ask Sage administrator.';
  }
  if (lower.includes('404') || lower.includes('not found')) {
    return 'The server address doesn\'t seem right. Make sure you\'re using the correct provider and haven\'t changed the server URL.';
  }
  if (lower.includes('network') || lower.includes('fetch') || lower.includes('failed to fetch') || lower.includes('typeerror')) {
    return 'Can\'t reach the server. Check your internet connection, make sure you\'re on the right network (VPN if required), and try again.';
  }
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return 'The connection timed out. The server may be busy — wait a moment and try again.';
  }
  if (lower.includes('cors') || lower.includes('access-control')) {
    return 'The server blocked this request due to security settings. This usually means you need to be on the correct network or VPN.';
  }
  if (lower.includes('500') || lower.includes('internal server error')) {
    return 'The server had an internal error. This is usually temporary — wait a minute and try again.';
  }
  if (lower.includes('429') || lower.includes('rate limit') || lower.includes('too many')) {
    return 'Too many requests. Wait a minute and try again.';
  }
  // Fallback: show as-is but wrapped in guidance
  return `Something unexpected went wrong: "${raw.length > 120 ? raw.slice(0, 120) + '…' : raw}"`;
}

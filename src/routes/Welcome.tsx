import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/state/auth';
import { createLLMClient, defaultBaseUrlFor } from '../lib/provider/factory';
import type { ProviderId } from '../lib/provider/types';
import {
  LOCAL_OPENAI_PRESETS,
  isLocalhostBaseUrl,
  probeLocalOpenAIEndpoint,
  type LocalEndpointProbeResult,
} from '../lib/provider/local_openai';
import { Diagnostics } from '../components/Diagnostics';
import { Spinner } from '../components/Spinner';
import { StepIndicator } from '../components/StepIndicator';
import { HelpTip } from '../components/HelpTip';
import { toast } from '../lib/state/toast';
import { debugLog } from '../lib/debug/log';
import { getProviderConnection } from '../lib/provider/connection';

export function Welcome() {
  const {
    provider,
    apiKey,
    baseUrl,
    models,
    localProbe,
    isValidating,
    error,
    setProvider,
    setApiKey,
    setBaseUrl,
    setModels,
    setLocalProbe,
    setValidating,
    setError,
    clear,
  } = useAuth();

  const [draftKey, setDraftKey] = useState(apiKey ?? '');
  const [draftBase, setDraftBase] = useState(baseUrl);
  const [draftProvider, setDraftProvider] = useState<ProviderId>(provider);
  const [localPresetId, setLocalPresetId] = useState<LocalPresetId>(() => localPresetIdForBase(baseUrl));
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  function onPickProvider(next: ProviderId) {
    if (next === draftProvider) return;
    const wasOnDefault = isDefaultOrLocalPresetBase(draftProvider, draftBase);
    setDraftProvider(next);
    if (wasOnDefault) {
      const nextBase = defaultBaseUrlFor(next);
      setDraftBase(nextBase);
      if (next === 'local_openai') setLocalPresetId(localPresetIdForBase(nextBase));
    } else if (next === 'local_openai') {
      setLocalPresetId(localPresetIdForBase(draftBase));
    }
  }

  function onPickLocalPreset(next: LocalPresetId) {
    setLocalPresetId(next);
    setLocalProbe(null);
    if (next === 'custom') return;
    const preset = LOCAL_OPENAI_PRESETS.find((p) => p.id === next);
    if (preset) setDraftBase(preset.baseUrl);
  }

  function onDraftBaseChange(nextBase: string) {
    setDraftBase(nextBase);
    setLocalProbe(null);
    if (draftProvider === 'local_openai') {
      setLocalPresetId(localPresetIdForBase(nextBase));
    }
  }

  async function validate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setValidating(true);
    setModels(null);
    setLocalProbe(null);
    try {
      const trimmedBase = draftBase.trim();
      const trimmedKey = draftKey.trim();
      if (draftProvider !== provider) setProvider(draftProvider);
      const client = createLLMClient({
        provider: draftProvider,
        baseUrl: trimmedBase,
        apiKey: trimmedKey,
      });
      const list = await client.getModels();
      setBaseUrl(trimmedBase);
      setApiKey(trimmedKey);
      setModels(list);
      if (draftProvider === 'local_openai') {
        const probe = await probeLocalOpenAIEndpoint({
          baseUrl: trimmedBase,
          apiKey: trimmedKey,
          model: list[0]?.id,
        });
        setLocalProbe(probe);
      }
      toast.success(`Connected — ${list.length} models available`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      debugLog.add(
        'error',
        `[connection] ${draftProvider} ${draftBase.trim().replace(/\/$/, '')}/models failed: ${message}`,
      );
      setError(message);
      setLocalProbe(null);
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

  const connection = getProviderConnection({
    provider,
    apiKey,
    baseUrl,
    models,
    localProbe,
    error,
  });
  const draftConnection = getProviderConnection({
    provider: draftProvider,
    apiKey: draftKey,
    baseUrl: draftBase,
    models: draftProvider === provider && draftBase.trim() === baseUrl ? models : null,
    localProbe,
    error: null,
  });
  const connected = connection.state === 'verified';
  const canSubmit = draftConnection.canValidate;
  const showLocalPrivacyWarning =
    draftProvider === 'local_openai' &&
    draftBase.trim().length > 0 &&
    !isLocalhostBaseUrl(draftBase.trim());
  const visibleLocalProbe =
    draftProvider === 'local_openai' &&
    localProbe &&
    draftBase.trim() === localProbe.baseUrl
      ? localProbe
      : null;
  const connectedProviderLabel =
    provider === 'local_openai'
      ? 'Local OpenAI-compatible (non-CUI, default local endpoint)'
      : provider === 'genai_mil'
        ? 'GenAI.mil (STARK gateway, no tool calling)'
      : provider === 'openrouter'
        ? 'OpenRouter'
        : 'Ask Sage';

  return (
    <main>
      <h1>Welcome to Ask Sage Document Writer</h1>
      <p>
        Draft structured DOCX packages from templates, write freeform documents,
        or clean up an existing Word file. Connect your provider, add source
        material, and export back to Word without running a server.
      </p>

      {/* ── Getting started steps ────────────────────────────────── */}
      <StepIndicator
        steps={[
          {
            label: 'Connect an AI provider',
            description: 'Use Ask Sage, GenAI.mil, OpenRouter, or a local OpenAI-compatible service.',
            done: connected,
            active: !connected,
          },
          {
            label: 'Upload a template or document',
            description: 'Use Templates for structured drafting or Documents to edit an existing DOCX.',
            done: false,
            active: connected,
          },
          {
            label: 'Create a project and draft',
            description: 'Attach references, draft with structured DOCX output, then export to Word.',
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
          {connectedProviderLabel} with{' '}
          {models?.length ?? 0} AI models available.
          <div style={{ marginTop: '0.4rem' }}>
            <strong>What to do next:</strong>{' '}
            Go to <Link to="/templates">Templates</Link> to upload a DOCX template,
            or <Link to="/documents">Documents</Link> to polish an existing document.
          </div>
          {provider === 'openrouter' && (
            <p className="note" style={{ marginTop: '0.4rem', marginBottom: 0, color: 'inherit' }}>
              <strong>Note:</strong> You're using OpenRouter (non-CUI only). Browser-side
              DOCX/PDF/text extraction is available for project references, but Ask Sage
              datasets and server-side file extraction are unavailable.
            </p>
          )}
        </div>
      )}

      {/* ── Connection form ──────────────────────────────────────── */}
      <div className="card" style={{ marginTop: 'var(--space-4)' }}>
        <form onSubmit={validate}>

          {/* Provider — styled to match V2's .provider-card grid. */}
          <fieldset style={{ border: 'none', padding: 0, margin: '0 0 var(--space-3) 0' }}>
            <legend style={{ fontWeight: 600, padding: 0, marginBottom: '0.5rem' }}>
              Which AI service do you use?
            </legend>
            <div className="provider-cards" role="radiogroup" aria-label="AI provider">
              <ProviderPickCard
                provider="asksage"
                mark="A"
                name="Ask Sage"
                url="DHA health.mil tenant"
                features={['CUI-authorized', 'Full drafting']}
                selected={draftProvider === 'asksage'}
                onSelect={onPickProvider}
              />
              <ProviderPickCard
                provider="genai_mil"
                mark="G"
                name="GenAI.mil"
                url="STARK API gateway"
                features={['Models + chat', 'No tool calling']}
                selected={draftProvider === 'genai_mil'}
                onSelect={onPickProvider}
              />
              <ProviderPickCard
                provider="local_openai"
                mark="L"
                name="Local OpenAI"
                url="localhost / custom"
                features={['Non-CUI by default', 'Ollama / llama.cpp']}
                selected={draftProvider === 'local_openai'}
                onSelect={onPickProvider}
              />
              <ProviderPickCard
                provider="openrouter"
                mark="O"
                name="OpenRouter"
                url="openrouter.ai"
                features={['Non-CUI only', 'Cleanup / refinement']}
                selected={draftProvider === 'openrouter'}
                onSelect={onPickProvider}
              />
            </div>
          </fieldset>

          {draftProvider === 'local_openai' && (
            <div style={{ marginTop: 'var(--space-3)' }}>
              <label htmlFor="localBackendPreset">Local backend</label>
              <select
                id="localBackendPreset"
                value={localPresetId}
                onChange={(e) => onPickLocalPreset(e.target.value as LocalPresetId)}
                style={{ fontSize: 14 }}
              >
                {LOCAL_OPENAI_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>{preset.name}</option>
                ))}
                <option value="custom">Custom</option>
              </select>
              <p className="note">
                Most local backends do not require an API key. Use localhost endpoints for
                non-CUI drafting experiments unless you have a trusted custom server.
              </p>
              {showLocalPrivacyWarning && (
                <div className="callout" style={{ marginTop: 'var(--space-2)' }}>
                  <strong>Local endpoint privacy check</strong>
                  <p className="note" style={{ marginTop: '0.3rem', marginBottom: 0 }}>
                    This Local OpenAI URL is not a localhost address. Confirm it is an
                    intended non-CUI local or trusted server before sending document text.
                  </p>
                </div>
              )}
            </div>
          )}
          {draftProvider === 'genai_mil' && (
            <div className="callout" style={{ marginTop: 'var(--space-3)' }}>
              <strong>Completion-only API</strong>
              <p className="note" style={{ marginTop: '0.3rem', marginBottom: 0 }}>
                The current GenAI.mil STARK API does not support tool calling.
                Drafting remains available using prompt-only JSON generation; tool,
                dataset, live-search, and embedding fields are not sent.
              </p>
            </div>
          )}

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
              ) : draftProvider === 'genai_mil' ? (
                <>
                  <strong>GenAI.mil STARK API key:</strong>
                  <p style={{ margin: '0.4rem 0 0', fontSize: 12 }}>
                    Create a scoped key in the GenAI.mil portal and paste the full key
                    supplied by the one-time key retrieval flow.
                  </p>
                </>
              ) : draftProvider === 'local_openai' ? (
                <>
                  <strong>Local OpenAI API key:</strong>
                  <p style={{ margin: '0.4rem 0 0', fontSize: 12 }}>
                    Most Ollama, llama.cpp, and LM Studio servers do not require a key.
                    Leave this blank unless your custom local endpoint requires one.
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
                : draftProvider === 'genai_mil'
                  ? 'Paste your GenAI.mil STARK API key here'
                : draftProvider === 'local_openai'
                  ? 'Optional for most local backends'
                  : 'Paste your OpenRouter API key here (starts with sk-or-...)'
            }
            spellCheck={false}
            autoComplete="off"
            style={{ fontSize: 14 }}
          />
          <p className="note">
            {draftProvider === 'local_openai'
              ? 'Most local backends do not require an API key. If you enter one, it stays only in this browser tab.'
              : 'Your key is stored only in this browser tab and is never saved to your computer. Closing the tab erases it.'}
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
                onChange={(e) => onDraftBaseChange(e.target.value)}
                spellCheck={false}
                autoComplete="off"
              />
              <p className="note">
                {draftProvider === 'asksage'
                  ? 'This points to the DHA health.mil Ask Sage server. Only change it if IT gave you a different address.'
                  : draftProvider === 'genai_mil'
                    ? 'This should include /v1. Change it if your GenAI.mil portal provides a different STARK gateway address.'
                  : draftProvider === 'local_openai'
                    ? 'This should include /v1 for OpenAI-compatible local servers. Use Custom above for a non-preset endpoint.'
                    : 'This points to the OpenRouter service. Only change it if you have a custom setup.'}
              </p>
            </div>
          </details>

          {/* Action buttons */}
          <div className="btn-row" style={{ marginTop: 'var(--space-4)' }}>
            <button type="submit" disabled={isValidating || !canSubmit} style={{ fontSize: 14 }}>
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
        {visibleLocalProbe && (
          <LocalProbeSummary probe={visibleLocalProbe} />
        )}
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
        <Diagnostics baseUrl={draftBase.trim()} apiKey={draftKey.trim()} provider={draftProvider} />
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

function ProviderPickCard({
  provider,
  mark,
  name,
  url,
  features,
  selected,
  onSelect,
}: {
  provider: ProviderId;
  mark: string;
  name: string;
  url: string;
  features: string[];
  selected: boolean;
  onSelect: (p: ProviderId) => void;
}) {
  return (
    <div
      className={'provider-card' + (selected ? ' on' : '')}
      role="radio"
      aria-checked={selected}
      tabIndex={selected ? 0 : -1}
      onClick={() => onSelect(provider)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(provider);
        }
      }}
    >
      <div className="pc-head">
        <span className="pc-mark">{mark}</span>
        <div>
          <div className="pc-name">{name}</div>
          <div className="pc-url">{url}</div>
        </div>
      </div>
      <div className="pc-feats">
        {features.map((f) => (
          <span key={f}>{f}</span>
        ))}
      </div>
    </div>
  );
}

type LocalPresetId = (typeof LOCAL_OPENAI_PRESETS)[number]['id'] | 'custom';

function localPresetIdForBase(baseUrl: string): LocalPresetId {
  const normalized = baseUrl.trim();
  return LOCAL_OPENAI_PRESETS.find((preset) => preset.baseUrl === normalized)?.id ?? 'custom';
}

function isDefaultOrLocalPresetBase(provider: ProviderId, baseUrl: string): boolean {
  if (provider === 'local_openai') return localPresetIdForBase(baseUrl) !== 'custom';
  return baseUrl.trim() === defaultBaseUrlFor(provider);
}

function LocalProbeSummary({ probe }: { probe: LocalEndpointProbeResult }) {
  const rows = [
    { label: 'Models', ok: probe.capabilities.models },
    { label: 'Chat', ok: probe.capabilities.chat },
    { label: 'Tools', ok: probe.capabilities.tools },
    { label: 'JSON', ok: probe.capabilities.jsonOutput },
    { label: 'Embeddings', ok: probe.capabilities.embeddings },
  ];
  return (
    <div className="callout" style={{ marginTop: 'var(--space-3)' }}>
      <strong>Endpoint check</strong>
      <p className="note" style={{ marginTop: '0.3rem' }}>
        Local endpoints often expose sparse metadata. Verify chat, tool, JSON,
        and embeddings support before relying on this backend for drafting.
      </p>
      <div className="pc-feats" style={{ marginTop: '0.5rem' }}>
        {rows.map((row) => (
          <span key={row.label}>{row.label}: {row.ok ? 'yes' : 'no'}</span>
        ))}
      </div>
      {probe.error && (
        <p className="note" style={{ marginTop: '0.5rem', marginBottom: 0 }}>
          {probe.error}
        </p>
      )}
      {probe.warnings.length > 0 && (
        <ul className="note" style={{ marginTop: '0.5rem', marginBottom: 0 }}>
          {probe.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
    </div>
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

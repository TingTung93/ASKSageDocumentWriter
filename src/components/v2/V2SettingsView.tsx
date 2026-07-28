import { useState, useMemo, useRef, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAuth } from '../../lib/state/auth';
import { getProviderConnection } from '../../lib/provider/connection';
import { createLLMClient, defaultBaseUrlFor, defaultModelFor, providerLabel } from '../../lib/provider/factory';
import type { ProviderId } from '../../lib/provider/types';
import {
  LOCAL_OPENAI_PRESETS,
  isLocalhostBaseUrl,
  probeLocalOpenAIEndpoint,
  type LocalEndpointProbeResult,
} from '../../lib/provider/local_openai';
import { toast } from '../../lib/state/toast';
import { loadSettings, saveSettings } from '../../lib/settings/store';
import type { ModelStage } from '../../lib/settings/types';
import { V2ProviderCard } from './V2ProviderCard';
import { V2SettingsAdvanced } from './V2SettingsAdvanced';

const STAGE_META: { stage: ModelStage; label: string; role: 'primary' | 'critic' | 'embed' }[] = [
  { stage: 'drafting', label: 'Drafting', role: 'primary' },
  { stage: 'critic', label: 'Critic', role: 'critic' },
  { stage: 'synthesis', label: 'Template analysis', role: 'embed' },
  { stage: 'cleanup', label: 'Document cleanup', role: 'primary' },
  { stage: 'schema_edit', label: 'Template refinement', role: 'primary' },
];

export function V2SettingsView({ onOpenAudit = () => {} }: { onOpenAudit?: () => void }) {
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

  const providerOptions = useMemo(
    (): Array<{
      provider: ProviderId;
      mark: string;
      name: string;
      url: string;
      features: string[];
    }> =>
      [
        {
          provider: 'asksage' as ProviderId,
          mark: 'S',
          name: 'Ask Sage',
          url: 'api.asksage.health.mil',
          features: ['CUI', 'DHA tenant', 'RAG'],
        },
        {
          provider: 'openrouter' as ProviderId,
          mark: 'O',
          name: 'OpenRouter',
          url: 'openrouter.ai/api/v1',
          features: ['non-CUI', 'commercial'],
        },
        {
          provider: 'genai_mil' as ProviderId,
          mark: 'G',
          name: 'GenAI.mil',
          url: 'api.genai.mil/v1',
          features: ['STARK gateway', 'completion-only'],
        },
        {
          provider: 'local_openai' as ProviderId,
          mark: 'L',
          name: 'Local OpenAI',
          url: 'localhost / custom',
          features: ['non-CUI default', 'vLLM / Ollama / llama.cpp'],
        },
      ],
    [],
  );
  const providerRefs = useRef<Record<ProviderId, HTMLDivElement | null>>({
    asksage: null,
    openrouter: null,
    genai_mil: null,
    local_openai: null,
  });

  const [draftProvider, setDraftProvider] = useState<ProviderId>(provider);
  const [draftKey, setDraftKey] = useState(apiKey ?? '');
  const [draftBase, setDraftBase] = useState(baseUrl);
  const [localPresetId, setLocalPresetId] = useState<LocalPresetId>(() => localPresetIdForBase(baseUrl));
  const [showKey, setShowKey] = useState(false);

  const settings = useLiveQuery(() => loadSettings(), []);
  // Track only user-pending edits; derive the displayed value from the
  // persisted settings otherwise. A useEffect mirror of settings.models
  // would clobber in-flight edits every time Dexie re-emits.
  const [modelEdits, setModelEdits] = useState<Partial<Record<ModelStage, string>>>({});
  function modelValueFor(stage: ModelStage): string {
    if (modelEdits[stage] !== undefined) return modelEdits[stage] ?? '';
    return settings?.models?.[stage] ?? '';
  }

  const connection = useMemo(() => getProviderConnection({
    provider,
    apiKey,
    baseUrl,
    models,
    localProbe,
    error,
  }), [apiKey, baseUrl, error, localProbe, models, provider]);
  const draftConnection = useMemo(() => getProviderConnection({
    provider: draftProvider,
    apiKey: draftKey,
    baseUrl: draftBase,
    models: draftProvider === provider && draftBase.trim() === baseUrl ? models : null,
    localProbe,
    error: null,
  }), [baseUrl, draftBase, draftKey, draftProvider, localProbe, models, provider]);
  const canTestConnection = draftConnection.canValidate;
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

  async function onValidate(e: FormEvent) {
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
      toast.success(`Connected · ${list.length} models available`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setLocalProbe(null);
      toast.error('Connection failed — check base URL and key');
    } finally {
      setValidating(false);
    }
  }

  function onClear() {
    clear();
    setDraftKey('');
    toast.info('Stored API key cleared');
  }

  async function onSaveModels() {
    const patch = {
      models: {
        drafting: modelValueFor('drafting').trim() || undefined,
        critic: modelValueFor('critic').trim() || undefined,
        synthesis: modelValueFor('synthesis').trim() || undefined,
        cleanup: modelValueFor('cleanup').trim() || undefined,
        schema_edit: modelValueFor('schema_edit').trim() || undefined,
      },
    };
    await saveSettings(patch);
    setModelEdits({});
    toast.success('Model routing saved');
  }

  return (
    <div className="settings-wrap">
      <div className="settings-inner">
        <div className="settings-eyebrow">Settings</div>
        <h1 className="settings-title">Connection &amp; models</h1>
        <p className="settings-lead">
          Configure your AI provider, key, and per-stage model routing. Keys live in this
          browser's sessionStorage and are sent only to the configured provider. Scroll down for
          advanced quality, cost, and reset controls.
        </p>

        <div className="s-card">
          <div className="s-head">
            <div>
              <h3>Connection</h3>
              <div className="s-desc">{providerLabel(provider)}</div>
            </div>
            <span className={"s-status " + (connection.state === 'verified' ? '' : 'warn')}>
              <span className="d" />
              {connection.label}
            </span>
          </div>

          <form onSubmit={onValidate}>
            <div className="provider-cards" role="radiogroup" aria-label="AI provider">
              {providerOptions.map((opt, i) => (
                <V2ProviderCard
                  key={opt.provider}
                  provider={opt.provider}
                  mark={opt.mark}
                  name={opt.name}
                  url={opt.url}
                  features={opt.features}
                  selected={draftProvider === opt.provider}
                  onSelect={onPickProvider}
                  inputRef={(el) => { providerRefs.current[opt.provider] = el; }}
                  onArrowNav={(dir) => {
                    const step = dir === 'next' ? 1 : -1;
                    const target = providerOptions[(i + step + providerOptions.length) % providerOptions.length];
                    onPickProvider(target.provider);
                    providerRefs.current[target.provider]?.focus();
                  }}
                />
              ))}
            </div>

            {draftProvider === 'local_openai' && (
              <>
                <div className="s-row two">
                  <div className="s-field">
                    <label htmlFor="v2-settings-local-backend">Local backend</label>
                    <select
                      id="v2-settings-local-backend"
                      value={localPresetId}
                      onChange={(e) => onPickLocalPreset(e.target.value as LocalPresetId)}
                    >
                      {LOCAL_OPENAI_PRESETS.map((preset) => (
                        <option key={preset.id} value={preset.id}>{preset.name}</option>
                      ))}
                      <option value="custom">Custom</option>
                    </select>
                    <div className="hint">Most local backends do not require an API key.</div>
                  </div>
                  <div className="s-field">
                    <div className="hint" style={{ marginTop: 24 }}>
                      Local OpenAI is for non-CUI drafting experiments with vLLM,
                      Ollama, llama.cpp, LM Studio, or a trusted custom endpoint.
                    </div>
                  </div>
                </div>
                {showLocalPrivacyWarning && (
                  <div style={{ marginTop: 12, padding: 12, border: '1px solid var(--line-strong)', borderRadius: 6 }}>
                    <strong style={{ fontSize: 12 }}>Local endpoint privacy check</strong>
                    <div className="hint" style={{ marginTop: 4 }}>
                      This Local OpenAI URL is not a localhost address. Confirm it is an
                      intended non-CUI local or trusted server before sending document text.
                    </div>
                  </div>
                )}
              </>
            )}
            {draftProvider === 'genai_mil' && (
              <div style={{ marginTop: 12, padding: 12, border: '1px solid var(--line-strong)', borderRadius: 6 }}>
                <strong style={{ fontSize: 12 }}>Completion-only integration</strong>
                <div className="hint" style={{ marginTop: 4 }}>
                  The current STARK API supports models and chat completions but not tool
                  calling. Drafting will use prompt-only JSON generation and will not send
                  tools, tool_choice, datasets, live search, or embeddings.
                </div>
              </div>
            )}

            <div className="s-row two">
              <div className="s-field">
                <label htmlFor="v2-settings-api-key">API key</label>
                <div className="input-row">
                  <input
                    id="v2-settings-api-key"
                    className="mono"
                    type={showKey ? 'text' : 'password'}
                    value={draftKey}
                    onChange={(e) => setDraftKey(e.target.value)}
                    placeholder={draftProvider === 'local_openai' ? 'optional for most local backends' : 'paste your key here'}
                    autoComplete="off"
                    aria-label="API key"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((v) => !v)}
                    aria-label={showKey ? 'Hide API key' : 'Show API key'}
                    aria-pressed={showKey}
                  >
                    {showKey ? 'Hide' : 'Show'}
                  </button>
                </div>
                <div className="hint">
                  {draftProvider === 'local_openai'
                    ? 'Leave blank unless your custom local endpoint requires a key.'
                    : 'Stored in sessionStorage. Cleared when the tab closes.'}
                </div>
              </div>

              <div className="s-field">
                <label htmlFor="v2-settings-base-url">Base URL</label>
                <input
                  id="v2-settings-base-url"
                  className="mono"
                  type={draftProvider === 'genai_mil' ? 'text' : 'url'}
                  value={draftBase}
                  onChange={(e) => onDraftBaseChange(e.target.value)}
                  placeholder="https://api.asksage.health.mil"
                />
                <div className="hint">
                  {draftProvider === 'local_openai'
                    ? 'Include /v1 for OpenAI-compatible local backends.'
                    : 'Defaults to each provider\'s production endpoint.'}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button type="submit" className="btn btn-primary" disabled={isValidating || !canTestConnection}>
                {isValidating ? 'Testing…' : 'Test connection'}
              </button>
              <button type="button" className="btn" onClick={onClear} disabled={!apiKey}>
                Clear key
              </button>
              {error && (
                <span style={{ fontSize: 12, color: 'var(--rose)', alignSelf: 'center' }}>
                  {error}
                </span>
              )}
              {models && !error && (
                <span style={{ fontSize: 12, color: 'var(--sage)', alignSelf: 'center', fontFamily: 'var(--font-mono)' }}>
                  {models.length} models available
                </span>
              )}
            </div>
          </form>
          {visibleLocalProbe && (
            <LocalProbeSummary probe={visibleLocalProbe} />
          )}
        </div>

        <div className="s-card">
          <div className="s-head">
            <div>
              <h3>Models &amp; routing</h3>
              <div className="s-desc">
                {draftProvider === 'local_openai'
                  ? 'Local endpoints often expose sparse metadata; run endpoint check and verify tool support before routing recipes.'
                  : draftProvider === 'genai_mil'
                    ? 'GenAI.mil models are completion-only in the current STARK API; recipes run without native tools.'
                  : 'Pick a specific model per stage, or leave blank to use the compiled-in default.'}
              </div>
            </div>
          </div>
          {STAGE_META.map((s) => {
            const showLocalNeutralRouting = draftProvider === 'local_openai';
            const genAIModels = draftProvider === provider && draftProvider === 'genai_mil'
              ? models ?? []
              : [];
            const suggested = showLocalNeutralRouting
              ? ''
              : draftProvider === 'genai_mil'
                ? genAIModels[0]?.id ?? ''
                : defaultModelFor(draftProvider, s.stage);
            const modelHint = showLocalNeutralRouting
              ? 'local model selected in backend'
              : suggested
                ? `${draftProvider === 'openrouter' || draftProvider === 'genai_mil' ? 'suggested' : 'default'}: ${suggested}`
                : 'Connect to load available models';
            return (
              <div key={s.stage} className="model-row">
                <div>
                  <div className="mr-name">{s.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                    {modelHint}
                  </div>
                </div>
                <span className={"mr-role " + s.role}>{s.role}</span>
                {draftProvider === 'genai_mil' ? (
                  <select
                    className="mono"
                    style={{ width: 260, padding: '6px 9px', border: '1px solid var(--line-strong)', borderRadius: 6, fontSize: 12, fontFamily: 'var(--font-mono)' }}
                    value={modelValueFor(s.stage)}
                    onChange={(e) => setModelEdits((d) => ({ ...d, [s.stage]: e.target.value }))}
                    aria-label={`${s.label} model override`}
                    disabled={genAIModels.length === 0}
                  >
                    <option value="">
                      {genAIModels.length === 0 ? 'Connect to load models' : 'Select a model…'}
                    </option>
                    {genAIModels.map((model) => (
                      <option key={model.id} value={model.id}>{model.name || model.id}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    className="mono"
                    style={{ width: 260, padding: '6px 9px', border: '1px solid var(--line-strong)', borderRadius: 6, fontSize: 12, fontFamily: 'var(--font-mono)' }}
                    value={modelValueFor(s.stage)}
                    onChange={(e) => setModelEdits((d) => ({ ...d, [s.stage]: e.target.value }))}
                    placeholder={showLocalNeutralRouting ? 'local backend model' : suggested}
                    aria-label={`${s.label} model override`}
                  />
                )}
              </div>
            );
          })}
          {(draftProvider === 'openrouter' || draftProvider === 'genai_mil') && (
            <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 8 }}>
              This provider has no universal fallback — the suggestions above are just hints. Save an explicit model per stage before running a recipe.
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14, gap: 8 }}>
            <button
              className="btn"
              onClick={() => setModelEdits({
                drafting: '',
                critic: '',
                synthesis: '',
                cleanup: '',
                schema_edit: '',
              })}
            >
              Reset to defaults
            </button>
            <button className="btn btn-primary" onClick={onSaveModels}>Save routing</button>
          </div>
        </div>

        {settings && <V2SettingsAdvanced settings={settings} onOpenAudit={onOpenAudit} />}
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
    <div style={{ marginTop: 12, padding: 12, border: '1px solid var(--line-strong)', borderRadius: 6 }}>
      <strong style={{ fontSize: 12 }}>Endpoint check</strong>
      <div className="hint" style={{ marginTop: 4 }}>
        Verify local chat, tool, JSON, and embeddings behavior before using this backend.
      </div>
      <div className="pc-feats" style={{ marginTop: 8 }}>
        {rows.map((row) => (
          <span key={row.label}>{row.label}: {row.ok ? 'yes' : 'no'}</span>
        ))}
      </div>
      {probe.error && (
        <div className="hint" style={{ marginTop: 8, color: 'var(--rose)' }}>{probe.error}</div>
      )}
      {probe.warnings.length > 0 && (
        <ul className="hint" style={{ marginTop: 8, marginBottom: 0 }}>
          {probe.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

import { useState, useMemo, useRef, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/state/auth';
import { createLLMClient, defaultBaseUrlFor, defaultModelFor, providerLabel } from '../../lib/provider/factory';
import type { ProviderId } from '../../lib/provider/types';
import { toast } from '../../lib/state/toast';
import { loadSettings, saveSettings } from '../../lib/settings/store';
import type { ModelStage } from '../../lib/settings/types';
import { V2ProviderCard } from './V2ProviderCard';

const STAGE_META: { stage: ModelStage; label: string; role: 'primary' | 'critic' | 'embed' }[] = [
  { stage: 'drafting', label: 'Drafting', role: 'primary' },
  { stage: 'critic', label: 'Critic', role: 'critic' },
  { stage: 'synthesis', label: 'Template analysis', role: 'embed' },
];

export function V2SettingsView() {
  const navigate = useNavigate();
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

  const askSageCardRef = useRef<HTMLDivElement>(null);
  const openRouterCardRef = useRef<HTMLDivElement>(null);

  const [draftProvider, setDraftProvider] = useState<ProviderId>(provider);
  const [draftKey, setDraftKey] = useState(apiKey ?? '');
  const [draftBase, setDraftBase] = useState(baseUrl);
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

  const connectionStatus = useMemo<'connected' | 'unverified' | 'none'>(() => {
    if (!apiKey) return 'none';
    if (models && models.length > 0) return 'connected';
    return 'unverified';
  }, [apiKey, models]);

  function onPickProvider(next: ProviderId) {
    if (next === draftProvider) return;
    const wasOnDefault = draftBase.trim() === defaultBaseUrlFor(draftProvider);
    setDraftProvider(next);
    if (wasOnDefault) setDraftBase(defaultBaseUrlFor(next));
  }

  async function onValidate(e: FormEvent) {
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
      toast.success(`Connected · ${list.length} models available`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
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
          browser's sessionStorage and never leave the workstation. For privacy, usage, and reset
          controls, open the full settings surface.
        </p>

        <div className="s-card">
          <div className="s-head">
            <div>
              <h3>Connection</h3>
              <div className="s-desc">{providerLabel(provider)}</div>
            </div>
            <span className={"s-status " + (connectionStatus === 'connected' ? '' : 'warn')}>
              <span className="d" />
              {connectionStatus === 'connected' ? 'connected' : connectionStatus === 'unverified' ? 'key set · not verified' : 'no key'}
            </span>
          </div>

          <form onSubmit={onValidate}>
            <div className="provider-cards" role="radiogroup" aria-label="AI provider">
              <V2ProviderCard
                provider="asksage"
                mark="S"
                name="Ask Sage"
                url="api.asksage.health.mil"
                features={['CUI', 'DHA tenant', 'RAG']}
                selected={draftProvider === 'asksage'}
                onSelect={onPickProvider}
                inputRef={askSageCardRef}
                onArrowNav={() => {
                  onPickProvider('openrouter');
                  openRouterCardRef.current?.focus();
                }}
              />
              <V2ProviderCard
                provider="openrouter"
                mark="O"
                name="OpenRouter"
                url="openrouter.ai/api/v1"
                features={['non-CUI', 'commercial']}
                selected={draftProvider === 'openrouter'}
                onSelect={onPickProvider}
                inputRef={openRouterCardRef}
                onArrowNav={() => {
                  onPickProvider('asksage');
                  askSageCardRef.current?.focus();
                }}
              />
            </div>

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
                    placeholder="paste your key here"
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
                <div className="hint">Stored in sessionStorage. Cleared when the tab closes.</div>
              </div>

              <div className="s-field">
                <label>Base URL</label>
                <input
                  className="mono"
                  type="url"
                  value={draftBase}
                  onChange={(e) => setDraftBase(e.target.value)}
                  placeholder="https://api.asksage.health.mil"
                />
                <div className="hint">Defaults to each provider's production endpoint.</div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button type="submit" className="btn btn-primary" disabled={isValidating || !draftKey.trim()}>
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
        </div>

        <div className="s-card">
          <div className="s-head">
            <div>
              <h3>Models &amp; routing</h3>
              <div className="s-desc">Pick a specific model per stage, or leave blank to use the compiled-in default.</div>
            </div>
          </div>
          {STAGE_META.map((s) => {
            const suggested = defaultModelFor(draftProvider, s.stage);
            return (
              <div key={s.stage} className="model-row">
                <div>
                  <div className="mr-name">{s.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                    {draftProvider === 'openrouter' ? 'suggested: ' : 'default: '}{suggested}
                  </div>
                </div>
                <span className={"mr-role " + s.role}>{s.role}</span>
                <input
                  className="mono"
                  style={{ width: 260, padding: '6px 9px', border: '1px solid var(--line-strong)', borderRadius: 6, fontSize: 12, fontFamily: 'var(--font-mono)' }}
                  value={modelValueFor(s.stage)}
                  onChange={(e) => setModelEdits((d) => ({ ...d, [s.stage]: e.target.value }))}
                  placeholder={suggested}
                  aria-label={`${s.label} model override`}
                />
              </div>
            );
          })}
          {draftProvider === 'openrouter' && (
            <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 8 }}>
              OpenRouter has no universal fallback — the suggestions above are just hints. Save an explicit model per stage before running a recipe.
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14, gap: 8 }}>
            <button
              className="btn"
              onClick={() => setModelEdits({ drafting: '', critic: '', synthesis: '' })}
            >
              Reset to defaults
            </button>
            <button className="btn btn-primary" onClick={onSaveModels}>Save routing</button>
          </div>
        </div>

        <div className="s-card">
          <div className="s-head">
            <div>
              <h3>Advanced</h3>
              <div className="s-desc">Critic loop, cost caps, privacy controls, audit export, data reset.</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-primary" onClick={() => navigate('/settings')}>
              Open full settings →
            </button>
            <button className="btn" onClick={() => navigate('/audit')}>
              Open audit log →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

import { useState, useEffect, useMemo, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/state/auth';
import { createLLMClient, defaultBaseUrlFor, providerLabel } from '../../lib/provider/factory';
import type { ProviderId } from '../../lib/provider/types';
import { toast } from '../../lib/state/toast';
import { loadSettings, saveSettings } from '../../lib/settings/store';
import { DEFAULT_MODEL_OVERRIDES, type ModelStage } from '../../lib/settings/types';
import { DEFAULT_DRAFTING_MODEL } from '../../lib/draft/drafter';
import { DEFAULT_SYNTHESIS_MODEL } from '../../lib/template/synthesis/synthesize';

const STAGES: { stage: ModelStage; label: string; role: 'primary' | 'critic' | 'embed'; default: string }[] = [
  { stage: 'drafting', label: 'Drafting', role: 'primary', default: DEFAULT_DRAFTING_MODEL },
  { stage: 'critic', label: 'Critic', role: 'critic', default: DEFAULT_DRAFTING_MODEL },
  { stage: 'synthesis', label: 'Template analysis', role: 'embed', default: DEFAULT_SYNTHESIS_MODEL },
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

  const [draftProvider, setDraftProvider] = useState<ProviderId>(provider);
  const [draftKey, setDraftKey] = useState(apiKey ?? '');
  const [draftBase, setDraftBase] = useState(baseUrl);
  const [showKey, setShowKey] = useState(false);

  const settings = useLiveQuery(() => loadSettings(), []);
  const [modelDrafts, setModelDrafts] = useState<Record<string, string>>({});
  useEffect(() => {
    if (settings?.models) {
      setModelDrafts({
        drafting: settings.models.drafting ?? '',
        critic: settings.models.critic ?? '',
        synthesis: settings.models.synthesis ?? '',
      });
    }
  }, [settings]);

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
        drafting: modelDrafts.drafting?.trim() || undefined,
        critic: modelDrafts.critic?.trim() || undefined,
        synthesis: modelDrafts.synthesis?.trim() || undefined,
      },
    };
    await saveSettings(patch);
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
            <div className="provider-cards">
              <div
                className={"provider-card" + (draftProvider === 'asksage' ? ' on' : '')}
                onClick={() => onPickProvider('asksage')}
                role="button"
                tabIndex={0}
              >
                <div className="pc-head">
                  <span className="pc-mark">S</span>
                  <div>
                    <div className="pc-name">Ask Sage</div>
                    <div className="pc-url">api.asksage.health.mil</div>
                  </div>
                </div>
                <div className="pc-feats">
                  <span>CUI</span><span>DHA tenant</span><span>RAG</span>
                </div>
              </div>
              <div
                className={"provider-card" + (draftProvider === 'openrouter' ? ' on' : '')}
                onClick={() => onPickProvider('openrouter')}
                role="button"
                tabIndex={0}
              >
                <div className="pc-head">
                  <span className="pc-mark">O</span>
                  <div>
                    <div className="pc-name">OpenRouter</div>
                    <div className="pc-url">openrouter.ai/api/v1</div>
                  </div>
                </div>
                <div className="pc-feats">
                  <span>non-CUI</span><span>commercial</span>
                </div>
              </div>
            </div>

            <div className="s-row two">
              <div className="s-field">
                <label>API key</label>
                <div className="input-row">
                  <input
                    className="mono"
                    type={showKey ? 'text' : 'password'}
                    value={draftKey}
                    onChange={(e) => setDraftKey(e.target.value)}
                    placeholder="paste your key here"
                    autoComplete="off"
                  />
                  <button type="button" onClick={() => setShowKey((v) => !v)}>
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
          {STAGES.map((s) => (
            <div key={s.stage} className="model-row">
              <div>
                <div className="mr-name">{s.label}</div>
                <div style={{ fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                  default: {s.default}
                </div>
              </div>
              <span className={"mr-role " + s.role}>{s.role}</span>
              <input
                className="mono"
                style={{ width: 260, padding: '6px 9px', border: '1px solid var(--line-strong)', borderRadius: 6, fontSize: 12, fontFamily: 'var(--font-mono)' }}
                value={modelDrafts[s.stage] ?? ''}
                onChange={(e) => setModelDrafts((d) => ({ ...d, [s.stage]: e.target.value }))}
                placeholder={s.default}
              />
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14, gap: 8 }}>
            <button
              className="btn"
              onClick={() => setModelDrafts({
                drafting: '',
                critic: '',
                synthesis: DEFAULT_MODEL_OVERRIDES.synthesis ?? '',
              })}
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

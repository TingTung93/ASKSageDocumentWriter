import { create } from 'zustand';
import type { ModelInfo } from '../asksage/types';
import { defaultBaseUrlFor } from '../provider/factory';
import type { LocalEndpointProbeResult } from '../provider/local_openai';
import type { ProviderId } from '../provider/types';
import { getProviderConnection } from '../provider/connection';

// Phase 0: API key lives in memory + sessionStorage for tab-refresh
// tolerance. Encrypted IndexedDB persistence (with a user passphrase via
// WebCrypto) is its own piece — deferred until the UX trade-off is
// validated with the user (PRD §11 open question 5).

const SESSION_KEY_API = 'asksage:apiKey';
const SESSION_KEY_BASE = 'asksage:baseUrl';
const SESSION_KEY_PROVIDER = 'asksage:provider';
const SESSION_KEY_MODELS = 'asksage:models';
const SESSION_KEY_LOCAL_PROBE = 'asksage:localProbe';

function readSession(name: string): string | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    return sessionStorage.getItem(name);
  } catch {
    return null;
  }
}

function writeSession(name: string, value: string | null): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    if (value === null) sessionStorage.removeItem(name);
    else sessionStorage.setItem(name, value);
  } catch {
    /* sessionStorage may be unavailable on file:// in some browsers */
  }
}

function readSessionJson<T>(name: string, validate: (value: unknown) => value is T): T | null {
  const raw = readSession(name);
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return validate(value) ? value : null;
  } catch {
    return null;
  }
}

function writeSessionJson(name: string, value: unknown | null): void {
  writeSession(name, value === null ? null : JSON.stringify(value));
}

function isModelInfoList(value: unknown): value is ModelInfo[] {
  return Array.isArray(value) && value.every((model) =>
    model !== null &&
    typeof model === 'object' &&
    typeof (model as { id?: unknown }).id === 'string'
  );
}

function isLocalProbe(value: unknown): value is LocalEndpointProbeResult {
  if (value === null || typeof value !== 'object') return false;
  const probe = value as Partial<LocalEndpointProbeResult>;
  return (
    typeof probe.ok === 'boolean' &&
    typeof probe.baseUrl === 'string' &&
    (probe.model === null || typeof probe.model === 'string') &&
    probe.capabilities !== null &&
    typeof probe.capabilities === 'object' &&
    Array.isArray(probe.warnings)
  );
}

function normalizeApiKey(apiKey: string | null): string | null {
  return apiKey === null || apiKey.trim() === '' ? null : apiKey;
}

function readProvider(): ProviderId {
  const raw = readSession(SESSION_KEY_PROVIDER);
  if (raw === 'genai_mil') return 'genai_mil';
  if (raw === 'local_openai') return 'local_openai';
  return raw === 'openrouter' ? 'openrouter' : 'asksage';
}

function readBaseUrl(provider: ProviderId): string {
  const stored = readSession(SESSION_KEY_BASE);
  if (
    provider === 'genai_mil' &&
    stored?.replace(/\/$/, '') === 'https://api.genai.mil/v1'
  ) {
    const proxyUrl = defaultBaseUrlFor(provider);
    writeSession(SESSION_KEY_BASE, proxyUrl);
    return proxyUrl;
  }
  return stored ?? defaultBaseUrlFor(provider);
}

export interface AuthState {
  provider: ProviderId;
  apiKey: string | null;
  baseUrl: string;
  models: ModelInfo[] | null;
  localProbe: LocalEndpointProbeResult | null;
  isValidating: boolean;
  error: string | null;

  setProvider: (provider: ProviderId) => void;
  setApiKey: (key: string | null) => void;
  setBaseUrl: (url: string) => void;
  setModels: (models: ModelInfo[] | null) => void;
  setLocalProbe: (probe: LocalEndpointProbeResult | null) => void;
  setValidating: (v: boolean) => void;
  setError: (msg: string | null) => void;
  clear: () => void;
}

export function getAuthConnection(state: Pick<
  AuthState,
  'provider' | 'apiKey' | 'baseUrl' | 'models' | 'localProbe' | 'error'
>) {
  return getProviderConnection(state);
}

const initialProvider = readProvider();

export const useAuth = create<AuthState>((set, get) => ({
  provider: initialProvider,
  apiKey: normalizeApiKey(readSession(SESSION_KEY_API)),
  baseUrl: readBaseUrl(initialProvider),
  models: readSessionJson(SESSION_KEY_MODELS, isModelInfoList),
  localProbe: readSessionJson(SESSION_KEY_LOCAL_PROBE, isLocalProbe),
  isValidating: false,
  error: null,

  setProvider: (provider) => {
    writeSession(SESSION_KEY_PROVIDER, provider);
    // When switching providers, clear stale models + error and reset
    // the base URL to the new provider's default ONLY if the user was
    // still on the old default. Custom URLs are preserved.
    const prev = get();
    const wasOnDefault = prev.baseUrl === defaultBaseUrlFor(prev.provider);
    const nextBaseUrl = wasOnDefault ? defaultBaseUrlFor(provider) : prev.baseUrl;
    if (wasOnDefault) writeSession(SESSION_KEY_BASE, nextBaseUrl);
    writeSessionJson(SESSION_KEY_MODELS, null);
    writeSessionJson(SESSION_KEY_LOCAL_PROBE, null);
    set({
      provider,
      baseUrl: nextBaseUrl,
      models: null,
      localProbe: null,
      error: null,
    });
  },
  setApiKey: (apiKey) => {
    const nextApiKey = normalizeApiKey(apiKey);
    writeSession(SESSION_KEY_API, nextApiKey);
    set({ apiKey: nextApiKey });
  },
  setBaseUrl: (baseUrl) => {
    writeSession(SESSION_KEY_BASE, baseUrl);
    writeSessionJson(SESSION_KEY_LOCAL_PROBE, null);
    set({ baseUrl, localProbe: null });
  },
  setModels: (models) => {
    writeSessionJson(SESSION_KEY_MODELS, models);
    set({ models });
  },
  setLocalProbe: (localProbe) => {
    writeSessionJson(SESSION_KEY_LOCAL_PROBE, localProbe);
    set({ localProbe });
  },
  setValidating: (isValidating) => set({ isValidating }),
  setError: (error) => set({ error }),
  clear: () => {
    writeSession(SESSION_KEY_API, null);
    writeSessionJson(SESSION_KEY_MODELS, null);
    writeSessionJson(SESSION_KEY_LOCAL_PROBE, null);
    set({ apiKey: null, models: null, localProbe: null, error: null, isValidating: false });
  },
}));

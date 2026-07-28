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

function normalizeApiKey(apiKey: string | null): string | null {
  return apiKey === null || apiKey.trim() === '' ? null : apiKey;
}

function readProvider(): ProviderId {
  const raw = readSession(SESSION_KEY_PROVIDER);
  if (raw === 'genai_mil') return 'genai_mil';
  if (raw === 'local_openai') return 'local_openai';
  return raw === 'openrouter' ? 'openrouter' : 'asksage';
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

export const useAuth = create<AuthState>((set, get) => ({
  provider: readProvider(),
  apiKey: normalizeApiKey(readSession(SESSION_KEY_API)),
  baseUrl: readSession(SESSION_KEY_BASE) ?? defaultBaseUrlFor(readProvider()),
  models: null,
  localProbe: null,
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
    set({ baseUrl, localProbe: null });
  },
  setModels: (models) => set({ models }),
  setLocalProbe: (localProbe) => set({ localProbe }),
  setValidating: (isValidating) => set({ isValidating }),
  setError: (error) => set({ error }),
  clear: () => {
    writeSession(SESSION_KEY_API, null);
    set({ apiKey: null, models: null, localProbe: null, error: null, isValidating: false });
  },
}));

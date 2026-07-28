import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelInfo } from '../asksage/types';
import type { LocalEndpointProbeResult } from '../provider/local_openai';

const SESSION_KEY_API = 'asksage:apiKey';
const SESSION_KEY_BASE = 'asksage:baseUrl';
const SESSION_KEY_PROVIDER = 'asksage:provider';

async function loadAuth() {
  const mod = await import('./auth');
  return mod.useAuth;
}

function probeResult(): LocalEndpointProbeResult {
  return {
    ok: true,
    baseUrl: 'http://localhost:11434/v1',
    model: 'qwen3:14b',
    capabilities: {
      models: true,
      chat: true,
      tools: false,
      jsonOutput: true,
      embeddings: false,
    },
    warnings: [],
  };
}

describe('auth state local provider support', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.resetModules();
  });

  it('reads local_openai from sessionStorage', async () => {
    sessionStorage.setItem(SESSION_KEY_PROVIDER, 'local_openai');

    const useAuth = await loadAuth();

    expect(useAuth.getState().provider).toBe('local_openai');
    expect(useAuth.getState().baseUrl).toBe('http://localhost:11434/v1');
  });

  it('reads genai_mil from sessionStorage', async () => {
    sessionStorage.setItem(SESSION_KEY_PROVIDER, 'genai_mil');

    const useAuth = await loadAuth();

    expect(useAuth.getState().provider).toBe('genai_mil');
    expect(useAuth.getState().baseUrl).toBe('/api/genai/v1');
  });

  it('migrates the old direct GenAI.mil URL to the same-origin proxy', async () => {
    sessionStorage.setItem(SESSION_KEY_PROVIDER, 'genai_mil');
    sessionStorage.setItem(SESSION_KEY_BASE, 'https://api.genai.mil/v1');

    const useAuth = await loadAuth();

    expect(useAuth.getState().baseUrl).toBe('/api/genai/v1');
    expect(sessionStorage.getItem(SESSION_KEY_BASE)).toBe('/api/genai/v1');
  });

  it('switching to local_openai uses the Ollama default if the old URL was default', async () => {
    sessionStorage.setItem(SESSION_KEY_PROVIDER, 'openrouter');
    sessionStorage.setItem(SESSION_KEY_BASE, 'https://openrouter.ai/api/v1');
    const useAuth = await loadAuth();

    useAuth.getState().setProvider('local_openai');

    expect(useAuth.getState().provider).toBe('local_openai');
    expect(useAuth.getState().baseUrl).toBe('http://localhost:11434/v1');
    expect(sessionStorage.getItem(SESSION_KEY_BASE)).toBe('http://localhost:11434/v1');
  });

  it('setApiKey stores an empty string as null', async () => {
    const useAuth = await loadAuth();

    useAuth.getState().setApiKey('');

    expect(useAuth.getState().apiKey).toBeNull();
    expect(sessionStorage.getItem(SESSION_KEY_API)).toBeNull();
  });

  it('setApiKey stores whitespace as null', async () => {
    const useAuth = await loadAuth();

    useAuth.getState().setApiKey('   ');

    expect(useAuth.getState().apiKey).toBeNull();
    expect(sessionStorage.getItem(SESSION_KEY_API)).toBeNull();
  });

  it('hydrates a whitespace session API key as null', async () => {
    sessionStorage.setItem(SESSION_KEY_API, '   ');

    const useAuth = await loadAuth();

    expect(useAuth.getState().apiKey).toBeNull();
  });

  it('setLocalProbe stores a probe result and clear removes it', async () => {
    const useAuth = await loadAuth();
    const probe = probeResult();

    useAuth.getState().setLocalProbe(probe);

    expect(useAuth.getState().localProbe).toEqual(probe);

    useAuth.getState().clear();

    expect(useAuth.getState().localProbe).toBeNull();
    expect(sessionStorage.getItem('asksage:localProbe')).toBeNull();
  });

  it('persists and rehydrates non-secret model and local verification metadata', async () => {
    const useAuth = await loadAuth();
    const models: ModelInfo[] = [{
      id: 'Qwen2.5-14B-Instruct-AWQ',
      name: 'Qwen',
      object: 'model',
      owned_by: 'vllm',
      created: '1',
    }];
    const probe = probeResult();

    useAuth.getState().setModels(models);
    useAuth.getState().setLocalProbe(probe);

    expect(JSON.parse(sessionStorage.getItem('asksage:models') ?? 'null')).toEqual(models);
    expect(JSON.parse(sessionStorage.getItem('asksage:localProbe') ?? 'null')).toEqual(probe);

    vi.resetModules();
    const reloadedAuth = await loadAuth();
    expect(reloadedAuth.getState().models).toEqual(models);
    expect(reloadedAuth.getState().localProbe).toEqual(probe);
  });

  it('setProvider clears the local probe result', async () => {
    const useAuth = await loadAuth();
    useAuth.getState().setLocalProbe(probeResult());

    useAuth.getState().setProvider('local_openai');

    expect(useAuth.getState().localProbe).toBeNull();
    expect(sessionStorage.getItem('asksage:localProbe')).toBeNull();
    expect(sessionStorage.getItem('asksage:models')).toBeNull();
  });

  it('setBaseUrl clears the local probe result', async () => {
    const useAuth = await loadAuth();
    useAuth.getState().setLocalProbe(probeResult());

    useAuth.getState().setBaseUrl('http://localhost:1234/v1');

    expect(useAuth.getState().localProbe).toBeNull();
    expect(sessionStorage.getItem('asksage:localProbe')).toBeNull();
  });
});

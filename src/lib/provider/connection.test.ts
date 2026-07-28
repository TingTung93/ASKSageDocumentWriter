import { describe, expect, it } from 'vitest';
import type { ModelInfo } from '../asksage/types';
import type { LocalEndpointProbeResult } from './local_openai';
import type { ProviderId } from './types';
import { getProviderConnection, type ProviderConnectionInput } from './connection';

const model = { id: 'model-1', name: 'Model 1' } as ModelInfo;

function input(patch: Partial<ProviderConnectionInput> = {}): ProviderConnectionInput {
  return {
    provider: 'asksage',
    apiKey: null,
    baseUrl: 'https://example.test/v1',
    models: null,
    localProbe: null,
    error: null,
    ...patch,
  };
}

function probe(patch: Partial<LocalEndpointProbeResult> = {}): LocalEndpointProbeResult {
  return {
    ok: true,
    baseUrl: 'http://localhost:11434/v1',
    model: 'model-1',
    capabilities: {
      models: true,
      chat: true,
      tools: true,
      jsonOutput: true,
      embeddings: false,
    },
    warnings: [],
    ...patch,
  };
}

describe('getProviderConnection', () => {
  it.each<ProviderId>(['asksage', 'openrouter', 'genai_mil'])(
    'requires a non-blank key for %s',
    (provider) => {
      const summary = getProviderConnection(input({ provider, apiKey: '  ' }));
      expect(summary).toMatchObject({
        state: 'not_configured',
        requiresApiKey: true,
        canValidate: false,
        canGenerate: false,
      });
    },
  );

  it.each<ProviderId>(['asksage', 'openrouter', 'genai_mil'])(
    'distinguishes configured, verified, and failed states for %s',
    (provider) => {
      expect(getProviderConnection(input({ provider, apiKey: 'key' })))
        .toMatchObject({ state: 'configured_unverified', canGenerate: true });
      expect(getProviderConnection(input({ provider, apiKey: 'key', models: [model] })))
        .toMatchObject({ state: 'verified', canGenerate: true });
      expect(getProviderConnection(input({ provider, apiKey: 'key', error: 'denied' })))
        .toMatchObject({ state: 'verification_failed', canGenerate: false });
    },
  );

  it('allows a verified keyless local provider to generate', () => {
    expect(getProviderConnection(input({
      provider: 'local_openai',
      baseUrl: 'http://localhost:11434/v1',
      models: [model],
      localProbe: probe(),
    }))).toMatchObject({
      state: 'verified',
      requiresApiKey: false,
      canValidate: true,
      canGenerate: true,
    });
  });

  it('does not treat models alone as verified for a local provider', () => {
    expect(getProviderConnection(input({
      provider: 'local_openai',
      baseUrl: 'http://localhost:11434/v1',
      models: [model],
    }))).toMatchObject({ state: 'configured_unverified', canGenerate: false });
  });

  it('invalidates a successful local probe after the base URL changes', () => {
    expect(getProviderConnection(input({
      provider: 'local_openai',
      baseUrl: 'http://localhost:1234/v1',
      models: [model],
      localProbe: probe(),
    }))).toMatchObject({ state: 'configured_unverified', canGenerate: false });
  });

  it('accepts insignificant trailing slashes when matching a local probe', () => {
    expect(getProviderConnection(input({
      provider: 'local_openai',
      baseUrl: 'http://localhost:11434/v1/',
      models: [model],
      localProbe: probe(),
    }))).toMatchObject({ state: 'verified', canGenerate: true });
  });

  it('reports failed local verification', () => {
    expect(getProviderConnection(input({
      provider: 'local_openai',
      baseUrl: 'http://localhost:11434/v1',
      models: [model],
      localProbe: probe({ ok: false, error: 'offline' }),
    }))).toMatchObject({ state: 'verification_failed', canGenerate: false });
  });

  it('treats an empty model result as known but unusable', () => {
    expect(getProviderConnection(input({ apiKey: 'key', models: [] }))).toMatchObject({
      state: 'configured_unverified',
      label: 'no models available',
      canGenerate: false,
    });
  });
});

import type { ModelInfo } from '../asksage/types';
import type { LocalEndpointProbeResult } from './local_openai';
import type { ProviderId } from './types';

export type ProviderConnectionState =
  | 'not_configured'
  | 'configured_unverified'
  | 'verified'
  | 'verification_failed';

export interface ProviderConnectionInput {
  provider: ProviderId;
  apiKey: string | null;
  baseUrl: string;
  models: ModelInfo[] | null;
  localProbe: LocalEndpointProbeResult | null;
  error: string | null;
}

export interface ProviderConnectionSummary {
  state: ProviderConnectionState;
  requiresApiKey: boolean;
  canValidate: boolean;
  canGenerate: boolean;
  label: string;
}

export function getProviderConnection(
  input: ProviderConnectionInput,
): ProviderConnectionSummary {
  const requiresApiKey = input.provider !== 'local_openai';
  const hasKey = Boolean(input.apiKey?.trim());
  const hasBaseUrl = Boolean(input.baseUrl.trim());
  const canValidate = hasBaseUrl && (!requiresApiKey || hasKey);
  const hasModels = input.models !== null && input.models.length > 0;

  if (requiresApiKey && !hasKey) {
    return {
      state: 'not_configured',
      requiresApiKey,
      canValidate: false,
      canGenerate: false,
      label: 'no key',
    };
  }

  if (input.provider === 'local_openai') {
    const probeMatches =
      input.localProbe !== null &&
      normalizeBaseUrl(input.localProbe.baseUrl) === normalizeBaseUrl(input.baseUrl);
    const probeSucceeded = probeMatches && input.localProbe?.ok === true;

    if ((probeMatches && input.localProbe?.ok === false) || input.error) {
      return {
        state: 'verification_failed',
        requiresApiKey,
        canValidate,
        canGenerate: false,
        label: 'verification failed',
      };
    }

    if (probeSucceeded && hasModels) {
      return {
        state: 'verified',
        requiresApiKey,
        canValidate,
        canGenerate: true,
        label: 'connected',
      };
    }

    return {
      state: 'configured_unverified',
      requiresApiKey,
      canValidate,
      canGenerate: false,
      label: probeSucceeded ? 'no models available' : 'not verified',
    };
  }

  if (input.error) {
    return {
      state: 'verification_failed',
      requiresApiKey,
      canValidate,
      canGenerate: false,
      label: 'verification failed',
    };
  }

  if (hasModels) {
    return {
      state: 'verified',
      requiresApiKey,
      canValidate,
      canGenerate: true,
      label: 'connected',
    };
  }

  return {
    state: 'configured_unverified',
    requiresApiKey,
    canValidate,
    // Model discovery is session-only. A persisted remote credential must
    // remain usable after refresh even though the model list has not been
    // fetched again; the provider call will still surface an invalid key.
    canGenerate: input.models === null,
    label: input.models === null ? 'key set · not verified' : 'no models available',
  };
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

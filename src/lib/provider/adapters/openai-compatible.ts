import { LocalOpenAIClient } from '../local_openai';
import type { PortableProviderIdentity } from '../portable-types';
import { LegacyLLMPortableAdapter } from './legacy-llm';

export interface OpenAICompatibleProfile {
  id: string;
  displayName: string;
  baseUrl: string;
  apiKey?: string;
  local: boolean;
  timeoutMs?: number;
}

export class OpenAICompatiblePortableAdapter extends LegacyLLMPortableAdapter {
  constructor(profile: OpenAICompatibleProfile, fetchImpl?: typeof fetch) {
    const identity: PortableProviderIdentity = {
      providerId: profile.id,
      displayName: profile.displayName,
      endpoint: normalizeOpenAIBaseUrl(profile.baseUrl),
      local: profile.local,
    };
    super(
      new LocalOpenAIClient(
        identity.endpoint!,
        profile.apiKey ?? '',
        fetchImpl,
        profile.timeoutMs,
      ),
      identity,
    );
  }
}

export function normalizeOpenAIBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (!trimmed) throw new Error('OpenAI-compatible base URL is required.');
  return trimmed;
}

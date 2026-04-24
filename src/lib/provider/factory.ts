// Factory for the LLM client based on the active provider in auth state.
//
// Routes that only need completion-side methods (synthesis, refine,
// document cleanup) should use `createLLMClient(state)` and the
// returned `LLMClient` interface. Routes that need Ask-Sage-only
// features (datasets, file ingest, training, monthly token count)
// should construct `AskSageClient` directly AND only do so when
// `state.provider === 'asksage'` — guard the affordance in the UI.

import { AskSageClient } from '../asksage/client';
import { OpenRouterClient } from './openrouter';
import type { LLMClient, ProviderId } from './types';
import type { ModelStage } from '../settings/types';

export interface ProviderState {
  provider: ProviderId;
  baseUrl: string;
  apiKey: string;
}

/** Build the right client for the active provider. */
export function createLLMClient(state: ProviderState): LLMClient {
  if (state.provider === 'openrouter') {
    return new OpenRouterClient(state.apiKey, state.baseUrl);
  }
  return new AskSageClient(state.baseUrl, state.apiKey);
}

/**
 * Default base URL for each provider. Used to seed the connection
 * form when the user toggles between providers.
 */
export function defaultBaseUrlFor(provider: ProviderId): string {
  switch (provider) {
    case 'openrouter':
      return 'https://openrouter.ai/api/v1';
    case 'asksage':
    default:
      return 'https://api.asksage.health.mil';
  }
}

/** Human-readable label for UI. */
export function providerLabel(provider: ProviderId): string {
  switch (provider) {
    case 'openrouter':
      return 'OpenRouter (commercial — non-CUI only)';
    case 'asksage':
    default:
      return 'Ask Sage (DHA health.mil tenant — CUI authorized)';
  }
}

// Ask Sage tenant defaults and OpenRouter suggestions shown in the
// Settings UI as placeholder/"default" hints. These are UI-only: the
// runtime resolver (resolve_model.ts) still refuses to pick an
// OpenRouter id without an explicit override, so nothing is silently
// wired up. The OpenRouter suggestions are stable, widely available
// ids that users can accept or change.
const ASK_SAGE_DRAFTING_DEFAULT = 'google-claude-46-sonnet';
const ASK_SAGE_SYNTHESIS_DEFAULT = 'google-claude-46-sonnet';
const OPENROUTER_DRAFTING_SUGGESTION = 'anthropic/claude-sonnet-4.5';
const OPENROUTER_SYNTHESIS_SUGGESTION = 'anthropic/claude-sonnet-4.5';

/** Model id shown as the "default" hint in Settings for a given stage. */
export function defaultModelFor(provider: ProviderId, stage: ModelStage): string {
  if (provider === 'openrouter') {
    return stage === 'synthesis'
      ? OPENROUTER_SYNTHESIS_SUGGESTION
      : OPENROUTER_DRAFTING_SUGGESTION;
  }
  return stage === 'synthesis' ? ASK_SAGE_SYNTHESIS_DEFAULT : ASK_SAGE_DRAFTING_DEFAULT;
}

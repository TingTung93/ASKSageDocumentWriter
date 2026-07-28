// Factory for the LLM client based on the active provider in auth state.
//
// Routes that only need completion-side methods (synthesis, refine,
// document cleanup) should use `createLLMClient(state)` and the
// returned `LLMClient` interface. Routes that need Ask-Sage-only
// features (datasets, file ingest, training, monthly token count)
// should construct `AskSageClient` directly AND only do so when
// `state.provider === 'asksage'` — guard the affordance in the UI.

import { AskSageClient } from '../asksage/client';
import { GENAI_MIL_DEFAULT_BASE_URL, GenAIMilClient } from './genai_mil';
import { LocalOpenAIClient } from './local_openai';
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
  if (state.provider === 'genai_mil') {
    return new GenAIMilClient(state.baseUrl, state.apiKey);
  }
  if (state.provider === 'local_openai') {
    return new LocalOpenAIClient(state.baseUrl, state.apiKey);
  }
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
    case 'genai_mil':
      return GENAI_MIL_DEFAULT_BASE_URL;
    case 'local_openai':
      return 'http://localhost:11434/v1';
    case 'openrouter':
      return 'https://openrouter.ai/api/v1';
    case 'asksage':
      return 'https://api.asksage.health.mil';
  }
}

/** Human-readable label for UI. */
export function providerLabel(provider: ProviderId): string {
  switch (provider) {
    case 'genai_mil':
      return 'GenAI.mil (STARK gateway — no tool calling)';
    case 'local_openai':
      return 'Local OpenAI-compatible (vLLM, Ollama, llama.cpp, LM Studio — non-CUI only)';
    case 'openrouter':
      return 'OpenRouter (commercial — non-CUI only)';
    case 'asksage':
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
const LOCAL_OPENAI_STRONG_DEFAULT = 'qwen3:14b';
const LOCAL_OPENAI_FAST_DEFAULT = 'qwen3:8b';

/** Model id shown as the "default" hint in Settings for a given stage. */
export function defaultModelFor(provider: ProviderId, stage: ModelStage): string {
  if (provider === 'local_openai') {
    return stage === 'cleanup' || stage === 'schema_edit'
      ? LOCAL_OPENAI_FAST_DEFAULT
      : LOCAL_OPENAI_STRONG_DEFAULT;
  }
  if (provider === 'openrouter' || provider === 'genai_mil') {
    return stage === 'synthesis'
      ? OPENROUTER_SYNTHESIS_SUGGESTION
      : OPENROUTER_DRAFTING_SUGGESTION;
  }
  return stage === 'synthesis' ? ASK_SAGE_SYNTHESIS_DEFAULT : ASK_SAGE_DRAFTING_DEFAULT;
}

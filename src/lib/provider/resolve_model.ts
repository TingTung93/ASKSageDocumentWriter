// Provider-aware model id resolution.
//
// Every drafting-chain function used to fall back to a hardcoded
// `'google-claude-46-sonnet'` when no override was supplied. That id
// is valid on the Ask Sage health.mil tenant but throws a 400 on
// OpenRouter, which makes the recipe runner unusable on OpenRouter
// even after the type system was widened to LLMClient.
//
// resolveDraftingModel centralizes the fallback logic:
//
//   1. Explicit override (caller's `options.model`) wins.
//   2. Settings override (`settings.models.drafting`) wins next.
//   3. If the client supports Ask Sage features, fall back to the
//      Ask Sage default model id.
//   4. Otherwise (OpenRouter and friends) throw a clear error telling
//      the user to set the per-stage model on the Settings tab. We
//      refuse to guess at an OpenRouter model id because the catalog
//      shifts and there is no safe universal default.
//
// Used by drafter.ts, metadata_batch.ts, preflight.ts. Cross-section
// review and critique already accept an explicit model from the
// orchestrator, so they don't go through this helper.

import type { LLMClient } from './types';
import { loadSettings } from '../settings/store';
import type { ModelStage } from '../settings/types';

/** Default model id on the Ask Sage health.mil tenant. */
export const ASK_SAGE_DEFAULT_DRAFTING_MODEL = 'google-claude-46-sonnet';

/**
 * Resolve a model id for a drafting-chain stage. Throws when no
 * override is set on a non-Ask-Sage provider — there is no safe
 * universal default outside of the gov tenant.
 */
export async function resolveDraftingModel(
  client: LLMClient,
  explicitOverride: string | null | undefined,
  stage: ModelStage = 'drafting',
): Promise<string> {
  if (explicitOverride && explicitOverride.trim().length > 0) {
    return explicitOverride;
  }
  let settingsOverride: string | null = null;
  try {
    const settings = await loadSettings();
    settingsOverride = settings.models?.[stage] ?? null;
  } catch {
    // Settings table may be unavailable in tests; fall through.
  }
  if (settingsOverride && settingsOverride.trim().length > 0) {
    return settingsOverride;
  }
  // Ask Sage has a single well-known default; OpenRouter does not.
  // We use the dataset capability as a proxy for "this is the gov
  // tenant" because OpenRouter has neither datasets nor a stable
  // catalog default.
  if (client.capabilities.dataset) {
    return ASK_SAGE_DEFAULT_DRAFTING_MODEL;
  }
  throw new Error(
    `No model id configured for stage "${stage}" on this provider. Set a model on the Settings tab (Models → ${stage}) — OpenRouter does not have a safe default.`,
  );
}

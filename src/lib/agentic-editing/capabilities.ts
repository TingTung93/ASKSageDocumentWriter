import type { ModelInfo } from '../asksage/types';
import type { LLMClient } from '../provider/types';
import type { AgentCapabilities, CapabilityEvidence } from './types';

/**
 * Resolve the execution features available for one turn. Provider flags are
 * the baseline; model metadata can only narrow a provider capability. This
 * prevents a gateway such as GenAI.mil from ever receiving a tools payload.
 */
export function resolveAgentCapabilities(
  client: LLMClient,
  model?: ModelInfo,
): AgentCapabilities {
  const evidence: CapabilityEvidence[] = [];
  const providerTools = client.capabilities.tools === true;
  const modelTools = model?.capabilities?.tool_calling;
  const nativeTools = providerTools && modelTools !== false;
  evidence.push({
    source: 'provider', capability: 'nativeTools', value: providerTools,
    reason: providerTools ? 'The provider accepts OpenAI-compatible tool calls.' : 'The provider does not accept tool calls.',
  });
  if (typeof modelTools === 'boolean') {
    evidence.push({
      source: 'model', capability: 'nativeTools', value: modelTools,
      reason: modelTools ? 'The selected model reports tool-calling support.' : 'The selected model reports no tool-calling support.',
    });
  }

  const modelJson = model?.capabilities?.json_output;
  const providerJson = client.capabilities.jsonOutput === true;
  const jsonSchemaOutput = providerJson && modelJson !== false;
  evidence.push({
    source: 'provider', capability: 'jsonSchemaOutput', value: providerJson,
    reason: providerJson ? 'The provider advertises structured JSON output.' : 'Structured output is prompted and validated locally.',
  });

  return {
    nativeTools,
    jsonSchemaOutput,
    // All supported providers can use queryJson's fenced-JSON parser.
    promptJsonOutput: true,
    embeddings: client.capabilities.embeddings === true,
    providerDatasets: client.capabilities.dataset,
    liveSearch: client.capabilities.liveSearch,
    localReferenceSearch: true,
    localDocumentInspection: true,
    evidence,
  };
}

export function executionPathFor(capabilities: AgentCapabilities): 'tool_assisted' | 'prompt_only' {
  return capabilities.nativeTools ? 'tool_assisted' : 'prompt_only';
}

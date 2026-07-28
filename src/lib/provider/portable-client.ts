import type { LLMClient } from './types';
import { LegacyLLMPortableAdapter } from './adapters/legacy-llm';
import type {
  PortableProviderClient,
  PortableProviderIdentity,
} from './portable-types';

export type PortableClient = PortableProviderClient;

/**
 * Compatibility entry point for migrating existing callers incrementally.
 * Provider-specific clients remain unchanged and are hidden behind the
 * provider-neutral PortableProviderClient contract.
 */
export function createPortableClient(
  client: LLMClient,
  identity: PortableProviderIdentity,
): PortableProviderClient {
  return new LegacyLLMPortableAdapter(client, identity);
}

export type {
  PortableCompletionInput,
  PortableCompletionResult,
  PortableEmbeddingInput,
  PortableEmbeddingResult,
  PortableMessage,
  PortableProviderClient,
  PortableStructuredInput,
  PortableStructuredResult,
} from './portable-types';

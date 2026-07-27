import type { ModelInfo, QueryInput, QueryResponse } from '../asksage/types';
import type { LLMClient } from '../provider/types';
import { putTraceArtifact } from './artifacts';
import { appendTraceEvent } from './journal';

/**
 * Decorates any existing provider without changing its request shape. The
 * recorded QueryInput and response are the canonical, provider-independent
 * audit record; credentials and HTTP authorization headers never enter it.
 */
export function withAuditedTransport(
  client: LLMClient,
  context: { sessionId: string; turnId: string },
): LLMClient {
  return {
    capabilities: client.capabilities,
    getModels: () => client.getModels(),
    query: async (input: QueryInput): Promise<QueryResponse> => {
      await recordRequest(context, input);
      try {
        const response = await client.query(input);
        await recordResponse(context, response);
        return response;
      } catch (error) {
        await recordFailure(context, error);
        throw error;
      }
    },
    queryJson: async <T>(input: QueryInput): Promise<{ data: T; raw: QueryResponse }> => {
      await recordRequest(context, input);
      try {
        const response = await client.queryJson<T>(input);
        await recordResponse(context, response.raw);
        return response;
      } catch (error) {
        await recordFailure(context, error);
        throw error;
      }
    },
  };
}

async function recordRequest(context: { sessionId: string; turnId: string }, input: QueryInput): Promise<void> {
  const artifact = await putTraceArtifact({ sessionId: context.sessionId, turnId: context.turnId, kind: 'canonical_query_input', content: JSON.stringify(input), containsDocumentContent: true });
  await appendTraceEvent({ sessionId: context.sessionId, turnId: context.turnId, node: 'model', type: 'model.request', status: 'running', summary: `Model request queued (${input.model ?? 'provider default'}).`, outputArtifactIds: [artifact.id] });
}

async function recordResponse(context: { sessionId: string; turnId: string }, response: QueryResponse): Promise<void> {
  const artifact = await putTraceArtifact({ sessionId: context.sessionId, turnId: context.turnId, kind: 'provider_response', content: JSON.stringify(response), containsDocumentContent: true });
  await appendTraceEvent({ sessionId: context.sessionId, turnId: context.turnId, node: 'model', type: 'model.response', status: 'succeeded', summary: 'Model response received.', outputArtifactIds: [artifact.id], tokensIn: response.usage?.prompt_tokens, tokensOut: response.usage?.completion_tokens });
}

async function recordFailure(context: { sessionId: string; turnId: string }, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await appendTraceEvent({ sessionId: context.sessionId, turnId: context.turnId, node: 'model', type: 'model.response', status: 'failed', summary: 'Model request failed.', error: { code: 'connection', message } });
}

export type { ModelInfo };

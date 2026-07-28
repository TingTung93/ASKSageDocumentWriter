import type {
  OpenAITool,
  OpenAIToolCall,
  QueryInput,
  QueryResponse,
} from '../../asksage/types';
import { canEmbed, type LLMClient } from '../types';
import {
  PortableProviderError,
  type EffectiveCapabilities,
  type PortableCompletionInput,
  type PortableCompletionResult,
  type PortableEmbeddingInput,
  type PortableEmbeddingResult,
  type PortableFinishReason,
  type PortableMessage,
  type PortableModel,
  type PortableProviderClient,
  type PortableProviderIdentity,
  type PortableStructuredInput,
  type PortableStructuredResult,
  type PortableToolCall,
} from '../portable-types';

export class LegacyLLMPortableAdapter implements PortableProviderClient {
  readonly capabilities: EffectiveCapabilities;

  constructor(
    protected readonly client: LLMClient,
    readonly identity: PortableProviderIdentity,
  ) {
    this.capabilities = capabilitiesFor(client);
  }

  async listModels(_signal?: AbortSignal): Promise<PortableModel[]> {
    try {
      const models = await this.client.getModels();
      return models.map((model) => ({
        id: model.id,
        name: model.name,
        owner: model.owned_by,
        contextWindow: model.capabilities?.context_length,
        metadata: {
          pricing: model.pricing,
          capabilities: model.capabilities,
        },
      }));
    } catch (error) {
      throw normalizePortableError(error);
    }
  }

  async complete(input: PortableCompletionInput): Promise<PortableCompletionResult> {
    throwIfAborted(input.signal);
    try {
      const raw = await this.client.query(toLegacyQuery(input));
      throwIfAborted(input.signal);
      return fromLegacyResponse(raw);
    } catch (error) {
      throw normalizePortableError(error);
    }
  }

  async completeStructured<T>(
    input: PortableStructuredInput<T>,
  ): Promise<PortableStructuredResult<T>> {
    throwIfAborted(input.signal);
    try {
      const { schema: _schema, schemaName: _schemaName, validate, ...completion } = input;
      const raw = await this.client.queryJson<T>(toLegacyQuery(completion));
      if (validate && !validate(raw.data)) {
        throw new PortableProviderError(
          'malformed_response',
          'Provider returned JSON that does not match the requested schema.',
        );
      }
      return {
        data: raw.data,
        completion: fromLegacyResponse(raw.raw),
      };
    } catch (error) {
      throw normalizePortableError(error);
    }
  }

  async embed(input: PortableEmbeddingInput): Promise<PortableEmbeddingResult> {
    if (!canEmbed(this.client)) {
      throw new PortableProviderError(
        'unsupported',
        `${this.identity.displayName} does not support embeddings.`,
      );
    }
    throwIfAborted(input.signal);
    try {
      const result = await this.client.embed(input.texts, input.model);
      throwIfAborted(input.signal);
      return {
        embeddings: result.embeddings,
        usage: { totalTokens: result.tokens },
      };
    } catch (error) {
      throw normalizePortableError(error);
    }
  }
}

export function toLegacyQuery(input: PortableCompletionInput): QueryInput {
  const system = input.messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join('\n\n');
  const conversation = input.messages
    .filter((message) => message.role !== 'system')
    .map((message) => ({
      user: message.role === 'assistant' ? 'gpt' : message.role,
      message: message.content,
      ...(message.toolCalls
        ? { tool_calls: message.toolCalls.map(toLegacyToolCall) }
        : {}),
      ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
      ...(message.name ? { name: message.name } : {}),
    }));

  const query: QueryInput = {
    model: input.model,
    message: conversation,
    usage: true,
  };
  if (system) query.system_prompt = system;
  if (input.temperature !== undefined) query.temperature = input.temperature;
  if (input.tools?.length) {
    query.tools = input.tools.map<OpenAITool>((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }));
  }
  if (input.toolChoice) {
    query.tool_choice =
      typeof input.toolChoice === 'string'
        ? input.toolChoice
        : { type: 'function', function: { name: input.toolChoice.name } };
  }
  return query;
}

export function fromLegacyResponse(raw: QueryResponse): PortableCompletionResult {
  const toolCalls = raw.tool_calls?.map(fromLegacyToolCall);
  return {
    id: raw.uuid || undefined,
    message: {
      role: 'assistant',
      content: raw.message ?? '',
      ...(toolCalls?.length ? { toolCalls } : {}),
    },
    finishReason: inferFinishReason(raw, toolCalls),
    usage: raw.usage
      ? {
          inputTokens: raw.usage.prompt_tokens,
          outputTokens: raw.usage.completion_tokens,
          totalTokens: raw.usage.total_tokens,
        }
      : undefined,
    raw,
  };
}

function toLegacyToolCall(call: PortableToolCall): OpenAIToolCall {
  return {
    id: call.id,
    type: 'function',
    function: { name: call.name, arguments: call.arguments },
  };
}

function fromLegacyToolCall(call: OpenAIToolCall): PortableToolCall {
  return {
    id: call.id,
    name: call.function.name,
    arguments: typeof call.function.arguments === 'string'
      ? call.function.arguments
      : JSON.stringify(call.function.arguments),
  };
}

function inferFinishReason(
  raw: QueryResponse,
  calls?: PortableToolCall[],
): PortableFinishReason {
  if (calls?.length) return 'tool_calls';
  if (raw.status >= 200 && raw.status < 300) return 'stop';
  return 'unknown';
}

function capabilitiesFor(client: LLMClient): EffectiveCapabilities {
  const declared = (value: boolean | undefined) => ({
    support: value === undefined ? 'unknown' as const : value ? 'supported' as const : 'unsupported' as const,
    source: 'declared' as const,
  });
  return {
    completion: declared(true),
    structuredOutput: declared(client.capabilities.jsonOutput),
    tools: declared(client.capabilities.tools),
    toolContinuation: declared(client.capabilities.tools),
    embeddings: declared(client.capabilities.embeddings ?? canEmbed(client)),
  };
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new PortableProviderError('aborted', 'Provider request was cancelled.');
  }
}

export function normalizePortableError(error: unknown): PortableProviderError {
  if (error instanceof PortableProviderError) return error;
  const status = statusFrom(error);
  const rawMessage = error instanceof Error ? error.message : String(error);
  const message = redactSecrets(rawMessage);
  const lower = message.toLowerCase();
  if (error instanceof DOMException && error.name === 'AbortError') {
    return new PortableProviderError('aborted', 'Provider request was cancelled.', status, false, { cause: error });
  }
  if (status === 401) return new PortableProviderError('authentication', message, status, false, { cause: error });
  if (status === 403) return new PortableProviderError('authorization', message, status, false, { cause: error });
  if (status === 404 && lower.includes('model')) return new PortableProviderError('model_not_found', message, status, false, { cause: error });
  if (status === 429) return new PortableProviderError('rate_limit', message, status, true, { cause: error });
  if (status === 400 || status === 422) return new PortableProviderError('invalid_request', message, status, false, { cause: error });
  if (status !== undefined && status >= 500) return new PortableProviderError('server', message, status, true, { cause: error });
  if (lower.includes('timeout') || lower.includes('timed out')) return new PortableProviderError('timeout', message, status, true, { cause: error });
  if (lower.includes('json') || lower.includes('parseable')) return new PortableProviderError('malformed_response', message, status, false, { cause: error });
  if (error instanceof TypeError && lower.includes('fetch')) return new PortableProviderError('network', message, status, true, { cause: error });
  return new PortableProviderError('unknown', message, status, false, { cause: error });
}

function statusFrom(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const value = (error as { status?: unknown }).status;
  return typeof value === 'number' ? value : undefined;
}

function redactSecrets(value: string): string {
  return value
    .replace(/\bBearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/([?&](?:api[_-]?key|token)=)[^&\s]+/gi, '$1[REDACTED]');
}

export function portableMessages(...messages: PortableMessage[]): PortableMessage[] {
  return messages;
}

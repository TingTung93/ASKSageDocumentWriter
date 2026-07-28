export type PortableMessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface PortableToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface PortableMessage {
  role: PortableMessageRole;
  content: string;
  toolCalls?: PortableToolCall[];
  toolCallId?: string;
  name?: string;
}

export interface PortableToolDefinition {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export type PortableToolChoice =
  | 'none'
  | 'auto'
  | 'required'
  | { name: string };

export interface PortableCompletionInput {
  model: string;
  messages: PortableMessage[];
  temperature?: number;
  tools?: PortableToolDefinition[];
  toolChoice?: PortableToolChoice;
  signal?: AbortSignal;
}

export type PortableFinishReason =
  | 'stop'
  | 'length'
  | 'tool_calls'
  | 'content_filter'
  | 'cancelled'
  | 'unknown';

export interface PortableUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface PortableCompletionResult {
  id?: string;
  message: PortableMessage;
  finishReason: PortableFinishReason;
  usage?: PortableUsage;
  raw?: unknown;
}

export interface PortableStructuredInput<T = unknown> extends PortableCompletionInput {
  schema: Record<string, unknown>;
  schemaName?: string;
  validate?: (value: unknown) => value is T;
}

export interface PortableStructuredResult<T> {
  data: T;
  completion: PortableCompletionResult;
}

export interface PortableEmbeddingInput {
  model?: string;
  texts: string[];
  signal?: AbortSignal;
}

export interface PortableEmbeddingResult {
  embeddings: number[][];
  usage?: PortableUsage;
}

export interface PortableModel {
  id: string;
  name: string;
  owner?: string;
  contextWindow?: number;
  metadata?: Record<string, unknown>;
}

export interface PortableProviderIdentity {
  providerId: string;
  displayName: string;
  endpoint?: string;
  model?: string;
  local: boolean;
}

export type CapabilitySupport = 'supported' | 'unsupported' | 'unknown';
export type CapabilitySource = 'declared' | 'probed' | 'overridden';

export interface EffectiveCapability {
  support: CapabilitySupport;
  source: CapabilitySource;
  detail?: string;
}

export interface EffectiveCapabilities {
  completion: EffectiveCapability;
  structuredOutput: EffectiveCapability;
  tools: EffectiveCapability;
  toolContinuation: EffectiveCapability;
  embeddings: EffectiveCapability;
}

export type PortableErrorCode =
  | 'aborted'
  | 'timeout'
  | 'authentication'
  | 'authorization'
  | 'rate_limit'
  | 'model_not_found'
  | 'unsupported'
  | 'invalid_request'
  | 'malformed_response'
  | 'network'
  | 'cors'
  | 'mixed_content'
  | 'server'
  | 'unknown';

export class PortableProviderError extends Error {
  constructor(
    public readonly code: PortableErrorCode,
    message: string,
    public readonly status?: number,
    public readonly retryable = false,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'PortableProviderError';
  }
}

export interface PortableProviderClient {
  readonly identity: PortableProviderIdentity;
  readonly capabilities: EffectiveCapabilities;
  listModels(signal?: AbortSignal): Promise<PortableModel[]>;
  complete(input: PortableCompletionInput): Promise<PortableCompletionResult>;
  completeStructured<T>(
    input: PortableStructuredInput<T>,
  ): Promise<PortableStructuredResult<T>>;
  embed?(input: PortableEmbeddingInput): Promise<PortableEmbeddingResult>;
}

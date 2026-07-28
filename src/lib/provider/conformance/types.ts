export const CONFORMANCE_PROBE_VERSION = 1;

export type ProbeFeature =
  | 'reachability'
  | 'modelList'
  | 'completion'
  | 'jsonOutput'
  | 'toolCall'
  | 'toolResultContinuation'
  | 'multipleToolCalls'
  | 'embeddings';

export type ProbeStatus =
  | 'supported'
  | 'unsupported'
  | 'failed'
  | 'skipped';

export type ProbeErrorKind =
  | 'cors'
  | 'mixed_content'
  | 'authentication'
  | 'timeout'
  | 'unknown_model'
  | 'malformed_response'
  | 'unsupported'
  | 'aborted'
  | 'network'
  | 'unknown';

export interface ProbeError {
  kind: ProbeErrorKind;
  message: string;
  status?: number;
}

export interface ProbeSignal {
  status: ProbeStatus;
  latencyMs?: number;
  detail?: string;
  error?: ProbeError;
}

export interface ConformanceIdentity {
  providerId: string;
  endpoint: string;
  model: string;
  /**
   * A caller-managed, random/non-secret identifier for the active auth
   * configuration. It must not be an API key, hash of a key, or other
   * reversible credential fingerprint.
   */
  authConfigurationId: string;
}

export interface ConformanceReport {
  identity: ConformanceIdentity;
  probeVersion: number;
  probedAt: string;
  signals: Record<ProbeFeature, ProbeSignal>;
}

export interface ProbeToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ProbeToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

export interface ProbeCompletion {
  text: string;
  toolCalls?: ProbeToolCall[];
}

export interface ConformanceProbeClient {
  listModels?(signal?: AbortSignal): Promise<string[]>;
  complete(input: {
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
    signal?: AbortSignal;
  }): Promise<ProbeCompletion>;
  completeJson?(input: {
    messages: Array<{ role: 'system' | 'user'; content: string }>;
    signal?: AbortSignal;
  }): Promise<unknown>;
  completeWithTools?(input: {
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
    tools: ProbeToolDefinition[];
    signal?: AbortSignal;
  }): Promise<ProbeCompletion>;
  continueWithToolResult?(input: {
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
    toolCall: ProbeToolCall;
    result: unknown;
    signal?: AbortSignal;
  }): Promise<ProbeCompletion>;
  embed?(texts: string[], signal?: AbortSignal): Promise<number[][]>;
}

export interface ProbeOptions {
  timeoutMs?: number;
  includeMultipleToolCalls?: boolean;
  signal?: AbortSignal;
}

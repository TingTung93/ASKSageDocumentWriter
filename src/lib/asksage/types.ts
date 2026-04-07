// Types match the verified Ask Sage Server API responses captured against
// api.asksage.health.mil on 2026-04-07. See API_Testing_Outputs.md for raw
// fixtures and PRD.md §5 for the architectural notes.

export interface ModelInfo {
  id: string;
  name: string;
  object: string;
  owned_by: string;
  /** Free-form date string ("na" on the health tenant). */
  created: string;
}

export interface GetModelsResponse {
  data: ModelInfo[];
  object: string;
  /** Convenience array of just the model ids; mirrors `data[].id`. */
  response: string[];
}

export type DatasetSelector = string | 'all' | 'none';

export interface QueryInput {
  /**
   * Either a string (single user message) or an array of conversation turns.
   * Ask Sage's `/server/query` accepts both shapes.
   */
  message: string | { user: string; message: string }[];
  model?: string;
  dataset?: DatasetSelector;
  /** Maximum knowledge base references to inject. 0 disables embeddings. */
  limit_references?: number;
  /** 0..1; default 0 on the server. */
  temperature?: number;
  system_prompt?: string;
  persona?: number;
  /** Web search toggle: 0 off, 1 Google results, 2 Google + crawl. */
  live?: 0 | 1 | 2;
  /** When true, the response includes a `usage` object. */
  usage?: boolean;
}

export interface QueryUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  [key: string]: unknown;
}

export interface QueryResponse {
  message: string;
  response: string;
  status: number;
  uuid: string;
  references?: string;
  embedding_down?: boolean;
  vectors_down?: boolean;
  added_obj?: unknown;
  type?: string;
  usage?: QueryUsage | null;
  tool_calls?: unknown;
  tool_calls_unified?: unknown;
  tool_responses?: unknown;
}

export class AskSageError extends Error {
  constructor(
    public readonly status: number | null,
    message: string,
    public readonly body?: string,
  ) {
    super(message);
    this.name = 'AskSageError';
  }
}

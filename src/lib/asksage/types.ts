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

export interface VerifyDatasetResult {
  name: string;
  /** True if the call to /server/query against the dataset succeeded */
  reachable: boolean;
  /** True if the response contained any reference material from the dataset */
  has_references: boolean;
  /** Excerpt of references returned, if any */
  references_excerpt: string | null;
  embedding_down: boolean;
  vectors_down: boolean;
  /** Error message if the verification call failed */
  error: string | null;
}

// ─── /server/get-datasets ─────────────────────────────────────────

export interface GetDatasetsResponse {
  /** Flat list of dataset names. May include user_custom_<USERID>_<NAME>_content entries. */
  response: string[];
  status?: number;
}

// ─── /server/file ─────────────────────────────────────────────────
// Multipart upload of a single file. Ask Sage runs its own extractor
// (handles DOCX, PDF, audio/video, etc.) and returns the extracted
// plaintext inline as `ret`. Max 250 MB for documents, 500 MB for A/V.

export interface UploadFileResponse {
  response: string;
  /** Extracted plaintext from the uploaded file */
  ret: string;
  status: number;
}

// ─── /server/train ────────────────────────────────────────────────
// Adds a chunk of text to the user's knowledge base. Vectors live in
// Ask Sage. force_dataset routes the content into a specific dataset
// name; without it, Ask Sage picks the default. Optional summarize +
// summarize_model lets Ask Sage compress before storage.

export interface TrainRequest {
  /** Short metadata describing this content (e.g. "PWS reference, project X") */
  context: string;
  /** The actual text to ingest */
  content: string;
  /** Optional: have Ask Sage summarize before embedding */
  summarize?: boolean;
  summarize_model?: string;
  /** Optional: route into a named dataset (creates it if it doesn't exist) */
  force_dataset?: string;
}

export interface TrainResponse {
  response: string;
  /** Embedding id Ask Sage assigned to this chunk */
  embedding?: string;
  status: number;
}

// ─── /server/query_with_file ──────────────────────────────────────
// Same response shape as /server/query. The `file` parameter takes a
// filename (or array of filenames) that's already been uploaded via
// /server/file in a prior call — it is NOT a multipart upload itself.

export interface QueryWithFileInput {
  message: string;
  file: string | string[];
  model?: string;
  dataset?: string | string[];
  temperature?: number;
  limit_references?: number;
  live?: 0 | 1 | 2;
  system_prompt?: string;
  usage?: boolean;
}

// ─── /server/tokenizer ────────────────────────────────────────────

export interface TokenizerRequest {
  content: string;
  model: string;
}

export interface TokenizerResponse {
  /** Exact token count for the given content under the given model */
  response?: number;
  tokens?: number;
  status?: number;
  [key: string]: unknown;
}

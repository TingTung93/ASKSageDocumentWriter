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
  /**
   * Per-token pricing in USD. Populated by providers that expose it
   * (currently only OpenRouter via `/v1/models`); undefined for Ask
   * Sage, whose health.mil tenant does not return per-model pricing.
   */
  pricing?: ModelPricing;
  /**
   * Provider-reported capability metadata. Populated by OpenRouter
   * (`/v1/models` exposes context_length, architecture, and
   * supported_parameters). Undefined for Ask Sage models — the
   * health.mil `/server/get-models` endpoint does not return any of
   * this. Consumers MUST treat undefined as "unknown, do not reject".
   */
  capabilities?: ModelCapabilities;
}

export interface ModelPricing {
  /** USD per input token. */
  prompt_per_token: number;
  /** USD per output completion token. */
  completion_per_token: number;
  /** True when both prompt and completion costs are zero. */
  is_free: boolean;
}

export interface ModelCapabilities {
  /** Maximum context window in tokens. */
  context_length?: number;
  /** Modalities the model accepts as input (e.g. ["text", "image"]). */
  input_modalities?: string[];
  /** Modalities the model produces as output (e.g. ["text"]). */
  output_modalities?: string[];
  /**
   * OpenAI-style parameter names the model honors (e.g. "temperature",
   * "tools", "response_format"). Used to confirm we can pass the knobs
   * our pipeline relies on (currently just `temperature`).
   */
  supported_parameters?: string[];
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
  /**
   * Number of OpenRouter web-search results invoked by THIS call.
   * Set by OpenRouterClient when the request body included the
   * `plugins: [{ id: 'web', max_results }]` block. Always
   * undefined for Ask Sage responses (the live-search field there
   * doesn't translate into a discrete result count). Used by the
   * cost rollup in lib/usage.ts to add the OpenRouter web plugin
   * surcharge ($0.004 per result on Exa) on top of token cost.
   */
  web_search_results?: number;
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
// content inline as `ret`. Max 250 MB for documents, 500 MB for A/V.
//
// Per swagger v1.56, `ret` is documented as an object, but the
// health.mil tenant returns the extracted plaintext as a string and
// our `attachProjectFile()` consumer treats it as such. We type it as
// `string | Record<string, unknown>` so callers must do an explicit
// narrowing instead of being silently wrong on a tenant variant.

export interface UploadFileFormFields {
  /** Extraction strategy. `auto` (default) lets Ask Sage choose. */
  strategy?: 'auto' | 'fast' | 'hi_res';
  /** Special CSV handling — preserves row structure for tabular files. */
  special_csv?: boolean;
}

export interface UploadFileResponse {
  response: string;
  /** Extracted content from the uploaded file. String on health tenant; object per swagger v1.56. */
  ret: string | Record<string, unknown>;
  /** Filename Ask Sage stored the upload under (per swagger v1.56). */
  sent_filename?: string;
  status: number;
}

// ─── /server/train ────────────────────────────────────────────────
// Adds a chunk of text to the user's knowledge base. Vectors live in
// Ask Sage. force_dataset routes the content into a specific dataset
// name; without it, Ask Sage picks the default.

export interface TrainRequest {
  /** The actual text to ingest (required per swagger v1.56) */
  content: string;
  /** Short metadata describing this content (e.g. "PWS reference, project X") */
  context?: string;
  /** Skip vector DB write — train without embedding (rare; default false). */
  skip_vectordb?: boolean;
  /** Route into a named dataset (creates it if it doesn't exist) */
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
// Per swagger v1.56, request takes content + model + optional flags;
// response returns the count as a STRING in `response`. Callers should
// use the `tokenize()` helper on the client which coerces to number.

export interface TokenizerRequest {
  content: string;
  /** Tokenizer to use. Default `ada-002` per swagger. */
  model?: string;
  /** Convert to Ask Sage's internal token-counting model. */
  convert_to_asksage?: boolean;
  /** Add this many tokens as a completion-side estimate. */
  completion_estimate?: number;
}

export interface TokenizerResponse {
  /** Token count, returned as a stringified integer per swagger v1.56. */
  response: string;
  status?: number;
}

// ─── /server/count-monthly-tokens ─────────────────────────────────
// Authoritative server-side monthly token usage. GET form returns the
// caller's full tenant count; POST form scopes by app. We use GET.

export interface CountMonthlyTokensResponse {
  /** Total tokens consumed in the current billing month. */
  response: number;
  status?: number;
}

// ─── Dataset & file management (all under /server/*) ─────────────
// Per swagger v1.56 these all live on the permissive Server surface,
// so they ARE reachable from the browser on the health.mil tenant.
// Memory dated 2026-04-07 incorrectly placed them on /user/*.

export interface DeleteDatasetRequest {
  dataset: string;
}

export interface DeleteFilenameFromDatasetRequest {
  dataset: string;
  filename: string;
}

export interface SimpleResponse {
  response: string;
  status?: number;
}

export interface GetAllFilesIngestedResponse {
  /** Array of file descriptors. Shape is tenant-dependent — passed through unchanged. */
  response: unknown[];
  status?: number;
}

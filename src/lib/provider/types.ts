// Provider abstraction.
//
// Two backends are supported:
//
//   1. `asksage` — the DHA health.mil tenant, used for CUI work. Goes
//      through `AskSageClient` and the /server/* surface. This is the
//      default and only path that supports datasets, file ingest,
//      training, and the full drafting pipeline.
//
//   2. `openrouter` — commercial OpenAI-compatible aggregator at
//      https://openrouter.ai/api/v1. Useful for non-CUI work where
//      the user wants to call commercial Claude/GPT/Gemini without
//      routing through the gov tenant. Supports `getModels`, `query`,
//      and `queryJson` only. Dataset/file/training calls throw.
//
// `LLMClient` is the structural surface both providers implement. It
// covers the methods the drafting/synthesis/refine pipeline relies on.
// `AskSageClient` is a *subtype* of `LLMClient` (it has all the methods
// plus the Ask-Sage-only ones), so passing `AskSageClient` where
// `LLMClient` is expected just works via TypeScript structural typing.

import type { ModelInfo, QueryInput, QueryResponse } from '../asksage/types';

export type ProviderId = 'asksage' | 'openrouter';

/**
 * Minimal completion-side surface shared by Ask Sage and OpenRouter.
 * If you're touching a method that ONLY makes sense on Ask Sage
 * (datasets, files, training, monthly token count), keep it on
 * `AskSageClient` directly — do not add it here.
 */
export interface LLMClient {
  /** Enumerate models available on this provider. */
  getModels(): Promise<ModelInfo[]>;

  /** One-shot completion. Some `QueryInput` fields are Ask-Sage-only and ignored on OpenRouter. */
  query(input: QueryInput): Promise<QueryResponse>;

  /**
   * Query whose model output is parsed as strict JSON. Strips a leading
   * ```json fence if present. Throws if the response isn't parseable.
   */
  queryJson<T>(input: QueryInput): Promise<{ data: T; raw: QueryResponse }>;
}

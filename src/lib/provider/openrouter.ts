// OpenRouter client — OpenAI-compatible aggregator at
// https://openrouter.ai/api/v1. Auth is `Authorization: Bearer <key>`.
//
// We expose only the LLMClient surface (getModels, query, queryJson)
// since OpenRouter has no concept of Ask Sage datasets, training,
// monthly token quotas, or file ingest. Calls to those features go
// through `AskSageClient` directly and are gated in the UI when the
// active provider is `openrouter`.
//
// Request/response shape mapping:
//
//   QueryInput → /v1/chat/completions body
//     message (string)            → messages: [{role: 'user', content}]
//     message (turn array)        → messages: [{role, content}, ...]
//     system_prompt               → prepended as {role: 'system', ...}
//     model                       → model
//     temperature                 → temperature
//     dataset/limit_references    → IGNORED (Ask-Sage-only RAG knobs)
//     live: 0                     → no plugins
//     live: 1                     → plugins: [{ id: 'web', max_results: 5 }]
//     live: 2                     → plugins: [{ id: 'web', max_results: 10 }]
//                                   (OpenRouter routes through Exa by default;
//                                    see https://openrouter.ai/docs/features/web-search)
//     persona                     → IGNORED
//     usage                       → IGNORED — OpenRouter always returns usage
//
//   /v1/chat/completions response → QueryResponse
//     id                          → uuid
//     choices[0].message.content  → message
//     usage.prompt_tokens etc.    → usage.prompt_tokens etc.
//     references                  → '' (no RAG)
//     embedding_down/vectors_down → false
//
// We DO NOT pass fetch directly — same illegal-invocation gotcha as
// AskSageClient.

import { AskSageError } from '../asksage/types';
import type {
  ModelInfo,
  ModelPricing,
  QueryInput,
  QueryResponse,
} from '../asksage/types';
import { writeAuditEntry } from '../asksage/audit';
import type { LLMClient, ProviderCapabilities } from './types';
import {
  buildOpenAIHeaders,
  mapModelRowToModelInfo,
  mapOpenAIResponseToQueryResponse,
  mapQueryInputToOpenAIChatBody,
  parseJsonFromOpenAIText,
  sortOpenAIEmbeddings,
  urlForOpenAIPath,
  type OpenAIChatBody,
  type OpenAIChatCompletionResponse,
  type OpenAIEmbeddingsResponse,
  type OpenAIModelRow,
} from './openai_compat';

const defaultFetch: typeof fetch = (input, init) => globalThis.fetch(input, init);

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';

/** Default timeout for API calls (5 minutes). */
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

/** Default embedding model for chunk vectorization. */
const DEFAULT_EMBEDDING_MODEL = 'openai/text-embedding-3-small';

// OpenRouter `/v1/models` shape (subset we use). Pricing fields are
// stringified USD per token; `"0"` for free models.
interface OpenRouterModelsResponse {
  data: Array<OpenAIModelRow & {
    pricing?: {
      prompt?: string;
      completion?: string;
      request?: string;
      image?: string;
    };
  }>;
}

/**
 * OpenRouter web-search plugin configuration. Documented at
 * https://openrouter.ai/docs/features/web-search. We only ever set
 * `id` and `max_results`; the engine and search-prompt fields use
 * OpenRouter defaults (Exa under the hood for most providers).
 */
interface OpenRouterWebPlugin {
  id: 'web';
  max_results?: number;
}

type OpenRouterChatBody = OpenAIChatBody & {
  plugins?: OpenRouterWebPlugin[];
};

export class OpenRouterClient implements LLMClient {
  /**
   * OpenRouter has no /server/file extraction and no named-dataset
   * RAG, but it DOES support web search via the `plugins` field on
   * /chat/completions — many backends include Exa-powered search at
   * no extra prompt-engineering cost. So liveSearch is a true
   * capability here even though the other two are not.
   */
  readonly capabilities: ProviderCapabilities = {
    fileUpload: false,
    dataset: false,
    liveSearch: true,
  };

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string = DEFAULT_BASE_URL,
    private readonly fetchImpl: typeof fetch = defaultFetch,
    /**
     * Optional `HTTP-Referer` and `X-Title` headers OpenRouter uses for
     * dashboard attribution. Both are documented as optional. We default
     * to a stable identifier so the user's OpenRouter dashboard groups
     * usage from this app together.
     */
    private readonly attribution: { referer?: string; title?: string } = {
      title: 'ASKSageDocumentWriter',
    },
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {
    if (!apiKey) throw new Error('OpenRouterClient: apiKey is required');
  }

  private url(path: string): string {
    return urlForOpenAIPath(this.baseUrl, path);
  }

  private buildHeaders(includeContentType: boolean): Record<string, string> {
    return buildOpenAIHeaders({
      apiKey: this.apiKey,
      includeContentType,
      extra: {
        'HTTP-Referer': this.attribution.referer || undefined,
        'X-Title': this.attribution.title || undefined,
      },
    });
  }

  async getModels(): Promise<ModelInfo[]> {
    const url = this.url('/models');
    const startedAt = Date.now();
    let res: Response;
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), this.timeoutMs);
      res = await this.fetchImpl(url, { method: 'GET', headers: this.buildHeaders(false), signal: ac.signal });
      clearTimeout(timer);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const errorMsg = `Network error calling GET ${url}: ${message}`;
      void writeAuditEntry({
        endpoint: '/openrouter/models',
        prompt_excerpt: '',
        response_excerpt: '',
        ms: Date.now() - startedAt,
        ok: false,
        error: errorMsg,
      });
      throw new AskSageError(null, errorMsg);
    }
    const text = await res.text();
    const ms = Date.now() - startedAt;
    if (!res.ok) {
      void writeAuditEntry({
        endpoint: '/openrouter/models',
        prompt_excerpt: '',
        response_excerpt: text,
        ms,
        ok: false,
        error: `${res.status} ${res.statusText}`,
      });
      throw new AskSageError(
        res.status,
        `OpenRouter GET ${url} failed (${res.status} ${res.statusText}): ${text || '(empty body)'}`,
        text,
      );
    }
    let parsed: OpenRouterModelsResponse;
    try {
      parsed = JSON.parse(text) as OpenRouterModelsResponse;
    } catch {
      throw new AskSageError(res.status, `OpenRouter GET ${url} returned non-JSON body`, text);
    }
    void writeAuditEntry({
      endpoint: '/openrouter/models',
      prompt_excerpt: '',
      response_excerpt: text.slice(0, 1500),
      ms,
      ok: true,
    });
    return (parsed.data ?? []).map(mapModel);
  }

  async query(input: QueryInput): Promise<QueryResponse> {
    const url = this.url('/chat/completions');
    const startedAt = Date.now();
    const body = mapQueryInputToOpenRouter(input);
    const reqBodyStr = JSON.stringify(body);
    let res: Response;
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), this.timeoutMs);
      res = await this.fetchImpl(url, {
        method: 'POST',
        headers: this.buildHeaders(true),
        body: reqBodyStr,
        signal: ac.signal,
      });
      clearTimeout(timer);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const errorMsg =
        `Network error calling POST ${url}: ${message}. ` +
        `OpenRouter requires Authorization: Bearer header — check your key.`;
      void writeAuditEntry({
        endpoint: '/openrouter/chat/completions',
        model: input.model,
        prompt_excerpt: reqBodyStr,
        response_excerpt: '',
        ms: Date.now() - startedAt,
        ok: false,
        error: errorMsg,
      });
      throw new AskSageError(null, errorMsg);
    }
    const text = await res.text();
    const ms = Date.now() - startedAt;
    if (!res.ok) {
      void writeAuditEntry({
        endpoint: '/openrouter/chat/completions',
        model: input.model,
        prompt_excerpt: reqBodyStr,
        response_excerpt: text,
        ms,
        ok: false,
        error: `${res.status} ${res.statusText}`,
      });
      throw new AskSageError(
        res.status,
        `OpenRouter POST ${url} failed (${res.status} ${res.statusText}): ${text || '(empty body)'}`,
        text,
      );
    }
    let parsed: OpenAIChatCompletionResponse;
    try {
      parsed = JSON.parse(text) as OpenAIChatCompletionResponse;
    } catch {
      throw new AskSageError(res.status, `OpenRouter POST ${url} returned non-JSON body`, text);
    }
    const mapped = mapOpenAIResponseToQueryResponse(parsed);
    // Annotate the response with the requested web_search_results
    // count when the request body included the web plugin. We use
    // the upper bound (max_results from the request) rather than
    // parsing the actual return count out of the response — the
    // upper bound matches the budget the user opted into and is
    // what gets billed in the worst case. Falls back to undefined
    // when the plugin wasn't included so the cost rollup ignores it.
    const webPlugin = body.plugins?.find((p) => p.id === 'web');
    if (webPlugin) {
      mapped.web_search_results = webPlugin.max_results ?? 0;
    }
    void writeAuditEntry({
      endpoint: '/openrouter/chat/completions',
      model: input.model,
      prompt_excerpt: reqBodyStr,
      response_excerpt: text,
      tokens_in: mapped.usage?.prompt_tokens,
      tokens_out: mapped.usage?.completion_tokens,
      ms,
      ok: true,
    });
    return mapped;
  }

  async queryJson<T>(input: QueryInput): Promise<{ data: T; raw: QueryResponse }> {
    const response = await this.query(input);
    const text = (response.message ?? '').trim();
    try {
      return { data: parseJsonFromOpenAIText<T>(text), raw: response };
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      throw new AskSageError(
        response.status ?? null,
        `OpenRouter queryJson: response was not parseable JSON (${reason}). ` +
          `Raw response (first 2000 chars):\n${text.slice(0, 2000)}`,
        text,
      );
    }
  }

  async embed(
    texts: string[],
    model: string = DEFAULT_EMBEDDING_MODEL,
  ): Promise<{ embeddings: number[][]; tokens: number }> {
    const url = this.url('/embeddings');
    const startedAt = Date.now();
    const reqBody = JSON.stringify({ model, input: texts });
    let res: Response;
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), this.timeoutMs);
      res = await this.fetchImpl(url, {
        method: 'POST',
        headers: this.buildHeaders(true),
        body: reqBody,
        signal: ac.signal,
      });
      clearTimeout(timer);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const errorMsg = `Network error calling POST ${url}: ${message}`;
      void writeAuditEntry({
        endpoint: '/openrouter/embeddings',
        model,
        prompt_excerpt: reqBody.slice(0, 500),
        response_excerpt: '',
        ms: Date.now() - startedAt,
        ok: false,
        error: errorMsg,
      });
      throw new AskSageError(null, errorMsg);
    }
    const text = await res.text();
    const ms = Date.now() - startedAt;
    if (!res.ok) {
      void writeAuditEntry({
        endpoint: '/openrouter/embeddings',
        model,
        prompt_excerpt: reqBody.slice(0, 500),
        response_excerpt: text,
        ms,
        ok: false,
        error: `${res.status} ${res.statusText}`,
      });
      throw new AskSageError(
        res.status,
        `OpenRouter POST ${url} failed (${res.status} ${res.statusText}): ${text || '(empty body)'}`,
        text,
      );
    }
    let parsed: OpenAIEmbeddingsResponse;
    try {
      parsed = JSON.parse(text) as OpenAIEmbeddingsResponse;
    } catch {
      throw new AskSageError(res.status, `OpenRouter POST ${url} returned non-JSON body`, text);
    }
    void writeAuditEntry({
      endpoint: '/openrouter/embeddings',
      model,
      prompt_excerpt: reqBody.slice(0, 500),
      response_excerpt: text.slice(0, 1500),
      tokens_in: parsed.usage?.prompt_tokens,
      ms,
      ok: true,
    });
    // Sort by index — the API may return embeddings out of order.
    const sorted = sortOpenAIEmbeddings(parsed);
    return {
      embeddings: sorted.map((d) => d.embedding),
      tokens: parsed.usage?.prompt_tokens ?? 0,
    };
  }
}

// ─── Mapping helpers ──────────────────────────────────────────────

function mapModel(m: OpenRouterModelsResponse['data'][number]): ModelInfo {
  const out = mapModelRowToModelInfo(m, 'openrouter');
  const pricing = extractPricing(m);
  if (pricing) out.pricing = pricing;
  return out;
}

/**
 * Convert OpenRouter's stringified per-token prices to numbers and
 * decide whether the model is free. A model is free when both prompt
 * and completion costs are zero, OR when the id ends in `:free`
 * (OpenRouter's naming convention for free-tier-only variants —
 * sometimes the pricing fields are missing on those).
 */
function extractPricing(
  m: OpenRouterModelsResponse['data'][number],
): ModelPricing | null {
  const p = m.pricing;
  const idLooksFree = m.id.endsWith(':free');
  if (!p && !idLooksFree) return null;

  const prompt = parseUsdPerToken(p?.prompt);
  const completion = parseUsdPerToken(p?.completion);
  const is_free = idLooksFree || (prompt === 0 && completion === 0);
  return {
    prompt_per_token: prompt,
    completion_per_token: completion,
    is_free,
  };
}

function parseUsdPerToken(value: string | undefined): number {
  if (value === undefined || value === null || value === '') return 0;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function mapQueryInputToOpenRouter(input: QueryInput): OpenRouterChatBody {
  // Required: model. OpenRouter won't pick a default for us — caller
  // must supply one (Settings tab does this for every stage).
  if (!input.model) {
    throw new AskSageError(
      null,
      'OpenRouter requires an explicit model id (e.g. "anthropic/claude-3.5-sonnet"). Set per-stage model overrides on the Settings tab.',
    );
  }
  const out: OpenRouterChatBody = mapQueryInputToOpenAIChatBody(input);
  // Web search: Ask Sage's `live` field (0/1/2) maps to OpenRouter's
  // `plugins: [{ id: 'web' }]`. We use max_results to roughly mirror
  // the Ask Sage modes — mode 1 is "give me web hits", mode 2 is
  // "autonomous market research, more is better". Both modes route
  // through whatever search engine OpenRouter has wired up for the
  // chosen model (Exa for most).
  if (input.live === 1) {
    out.plugins = [{ id: 'web', max_results: 5 }];
  } else if (input.live === 2) {
    out.plugins = [{ id: 'web', max_results: 10 }];
  }
  return out;
}

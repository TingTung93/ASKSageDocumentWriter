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
  ModelCapabilities,
  ModelInfo,
  ModelPricing,
  QueryInput,
  QueryResponse,
  QueryUsage,
} from '../asksage/types';
import { writeAuditEntry } from '../asksage/audit';
import type { LLMClient, ProviderCapabilities } from './types';

const defaultFetch: typeof fetch = (input, init) => globalThis.fetch(input, init);

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';

// OpenRouter `/v1/models` shape (subset we use). Pricing fields are
// stringified USD per token; `"0"` for free models.
interface OpenRouterModelsResponse {
  data: Array<{
    id: string;
    name?: string;
    created?: number;
    description?: string;
    pricing?: {
      prompt?: string;
      completion?: string;
      request?: string;
      image?: string;
    };
    /** Maximum context window in tokens. */
    context_length?: number;
    architecture?: {
      modality?: string;
      input_modalities?: string[];
      output_modalities?: string[];
      tokenizer?: string;
    };
    /**
     * OpenAI-style parameter names this model honors. We use this to
     * check that `temperature` is settable for queryJson calls.
     */
    supported_parameters?: string[];
  }>;
}

// OpenRouter `/v1/chat/completions` shape (OpenAI-compatible subset).
interface OpenAIChatCompletionResponse {
  id: string;
  object?: string;
  choices: Array<{
    index?: number;
    message: { role: string; content: string };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

interface OpenAIChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
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
  ) {
    if (!apiKey) throw new Error('OpenRouterClient: apiKey is required');
  }

  private url(path: string): string {
    const trimmed = this.baseUrl.replace(/\/$/, '');
    return `${trimmed}${path.startsWith('/') ? path : `/${path}`}`;
  }

  private buildHeaders(includeContentType: boolean): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
    };
    if (includeContentType) headers['Content-Type'] = 'application/json';
    if (this.attribution.referer) headers['HTTP-Referer'] = this.attribution.referer;
    if (this.attribution.title) headers['X-Title'] = this.attribution.title;
    return headers;
  }

  async getModels(): Promise<ModelInfo[]> {
    const url = this.url('/models');
    const startedAt = Date.now();
    let res: Response;
    try {
      res = await this.fetchImpl(url, { method: 'GET', headers: this.buildHeaders(false) });
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
    const body = mapQueryInputToOpenAI(input);
    const reqBodyStr = JSON.stringify(body);
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: 'POST',
        headers: this.buildHeaders(true),
        body: reqBodyStr,
      });
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
    const cleaned = stripCodeFence(text);
    try {
      return { data: JSON.parse(cleaned) as T, raw: response };
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
}

// ─── Mapping helpers ──────────────────────────────────────────────

function mapModel(m: OpenRouterModelsResponse['data'][number]): ModelInfo {
  // OpenRouter ids look like "anthropic/claude-3.5-sonnet". Use the
  // vendor segment as `owned_by` to mirror Ask Sage's shape so the
  // existing model picker UI doesn't have to special-case anything.
  const vendor = m.id.includes('/') ? m.id.split('/')[0] ?? 'openrouter' : 'openrouter';
  const out: ModelInfo = {
    id: m.id,
    name: m.name ?? m.id,
    object: 'model',
    owned_by: vendor,
    created: typeof m.created === 'number' ? String(m.created) : 'na',
  };
  const pricing = extractPricing(m);
  if (pricing) out.pricing = pricing;
  const capabilities = extractCapabilities(m);
  if (capabilities) out.capabilities = capabilities;
  return out;
}

/**
 * Pull capability metadata from the OpenRouter `/v1/models` row. We
 * only set fields the API actually returned — leaving the rest
 * undefined so the validator can distinguish "missing" from "empty".
 */
function extractCapabilities(
  m: OpenRouterModelsResponse['data'][number],
): ModelCapabilities | null {
  const out: ModelCapabilities = {};
  if (typeof m.context_length === 'number' && m.context_length > 0) {
    out.context_length = m.context_length;
  }
  const inMods = m.architecture?.input_modalities;
  if (Array.isArray(inMods) && inMods.length > 0) {
    out.input_modalities = inMods.slice();
  }
  const outMods = m.architecture?.output_modalities;
  if (Array.isArray(outMods) && outMods.length > 0) {
    out.output_modalities = outMods.slice();
  }
  if (Array.isArray(m.supported_parameters) && m.supported_parameters.length > 0) {
    out.supported_parameters = m.supported_parameters.slice();
  }
  return Object.keys(out).length > 0 ? out : null;
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

function mapQueryInputToOpenAI(input: QueryInput): {
  model: string;
  messages: OpenAIChatMessage[];
  temperature?: number;
  plugins?: OpenRouterWebPlugin[];
} {
  const messages: OpenAIChatMessage[] = [];
  if (input.system_prompt) {
    messages.push({ role: 'system', content: input.system_prompt });
  }
  if (typeof input.message === 'string') {
    messages.push({ role: 'user', content: input.message });
  } else {
    // Ask Sage's turn array uses `{user, message}` where `user` is
    // 'me' or 'gpt'. Map to OpenAI roles.
    for (const turn of input.message) {
      const role: OpenAIChatMessage['role'] = turn.user === 'gpt' ? 'assistant' : 'user';
      messages.push({ role, content: turn.message });
    }
  }
  // Required: model. OpenRouter won't pick a default for us — caller
  // must supply one (Settings tab does this for every stage).
  if (!input.model) {
    throw new AskSageError(
      null,
      'OpenRouter requires an explicit model id (e.g. "anthropic/claude-3.5-sonnet"). Set per-stage model overrides on the Settings tab.',
    );
  }
  const out: {
    model: string;
    messages: OpenAIChatMessage[];
    temperature?: number;
    plugins?: OpenRouterWebPlugin[];
  } = {
    model: input.model,
    messages,
  };
  if (typeof input.temperature === 'number') out.temperature = input.temperature;
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

function mapOpenAIResponseToQueryResponse(r: OpenAIChatCompletionResponse): QueryResponse {
  const content = r.choices?.[0]?.message?.content ?? '';
  const usage: QueryUsage | null = r.usage
    ? {
        prompt_tokens: r.usage.prompt_tokens,
        completion_tokens: r.usage.completion_tokens,
        total_tokens: r.usage.total_tokens,
      }
    : null;
  return {
    message: content,
    response: 'OK',
    status: 200,
    uuid: r.id,
    references: '',
    embedding_down: false,
    vectors_down: false,
    usage,
  };
}

function stripCodeFence(text: string): string {
  const fenced = text.match(/^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/i);
  if (fenced) return fenced[1]!.trim();
  return text;
}

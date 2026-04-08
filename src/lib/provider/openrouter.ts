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
//     live/persona                → IGNORED
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
  QueryInput,
  QueryResponse,
  QueryUsage,
} from '../asksage/types';
import { writeAuditEntry } from '../asksage/audit';
import type { LLMClient } from './types';

const defaultFetch: typeof fetch = (input, init) => globalThis.fetch(input, init);

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';

// OpenRouter `/v1/models` shape (subset we use).
interface OpenRouterModelsResponse {
  data: Array<{
    id: string;
    name?: string;
    created?: number;
    description?: string;
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

export class OpenRouterClient implements LLMClient {
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
  return {
    id: m.id,
    name: m.name ?? m.id,
    object: 'model',
    owned_by: vendor,
    created: typeof m.created === 'number' ? String(m.created) : 'na',
  };
}

function mapQueryInputToOpenAI(input: QueryInput): {
  model: string;
  messages: OpenAIChatMessage[];
  temperature?: number;
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
  const out: { model: string; messages: OpenAIChatMessage[]; temperature?: number } = {
    model: input.model,
    messages,
  };
  if (typeof input.temperature === 'number') out.temperature = input.temperature;
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

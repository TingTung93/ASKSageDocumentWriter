import { writeAuditEntry } from '../asksage/audit';
import { AskSageError } from '../asksage/types';
import type { ModelInfo, QueryInput, QueryResponse } from '../asksage/types';
import type { LLMClient, ProviderCapabilities } from './types';
import {
  buildOpenAIHeaders,
  mapModelRowToModelInfo,
  mapOpenAIResponseToQueryResponse,
  mapQueryInputToOpenAIChatBody,
  parseJsonFromOpenAIText,
  urlForOpenAIPath,
  type OpenAIChatCompletionResponse,
  type OpenAIModelRow,
} from './openai_compat';

const defaultFetch: typeof fetch = (input, init) => globalThis.fetch(input, init);

/**
 * Same-origin route exposed by the bundled proxy server. STARK does not
 * currently handle browser CORS preflights, so direct browser requests to
 * https://api.genai.mil/v1 cannot succeed even with a valid API key.
 */
export const GENAI_MIL_DEFAULT_BASE_URL = '/api/genai/v1';
export const GENAI_MIL_TIMEOUT_MS = 5 * 60 * 1000;

interface GenAIMilModelsResponse {
  data?: OpenAIModelRow[];
}

/**
 * Client for the GenAI.mil STARK gateway described by issue #13.
 *
 * Although the gateway uses OpenAI-compatible routes, its Swagger schema is
 * intentionally narrower than OpenAI's: it does not accept tools,
 * tool_choice, response_format, embeddings, or provider-specific RAG fields.
 * Keep this as a distinct provider so unsupported fields cannot leak into
 * requests as the broader OpenAI-compatible clients evolve.
 */
export class GenAIMilClient implements LLMClient {
  readonly capabilities: ProviderCapabilities = {
    fileUpload: false,
    dataset: false,
    liveSearch: false,
    tools: false,
    jsonOutput: false,
    embeddings: false,
  };

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = defaultFetch,
    private readonly timeoutMs: number = GENAI_MIL_TIMEOUT_MS,
  ) {
    if (!baseUrl.trim()) throw new Error('GenAIMilClient: baseUrl is required');
    if (!apiKey.trim()) throw new Error('GenAIMilClient: apiKey is required');
  }

  private url(path: string): string {
    return urlForOpenAIPath(this.baseUrl, path);
  }

  private headers(includeContentType: boolean): Record<string, string> {
    return buildOpenAIHeaders({
      apiKey: this.apiKey,
      includeContentType,
    });
  }

  async getModels(): Promise<ModelInfo[]> {
    const url = this.url('/models');
    const startedAt = Date.now();
    const res = await this.request(url, {
      method: 'GET',
      headers: this.headers(false),
    }, 'GET');
    const text = await res.text();
    const ms = Date.now() - startedAt;

    if (!res.ok) {
      this.auditFailure('/genai-mil/models', text, ms, res);
      throw responseError('GET', url, res, text);
    }

    let parsed: GenAIMilModelsResponse;
    try {
      parsed = JSON.parse(text) as GenAIMilModelsResponse;
    } catch {
      throw new AskSageError(res.status, `GenAI.mil GET ${url} returned a non-JSON body`, text);
    }

    void writeAuditEntry({
      endpoint: '/genai-mil/models',
      prompt_excerpt: '',
      response_excerpt: text.slice(0, 1500),
      ms,
      ok: true,
    });

    return (parsed.data ?? []).map((row) => {
      const model = mapModelRowToModelInfo(row, 'genai_mil');
      return {
        ...model,
        capabilities: {
          ...(model.capabilities ?? {}),
          supported_parameters: ['temperature'],
          tool_calling: false,
          json_output: false,
          backend_notes: 'GenAI.mil STARK chat completions do not support tool calling.',
        },
      };
    });
  }

  async query(input: QueryInput): Promise<QueryResponse> {
    const url = this.url('/chat/completions');
    const startedAt = Date.now();
    const mapped = mapQueryInputToOpenAIChatBody(input);

    // Rebuild from the Swagger allow-list. Do not forward tools, tool_choice,
    // tool transcript envelopes, or provider-specific QueryInput fields.
    const body = {
      model: mapped.model,
      messages: mapped.messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
      ...(typeof mapped.temperature === 'number'
        ? { temperature: mapped.temperature }
        : {}),
      stream: false,
    };
    const requestText = JSON.stringify(body);
    const res = await this.request(url, {
      method: 'POST',
      headers: this.headers(true),
      body: requestText,
    }, 'POST');
    const text = await res.text();
    const ms = Date.now() - startedAt;

    if (!res.ok) {
      void writeAuditEntry({
        endpoint: '/genai-mil/chat/completions',
        model: input.model,
        prompt_excerpt: requestText,
        response_excerpt: text,
        ms,
        ok: false,
        error: `${res.status} ${res.statusText}`,
      });
      throw responseError('POST', url, res, text);
    }

    let parsed: OpenAIChatCompletionResponse;
    try {
      parsed = JSON.parse(text) as OpenAIChatCompletionResponse;
    } catch {
      throw new AskSageError(res.status, `GenAI.mil POST ${url} returned a non-JSON body`, text);
    }

    const response = mapOpenAIResponseToQueryResponse(parsed);
    void writeAuditEntry({
      endpoint: '/genai-mil/chat/completions',
      model: input.model,
      prompt_excerpt: requestText,
      response_excerpt: text,
      tokens_in: response.usage?.prompt_tokens,
      tokens_out: response.usage?.completion_tokens,
      ms,
      ok: true,
    });
    return response;
  }

  async queryJson<T>(input: QueryInput): Promise<{ data: T; raw: QueryResponse }> {
    const raw = await this.query(input);
    const text = (raw.message ?? '').trim();
    try {
      return { data: parseJsonFromOpenAIText<T>(text), raw };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new AskSageError(
        raw.status ?? null,
        `GenAI.mil queryJson: response was not parseable JSON (${reason}). ` +
          `Raw response (first 2000 chars):\n${text.slice(0, 2000)}`,
        text,
      );
    }
  }

  private async request(
    input: RequestInfo | URL,
    init: RequestInit,
    method: 'GET' | 'POST',
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(input, { ...init, signal: controller.signal });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new AskSageError(
        null,
        `GenAI.mil ${method} ${String(input)} failed: ${reason}. ` +
          'Confirm the STARK gateway URL, network access, API key, and browser CORS policy.',
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private auditFailure(endpoint: string, text: string, ms: number, res: Response): void {
    void writeAuditEntry({
      endpoint,
      prompt_excerpt: '',
      response_excerpt: text,
      ms,
      ok: false,
      error: `${res.status} ${res.statusText}`,
    });
  }
}

function responseError(method: string, url: string, res: Response, text: string): AskSageError {
  return new AskSageError(
    res.status,
    `GenAI.mil ${method} ${url} failed (${res.status} ${res.statusText}): ${text || '(empty body)'}`,
    text,
  );
}

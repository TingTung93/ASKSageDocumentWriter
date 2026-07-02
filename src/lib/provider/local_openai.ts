import { writeAuditEntry } from '../asksage/audit';
import { AskSageError } from '../asksage/types';
import type {
  ModelCapabilities,
  ModelInfo,
  QueryInput,
  QueryResponse,
} from '../asksage/types';
import type { LLMClient, ProviderCapabilities } from './types';
import {
  buildOpenAIHeaders,
  mapModelRowToModelInfo,
  mapOpenAIResponseToQueryResponse,
  mapQueryInputToOpenAIChatBody,
  parseJsonFromOpenAIText,
  sortOpenAIEmbeddings,
  urlForOpenAIPath,
  type OpenAIChatCompletionResponse,
  type OpenAIEmbeddingsResponse,
  type OpenAIModelRow,
} from './openai_compat';

const defaultFetch: typeof fetch = (input, init) => globalThis.fetch(input, init);

export const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

const DEFAULT_EMBEDDING_MODEL = 'nomic-embed-text';

export const LOCAL_OPENAI_PRESETS = [
  { id: 'ollama', name: 'Ollama', baseUrl: 'http://localhost:11434/v1' },
  { id: 'llama.cpp', name: 'llama.cpp', baseUrl: 'http://localhost:8080/v1' },
  { id: 'lmstudio', name: 'LM Studio', baseUrl: 'http://localhost:1234/v1' },
] as const;

export interface LocalEndpointProbeResult {
  ok: boolean;
  baseUrl: string;
  model: string | null;
  capabilities: {
    models: boolean;
    chat: boolean;
    tools: boolean;
    jsonOutput: boolean;
    embeddings: boolean;
  };
  warnings: string[];
  error?: string;
}

interface LocalModelsResponse {
  data?: OpenAIModelRow[];
  object?: string;
}

interface LocalModelEnrichment {
  context_length?: number;
  tool_calling?: boolean;
  json_output?: boolean;
  recommended_vram_gb: 8 | 16 | 24;
  backend_notes: string;
}

export class LocalOpenAIClient implements LLMClient {
  readonly capabilities: ProviderCapabilities = {
    fileUpload: false,
    dataset: false,
    liveSearch: false,
    tools: true,
    jsonOutput: true,
    embeddings: false,
  };

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string = '',
    private readonly fetchImpl: typeof fetch = defaultFetch,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {
    if (!baseUrl.trim()) throw new Error('LocalOpenAIClient: baseUrl is required');
  }

  private url(path: string): string {
    return urlForOpenAIPath(this.baseUrl, path);
  }

  private buildHeaders(includeContentType: boolean): Record<string, string> {
    return buildOpenAIHeaders({
      apiKey: this.apiKey,
      includeContentType,
    });
  }

  async getModels(): Promise<ModelInfo[]> {
    const url = this.url('/models');
    const startedAt = Date.now();
    let res: Response;
    try {
      res = await this.fetchWithTimeout(url, {
        method: 'GET',
        headers: this.buildHeaders(false),
      });
    } catch (err) {
      const errorMsg = localNetworkError('GET', url, err);
      void writeAuditEntry({
        endpoint: '/local-openai/models',
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
        endpoint: '/local-openai/models',
        prompt_excerpt: '',
        response_excerpt: text,
        ms,
        ok: false,
        error: `${res.status} ${res.statusText}`,
      });
      throw new AskSageError(
        res.status,
        `Local OpenAI GET ${url} failed (${res.status} ${res.statusText}): ${text || '(empty body)'}`,
        text,
      );
    }

    let parsed: LocalModelsResponse;
    try {
      parsed = JSON.parse(text) as LocalModelsResponse;
    } catch {
      throw new AskSageError(res.status, `Local OpenAI GET ${url} returned non-JSON body`, text);
    }

    void writeAuditEntry({
      endpoint: '/local-openai/models',
      prompt_excerpt: '',
      response_excerpt: text.slice(0, 1500),
      ms,
      ok: true,
    });

    return (parsed.data ?? []).map((row) => enrichLocalModelInfo(mapModelRowToModelInfo(row, 'local_openai')));
  }

  async query(input: QueryInput): Promise<QueryResponse> {
    const url = this.url('/chat/completions');
    const startedAt = Date.now();
    const body = mapQueryInputToOpenAIChatBody(input);
    const reqBodyStr = JSON.stringify(body);
    let res: Response;
    try {
      res = await this.fetchWithTimeout(url, {
        method: 'POST',
        headers: this.buildHeaders(true),
        body: reqBodyStr,
      });
    } catch (err) {
      const errorMsg = localNetworkError('POST', url, err);
      void writeAuditEntry({
        endpoint: '/local-openai/chat/completions',
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
        endpoint: '/local-openai/chat/completions',
        model: input.model,
        prompt_excerpt: reqBodyStr,
        response_excerpt: text,
        ms,
        ok: false,
        error: `${res.status} ${res.statusText}`,
      });
      throw new AskSageError(
        res.status,
        `Local OpenAI POST ${url} failed (${res.status} ${res.statusText}): ${text || '(empty body)'}`,
        text,
      );
    }

    let parsed: OpenAIChatCompletionResponse;
    try {
      parsed = JSON.parse(text) as OpenAIChatCompletionResponse;
    } catch {
      throw new AskSageError(res.status, `Local OpenAI POST ${url} returned non-JSON body`, text);
    }

    const mapped = mapOpenAIResponseToQueryResponse(parsed);
    void writeAuditEntry({
      endpoint: '/local-openai/chat/completions',
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
        `Local OpenAI queryJson: response was not parseable JSON (${reason}). ` +
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
      res = await this.fetchWithTimeout(url, {
        method: 'POST',
        headers: this.buildHeaders(true),
        body: reqBody,
      });
    } catch (err) {
      const errorMsg = localNetworkError('POST', url, err);
      void writeAuditEntry({
        endpoint: '/local-openai/embeddings',
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
        endpoint: '/local-openai/embeddings',
        model,
        prompt_excerpt: reqBody.slice(0, 500),
        response_excerpt: text,
        ms,
        ok: false,
        error: `${res.status} ${res.statusText}`,
      });
      throw new AskSageError(
        res.status,
        `Local OpenAI POST ${url} failed (${res.status} ${res.statusText}): ${text || '(empty body)'}`,
        text,
      );
    }

    let parsed: OpenAIEmbeddingsResponse;
    try {
      parsed = JSON.parse(text) as OpenAIEmbeddingsResponse;
    } catch {
      throw new AskSageError(res.status, `Local OpenAI POST ${url} returned non-JSON body`, text);
    }

    void writeAuditEntry({
      endpoint: '/local-openai/embeddings',
      model,
      prompt_excerpt: reqBody.slice(0, 500),
      response_excerpt: text.slice(0, 1500),
      tokens_in: parsed.usage?.prompt_tokens,
      ms,
      ok: true,
    });

    const sorted = sortOpenAIEmbeddings(parsed);
    return {
      embeddings: sorted.map((d) => d.embedding),
      tokens: parsed.usage?.prompt_tokens ?? 0,
    };
  }

  private async fetchWithTimeout(input: RequestInfo | URL, init: RequestInit): Promise<Response> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(input, { ...init, signal: ac.signal });
    } finally {
      clearTimeout(timer);
    }
  }
}

export function enrichLocalModelInfo(model: ModelInfo): ModelInfo {
  const enrichment = findLocalModelEnrichment(model.id);
  if (!enrichment) return model;

  const capabilities: ModelCapabilities = {
    ...(model.capabilities ?? {}),
  };
  capabilities.context_length ??= enrichment.context_length;
  capabilities.tool_calling ??= enrichment.tool_calling;
  capabilities.json_output ??= enrichment.json_output;
  capabilities.recommended_vram_gb ??= enrichment.recommended_vram_gb;
  capabilities.backend_notes ??= enrichment.backend_notes;

  const supported = new Set(capabilities.supported_parameters ?? []);
  if (enrichment.tool_calling) supported.add('tools');
  if (enrichment.json_output) supported.add('response_format');
  if (supported.size > 0) capabilities.supported_parameters = [...supported];

  return {
    ...model,
    capabilities,
  };
}

export function isLocalhostBaseUrl(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
  } catch {
    return false;
  }
}

export async function probeLocalOpenAIEndpoint({
  baseUrl,
  apiKey = '',
  model,
  fetchImpl = defaultFetch,
}: {
  baseUrl: string;
  apiKey?: string;
  model?: string;
  fetchImpl?: typeof fetch;
}): Promise<LocalEndpointProbeResult> {
  const warnings: string[] = [];
  if (!isLocalhostBaseUrl(baseUrl)) {
    warnings.push('Endpoint is not localhost, 127.0.0.1, or [::1]; confirm this is an intended local or trusted server.');
  }

  const client = new LocalOpenAIClient(baseUrl, apiKey, fetchImpl);
  const result: LocalEndpointProbeResult = {
    ok: false,
    baseUrl,
    model: null,
    capabilities: {
      models: false,
      chat: false,
      tools: false,
      jsonOutput: false,
      embeddings: false,
    },
    warnings,
  };

  try {
    const models = await client.getModels();
    result.capabilities.models = true;
    result.model = model ?? models[0]?.id ?? null;
    if (!result.model) {
      result.error = 'Local OpenAI endpoint returned no models.';
      return result;
    }

    await client.query({
      model: result.model,
      message: 'Reply with ok.',
      temperature: 0,
    });
    result.capabilities.chat = true;

    try {
      const toolResponse = await client.query({
        model: result.model,
        message: 'Use lookup_policy for document type PWS.',
        temperature: 0,
        tools: [
          {
            type: 'function',
            function: {
              name: 'lookup_policy',
              description: 'Look up acquisition policy by document type.',
              parameters: {
                type: 'object',
                properties: {
                  document_type: {
                    type: 'string',
                    enum: ['PWS'],
                  },
                },
                required: ['document_type'],
              },
            },
          },
        ],
        tool_choice: {
          type: 'function',
          function: { name: 'lookup_policy' },
        },
      });
      result.capabilities.tools = (toolResponse.tool_calls ?? []).some(
        (call) => call.function.name === 'lookup_policy',
      );
      if (!result.capabilities.tools) {
        warnings.push('Tool calls were not returned in native OpenAI format.');
      }
    } catch (err) {
      warnings.push(`Tool call probe failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    await client.queryJson<{ ok: boolean }>({
      model: result.model,
      message: 'Return exactly {"ok":true}.',
      temperature: 0,
    });
    result.capabilities.jsonOutput = true;

    try {
      await client.embed(['local openai embedding probe']);
      result.capabilities.embeddings = true;
    } catch (err) {
      warnings.push(`Embeddings probe failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    result.ok = result.capabilities.models && result.capabilities.chat && result.capabilities.jsonOutput;
    return result;
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    return result;
  }
}

function localNetworkError(method: string, url: string, err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return (
    `Local OpenAI network error calling ${method} ${url}: ${message}. ` +
    'Check local server running status, confirm the base URL includes /v1, and ensure CORS is enabled for this browser app.'
  );
}

function findLocalModelEnrichment(modelId: string): LocalModelEnrichment | null {
  const id = modelId.toLowerCase();
  if (id.includes('qwen3:4b')) {
    return {
      context_length: 32768,
      tool_calling: true,
      json_output: true,
      recommended_vram_gb: 8,
      backend_notes: 'Qwen3 small local model; good for fast drafting probes with Ollama, llama.cpp, or LM Studio.',
    };
  }
  if (id.includes('qwen3:8b')) {
    return {
      context_length: 32768,
      tool_calling: true,
      json_output: true,
      recommended_vram_gb: 8,
      backend_notes: 'Qwen3 8B local model; balanced default for local tool and JSON probes.',
    };
  }
  if (id.includes('qwen3:14b')) {
    return {
      context_length: 32768,
      tool_calling: true,
      json_output: true,
      recommended_vram_gb: 16,
      backend_notes: 'Qwen3 14B local model; stronger reasoning with moderate VRAM requirements.',
    };
  }
  if (id.includes('qwen3:30b') || id.includes('qwen3:32b')) {
    return {
      context_length: 32768,
      tool_calling: true,
      json_output: true,
      recommended_vram_gb: 24,
      backend_notes: 'Large Qwen3 local model; prefer high-VRAM systems or quantized builds.',
    };
  }
  if (id.includes('llama3.1:8b') || id.includes('llama-3.1-8b')) {
    return {
      context_length: 128000,
      tool_calling: true,
      json_output: true,
      recommended_vram_gb: 8,
      backend_notes: 'Llama 3.1 8B supports long-context local drafting on compatible backends.',
    };
  }
  if (id.includes('mistral-nemo')) {
    return {
      context_length: 128000,
      tool_calling: true,
      json_output: true,
      recommended_vram_gb: 16,
      backend_notes: 'Mistral Nemo local model with long context; useful for reference-heavy drafts.',
    };
  }
  if (id.includes('mistral-small3.1:24b') || id.includes('mistral-small-3.1') || id.includes('mistral-small-24b')) {
    return {
      context_length: 128000,
      tool_calling: true,
      json_output: true,
      recommended_vram_gb: 24,
      backend_notes: 'Mistral Small 3.1 24B local model; strong quality when sufficient VRAM is available.',
    };
  }
  if (id.includes('gemma3:4b')) {
    return {
      context_length: 128000,
      tool_calling: true,
      json_output: true,
      recommended_vram_gb: 8,
      backend_notes: 'Gemma 3 4B local model; lightweight option for quick local drafting.',
    };
  }
  if (id.includes('gemma3:12b')) {
    return {
      context_length: 128000,
      tool_calling: true,
      json_output: true,
      recommended_vram_gb: 16,
      backend_notes: 'Gemma 3 12B local model; balanced quality and VRAM profile.',
    };
  }
  if (id.includes('gemma3:27b')) {
    return {
      context_length: 128000,
      tool_calling: true,
      json_output: true,
      recommended_vram_gb: 24,
      backend_notes: 'Gemma 3 27B local model; prefer high-VRAM systems or quantized builds.',
    };
  }
  return null;
}

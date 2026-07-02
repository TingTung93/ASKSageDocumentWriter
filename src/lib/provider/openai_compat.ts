import type {
  ModelCapabilities,
  ModelInfo,
  OpenAITool,
  OpenAIToolCall,
  OpenAIToolChoice,
  QueryInput,
  QueryResponse,
  QueryUsage,
} from '../asksage/types';

export interface OpenAIModelRow {
  id: string;
  name?: string;
  created?: number | string;
  description?: string;
  context_length?: number;
  architecture?: {
    modality?: string;
    input_modalities?: string[];
    output_modalities?: string[];
    tokenizer?: string;
  };
  supported_parameters?: string[];
}

export interface OpenAIChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface OpenAIChatBody {
  model: string;
  messages: OpenAIChatMessage[];
  temperature?: number;
  tools?: OpenAITool[];
  tool_choice?: 'none' | 'auto' | 'required' | OpenAIToolChoice;
}

export interface OpenAIChatCompletionResponse {
  id: string;
  object?: string;
  choices: Array<{
    index?: number;
    message: {
      role: string;
      content: string;
      tool_calls?: OpenAIToolCall[];
    };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export interface OpenAIEmbeddingsResponse {
  data: Array<{
    index: number;
    embedding: number[];
  }>;
  usage?: {
    prompt_tokens?: number;
    total_tokens?: number;
  };
}

export function urlForOpenAIPath(baseUrl: string, path: string): string {
  const trimmed = baseUrl.replace(/\/$/, '');
  return `${trimmed}${path.startsWith('/') ? path : `/${path}`}`;
}

export function buildOpenAIHeaders({
  apiKey,
  includeContentType,
  extra,
}: {
  apiKey?: string;
  includeContentType: boolean;
  extra?: Record<string, string | undefined>;
}): Record<string, string> {
  const headers: Record<string, string> = {};
  const trimmedKey = apiKey?.trim();
  if (trimmedKey) headers.Authorization = `Bearer ${trimmedKey}`;
  if (includeContentType) headers['Content-Type'] = 'application/json';
  for (const [key, value] of Object.entries(extra ?? {})) {
    if (value !== undefined) headers[key] = value;
  }
  return headers;
}

export function mapQueryInputToOpenAIChatBody(input: QueryInput): OpenAIChatBody {
  const messages: OpenAIChatMessage[] = [];
  if (input.system_prompt) {
    messages.push({ role: 'system', content: input.system_prompt });
  }
  if (typeof input.message === 'string') {
    messages.push({ role: 'user', content: input.message });
  } else {
    for (const turn of input.message) {
      const role: OpenAIChatMessage['role'] =
        turn.user === 'gpt' ? 'assistant' : turn.user === 'tool' ? 'tool' : 'user';
      const msg: OpenAIChatMessage = { role, content: turn.message };
      if (turn.tool_calls) msg.tool_calls = turn.tool_calls;
      if (turn.tool_call_id) msg.tool_call_id = turn.tool_call_id;
      if (turn.name) msg.name = turn.name;
      messages.push(msg);
    }
  }

  const out: OpenAIChatBody = {
    model: input.model ?? '',
    messages,
  };
  if (typeof input.temperature === 'number') out.temperature = input.temperature;
  if (input.tools && input.tools.length > 0) out.tools = input.tools;
  if (input.tool_choice) out.tool_choice = input.tool_choice;
  return out;
}

export function mapOpenAIResponseToQueryResponse(r: OpenAIChatCompletionResponse): QueryResponse {
  const content = r.choices?.[0]?.message?.content ?? '';
  const usage: QueryUsage | null = r.usage
    ? {
        prompt_tokens: r.usage.prompt_tokens,
        completion_tokens: r.usage.completion_tokens,
        total_tokens: r.usage.total_tokens,
      }
    : null;
  const tool_calls = r.choices?.[0]?.message?.tool_calls;
  return {
    message: content,
    response: 'OK',
    status: 200,
    uuid: r.id,
    references: '',
    embedding_down: false,
    vectors_down: false,
    usage,
    tool_calls,
  };
}

export function stripCodeFence(text: string): string {
  const fenced = text.match(/^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/i);
  if (fenced) return fenced[1]!.trim();
  return text;
}

export function parseJsonFromOpenAIText<T>(text: string): T {
  return JSON.parse(stripCodeFence(text.trim())) as T;
}

export function mapModelRowToModelInfo(row: OpenAIModelRow, fallbackOwner: string): ModelInfo {
  const owner = row.id.includes('/') ? row.id.split('/')[0] ?? fallbackOwner : fallbackOwner;
  const out: ModelInfo = {
    id: row.id,
    name: row.name ?? row.id,
    object: 'model',
    owned_by: owner,
    created: typeof row.created === 'number' ? String(row.created) : row.created ?? 'na',
  };
  const capabilities = extractCapabilities(row);
  if (capabilities) out.capabilities = capabilities;
  return out;
}

export function extractCapabilities(row: OpenAIModelRow): ModelCapabilities | null {
  const out: ModelCapabilities = {};
  if (typeof row.context_length === 'number' && row.context_length > 0) {
    out.context_length = row.context_length;
  }
  const inMods = row.architecture?.input_modalities;
  if (Array.isArray(inMods) && inMods.length > 0) {
    out.input_modalities = inMods.slice();
  }
  const outMods = row.architecture?.output_modalities;
  if (Array.isArray(outMods) && outMods.length > 0) {
    out.output_modalities = outMods.slice();
  }
  if (Array.isArray(row.supported_parameters) && row.supported_parameters.length > 0) {
    out.supported_parameters = row.supported_parameters.slice();
  }
  return Object.keys(out).length > 0 ? out : null;
}

export function sortOpenAIEmbeddings(
  response: OpenAIEmbeddingsResponse,
): OpenAIEmbeddingsResponse['data'] {
  return [...response.data].sort((a, b) => a.index - b.index);
}

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenRouterClient } from './openrouter';
import { AskSageError } from '../asksage/types';

describe('OpenRouterClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
  });

  function makeClient(key = 'sk-or-test') {
    return new OpenRouterClient(
      key,
      'https://openrouter.ai/api/v1',
      fetchMock as unknown as typeof fetch,
    );
  }

  it('rejects construction without an api key', () => {
    expect(() => new OpenRouterClient('')).toThrow(/apiKey/);
  });

  it('getModels() GETs /v1/models with Bearer auth and maps response shape', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', created: 1717200000 },
            { id: 'openai/gpt-4o', name: 'GPT-4o', created: 1717200001 },
          ],
        }),
        { status: 200 },
      ),
    );
    const client = makeClient();
    const models = await client.getModels();

    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://openrouter.ai/api/v1/models');
    expect(opts.method).toBe('GET');
    const headers = opts.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer sk-or-test');
    // GET must NOT include Content-Type — that would add it to the preflight.
    expect(headers['Content-Type']).toBeUndefined();
    // Default attribution title set in constructor.
    expect(headers['X-Title']).toBe('ASKSageDocumentWriter');

    expect(models).toHaveLength(2);
    expect(models[0]?.id).toBe('anthropic/claude-3.5-sonnet');
    expect(models[0]?.name).toBe('Claude 3.5 Sonnet');
    expect(models[0]?.owned_by).toBe('anthropic');
    expect(models[0]?.created).toBe('1717200000');
    expect(models[1]?.owned_by).toBe('openai');
    // Models without pricing data have undefined pricing.
    expect(models[0]?.pricing).toBeUndefined();
  });

  it('getModels() extracts paid pricing from /v1/models response', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'anthropic/claude-3.5-sonnet',
              name: 'Claude 3.5 Sonnet',
              pricing: {
                prompt: '0.000003',
                completion: '0.000015',
                request: '0',
                image: '0',
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const client = makeClient();
    const models = await client.getModels();
    expect(models[0]?.pricing).toEqual({
      prompt_per_token: 0.000003,
      completion_per_token: 0.000015,
      is_free: false,
    });
  });

  it('getModels() flags zero-priced models as free', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'meta-llama/llama-3.1-8b-instruct',
              name: 'Llama 3.1 8B Instruct',
              pricing: { prompt: '0', completion: '0' },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const client = makeClient();
    const models = await client.getModels();
    expect(models[0]?.pricing?.is_free).toBe(true);
    expect(models[0]?.pricing?.prompt_per_token).toBe(0);
  });

  it('getModels() extracts capability metadata (context_length, modalities, supported_parameters)', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'anthropic/claude-3.5-sonnet',
              name: 'Claude 3.5 Sonnet',
              context_length: 200000,
              architecture: {
                modality: 'text+image->text',
                input_modalities: ['text', 'image'],
                output_modalities: ['text'],
                tokenizer: 'Claude',
              },
              supported_parameters: ['temperature', 'top_p', 'tools', 'response_format'],
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const client = makeClient();
    const models = await client.getModels();
    expect(models[0]?.capabilities).toEqual({
      context_length: 200000,
      input_modalities: ['text', 'image'],
      output_modalities: ['text'],
      supported_parameters: ['temperature', 'top_p', 'tools', 'response_format'],
    });
  });

  it('getModels() leaves capabilities undefined when the row has no capability fields', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [{ id: 'foo/bar', name: 'Bar' }],
        }),
        { status: 200 },
      ),
    );
    const client = makeClient();
    const models = await client.getModels();
    expect(models[0]?.capabilities).toBeUndefined();
  });

  it('getModels() flags `:free` suffix ids as free even without explicit pricing', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            { id: 'meta-llama/llama-3.1-8b-instruct:free', name: 'Llama 3.1 8B Instruct (free)' },
          ],
        }),
        { status: 200 },
      ),
    );
    const client = makeClient();
    const models = await client.getModels();
    expect(models[0]?.pricing?.is_free).toBe(true);
  });

  it('query() POSTs to /v1/chat/completions and maps response to QueryResponse', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'gen-abc-123',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'pong' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 },
        }),
        { status: 200 },
      ),
    );
    const client = makeClient();
    const r = await client.query({
      message: 'ping',
      model: 'anthropic/claude-3.5-sonnet',
      temperature: 0.2,
      system_prompt: 'be concise',
    });

    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body as string);
    // System prompt is prepended; user message follows.
    expect(body.messages).toEqual([
      { role: 'system', content: 'be concise' },
      { role: 'user', content: 'ping' },
    ]);
    expect(body.model).toBe('anthropic/claude-3.5-sonnet');
    expect(body.temperature).toBe(0.2);
    // Ask-Sage-only knobs MUST NOT be forwarded to OpenRouter.
    expect(body.dataset).toBeUndefined();
    expect(body.limit_references).toBeUndefined();
    expect(body.live).toBeUndefined();
    expect(body.persona).toBeUndefined();

    expect(r.message).toBe('pong');
    expect(r.uuid).toBe('gen-abc-123');
    expect(r.usage?.prompt_tokens).toBe(12);
    expect(r.usage?.completion_tokens).toBe(5);
  });

  it('query() maps Ask-Sage-shape turn array {user, message} to OpenAI roles', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'g',
          choices: [{ message: { role: 'assistant', content: 'ok' } }],
        }),
        { status: 200 },
      ),
    );
    const client = makeClient();
    await client.query({
      model: 'openai/gpt-4o',
      message: [
        { user: 'me', message: 'hi' },
        { user: 'gpt', message: 'hello' },
        { user: 'me', message: 'thanks' },
      ],
    });
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.messages).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
      { role: 'user', content: 'thanks' },
    ]);
  });

  it('query() throws AskSageError when no model is supplied (OpenRouter has no default)', async () => {
    const client = makeClient();
    await expect(client.query({ message: 'hi' })).rejects.toMatchObject({
      name: 'AskSageError',
      message: expect.stringContaining('OpenRouter requires an explicit model id'),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('query() surfaces network failures as AskSageError(null) with diagnostic', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const client = makeClient();
    const err = await client
      .query({ message: 'hi', model: 'openai/gpt-4o' })
      .catch((e) => e as AskSageError);
    expect(err).toBeInstanceOf(AskSageError);
    expect((err as AskSageError).status).toBeNull();
    expect((err as AskSageError).message).toContain('Authorization: Bearer');
  });

  it('query() throws AskSageError with status on non-OK response', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{"error":{"message":"insufficient credits"}}', { status: 402, statusText: 'Payment Required' }),
    );
    const client = makeClient();
    const err = await client
      .query({ message: 'hi', model: 'openai/gpt-4o' })
      .catch((e) => e as AskSageError);
    expect((err as AskSageError).status).toBe(402);
    expect((err as AskSageError).message).toContain('insufficient credits');
  });

  it('queryJson() parses fenced ```json blocks', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'g',
          choices: [
            {
              message: {
                role: 'assistant',
                content: '```json\n{"ok":true,"count":3}\n```',
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const client = makeClient();
    const { data, raw } = await client.queryJson<{ ok: boolean; count: number }>({
      message: 'give me json',
      model: 'openai/gpt-4o',
      temperature: 0,
    });
    expect(data).toEqual({ ok: true, count: 3 });
    expect(raw.uuid).toBe('g');
  });

  it('queryJson() throws AskSageError with raw text on parse failure', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'g',
          choices: [{ message: { role: 'assistant', content: 'not json at all' } }],
        }),
        { status: 200 },
      ),
    );
    const client = makeClient();
    const err = await client
      .queryJson({ message: 'x', model: 'openai/gpt-4o' })
      .catch((e) => e as AskSageError);
    expect(err).toBeInstanceOf(AskSageError);
    expect((err as AskSageError).message).toContain('not parseable JSON');
    expect((err as AskSageError).body).toContain('not json at all');
  });
});

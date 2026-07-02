import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AskSageError } from '../asksage/types';
import {
  LOCAL_OPENAI_PRESETS,
  LocalOpenAIClient,
  isLocalhostBaseUrl,
  probeLocalOpenAIEndpoint,
} from './local_openai';

vi.mock('../asksage/audit', () => ({
  writeAuditEntry: vi.fn().mockResolvedValue(undefined),
}));

describe('LocalOpenAIClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
  });

  function makeClient(apiKey = '') {
    return new LocalOpenAIClient(
      'http://localhost:11434/v1',
      apiKey,
      fetchMock as unknown as typeof fetch,
    );
  }

  it('presets expose the expected local OpenAI-compatible base URLs', () => {
    expect(LOCAL_OPENAI_PRESETS).toEqual([
      { id: 'ollama', name: 'Ollama', baseUrl: 'http://localhost:11434/v1' },
      { id: 'llama.cpp', name: 'llama.cpp', baseUrl: 'http://localhost:8080/v1' },
      { id: 'lmstudio', name: 'LM Studio', baseUrl: 'http://localhost:1234/v1' },
    ]);
  });

  it('isLocalhostBaseUrl detects localhost loopback URLs and rejects LAN IPs', () => {
    expect(isLocalhostBaseUrl('http://localhost:11434/v1')).toBe(true);
    expect(isLocalhostBaseUrl('http://127.0.0.1:8080/v1')).toBe(true);
    expect(isLocalhostBaseUrl('http://[::1]:1234/v1')).toBe(true);
    expect(isLocalhostBaseUrl('http://192.168.1.20:11434/v1')).toBe(false);
  });

  it('getModels omits Authorization when apiKey is blank and enriches qwen3:8b', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [{ id: 'qwen3:8b', object: 'model', created: 1717200000 }],
        }),
        { status: 200 },
      ),
    );
    const models = await makeClient().getModels();

    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:11434/v1/models');
    expect(opts.method).toBe('GET');
    const headers = opts.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
    expect(headers['Content-Type']).toBeUndefined();
    expect(models[0]).toMatchObject({
      id: 'qwen3:8b',
      owned_by: 'local_openai',
      capabilities: {
        tool_calling: true,
        json_output: true,
        recommended_vram_gb: 8,
      },
    });
  });

  it('getModels sends Bearer auth when apiKey is provided', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ id: 'llama3.1:8b' }] }), { status: 200 }),
    );
    await makeClient('sk-local').getModels();

    const headers = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer sk-local');
    expect(headers['Content-Type']).toBeUndefined();
  });

  it('query posts chat completions and maps tool calls', async () => {
    const toolCall = {
      id: 'call-lookup',
      type: 'function' as const,
      function: { name: 'lookup_policy', arguments: '{"document_type":"PWS"}' },
    };
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'chat-1',
          choices: [{ message: { role: 'assistant', content: '', tool_calls: [toolCall] } }],
          usage: { prompt_tokens: 8, completion_tokens: 3, total_tokens: 11 },
        }),
        { status: 200 },
      ),
    );

    const response = await makeClient().query({
      model: 'qwen3:8b',
      message: 'Pick the right policy.',
      tools: [
        {
          type: 'function',
          function: {
            name: 'lookup_policy',
            parameters: {
              type: 'object',
              properties: { document_type: { type: 'string' } },
              required: ['document_type'],
            },
          },
        },
      ],
      tool_choice: { type: 'function', function: { name: 'lookup_policy' } },
      dataset: 'ignored',
      limit_references: 5,
      live: 2,
    });

    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:11434/v1/chat/completions');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body as string);
    expect(body).toMatchObject({
      model: 'qwen3:8b',
      messages: [{ role: 'user', content: 'Pick the right policy.' }],
      tool_choice: { type: 'function', function: { name: 'lookup_policy' } },
    });
    expect(body.tools[0].function.name).toBe('lookup_policy');
    expect(body.dataset).toBeUndefined();
    expect(body.limit_references).toBeUndefined();
    expect(body.live).toBeUndefined();
    expect(response.tool_calls).toEqual([toolCall]);
    expect(response.usage?.total_tokens).toBe(11);
  });

  it('queryJson parses fenced JSON and throws AskSageError with raw body on invalid JSON', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'json-1',
            choices: [{ message: { role: 'assistant', content: '```json\n{"ok":true}\n```' } }],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'json-2',
            choices: [{ message: { role: 'assistant', content: 'not json' } }],
          }),
          { status: 200 },
        ),
      );

    await expect(
      makeClient().queryJson<{ ok: boolean }>({ model: 'qwen3:8b', message: 'json' }),
    ).resolves.toMatchObject({ data: { ok: true } });

    let err: unknown;
    try {
      await makeClient().queryJson({ model: 'qwen3:8b', message: 'bad json' });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(AskSageError);
    const askSageError = err as AskSageError;
    expect(askSageError.message).toContain('not parseable JSON');
    expect(askSageError.body).toBe('not json');
  });

  it('embed posts to local embeddings and sorts returned vectors', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            { index: 1, embedding: [0.3, 0.4] },
            { index: 0, embedding: [0.1, 0.2] },
          ],
          usage: { prompt_tokens: 9, total_tokens: 9 },
        }),
        { status: 200 },
      ),
    );

    const result = await makeClient().embed(['first', 'second']);

    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:11434/v1/embeddings');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body as string);
    expect(body).toEqual({ model: 'nomic-embed-text', input: ['first', 'second'] });
    expect(result.embeddings).toEqual([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
    expect(result.tokens).toBe(9);
  });

  it('network errors mention Local OpenAI and CORS guidance', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const err = await makeClient()
      .query({ model: 'qwen3:8b', message: 'hi' })
      .catch((e) => e as AskSageError);

    expect(err).toBeInstanceOf(AskSageError);
    expect(err.status).toBeNull();
    expect(err.message).toContain('Local OpenAI');
    expect(err.message).toContain('local server running');
    expect(err.message).toContain('/v1');
    expect(err.message).toContain('CORS');
  });

  it('probeLocalOpenAIEndpoint records model, chat, tool, json, and embedding capabilities', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ id: 'qwen3:8b' }] }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'chat-probe',
            choices: [{ message: { role: 'assistant', content: 'ok' } }],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'tool-probe',
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: '',
                  tool_calls: [
                    {
                      id: 'call-policy',
                      type: 'function',
                      function: {
                        name: 'lookup_policy',
                        arguments: '{"document_type":"PWS"}',
                      },
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'json-probe',
            choices: [{ message: { role: 'assistant', content: '{"ok":true}' } }],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ index: 0, embedding: [0.1, 0.2] }],
            usage: { prompt_tokens: 2 },
          }),
          { status: 200 },
        ),
      );

    const result = await probeLocalOpenAIEndpoint({
      baseUrl: 'http://localhost:11434/v1',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(result).toMatchObject({
      ok: true,
      model: 'qwen3:8b',
      capabilities: {
        models: true,
        chat: true,
        tools: true,
        jsonOutput: true,
        embeddings: true,
      },
      warnings: [],
    });
  });
});

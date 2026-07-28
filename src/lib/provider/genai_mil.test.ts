import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AskSageError } from '../asksage/types';
import { GENAI_MIL_DEFAULT_BASE_URL, GenAIMilClient } from './genai_mil';

vi.mock('../asksage/audit', () => ({
  writeAuditEntry: vi.fn().mockResolvedValue(undefined),
}));

describe('GenAIMilClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
  });

  function makeClient() {
    return new GenAIMilClient(
      'https://stark.example.mil/v1',
      'STARK_test-key',
      fetchMock as unknown as typeof fetch,
    );
  }

  it('requires both a base URL and API key', () => {
    expect(() => new GenAIMilClient('', 'key')).toThrow(/baseUrl/);
    expect(() => new GenAIMilClient('https://stark.example.mil/v1', '')).toThrow(/apiKey/);
  });

  it('uses the bundled same-origin proxy by default', () => {
    expect(GENAI_MIL_DEFAULT_BASE_URL).toBe('/api/genai/v1');
  });

  it('lists models with Bearer auth and marks tool calling unsupported', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({
        object: 'list',
        data: [{ id: 'model-a', object: 'model', created: 1, owned_by: 'stark-proxy' }],
      }), { status: 200 }),
    );

    const models = await makeClient().getModels();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://stark.example.mil/v1/models');
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer STARK_test-key');
    expect(models[0]).toMatchObject({
      id: 'model-a',
      owned_by: 'genai_mil',
      capabilities: {
        supported_parameters: ['temperature'],
        tool_calling: false,
        json_output: false,
      },
    });
  });

  it('sends only fields allowed by the STARK chat completion schema', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({
        id: 'chat-1',
        object: 'chat.completion',
        created: 1,
        model: 'model-a',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: '{"paragraphs":[]}' },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 },
      }), { status: 200 }),
    );

    const result = await makeClient().query({
      model: 'model-a',
      system_prompt: 'Return JSON.',
      message: 'Draft this.',
      temperature: 0,
      max_tokens: 8192,
      dataset: 'some-dataset',
      limit_references: 5,
      live: 2,
      tools: [{
        type: 'function',
        function: {
          name: 'lookup',
          parameters: { type: 'object', properties: {} },
        },
      }],
      tool_choice: 'required',
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://stark.example.mil/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'model-a',
      messages: [
        { role: 'system', content: 'Return JSON.' },
        { role: 'user', content: 'Draft this.' },
      ],
      temperature: 0,
      max_tokens: 8192,
      stream: false,
    });
    expect(result.message).toBe('{"paragraphs":[]}');
    expect(result.usage?.total_tokens).toBe(12);
  });

  it('parses fenced JSON and reports non-JSON output clearly', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          id: 'chat-json',
          choices: [{ message: { role: 'assistant', content: '```json\n{"ok":true}\n```' } }],
        }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          id: 'chat-bad',
          choices: [{ message: { role: 'assistant', content: 'not json' } }],
        }), { status: 200 }),
      );

    await expect(makeClient().queryJson<{ ok: boolean }>({
      model: 'model-a',
      message: 'json',
    })).resolves.toMatchObject({ data: { ok: true } });

    let error: unknown;
    try {
      await makeClient().queryJson({
        model: 'model-a',
        message: 'json',
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(AskSageError);
    expect((error as AskSageError).message).toContain('not parseable JSON');
    expect((error as AskSageError).body).toBe('not json');
  });

  it('identifies JSON truncated by the model output limit', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({
        id: 'chat-truncated',
        choices: [{
          message: { role: 'assistant', content: '{"edits":[{"op":"replace_' },
          finish_reason: 'length',
        }],
      }), { status: 200 }),
    );

    await expect(makeClient().queryJson({
      model: 'model-a',
      message: 'json',
      max_tokens: 8192,
    })).rejects.toThrow(/STARK truncated the response at max_tokens/);
  });

  it('extracts a complete JSON object wrapped in model commentary', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({
        id: 'chat-wrapped',
        choices: [{
          message: { role: 'assistant', content: 'Here is the result:\n{"edits":[]}\nDone.' },
          finish_reason: 'stop',
        }],
      }), { status: 200 }),
    );

    await expect(makeClient().queryJson<{ edits: unknown[] }>({
      model: 'model-a',
      message: 'json',
    })).resolves.toMatchObject({ data: { edits: [] } });
  });
});

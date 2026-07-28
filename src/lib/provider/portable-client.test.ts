import { describe, expect, it, vi } from 'vitest';
import type { LLMClient } from './types';
import { createPortableClient } from './portable-client';
import { PortableProviderError } from './portable-types';

function fakeClient(overrides: Partial<LLMClient> = {}): LLMClient {
  return {
    capabilities: {
      fileUpload: false,
      dataset: false,
      liveSearch: false,
      tools: true,
      jsonOutput: true,
      embeddings: false,
    },
    getModels: vi.fn().mockResolvedValue([
      {
        id: 'model-a',
        name: 'Model A',
        object: 'model',
        owned_by: 'test',
        created: 'na',
        capabilities: { context_length: 8192 },
      },
    ]),
    query: vi.fn().mockResolvedValue({
      message: '',
      response: 'OK',
      status: 200,
      uuid: 'completion-1',
      usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
      tool_calls: [
        {
          id: 'call-1',
          type: 'function',
          function: { name: 'lookup', arguments: '{"id":7}' },
        },
      ],
    }),
    queryJson: vi.fn().mockResolvedValue({
      data: { answer: 42 },
      raw: {
        message: '{"answer":42}',
        response: 'OK',
        status: 200,
        uuid: 'completion-2',
      },
    }),
    ...overrides,
  };
}

const identity = {
  providerId: 'test',
  displayName: 'Test Provider',
  endpoint: 'https://example.test/v1',
  local: false,
};

describe('portable provider compatibility adapter', () => {
  it('maps multi-turn messages, tools, usage, and tool calls', async () => {
    const legacy = fakeClient();
    const client = createPortableClient(legacy, identity);

    const result = await client.complete({
      model: 'model-a',
      messages: [
        { role: 'system', content: 'Be precise.' },
        { role: 'user', content: 'Look it up.' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'old-call', name: 'lookup', arguments: '{"id":6}' }],
        },
        {
          role: 'tool',
          content: '{"title":"Policy"}',
          toolCallId: 'old-call',
          name: 'lookup',
        },
      ],
      tools: [
        {
          name: 'lookup',
          description: 'Find a policy.',
          inputSchema: { type: 'object', properties: { id: { type: 'number' } } },
        },
      ],
      toolChoice: { name: 'lookup' },
    });

    expect(legacy.query).toHaveBeenCalledWith(expect.objectContaining({
      model: 'model-a',
      system_prompt: 'Be precise.',
      tool_choice: { type: 'function', function: { name: 'lookup' } },
    }));
    expect(result.finishReason).toBe('tool_calls');
    expect(result.message.toolCalls).toEqual([
      { id: 'call-1', name: 'lookup', arguments: '{"id":7}' },
    ]);
    expect(result.usage).toEqual({
      inputTokens: 12,
      outputTokens: 3,
      totalTokens: 15,
    });
  });

  it('lists models without leaking provider model types', async () => {
    const result = await createPortableClient(fakeClient(), identity).listModels();
    expect(result).toEqual([
      expect.objectContaining({
        id: 'model-a',
        name: 'Model A',
        owner: 'test',
        contextWindow: 8192,
      }),
    ]);
  });

  it('validates structured results when a validator is supplied', async () => {
    const client = createPortableClient(fakeClient(), identity);
    const result = await client.completeStructured<{ answer: number }>({
      model: 'model-a',
      messages: [{ role: 'user', content: 'Answer.' }],
      schema: { type: 'object' },
      validate: (value): value is { answer: number } =>
        typeof value === 'object' && value !== null && 'answer' in value,
    });
    expect(result.data.answer).toBe(42);
  });

  it('normalizes and redacts provider errors', async () => {
    const error = Object.assign(
      new Error('Bearer super-secret failed at ?api_key=another-secret'),
      { status: 401 },
    );
    const client = createPortableClient(
      fakeClient({ query: vi.fn().mockRejectedValue(error) }),
      identity,
    );
    await expect(client.complete({
      model: 'model-a',
      messages: [{ role: 'user', content: 'Hello' }],
    })).rejects.toMatchObject({
      code: 'authentication',
      status: 401,
      message: 'Bearer [REDACTED] failed at ?api_key=[REDACTED]',
    });
  });

  it('rejects an already-aborted request without calling the provider', async () => {
    const legacy = fakeClient();
    const controller = new AbortController();
    controller.abort();
    const promise = createPortableClient(legacy, identity).complete({
      model: 'model-a',
      messages: [{ role: 'user', content: 'Hello' }],
      signal: controller.signal,
    });
    await expect(promise).rejects.toBeInstanceOf(PortableProviderError);
    expect(legacy.query).not.toHaveBeenCalled();
  });
});

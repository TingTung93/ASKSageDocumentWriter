import { describe, expect, it, vi } from 'vitest';
import { OpenAICompatiblePortableAdapter, normalizeOpenAIBaseUrl } from './openai-compatible';

describe('OpenAICompatiblePortableAdapter', () => {
  it('normalizes the endpoint and supports a keyless local completion', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: 'chat-1',
      choices: [{ message: { role: 'assistant', content: 'Draft ready.' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
    }), { status: 200 }));
    const client = new OpenAICompatiblePortableAdapter({
      id: 'local-test',
      displayName: 'Local Test',
      baseUrl: ' http://localhost:11434/v1/ ',
      local: true,
    }, fetchImpl);

    const result = await client.complete({
      model: 'qwen',
      messages: [{ role: 'user', content: 'Draft this.' }],
    });

    expect(client.identity.endpoint).toBe('http://localhost:11434/v1');
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://localhost:11434/v1/chat/completions',
      expect.objectContaining({ method: 'POST' }),
    );
    const headers = (fetchImpl.mock.calls[0]![1] as RequestInit).headers;
    expect(headers).not.toHaveProperty('Authorization');
    expect(result.message.content).toBe('Draft ready.');
  });

  it('requires a non-empty base URL', () => {
    expect(() => normalizeOpenAIBaseUrl(' / ')).toThrow(/required/i);
  });
});

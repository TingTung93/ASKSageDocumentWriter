import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AskSageClient } from './client';
import { AskSageError } from './types';
import modelsFixture from '../../test/fixtures/get-models.json';

describe('AskSageClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
  });

  function makeClient(key = 'test-key', base = 'https://api.asksage.health.mil') {
    return new AskSageClient(base, key, fetchMock as unknown as typeof fetch);
  }

  it('rejects construction without baseUrl or apiKey', () => {
    expect(() => new AskSageClient('', 'k')).toThrow(/baseUrl/);
    expect(() => new AskSageClient('https://x', '')).toThrow(/apiKey/);
  });

  it('sends x-access-tokens header on getModels and parses the response', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(modelsFixture), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const client = makeClient();
    const models = await client.getModels();

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.asksage.health.mil/server/get-models');
    expect(opts.method).toBe('POST');
    const headers = opts.headers as Record<string, string>;
    expect(headers['x-access-tokens']).toBe('test-key');
    expect(headers['Content-Type']).toBe('application/json');
    expect(opts.body).toBe('{}');

    expect(models).toHaveLength(modelsFixture.data.length);
    expect(models[0]?.id).toBe('google-gemini-2.5-flash');
  });

  it('strips trailing slash on baseUrl', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(modelsFixture), { status: 200 }),
    );
    const client = new AskSageClient(
      'https://api.asksage.health.mil/',
      'k',
      fetchMock as unknown as typeof fetch,
    );
    await client.getModels();
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('https://api.asksage.health.mil/server/get-models');
  });

  it('throws AskSageError with status and body on non-OK responses', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{"response":"Token is invalid [2]","status":400}', { status: 400 }),
    );
    const client = makeClient('bad-key');
    const err = await client.getModels().catch((e) => e);
    expect(err).toBeInstanceOf(AskSageError);
    expect(err.status).toBe(400);
    expect(err.message).toMatch(/Token is invalid/);
    expect(err.body).toContain('Token is invalid');
  });

  it('throws AskSageError with null status on network failure', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const client = makeClient();
    const err = await client.getModels().catch((e) => e);
    expect(err).toBeInstanceOf(AskSageError);
    expect(err.status).toBeNull();
    expect(err.message).toMatch(/Network error/);
  });

  it('uses globalThis.fetch (not detached) when no fetchImpl is provided — regression for "Illegal invocation"', async () => {
    // Simulate a browser-like fetch that throws "Illegal invocation" when
    // `this` is not globalThis. This is what the real browser fetch does
    // and what was causing the Phase 0 connection-check failure on the
    // DHA workstation.
    const browserLikeFetch = function (this: unknown, _input: unknown, _init?: unknown) {
      if (this !== globalThis) {
        throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
      }
      return Promise.resolve(
        new Response(JSON.stringify(modelsFixture), { status: 200 }),
      );
    } as unknown as typeof fetch;

    const originalFetch = globalThis.fetch;
    (globalThis as unknown as { fetch: typeof fetch }).fetch = browserLikeFetch;
    try {
      // Construct WITHOUT passing fetchImpl so we exercise the default path.
      const client = new AskSageClient('https://api.asksage.health.mil', 'test-key');
      const models = await client.getModels();
      expect(models.length).toBeGreaterThan(0);
    } finally {
      (globalThis as unknown as { fetch: typeof fetch }).fetch = originalFetch;
    }
  });

  it('query() POSTs to /server/query with the input as JSON body', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          response: 'OK',
          message: 'pong',
          status: 200,
          uuid: 'abc-123',
        }),
        { status: 200 },
      ),
    );

    const client = makeClient();
    const r = await client.query({
      message: 'ping',
      model: 'google-claude-46-sonnet',
      dataset: 'none',
      temperature: 0.2,
    });

    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.asksage.health.mil/server/query');
    expect(JSON.parse(opts.body as string)).toEqual({
      message: 'ping',
      model: 'google-claude-46-sonnet',
      dataset: 'none',
      temperature: 0.2,
    });
    expect(r.uuid).toBe('abc-123');
    expect(r.message).toBe('pong');
  });
});

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

  it('only sets minimal fetch options (no cache/credentials/referrerPolicy) — regression for CORS preflight rejection on health.mil', async () => {
    // The Ask Sage health.mil tenant's CORS Access-Control-Allow-Headers
    // is narrow. Adding cache: 'no-store', credentials: 'omit',
    // referrerPolicy: 'no-referrer', or redirect: 'follow' caused the
    // browser to either add headers (Cache-Control, Pragma) or alter the
    // preflight in ways that the server rejects, producing a fast
    // "Failed to fetch" with no body. probe.html sets ONLY method, mode,
    // headers, body — and works. The client must do the same.
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(modelsFixture), { status: 200 }),
    );
    const client = makeClient();
    await client.getModels();
    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    const keys = Object.keys(opts).sort();
    expect(keys).toEqual(['body', 'headers', 'method', 'mode', 'signal'].sort());
    expect(opts.mode).toBe('cors');
    expect(opts.method).toBe('POST');
    // These MUST NOT be set:
    expect(opts).not.toHaveProperty('cache');
    expect(opts).not.toHaveProperty('credentials');
    expect(opts).not.toHaveProperty('referrerPolicy');
    expect(opts).not.toHaveProperty('redirect');
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

  it('verifyDataset() returns reachable=true with reference excerpt on success', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          response: 'OK',
          message: 'verify',
          status: 200,
          uuid: 'u',
          references: 'FAR 13.106-2 — Soliciting from a single source...',
          embedding_down: false,
          vectors_down: false,
        }),
        { status: 200 },
      ),
    );
    const client = makeClient();
    const r = await client.verifyDataset('far-clauses');
    expect(r.reachable).toBe(true);
    expect(r.has_references).toBe(true);
    expect(r.references_excerpt).toContain('FAR 13.106-2');
    expect(r.error).toBeNull();
  });

  it('verifyDataset() returns reachable=true / has_references=false when no refs returned', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          response: 'OK',
          message: 'verify',
          status: 200,
          uuid: 'u',
          references: '',
          embedding_down: false,
          vectors_down: false,
        }),
        { status: 200 },
      ),
    );
    const client = makeClient();
    const r = await client.verifyDataset('empty-dataset');
    expect(r.reachable).toBe(true);
    expect(r.has_references).toBe(false);
    expect(r.references_excerpt).toBeNull();
  });

  it('verifyDataset() returns reachable=false on network failure (does not throw)', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const client = makeClient();
    const r = await client.verifyDataset('blocked-dataset');
    expect(r.reachable).toBe(false);
    expect(r.error).toContain('Network error');
  });

  it('query() forwards live parameter for web search', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ response: 'OK', message: 'pong', status: 200, uuid: 'u' }),
        { status: 200 },
      ),
    );
    const client = makeClient();
    await client.query({ message: 'market research', live: 2 });
    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(opts.body as string);
    expect(body.live).toBe(2);
  });

  it('getServerDatasets() returns dataset names from /server/get-datasets', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ response: ['user_custom_42_far_clauses_content', 'asd_pws_drafts'], status: 200 }),
        { status: 200 },
      ),
    );
    const client = makeClient();
    const list = await client.getServerDatasets();
    expect(list).toEqual(['user_custom_42_far_clauses_content', 'asd_pws_drafts']);
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.asksage.health.mil/server/get-datasets');
    expect(opts.method).toBe('POST');
  });

  it('tokenize() coerces stringified count to number per swagger v1.56', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ response: '1234', status: 200 }), { status: 200 }),
    );
    const client = makeClient();
    const n = await client.tokenize({ content: 'hello', model: 'ada-002' });
    expect(n).toBe(1234);
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('https://api.asksage.health.mil/server/tokenizer');
  });

  it('tokenize() returns NaN when response is not coercible', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ response: 'oops', status: 200 }), { status: 200 }),
    );
    const client = makeClient();
    const n = await client.tokenize({ content: 'hello' });
    expect(Number.isNaN(n)).toBe(true);
  });

  it('countMonthlyTokens() issues GET /server/count-monthly-tokens with no body', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ response: 87654, status: 200 }), { status: 200 }),
    );
    const client = makeClient();
    const n = await client.countMonthlyTokens();
    expect(n).toBe(87654);
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.asksage.health.mil/server/count-monthly-tokens');
    expect(opts.method).toBe('GET');
    expect(opts.body).toBeUndefined();
    const headers = opts.headers as Record<string, string>;
    expect(headers['x-access-tokens']).toBe('test-key');
    // GET must NOT carry Content-Type — that would add it to the preflight.
    expect(headers['Content-Type']).toBeUndefined();
  });

  it('deleteDataset() issues DELETE /server/dataset with JSON body', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ response: 'deleted', status: 200 }), { status: 200 }),
    );
    const client = makeClient();
    const r = await client.deleteDataset('asd_old_pws');
    expect(r.response).toBe('deleted');
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.asksage.health.mil/server/dataset');
    expect(opts.method).toBe('DELETE');
    expect(JSON.parse(opts.body as string)).toEqual({ dataset: 'asd_old_pws' });
  });

  it('deleteFilenameFromDataset() POSTs to /server/delete-filename-from-dataset', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ response: 'removed', status: 200 }), { status: 200 }),
    );
    const client = makeClient();
    await client.deleteFilenameFromDataset({ dataset: 'asd_pws', filename: 'old.docx' });
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.asksage.health.mil/server/delete-filename-from-dataset');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body as string)).toEqual({ dataset: 'asd_pws', filename: 'old.docx' });
  });

  it('uploadFile() forwards optional strategy and special_csv form fields', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ response: 'ok', ret: 'extracted text', sent_filename: 'a.docx', status: 200 }),
        { status: 200 },
      ),
    );
    const client = makeClient();
    const file = new File(['hello'], 'a.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    const r = await client.uploadFile(file, { strategy: 'hi_res', special_csv: true });
    expect(r.ret).toBe('extracted text');
    expect(r.sent_filename).toBe('a.docx');
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.asksage.health.mil/server/file');
    expect(opts.method).toBe('POST');
    const form = opts.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(form.get('strategy')).toBe('hi_res');
    expect(form.get('special_csv')).toBe('true');
    // The browser sets Content-Type with boundary; we must NOT set it ourselves.
    const headers = opts.headers as Record<string, string>;
    expect(headers['Content-Type']).toBeUndefined();
    expect(headers['x-access-tokens']).toBe('test-key');
  });

  it('train() POSTs to /server/train with content + force_dataset', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ response: 'ok', embedding: 'emb-1', status: 200 }), { status: 200 }),
    );
    const client = makeClient();
    const r = await client.train({
      content: 'PWS reference text',
      context: 'project ABC attachment',
      force_dataset: 'asd_abc',
    });
    expect(r.embedding).toBe('emb-1');
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.asksage.health.mil/server/train');
    expect(JSON.parse(opts.body as string)).toEqual({
      content: 'PWS reference text',
      context: 'project ABC attachment',
      force_dataset: 'asd_abc',
    });
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

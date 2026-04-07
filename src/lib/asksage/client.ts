import {
  AskSageError,
  type GetModelsResponse,
  type ModelInfo,
  type QueryInput,
  type QueryResponse,
} from './types';

/**
 * Default fetch wrapper. We DO NOT pass `fetch` directly because the
 * browser's `fetch` is a built-in that requires its `this` context to be
 * `globalThis`/`window`. Storing `fetch` as a method property and calling
 * it detached (`this.fetchImpl(...)`) throws "Illegal invocation" in real
 * browsers (test mocks don't care, which is how this slipped through).
 *
 * The wrapper below always invokes `globalThis.fetch(...)` as a method
 * call, preserving the correct receiver. Custom `fetchImpl`s passed by
 * tests are already free functions, so they work as-is.
 */
const defaultFetch: typeof fetch = (input, init) => globalThis.fetch(input, init);

/**
 * Browser-side client for the Ask Sage Server API.
 *
 * Auth: the user's long-lived API key is sent in the `x-access-tokens`
 * header on every call. No token-exchange step (the `/user/*` exchange
 * endpoint is CORS-blocked on the health.mil tenant — see PRD §5).
 *
 * Only `/server/*` endpoints are reachable from the browser on the health
 * tenant; do not add `/user/*` calls here.
 */
export class AskSageClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = defaultFetch,
  ) {
    if (!baseUrl) throw new Error('AskSageClient: baseUrl is required');
    if (!apiKey) throw new Error('AskSageClient: apiKey is required');
  }

  private url(path: string): string {
    const trimmed = this.baseUrl.replace(/\/$/, '');
    return `${trimmed}${path.startsWith('/') ? path : `/${path}`}`;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const url = this.url(path);
    let res: Response;
    try {
      // Match probe.html's working request shape EXACTLY. Do NOT add
      // "defensive" options like cache: 'no-store', credentials: 'omit',
      // referrerPolicy: 'no-referrer', etc. — `cache: 'no-store'` in
      // particular causes Chromium/Firefox to add Cache-Control and
      // Pragma headers, which are non-safelisted and get listed in the
      // CORS preflight's Access-Control-Request-Headers. If the server's
      // Access-Control-Allow-Headers doesn't include them (Ask Sage's
      // doesn't), the preflight is rejected with no body and a generic
      // "Failed to fetch" — exactly the bug I previously introduced.
      res = await this.fetchImpl(url, {
        method: 'POST',
        mode: 'cors',
        headers: {
          'Content-Type': 'application/json',
          'x-access-tokens': this.apiKey,
        },
        body: JSON.stringify(body ?? {}),
      });
    } catch (err) {
      // Network-level failure (CORS, DNS, offline, etc.). The browser
      // hides the real cause behind a generic "Failed to fetch". Capture
      // everything we have so the UI can surface it without DevTools.
      const name = err instanceof Error ? err.name : 'UnknownError';
      const message = err instanceof Error ? err.message : String(err);
      throw new AskSageError(
        null,
        `Network error calling POST ${url}: ${name}: ${message}. ` +
          `This is typically a CORS preflight rejection, DNS failure, ` +
          `unreachable host, or browser security policy. The browser ` +
          `does not expose the underlying reason to JavaScript.`,
      );
    }

    const text = await res.text();
    if (!res.ok) {
      throw new AskSageError(
        res.status,
        `Ask Sage POST ${url} failed (${res.status} ${res.statusText}): ${text || '(empty body)'}`,
        text,
      );
    }

    try {
      return JSON.parse(text) as T;
    } catch {
      throw new AskSageError(
        res.status,
        `Ask Sage POST ${url} returned non-JSON body: ${text.slice(0, 500)}`,
        text,
      );
    }
  }

  /** Enumerate models available to the authenticated tenant. */
  async getModels(): Promise<ModelInfo[]> {
    const r = await this.post<GetModelsResponse>('/server/get-models', {});
    return r.data ?? [];
  }

  /** Primary completion endpoint. Used by every drafting/synthesis stage. */
  async query(input: QueryInput): Promise<QueryResponse> {
    return this.post<QueryResponse>('/server/query', input);
  }

  /**
   * Calls /server/query and parses the model's text response as strict
   * JSON. Strips a leading ```json / trailing ``` code fence if the model
   * wrapped its output in one (Flash and Sonnet sometimes do this even
   * when told not to). Throws AskSageError on parse failure with the
   * full raw response in the body for debugging.
   *
   * The caller is responsible for putting "respond with strict JSON" in
   * the system_prompt and choosing temperature 0.
   */
  async queryJson<T>(input: QueryInput): Promise<{ data: T; raw: QueryResponse }> {
    const response = await this.query(input);
    const text = (response.message ?? '').trim();
    const cleaned = stripCodeFence(text);
    try {
      return { data: JSON.parse(cleaned) as T, raw: response };
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      throw new AskSageError(
        response.status ?? null,
        `Ask Sage queryJson: response was not parseable JSON (${reason}). ` +
          `Raw response (first 2000 chars):\n${text.slice(0, 2000)}`,
        text,
      );
    }
  }
}

function stripCodeFence(text: string): string {
  // Match ```json\n...\n``` or ```\n...\n``` with optional trailing newline.
  const fenced = text.match(/^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/i);
  if (fenced) return fenced[1]!.trim();
  return text;
}

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
      res = await this.fetchImpl(url, {
        method: 'POST',
        // Explicit CORS mode. Default for cross-origin is 'cors' but
        // file:// origins are special and we want zero ambiguity.
        mode: 'cors',
        // Don't send cookies; we authenticate via x-access-tokens.
        credentials: 'omit',
        // Avoid any cache layer between us and Ask Sage.
        cache: 'no-store',
        // Some servers reject based on referrer; file:// referrers are
        // unusual. Suppress to match probe.html's effective behavior.
        referrerPolicy: 'no-referrer',
        redirect: 'follow',
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
}

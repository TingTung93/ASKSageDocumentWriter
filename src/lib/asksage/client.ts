import {
  AskSageError,
  type GetModelsResponse,
  type ModelInfo,
  type QueryInput,
  type QueryResponse,
} from './types';

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
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    if (!baseUrl) throw new Error('AskSageClient: baseUrl is required');
    if (!apiKey) throw new Error('AskSageClient: apiKey is required');
  }

  private url(path: string): string {
    const trimmed = this.baseUrl.replace(/\/$/, '');
    return `${trimmed}${path.startsWith('/') ? path : `/${path}`}`;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(this.url(path), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-access-tokens': this.apiKey,
        },
        body: JSON.stringify(body ?? {}),
      });
    } catch (err) {
      // Network-level failure (CORS, DNS, offline, etc.)
      const message = err instanceof Error ? err.message : String(err);
      throw new AskSageError(null, `Network error calling ${path}: ${message}`);
    }

    const text = await res.text();
    if (!res.ok) {
      throw new AskSageError(
        res.status,
        `Ask Sage ${path} failed (${res.status}): ${text || res.statusText}`,
        text,
      );
    }

    try {
      return JSON.parse(text) as T;
    } catch {
      throw new AskSageError(
        res.status,
        `Ask Sage ${path} returned non-JSON body`,
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

import {
  AskSageError,
  type DatasetInfo,
  type DatasetsResponse,
  type GetModelsResponse,
  type ModelInfo,
  type QueryInput,
  type QueryResponse,
  type VerifyDatasetResult,
} from './types';
import { writeAuditEntry } from './audit';

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
    const startedAt = Date.now();
    const reqBodyStr = JSON.stringify(body ?? {});
    const reqModel =
      body && typeof body === 'object' && 'model' in body
        ? String((body as { model: unknown }).model)
        : undefined;
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
        body: reqBodyStr,
      });
    } catch (err) {
      // Network-level failure (CORS, DNS, offline, etc.). The browser
      // hides the real cause behind a generic "Failed to fetch". Capture
      // everything we have so the UI can surface it without DevTools.
      const name = err instanceof Error ? err.name : 'UnknownError';
      const message = err instanceof Error ? err.message : String(err);
      const errorMsg =
        `Network error calling POST ${url}: ${name}: ${message}. ` +
        `This is typically a CORS preflight rejection, DNS failure, ` +
        `unreachable host, or browser security policy. The browser ` +
        `does not expose the underlying reason to JavaScript.`;
      void writeAuditEntry({
        endpoint: path,
        model: reqModel,
        prompt_excerpt: reqBodyStr,
        response_excerpt: '',
        ms: Date.now() - startedAt,
        ok: false,
        error: errorMsg,
      });
      throw new AskSageError(null, errorMsg);
    }

    const text = await res.text();
    const ms = Date.now() - startedAt;
    if (!res.ok) {
      void writeAuditEntry({
        endpoint: path,
        model: reqModel,
        prompt_excerpt: reqBodyStr,
        response_excerpt: text,
        ms,
        ok: false,
        error: `${res.status} ${res.statusText}`,
      });
      throw new AskSageError(
        res.status,
        `Ask Sage POST ${url} failed (${res.status} ${res.statusText}): ${text || '(empty body)'}`,
        text,
      );
    }

    let parsed: T;
    try {
      parsed = JSON.parse(text) as T;
    } catch {
      void writeAuditEntry({
        endpoint: path,
        model: reqModel,
        prompt_excerpt: reqBodyStr,
        response_excerpt: text,
        ms,
        ok: false,
        error: 'non-JSON body',
      });
      throw new AskSageError(
        res.status,
        `Ask Sage POST ${url} returned non-JSON body: ${text.slice(0, 500)}`,
        text,
      );
    }

    // Successful call — log token usage if the response carries a usage field.
    let tokens_in: number | undefined;
    let tokens_out: number | undefined;
    if (parsed && typeof parsed === 'object' && 'usage' in parsed) {
      const u = (parsed as { usage?: { prompt_tokens?: number; completion_tokens?: number } }).usage;
      tokens_in = u?.prompt_tokens;
      tokens_out = u?.completion_tokens;
    }
    void writeAuditEntry({
      endpoint: path,
      model: reqModel,
      prompt_excerpt: reqBodyStr,
      response_excerpt: text,
      tokens_in,
      tokens_out,
      ms,
      ok: true,
    });

    return parsed;
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
   * List datasets available to the authenticated user.
   *
   * NOTE: this calls `/user/get-datasets` which on the DHA health.mil
   * tenant is CORS-blocked from the browser (see PRD §5 / memory).
   * The call may throw an AskSageError with status === null. The
   * caller should catch and fall back to manual dataset entry. On
   * tenants with permissive CORS this returns the dataset list.
   *
   * The Ask Sage API has been observed to return either a flat array
   * of strings or an array of {name, description?} objects depending
   * on tenant version. We normalize both to DatasetInfo[].
   */
  async getDatasets(): Promise<DatasetInfo[]> {
    const r = await this.post<DatasetsResponse>('/user/get-datasets', {});
    const raw = r.response ?? r.data ?? [];
    if (!Array.isArray(raw)) return [];
    return raw.map((entry) =>
      typeof entry === 'string' ? { name: entry } : (entry as DatasetInfo),
    );
  }

  /**
   * Verify that a dataset name is valid by issuing a tiny RAG query
   * against it. Works through `/server/query` which IS browser-
   * accessible, so this is the practical way to check dataset names
   * on tenants where `/user/get-datasets` is blocked.
   *
   * Returns reachable=true if the query succeeds, has_references=true
   * if the dataset returned any source material. Empty references with
   * a successful query usually means the dataset exists but doesn't
   * contain content matching the probe query.
   */
  async verifyDataset(name: string): Promise<VerifyDatasetResult> {
    try {
      const response = await this.query({
        message: 'verify',
        model: 'google-claude-45-haiku',
        dataset: name,
        limit_references: 1,
        temperature: 0,
      });
      const refs = response.references ?? '';
      return {
        name,
        reachable: true,
        has_references: refs.length > 0,
        references_excerpt: refs ? refs.slice(0, 400) : null,
        embedding_down: response.embedding_down ?? false,
        vectors_down: response.vectors_down ?? false,
        error: null,
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return {
        name,
        reachable: false,
        has_references: false,
        references_excerpt: null,
        embedding_down: false,
        vectors_down: false,
        error: message,
      };
    }
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

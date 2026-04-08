import {
  AskSageError,
  type CountMonthlyTokensResponse,
  type DeleteDatasetRequest,
  type DeleteFilenameFromDatasetRequest,
  type GetAllFilesIngestedResponse,
  type GetDatasetsResponse,
  type GetModelsResponse,
  type ModelInfo,
  type QueryInput,
  type QueryResponse,
  type QueryWithFileInput,
  type SimpleResponse,
  type TokenizerRequest,
  type TokenizerResponse,
  type TrainRequest,
  type TrainResponse,
  type UploadFileFormFields,
  type UploadFileResponse,
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
 * Only `/server/*` endpoints are reachable from the browser on the
 * health tenant; do not add `/user/*` calls here. Per swagger v1.56,
 * the full set of dataset/file management endpoints (get-datasets,
 * dataset DELETE, delete-filename-from-dataset, get-all-files-ingested,
 * train, train-with-file, file) all live on /server/*, so anything we
 * need is reachable.
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
    return this.requestJson<T>('POST', path, body);
  }

  /** DELETE with a JSON body. Used for /server/dataset etc. */
  private async del<T>(path: string, body: unknown): Promise<T> {
    return this.requestJson<T>('DELETE', path, body);
  }

  /** GET with no body. Used for /server/count-monthly-tokens etc. */
  private async get<T>(path: string): Promise<T> {
    return this.requestJson<T>('GET', path, undefined);
  }

  private async requestJson<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body: unknown,
  ): Promise<T> {
    const url = this.url(path);
    const startedAt = Date.now();
    const hasBody = method !== 'GET' && body !== undefined;
    const reqBodyStr = hasBody ? JSON.stringify(body ?? {}) : '';
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
      const headers: Record<string, string> = {
        'x-access-tokens': this.apiKey,
      };
      if (hasBody) headers['Content-Type'] = 'application/json';
      res = await this.fetchImpl(url, {
        method,
        mode: 'cors',
        headers,
        body: hasBody ? reqBodyStr : undefined,
      });
    } catch (err) {
      // Network-level failure (CORS, DNS, offline, etc.). The browser
      // hides the real cause behind a generic "Failed to fetch". Capture
      // everything we have so the UI can surface it without DevTools.
      const name = err instanceof Error ? err.name : 'UnknownError';
      const message = err instanceof Error ? err.message : String(err);
      const errorMsg =
        `Network error calling ${method} ${url}: ${name}: ${message}. ` +
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
        `Ask Sage ${method} ${url} failed (${res.status} ${res.statusText}): ${text || '(empty body)'}`,
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
        `Ask Sage ${method} ${url} returned non-JSON body: ${text.slice(0, 500)}`,
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

  /**
   * Multipart-form POST. Used for `/server/file` (and any future
   * upload endpoints). Critical CORS notes:
   *
   *   - We do NOT set the Content-Type header ourselves. The browser
   *     auto-generates `multipart/form-data; boundary=...` when given
   *     a FormData body. Setting it manually breaks the boundary.
   *   - The preflight will list `x-access-tokens` (non-safelisted) and
   *     content-type (with multipart value). Ask Sage's
   *     Access-Control-Allow-Headers already permits both for /server/*
   *     since /server/query works with the same custom header.
   *   - As with `post()`, do NOT add cache: 'no-store' or other options
   *     that introduce extra headers into the preflight — that's the
   *     trap we documented in `post()` above.
   */
  private async postMultipart<T>(path: string, form: FormData): Promise<T> {
    const url = this.url(path);
    const startedAt = Date.now();
    // Capture a short summary of the form fields for the audit log.
    const fieldSummary: string[] = [];
    for (const [k, v] of form.entries()) {
      if (v instanceof File) {
        fieldSummary.push(`${k}=<File:${v.name},${v.size}b,${v.type || 'unknown'}>`);
      } else {
        const s = String(v);
        fieldSummary.push(`${k}=${s.length > 80 ? `${s.slice(0, 80)}…` : s}`);
      }
    }
    const reqSummary = `multipart {${fieldSummary.join(', ')}}`;

    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: 'POST',
        mode: 'cors',
        headers: {
          // NO Content-Type — let the browser set it with the boundary.
          'x-access-tokens': this.apiKey,
        },
        body: form,
      });
    } catch (err) {
      const ms = Date.now() - startedAt;
      const message = err instanceof Error ? err.message : String(err);
      void writeAuditEntry({
        endpoint: path,
        prompt_excerpt: reqSummary,
        response_excerpt: '',
        ms,
        ok: false,
        error: `network: ${message}`,
      });
      throw new AskSageError(
        null,
        `Ask Sage POST ${url}: network failure (${message}). Likely CORS — verify /server/file is allowed from this origin.`,
      );
    }

    const ms = Date.now() - startedAt;
    const text = await res.text();
    if (!res.ok) {
      void writeAuditEntry({
        endpoint: path,
        prompt_excerpt: reqSummary,
        response_excerpt: text.slice(0, 1500),
        ms,
        ok: false,
        error: `HTTP ${res.status}`,
      });
      throw new AskSageError(
        res.status,
        `Ask Sage POST ${url} returned HTTP ${res.status}: ${text.slice(0, 500)}`,
        text,
      );
    }

    let parsed: T;
    try {
      parsed = JSON.parse(text) as T;
    } catch {
      void writeAuditEntry({
        endpoint: path,
        prompt_excerpt: reqSummary,
        response_excerpt: text.slice(0, 1500),
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

    void writeAuditEntry({
      endpoint: path,
      prompt_excerpt: reqSummary,
      response_excerpt: text.slice(0, 1500),
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

  /**
   * Enumerate datasets via the SERVER surface. The /user/get-datasets
   * twin is CORS-blocked on the health.mil tenant; /server/get-datasets
   * works because /server/* is the permissive surface. Returns the flat
   * list of dataset names exactly as Ask Sage stores them — typically
   * `user_custom_<USERID>_<NAME>_content`.
   */
  async getServerDatasets(): Promise<string[]> {
    const r = await this.post<GetDatasetsResponse>('/server/get-datasets', {});
    return Array.isArray(r.response) ? r.response : [];
  }

  /**
   * Upload a file via /server/file. Ask Sage runs its own extractor
   * (DOCX, PDF, audio/video) and returns the extracted content inline
   * as `ret`. The filename is preserved on the server side and can be
   * referenced later by /server/query_with_file.
   *
   * Per swagger v1.56, accepts optional `strategy` (auto/fast/hi_res)
   * and `special_csv` form fields. Limits: 250 MB documents, 500 MB A/V.
   */
  async uploadFile(file: File, opts: UploadFileFormFields = {}): Promise<UploadFileResponse> {
    const form = new FormData();
    form.append('file', file, file.name);
    if (opts.strategy) form.append('strategy', opts.strategy);
    if (opts.special_csv !== undefined) form.append('special_csv', String(opts.special_csv));
    return this.postMultipart<UploadFileResponse>('/server/file', form);
  }

  /**
   * Add content to the user's knowledge base. Pass `force_dataset` to
   * route the chunk into a specific dataset (creates one with that
   * name if it doesn't exist yet). Per swagger v1.56 fields are
   * `content` (required), `context`, `skip_vectordb`, `force_dataset`.
   */
  async train(input: TrainRequest): Promise<TrainResponse> {
    return this.post<TrainResponse>('/server/train', input);
  }

  /**
   * /server/query_with_file. The `file` parameter is a path or filename
   * already known to Ask Sage — typically the original filename of a
   * file you previously uploaded via /server/file. This is one-shot
   * file context per query (NOT a multipart upload itself).
   */
  async queryWithFile(input: QueryWithFileInput): Promise<QueryResponse> {
    return this.post<QueryResponse>('/server/query_with_file', input);
  }

  /**
   * Exact token count for a given content + model via /server/tokenizer.
   * Per swagger v1.56 the server returns the count as a stringified
   * integer in `response`; we coerce to number here. Returns NaN on
   * coercion failure (caller should fall back to a heuristic).
   */
  async tokenize(input: TokenizerRequest): Promise<number> {
    const r = await this.post<TokenizerResponse>('/server/tokenizer', input);
    const n = Number(r.response);
    return Number.isFinite(n) ? n : NaN;
  }

  /**
   * Authoritative monthly token usage for the authenticated tenant.
   * GET form per swagger v1.56. Use this in place of audit-log-derived
   * totals when displaying spend so far.
   */
  async countMonthlyTokens(): Promise<number> {
    const r = await this.get<CountMonthlyTokensResponse>('/server/count-monthly-tokens');
    return typeof r.response === 'number' ? r.response : Number(r.response) || 0;
  }

  /**
   * List every file Ask Sage has ingested for the authenticated tenant.
   * Per swagger v1.56 this is a POST that returns an array; the entry
   * shape is tenant-dependent so we pass it through unchanged.
   */
  async getAllFilesIngested(): Promise<unknown[]> {
    const r = await this.post<GetAllFilesIngestedResponse>('/server/get-all-files-ingested', {});
    return Array.isArray(r.response) ? r.response : [];
  }

  /**
   * Remove a single file (by filename) from a named dataset. Per
   * swagger v1.56 this lives on /server/* — earlier memory had it on
   * /user/* and treated it as unreachable. It is reachable.
   */
  async deleteFilenameFromDataset(req: DeleteFilenameFromDatasetRequest): Promise<SimpleResponse> {
    return this.post<SimpleResponse>('/server/delete-filename-from-dataset', req);
  }

  /**
   * Delete an entire dataset by name. Per swagger v1.56 this is
   * `DELETE /server/dataset` with a JSON body of `{ dataset }`.
   * Destructive — caller should confirm with the user first.
   */
  async deleteDataset(name: string): Promise<SimpleResponse> {
    const body: DeleteDatasetRequest = { dataset: name };
    return this.del<SimpleResponse>('/server/dataset', body);
  }

  /** Primary completion endpoint. Used by every drafting/synthesis stage. */
  async query(input: QueryInput): Promise<QueryResponse> {
    return this.post<QueryResponse>('/server/query', input);
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

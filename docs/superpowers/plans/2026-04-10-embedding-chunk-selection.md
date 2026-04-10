# Embedding-Based Chunk Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Jaccard token-overlap scoring with cosine similarity over OpenRouter embedding vectors so per-section chunk selection catches semantically related content that differs lexically.

**Architecture:** Embeddings are computed once at chunk time via OpenRouter's `/v1/embeddings` endpoint and cached on `ReferenceChunk` records in Dexie. At draft time, section queries are batch-embedded in one call, and `selectChunksForSection` uses cosine similarity when embeddings are present, falling back to Jaccard when they're not (Ask Sage path, legacy chunks).

**Tech Stack:** TypeScript, Vitest, OpenRouter `/v1/embeddings` API (OpenAI-compatible), Dexie (IndexedDB)

**Spec:** `docs/superpowers/specs/2026-04-10-embedding-chunk-selection-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/lib/db/schema.ts` | Modify | Add optional `embedding` field to `ReferenceChunk` |
| `src/lib/provider/types.ts` | Modify | Add `EmbeddingCapable` interface and `canEmbed()` type guard |
| `src/lib/provider/openrouter.ts` | Modify | Add `embed()` method |
| `src/lib/provider/openrouter.test.ts` | Modify | Add tests for `embed()` |
| `src/lib/project/chunk.ts` | Modify | Add `cosineSim()`, update `selectChunksForSection` to accept `query_embedding`, update `semanticChunkText` to embed after chunking |
| `src/lib/project/chunk.test.ts` | Modify | Add tests for cosine scoring path and embedding integration |
| `src/lib/draft/orchestrator.ts` | Modify | Batch-embed section queries, pass to selection |

---

### Task 1: Add `embedding` field to `ReferenceChunk`

**Files:**
- Modify: `src/lib/db/schema.ts:100-108`

- [ ] **Step 1: Add the optional field**

In `src/lib/db/schema.ts`, add `embedding` to the `ReferenceChunk` interface:

```ts
export interface ReferenceChunk {
  id: string;
  /** One-line human-readable label, e.g. "Section 1.2 — Scope of Work" */
  title: string;
  /** One-sentence summary of the chunk's content, used for relevance scoring */
  summary: string;
  /** Verbatim text of the chunk */
  text: string;
  /** Embedding vector from OpenRouter /v1/embeddings (1536 dims). Absent on Ask Sage or legacy chunks. */
  embedding?: number[];
}
```

- [ ] **Step 2: Verify the build**

Run: `npx tsc --noEmit`
Expected: No errors. The field is optional so all existing code remains valid.

- [ ] **Step 3: Commit**

```bash
git add src/lib/db/schema.ts
git commit -m "feat: add optional embedding field to ReferenceChunk"
```

---

### Task 2: Add `EmbeddingCapable` interface and `canEmbed()` type guard

**Files:**
- Modify: `src/lib/provider/types.ts:55-77`

- [ ] **Step 1: Add the interface and type guard**

Append to the end of `src/lib/provider/types.ts`:

```ts
/**
 * Optional capability for providers that support embedding text into
 * vectors via an embeddings API. Used for cosine-similarity chunk
 * selection. Providers that implement this should add an `embed()`
 * method — the type guard `canEmbed()` detects it at runtime without
 * coupling callers to a concrete class.
 */
export interface EmbeddingCapable {
  embed(texts: string[], model?: string): Promise<{
    embeddings: number[][];
    tokens: number;
  }>;
}

/**
 * Runtime check for whether an LLMClient supports embedding. Returns
 * true when the client has an `embed` method (structural typing —
 * no instanceof needed).
 */
export function canEmbed(client: LLMClient): client is LLMClient & EmbeddingCapable {
  return 'embed' in client && typeof (client as Record<string, unknown>).embed === 'function';
}
```

- [ ] **Step 2: Verify the build**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/provider/types.ts
git commit -m "feat: add EmbeddingCapable interface and canEmbed() type guard"
```

---

### Task 3: Implement `OpenRouterClient.embed()` with tests

**Files:**
- Modify: `src/lib/provider/openrouter.ts`
- Modify: `src/lib/provider/openrouter.test.ts`

- [ ] **Step 1: Write the failing tests**

Add a new `describe('embed()')` block at the end of the top-level `describe` in `src/lib/provider/openrouter.test.ts`:

```ts
  describe('embed()', () => {
    it('sends POST /v1/embeddings with correct model and input', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              { index: 0, embedding: [0.1, 0.2, 0.3] },
              { index: 1, embedding: [0.4, 0.5, 0.6] },
            ],
            usage: { prompt_tokens: 12, total_tokens: 12 },
          }),
          { status: 200 },
        ),
      );
      const client = makeClient();
      const result = await client.embed(['hello world', 'foo bar']);

      const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://openrouter.ai/api/v1/embeddings');
      expect(opts.method).toBe('POST');
      const body = JSON.parse(opts.body as string);
      expect(body.model).toBe('openai/text-embedding-3-small');
      expect(body.input).toEqual(['hello world', 'foo bar']);

      expect(result.embeddings).toEqual([
        [0.1, 0.2, 0.3],
        [0.4, 0.5, 0.6],
      ]);
      expect(result.tokens).toBe(12);
    });

    it('uses a custom model when provided', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ index: 0, embedding: [1, 2] }],
            usage: { prompt_tokens: 5, total_tokens: 5 },
          }),
          { status: 200 },
        ),
      );
      const client = makeClient();
      await client.embed(['test'], 'openai/text-embedding-3-large');

      const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
      expect(body.model).toBe('openai/text-embedding-3-large');
    });

    it('throws AskSageError on HTTP failure', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response('rate limited', { status: 429, statusText: 'Too Many Requests' }),
      );
      const client = makeClient();
      await expect(client.embed(['test'])).rejects.toThrow(/429/);
    });

    it('throws on non-JSON response', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response('not json', { status: 200 }),
      );
      const client = makeClient();
      await expect(client.embed(['test'])).rejects.toThrow(/non-JSON/);
    });

    it('sorts embeddings by index when response is out of order', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              { index: 1, embedding: [0.4, 0.5] },
              { index: 0, embedding: [0.1, 0.2] },
            ],
            usage: { prompt_tokens: 8, total_tokens: 8 },
          }),
          { status: 200 },
        ),
      );
      const client = makeClient();
      const result = await client.embed(['first', 'second']);
      expect(result.embeddings[0]).toEqual([0.1, 0.2]);
      expect(result.embeddings[1]).toEqual([0.4, 0.5]);
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/provider/openrouter.test.ts`
Expected: FAIL — `client.embed is not a function`

- [ ] **Step 3: Implement `embed()` on OpenRouterClient**

Add the `DEFAULT_EMBEDDING_MODEL` constant after `DEFAULT_TIMEOUT_MS` in `src/lib/provider/openrouter.ts`:

```ts
/** Default embedding model for chunk vectorization. */
const DEFAULT_EMBEDDING_MODEL = 'openai/text-embedding-3-small';
```

Add the OpenAI embeddings response type after the existing `OpenAIChatCompletionResponse` interface:

```ts
/** OpenAI-compatible /v1/embeddings response shape. */
interface OpenAIEmbeddingsResponse {
  data: Array<{
    index: number;
    embedding: number[];
  }>;
  usage?: {
    prompt_tokens?: number;
    total_tokens?: number;
  };
}
```

Add the `embed()` method to the `OpenRouterClient` class, after `queryJson()`:

```ts
  async embed(
    texts: string[],
    model: string = DEFAULT_EMBEDDING_MODEL,
  ): Promise<{ embeddings: number[][]; tokens: number }> {
    const url = this.url('/embeddings');
    const startedAt = Date.now();
    const reqBody = JSON.stringify({ model, input: texts });
    let res: Response;
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), this.timeoutMs);
      res = await this.fetchImpl(url, {
        method: 'POST',
        headers: this.buildHeaders(true),
        body: reqBody,
        signal: ac.signal,
      });
      clearTimeout(timer);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const errorMsg = `Network error calling POST ${url}: ${message}`;
      void writeAuditEntry({
        endpoint: '/openrouter/embeddings',
        model,
        prompt_excerpt: reqBody.slice(0, 500),
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
        endpoint: '/openrouter/embeddings',
        model,
        prompt_excerpt: reqBody.slice(0, 500),
        response_excerpt: text,
        ms,
        ok: false,
        error: `${res.status} ${res.statusText}`,
      });
      throw new AskSageError(
        res.status,
        `OpenRouter POST ${url} failed (${res.status} ${res.statusText}): ${text || '(empty body)'}`,
        text,
      );
    }
    let parsed: OpenAIEmbeddingsResponse;
    try {
      parsed = JSON.parse(text) as OpenAIEmbeddingsResponse;
    } catch {
      throw new AskSageError(res.status, `OpenRouter POST ${url} returned non-JSON body`, text);
    }
    void writeAuditEntry({
      endpoint: '/openrouter/embeddings',
      model,
      prompt_excerpt: reqBody.slice(0, 500),
      response_excerpt: text.slice(0, 1500),
      tokens_in: parsed.usage?.prompt_tokens,
      ms,
      ok: true,
    });
    // Sort by index — the API may return embeddings out of order.
    const sorted = [...parsed.data].sort((a, b) => a.index - b.index);
    return {
      embeddings: sorted.map((d) => d.embedding),
      tokens: parsed.usage?.prompt_tokens ?? 0,
    };
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/provider/openrouter.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Verify the full build**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/provider/openrouter.ts src/lib/provider/openrouter.test.ts
git commit -m "feat: add embed() method to OpenRouterClient"
```

---

### Task 4: Add `cosineSim()` and update `selectChunksForSection` with tests

**Files:**
- Modify: `src/lib/project/chunk.ts:232-430`
- Modify: `src/lib/project/chunk.test.ts`

- [ ] **Step 1: Write the failing tests**

Add these test cases to the existing `describe('selectChunksForSection')` block in `src/lib/project/chunk.test.ts`:

```ts
  it('uses cosine similarity when query_embedding and chunk embeddings are present', () => {
    // Two chunks: "scope" is semantically closer to the query embedding,
    // "billing" is distant. Jaccard would score them similarly because
    // their titles share few tokens with the section name.
    const file = makeFile('f1', 'pws.docx', [
      {
        id: 'c_scope',
        title: 'Contractor Responsibilities',
        summary: 'Defines labor resources and workforce obligations.',
        text: 'The contractor shall supply all necessary labor.',
        // Embedding pointing in a similar direction to the query
        embedding: [0.9, 0.1, 0.0],
      },
      {
        id: 'c_billing',
        title: 'Invoice Procedures',
        summary: 'Describes how the contractor submits monthly invoices.',
        text: 'Invoices shall be submitted on the 15th of each month.',
        // Embedding pointing in a different direction
        embedding: [0.0, 0.1, 0.9],
      },
    ]);
    const selected = selectChunksForSection({
      files: [file],
      extractedById: new Map(),
      section: makeSection('scope', 'Scope of Work', 'Define contractor workforce responsibilities.'),
      size_class: 'body',
      // Query embedding close to c_scope's embedding
      query_embedding: [0.85, 0.15, 0.05],
    });
    expect(selected[0]?.chunk_id).toBe('c_scope');
  });

  it('falls back to Jaccard when query_embedding is absent even if chunks have embeddings', () => {
    const file = makeFile('f1', 'pws.docx', [
      {
        id: 'c1',
        title: 'Scope of Work',
        summary: 'Defines scope and contractor responsibilities.',
        text: 'The contractor shall perform maintenance.',
        embedding: [0.9, 0.1],
      },
    ]);
    const selected = selectChunksForSection({
      files: [file],
      extractedById: new Map(),
      section: makeSection('scope', 'Scope', 'Scope of contractor work.'),
      size_class: 'body',
      // No query_embedding — should still work via Jaccard
    });
    expect(selected.length).toBe(1);
    expect(selected[0]?.chunk_id).toBe('c1');
  });

  it('falls back to Jaccard for individual chunks without embeddings in a mixed set', () => {
    const file = makeFile('f1', 'pws.docx', [
      {
        id: 'c_with',
        title: 'Period of Performance',
        summary: 'States the ordering timeline for the contract.',
        text: 'Base year plus four option years.',
        embedding: [0.1, 0.9],
      },
      {
        id: 'c_without',
        title: 'Scope of Work',
        summary: 'Defines scope and contractor responsibilities for maintenance.',
        text: 'The contractor shall perform equipment maintenance.',
        // No embedding — Jaccard fallback
      },
    ]);
    const selected = selectChunksForSection({
      files: [file],
      extractedById: new Map(),
      section: makeSection('scope', 'Scope', 'Define contractor maintenance scope.'),
      template_example: 'The contractor shall perform maintenance.',
      size_class: 'body',
      query_embedding: [0.1, 0.9],
    });
    // Both chunks should be scored — one via cosine, one via Jaccard.
    // Both should appear since both are relevant (either by cosine or
    // Jaccard) and budget allows it.
    expect(selected.length).toBe(2);
  });
```

Also add a new top-level `describe` block for `cosineSim`:

```ts
describe('cosineSim', () => {
  // Import the function — it needs to be exported for testing.
  // We'll import it at the top of the file alongside the other imports.

  it('returns 1.0 for identical vectors', () => {
    expect(cosineSim([1, 0, 0], [1, 0, 0])).toBeCloseTo(1.0);
  });

  it('returns 0.0 for orthogonal vectors', () => {
    expect(cosineSim([1, 0], [0, 1])).toBeCloseTo(0.0);
  });

  it('returns a value between 0 and 1 for similar vectors', () => {
    const score = cosineSim([0.9, 0.1], [0.8, 0.2]);
    expect(score).toBeGreaterThan(0.9);
    expect(score).toBeLessThanOrEqual(1.0);
  });

  it('returns 0 when either vector is all zeros', () => {
    expect(cosineSim([0, 0], [1, 1])).toBeCloseTo(0.0);
  });
});
```

Update the imports at the top of `chunk.test.ts`:

```ts
import {
  naiveChunkText,
  selectChunksForSection,
  renderSelectedChunks,
  cosineSim,
  NAIVE_CHUNK_SIZE_CHARS,
} from './chunk';
```

And update the `ReferenceChunk` type import is already there from `'../db/schema'`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/project/chunk.test.ts`
Expected: FAIL — `cosineSim` is not exported; `query_embedding` is not a recognized property.

- [ ] **Step 3: Implement `cosineSim()` and update `selectChunksForSection`**

In `src/lib/project/chunk.ts`, add the `cosineSim` function after the existing `jaccardScore` function (around line 487), and export it:

```ts
/**
 * Cosine similarity between two equal-length vectors. Returns 0 when
 * either vector is all zeros (avoids NaN from division by zero).
 */
export function cosineSim(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
```

Update the `selectChunksForSection` args interface to accept an optional `query_embedding`:

```ts
export function selectChunksForSection(args: {
  files: ProjectContextFile[];
  extractedById: Map<string, string>;
  section: BodyFillRegion;
  template_example?: string | null;
  size_class: SectionSizeClass;
  budget_chars?: number;
  max_chunks?: number;
  preferred_chunk_ids?: string[];
  /**
   * Pre-computed embedding vector for this section's query. When
   * provided AND a chunk has an `embedding` field, cosine similarity
   * is used instead of Jaccard token overlap. The caller (orchestrator)
   * batch-embeds all section queries in a single API call and passes
   * the per-section vector here.
   */
  query_embedding?: number[];
}): SelectedChunk[] {
```

Update the per-chunk scoring logic inside the function. Replace the current scoring block (approximately lines 344-348):

```ts
    for (const c of chunks) {
      const scoringText = c.summary && c.summary.length > 0 ? `${c.title}\n${c.summary}` : c.text;
      const score = jaccardScore(queryTokens, tokenize(scoringText));
```

With:

```ts
    for (const c of chunks) {
      let score: number;
      if (args.query_embedding && c.embedding) {
        score = cosineSim(args.query_embedding, c.embedding);
      } else {
        const scoringText = c.summary && c.summary.length > 0 ? `${c.title}\n${c.summary}` : c.text;
        score = jaccardScore(queryTokens, tokenize(scoringText));
      }
```

No other changes — the rest of the selection logic (sorting, greedy budget, preferred seating) operates on `score` regardless of how it was computed.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/project/chunk.test.ts`
Expected: All tests PASS — both old Jaccard tests and new cosine tests.

- [ ] **Step 5: Verify the full build**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/project/chunk.ts src/lib/project/chunk.test.ts
git commit -m "feat: add cosine similarity scoring path to chunk selection"
```

---

### Task 5: Embed chunks at chunk time in `semanticChunkText`

**Files:**
- Modify: `src/lib/project/chunk.ts:177-230`

- [ ] **Step 1: Write the failing test**

Add to `src/lib/project/chunk.test.ts`, a new `describe('semanticChunkText')` block. This tests the embedding integration path:

```ts
describe('semanticChunkText embedding integration', () => {
  it('attaches embeddings to chunks when client supports embed()', async () => {
    // Mock LLMClient that returns two chunks + supports embed()
    const mockClient = {
      capabilities: { fileUpload: false, dataset: false, liveSearch: false },
      getModels: vi.fn(),
      query: vi.fn(),
      queryJson: vi.fn().mockResolvedValueOnce({
        data: {
          chunks: [
            { title: 'Scope', summary: 'Defines scope.', text: 'Scope text here.' },
            { title: 'PoP', summary: 'Period of performance.', text: 'Base year plus options.' },
          ],
        },
        raw: { usage: { prompt_tokens: 100, completion_tokens: 50 } },
      }),
      embed: vi.fn().mockResolvedValueOnce({
        embeddings: [[0.1, 0.2], [0.3, 0.4]],
        tokens: 20,
      }),
    };

    const result = await semanticChunkText(mockClient, 'full document text', {
      model: 'test-model',
    });

    // embed() should have been called with title+summary strings
    expect(mockClient.embed).toHaveBeenCalledOnce();
    const embedArgs = mockClient.embed.mock.calls[0]![0] as string[];
    expect(embedArgs).toHaveLength(2);
    expect(embedArgs[0]).toContain('Scope');
    expect(embedArgs[0]).toContain('Defines scope.');
    expect(embedArgs[1]).toContain('PoP');

    // Chunks should have embeddings attached
    expect(result.chunks[0]!.embedding).toEqual([0.1, 0.2]);
    expect(result.chunks[1]!.embedding).toEqual([0.3, 0.4]);

    // Embedding tokens should be tracked in usage_by_model
    expect(result.tokens_in).toBe(100); // LLM tokens only
    // usage_by_model should have entries for both the chunking model and the embedding model
    const models = Object.keys(result.usage_by_model);
    expect(models.length).toBeGreaterThanOrEqual(1);
  });

  it('skips embedding when client does not support embed()', async () => {
    const mockClient = {
      capabilities: { fileUpload: false, dataset: false, liveSearch: false },
      getModels: vi.fn(),
      query: vi.fn(),
      queryJson: vi.fn().mockResolvedValueOnce({
        data: {
          chunks: [
            { title: 'Scope', summary: 'Defines scope.', text: 'Scope text.' },
          ],
        },
        raw: { usage: { prompt_tokens: 50, completion_tokens: 25 } },
      }),
      // No embed() method
    };

    const result = await semanticChunkText(mockClient, 'document text', {
      model: 'test-model',
    });

    expect(result.chunks[0]!.embedding).toBeUndefined();
  });
});
```

Update the imports at the top of `chunk.test.ts` to include `semanticChunkText` and `vi`:

```ts
import { describe, expect, it, vi } from 'vitest';
import {
  naiveChunkText,
  selectChunksForSection,
  renderSelectedChunks,
  cosineSim,
  semanticChunkText,
  NAIVE_CHUNK_SIZE_CHARS,
} from './chunk';
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/project/chunk.test.ts`
Expected: FAIL — `semanticChunkText` doesn't call `embed()` yet so no embeddings are attached.

- [ ] **Step 3: Add embedding call to `semanticChunkText`**

In `src/lib/project/chunk.ts`, add the import at the top:

```ts
import { canEmbed } from '../provider/types';
```

In `semanticChunkText()`, after the chunk array `out` is built and before the final `return`, add the embedding step (before the `if (out.length === 0)` check, after the for-loop that builds `out`):

After the existing error check (`if (out.length === 0) { throw ... }`), and before the `const usage = ...` line, insert:

```ts
  // When the provider supports embeddings, vectorize the scoring
  // surface (title + summary) for each chunk. This is a single batch
  // API call. The vectors are stored on the ReferenceChunk and reused
  // by selectChunksForSection for cosine-similarity scoring.
  let embeddingTokens = 0;
  let embeddingModel: string | undefined;
  if (canEmbed(client)) {
    const scoringTexts = out.map((c) => `${c.title}\n${c.summary}`);
    const embResult = await client.embed(scoringTexts);
    for (let j = 0; j < out.length; j++) {
      out[j]!.embedding = embResult.embeddings[j];
    }
    embeddingTokens = embResult.tokens;
    embeddingModel = 'openai/text-embedding-3-small';
  }
```

Then, after the existing `recordUsage` call for the chunking model, add the embedding usage:

```ts
  if (embeddingModel && embeddingTokens > 0) {
    recordUsage(usage_by_model, embeddingModel, {
      tokens_in: embeddingTokens,
      tokens_out: 0,
    });
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/project/chunk.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Verify the full build**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/project/chunk.ts src/lib/project/chunk.test.ts
git commit -m "feat: embed chunk scoring surface at chunk time via OpenRouter"
```

---

### Task 6: Batch-embed section queries in the orchestrator

**Files:**
- Modify: `src/lib/draft/orchestrator.ts:1-10,148-298`

- [ ] **Step 1: Add imports**

In `src/lib/draft/orchestrator.ts`, add the import for `canEmbed`:

```ts
import { canEmbed } from '../provider/types';
```

And add `recordUsage` to the existing usage import:

```ts
import { type UsageByModel, emptyUsage, mergeUsage, recordUsage } from '../usage';
```

- [ ] **Step 2: Batch-embed section queries before the template loop**

After the `totalChunkCount` computation (line ~199) and before the `for (const template of templates)` loop (line ~201), add:

```ts
  // ─── Pre-flight 3: batch-embed section queries ────────────────────
  // When the provider supports embeddings, vectorize every section's
  // scoring query (name + intent) in a single API call. The resulting
  // map is keyed by section id so the per-section selection call can
  // pass its query embedding for cosine-similarity scoring. This runs
  // once per draft run — re-drafts re-embed (cheap, ~15 short strings)
  // because section queries may have changed.
  const sectionQueryEmbeddings = new Map<string, number[]>();
  if (canEmbed(client)) {
    // Collect all sections across all templates (deduplicate by id in
    // case multiple templates share section ids — unlikely but safe).
    const allSections: Array<{ id: string; query: string }> = [];
    const seenIds = new Set<string>();
    for (const t of templates) {
      const schema = t.schema_json;
      for (const s of schema.body_fill_regions ?? []) {
        if (seenIds.has(s.id)) continue;
        seenIds.add(s.id);
        allSections.push({
          id: s.id,
          query: `${s.name} ${s.intent ?? ''}`.trim(),
        });
      }
    }
    if (allSections.length > 0) {
      try {
        const { embeddings, tokens } = await client.embed(
          allSections.map((s) => s.query),
        );
        for (let i = 0; i < allSections.length; i++) {
          sectionQueryEmbeddings.set(allSections[i]!.id, embeddings[i]!);
        }
        recordUsage(usage_by_model, 'openai/text-embedding-3-small', {
          tokens_in: tokens,
          tokens_out: 0,
        });
      } catch {
        // Embedding failure is non-fatal — selection falls back to
        // Jaccard. Log but don't abort the run.
      }
    }
  }
```

- [ ] **Step 3: Pass `query_embedding` to `selectChunksForSection`**

Update the existing `selectChunksForSection` call (around line 291) to include the query embedding:

```ts
      const selectedChunks = selectChunksForSection({
        files,
        extractedById,
        section,
        template_example: templateExample,
        size_class: sizeClass,
        preferred_chunk_ids: mapping?.matched_chunk_ids,
        query_embedding: sectionQueryEmbeddings.get(section.id),
      });
```

- [ ] **Step 4: Verify the full build**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Run the full test suite**

Run: `npx vitest run`
Expected: All tests PASS. The orchestrator isn't unit-tested directly (it's an integration point), but any type errors or broken imports will surface here.

- [ ] **Step 6: Commit**

```bash
git add src/lib/draft/orchestrator.ts
git commit -m "feat: batch-embed section queries in orchestrator for cosine chunk selection"
```

---

### Task 7: End-to-end verification

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: All tests PASS.

- [ ] **Step 2: Run the type checker**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Run the build**

Run: `npm run build`
Expected: Build succeeds. `release/` output is a single IIFE file with no `type="module"`.

- [ ] **Step 4: Manual smoke test (optional)**

Open `release/index.html` from disk. Create a project with OpenRouter provider, attach a reference file, chunk it semantically, and draft. Verify:
- Chunks get embeddings (check Dexie via devtools: `db.projects` → file record → `chunks[n].embedding` should be a 1536-length array)
- Section drafting works without errors
- Audit log shows `/openrouter/embeddings` entries

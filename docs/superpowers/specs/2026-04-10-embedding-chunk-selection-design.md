# Embedding-Based Chunk Selection for OpenRouter

**Date:** 2026-04-10
**Status:** Approved

## Problem

Per-section reference chunk selection uses Jaccard token overlap — a bag-of-words heuristic that scores chunk `title + summary` against the section's `name + intent + template_example`. This causes chunk selection failures when semantically related content uses different vocabulary (e.g., "contractor workforce" vs. "labor resources", "period of performance" vs. "ordering timeline"). Irrelevant chunks consume token budget while relevant ones are missed.

## Solution

Replace the Jaccard heuristic with cosine similarity over embedding vectors when the active provider is OpenRouter. Embeddings are computed once at chunk time and cached on the `ReferenceChunk` record in Dexie. Section queries are batch-embedded once per draft run. The Jaccard fallback remains for the Ask Sage path and legacy chunks without embeddings.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| When to embed | At chunk time (not draft time) | One-time cost per file; re-drafts reuse cached vectors |
| Batch strategy | Single `/v1/embeddings` call per file | 5-30 chunks per file fits in one call; minimizes round-trips |
| Provider scope | OpenRouter only | Ask Sage has server-side RAG; no standalone embedding endpoint |
| Embedding model | `openai/text-embedding-3-small` (hardcoded) | 1536 dims, cheapest, good quality; configurable later if needed |
| Selection function async? | No — stays synchronous | Caller pre-embeds the query and passes `query_embedding` arg |

## Data Model

`ReferenceChunk` gains one optional field:

```ts
export interface ReferenceChunk {
  id: string;
  title: string;
  summary: string;
  text: string;
  /** Embedding vector (1536 dims) from OpenRouter. Absent on Ask Sage or legacy chunks. */
  embedding?: number[];
}
```

Storage impact: 1536 floats x 8 bytes x 30 chunks = ~360KB per file in Dexie. No Dexie schema version bump needed — `embedding` is optional and Dexie is schemaless on non-indexed fields.

## Components

### 1. `OpenRouterClient.embed()`

New method on `OpenRouterClient` (not on `LLMClient` interface):

```ts
async embed(texts: string[], model?: string): Promise<{
  embeddings: number[][];
  tokens: number;
}>
```

- Calls `POST /v1/embeddings` with `{ model, input: texts }`
- Model defaults to `"openai/text-embedding-3-small"`
- Returns embedding vectors in input order + total token usage
- Same error handling, audit logging, timeout, and attribution headers as `query()`

**What gets embedded:** The scoring surface — `title + '\n' + summary` for each chunk. Matches what Jaccard currently scores against. Keeps token costs low vs. embedding full chunk text.

### 2. `EmbeddingCapable` type guard

New interface and type guard in `lib/provider/types.ts`:

```ts
export interface EmbeddingCapable {
  embed(texts: string[], model?: string): Promise<{
    embeddings: number[][];
    tokens: number;
  }>;
}

export function canEmbed(client: LLMClient): client is LLMClient & EmbeddingCapable {
  return 'embed' in client && typeof (client as any).embed === 'function';
}
```

Avoids `instanceof OpenRouterClient` checks. Future providers that support embeddings just implement `embed()`.

### 3. Chunk-time integration

In `semanticChunkText()`, after the LLM returns chunks and before returning:

1. Check `canEmbed(client)`
2. Build texts array: `chunks.map(c => c.title + '\n' + c.summary)`
3. Call `client.embed(texts)`
4. Attach `embedding` to each `ReferenceChunk`
5. Roll embedding token usage into `SemanticChunkResult.usage_by_model` under the embedding model id

### 4. Selection — cosine over Jaccard

`selectChunksForSection` gains an optional `query_embedding?: number[]` parameter.

Per-chunk scoring logic:

- If the chunk has `embedding` AND `query_embedding` is provided: use cosine similarity
- Otherwise: fall back to Jaccard (existing behavior)

Cosine similarity:

```ts
function cosineSim(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
}
```

`selectChunksForSection` stays synchronous. The `query_embedding` is pre-computed by the caller.

### 5. Orchestrator wiring

In `lib/draft/orchestrator.ts`, before the per-section loop:

1. If `canEmbed(client)`, batch-embed all section queries in one call:
   ```
   sections.map(s => s.name + ' ' + (s.intent ?? ''))
   ```
2. Store results as `Map<sectionId, number[]>`
3. Pass per-section `query_embedding` to `selectChunksForSection`
4. Roll section-query embedding tokens into run's `usage_by_model`

## API Call Budget

| Phase | Calls | When |
|-------|-------|------|
| Chunk time (per file) | 1 `/v1/embeddings` | First time only; cached in Dexie |
| Draft time (per run) | 1 `/v1/embeddings` | All section queries batched |
| Re-draft | 1 `/v1/embeddings` | Section queries only; chunk embeddings cached |

Total: **2 calls** on first draft, **1 call** on re-drafts. Rate limiting is not a concern at this volume.

## Files Modified

| File | Change |
|------|--------|
| `src/lib/db/schema.ts` | Add optional `embedding?: number[]` to `ReferenceChunk` |
| `src/lib/provider/types.ts` | Add `EmbeddingCapable` interface and `canEmbed()` type guard |
| `src/lib/provider/openrouter.ts` | Add `embed()` method |
| `src/lib/project/chunk.ts` | Add `cosineSim()`, update `selectChunksForSection` to accept `query_embedding` and use cosine when available, update `semanticChunkText` to embed chunks when `canEmbed` |
| `src/lib/draft/orchestrator.ts` | Batch-embed section queries before per-section loop, pass embeddings to selection |

## What This Does NOT Change

- Ask Sage path: untouched. Still uses Jaccard (or server-side RAG if re-enabled later).
- Naive chunking: still produces chunks without embeddings. Jaccard fallback handles them.
- Section mapping (`lib/agent/section_mapping.ts`): untouched. Preferred chunk IDs still bypass the score floor.
- Dexie schema version: no bump needed.
- UI: no changes. Embedding is transparent to the user.

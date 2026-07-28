import { describe, expect, it } from 'vitest';
import { selectRelevantGroundingChunks, type GroundingChunk } from './relevance';

const chunks: GroundingChunk[] = [
  {
    sourceId: 'file-a',
    chunkId: 'security',
    title: 'Security controls',
    summary: 'Encryption and access control requirements.',
    text: 'All data must use encryption at rest.',
    embedding: [1, 0],
  },
  {
    sourceId: 'file-a',
    chunkId: 'schedule',
    title: 'Delivery schedule',
    summary: 'Milestones and delivery dates.',
    text: 'Delivery occurs in three milestones.',
    embedding: [0, 1],
  },
  {
    sourceId: 'file-b',
    chunkId: 'pinned',
    title: 'User-selected appendix',
    summary: 'Unrelated but explicitly selected.',
    text: 'Pinned appendix material.',
    pinned: true,
  },
];

describe('grounding relevance', () => {
  it('uses verified embeddings and records the selection reason', () => {
    const result = selectRelevantGroundingChunks(chunks, {
      targetText: 'Write the requirements.',
      instruction: 'Add security controls.',
      queryEmbedding: [1, 0],
      embeddingsVerified: true,
    }, { maxChunks: 2, maxChunksPerSource: 1, maxContextCharacters: 500 });

    expect(result.chunks.map(({ chunkId }) => chunkId)).toEqual(['pinned', 'security']);
    expect(result.chunks.find(({ chunkId }) => chunkId === 'security')).toMatchObject({
      score: 1,
      scoringMethod: 'embedding',
      reason: 'relevance',
    });
  });

  it('falls back deterministically to lexical relevance', () => {
    const result = selectRelevantGroundingChunks(chunks.slice(0, 2), {
      targetText: 'Describe delivery.',
      instruction: 'Add milestone dates and delivery schedule.',
      embeddingsVerified: false,
    }, { maxChunks: 1, maxChunksPerSource: 1, maxContextCharacters: 500 });
    expect(result.chunks[0]).toMatchObject({
      chunkId: 'schedule',
      scoringMethod: 'lexical',
    });
  });

  it('bounds chunks per source and total context', () => {
    const result = selectRelevantGroundingChunks(chunks.slice(0, 2), {
      targetText: 'security delivery controls milestones',
      instruction: 'Summarize.',
      embeddingsVerified: false,
    }, { maxChunks: 2, maxChunksPerSource: 1, maxContextCharacters: 12 });
    expect(result.chunks).toHaveLength(1);
    expect(result.totalCharacters).toBeLessThanOrEqual(12);
    expect(result.chunks[0]?.truncated).toBe(true);
  });

  it('preserves every pinned source visibly even when the budget is exhausted', () => {
    const pinned = chunks.map((chunk) => ({ ...chunk, pinned: true }));
    const result = selectRelevantGroundingChunks(pinned, {
      targetText: '',
      instruction: '',
      embeddingsVerified: false,
    }, { maxChunks: 1, maxChunksPerSource: 1, maxContextCharacters: 5 });
    expect(result.chunks.map(({ chunkId }) => chunkId)).toEqual(['security', 'schedule', 'pinned']);
    expect(result.chunks[1]).toMatchObject({
      includedCharacters: 0,
      truncated: true,
      reason: 'pinned_by_user',
    });
  });
});

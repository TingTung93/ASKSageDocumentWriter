// Tests for the pre-pass problem identification module. Mirrors the
// mock-client pattern used by lib/draft/critique.test.ts: responses
// are queued per call and queryJson feeds them out in order.

import { describe, it, expect } from 'vitest';
import {
  runProblemIdentificationPass,
  narrowChunkToFocus,
} from './prepass';
import type { LLMClient } from '../provider/types';
import type { ModelInfo, QueryInput, QueryResponse } from '../asksage/types';
import type { ParagraphInfo } from '../template/parser';

// ─── Fixtures ────────────────────────────────────────────────────

/**
 * Build a bare ParagraphInfo stub. The prepass module only reads
 * `index` and `text`, so every other field is irrelevant to these
 * tests — we cast through unknown to avoid having to stub runs,
 * el, bookmarks, and the rest of the parser shape.
 */
function makeParagraph(index: number, text: string): ParagraphInfo {
  return {
    index,
    text,
  } as unknown as ParagraphInfo;
}

// ─── Mock LLMClient ──────────────────────────────────────────────

interface MockResponse {
  json: unknown;
  prompt_tokens?: number;
  completion_tokens?: number;
}

class MockLLMClient implements LLMClient {
  readonly capabilities = { fileUpload: false, dataset: false, liveSearch: false };
  public calls: QueryInput[] = [];
  private queue: MockResponse[] = [];

  enqueue(r: MockResponse): this {
    this.queue.push(r);
    return this;
  }

  async getModels(): Promise<ModelInfo[]> {
    return [];
  }

  async query(input: QueryInput): Promise<QueryResponse> {
    const r = await this.queryJson<unknown>(input);
    return r.raw;
  }

  async queryJson<T>(input: QueryInput): Promise<{ data: T; raw: QueryResponse }> {
    this.calls.push(input);
    const next = this.queue.shift();
    if (!next) {
      throw new Error(
        `MockLLMClient: queue empty (call #${this.calls.length}). Test forgot to enqueue a response.`,
      );
    }
    const raw: QueryResponse = {
      message: JSON.stringify(next.json),
      response: JSON.stringify(next.json),
      status: 200,
      uuid: `mock-${this.calls.length}`,
      references: '',
      usage: {
        prompt_tokens: next.prompt_tokens ?? 123,
        completion_tokens: next.completion_tokens ?? 45,
      },
    };
    return { data: next.json as T, raw };
  }
}

// ─── runProblemIdentificationPass ────────────────────────────────

describe('runProblemIdentificationPass', () => {
  it('parses the mocked JSON response correctly', async () => {
    const client = new MockLLMClient().enqueue({
      json: {
        markers: [
          {
            paragraph_index: 2,
            category: 'grammar',
            hint: 'Subject-verb disagreement in the first sentence.',
            severity: 'high',
          },
          {
            paragraph_index: 5,
            category: 'wordiness',
            hint: 'Sentence is padded with filler phrases.',
            severity: 'medium',
          },
        ],
      },
    });

    const paragraphs = [
      makeParagraph(0, 'Clean opening paragraph.'),
      makeParagraph(2, 'This documents are important.'),
      makeParagraph(5, 'It should be noted that, in point of fact, the process works.'),
      makeParagraph(7, 'Another clean paragraph.'),
    ];

    const result = await runProblemIdentificationPass(client, {
      paragraphs,
      instruction: 'fix grammar and wordiness',
    });

    expect(result.markers).toHaveLength(2);
    expect(result.markers[0]).toEqual({
      paragraph_index: 2,
      category: 'grammar',
      hint: 'Subject-verb disagreement in the first sentence.',
      severity: 'high',
    });
    expect(result.markers[1]!.paragraph_index).toBe(5);
    expect(result.focus_indices).toEqual([2, 5]);
    expect(result.tokens_in).toBe(123);
    expect(result.tokens_out).toBe(45);
    expect(result.prompt_sent).toContain('User instruction: fix grammar and wordiness');
    expect(result.prompt_sent).toContain('[2] This documents are important.');
    expect(result.prompt_sent).toContain('[5] It should be noted');

    // System prompt should have been sent and should be the narrow
    // "flag only" prompt.
    expect(client.calls).toHaveLength(1);
    const call = client.calls[0]!;
    expect(call.system_prompt).toMatch(/NOT proposing edits/);
    expect(call.system_prompt).toMatch(/STRICT JSON/);
    expect(call.temperature).toBe(0);
  });

  it('de-duplicates markers by paragraph_index (first occurrence wins)', async () => {
    const client = new MockLLMClient().enqueue({
      json: {
        markers: [
          {
            paragraph_index: 3,
            category: 'grammar',
            hint: 'Typo in the second word.',
            severity: 'low',
          },
          {
            paragraph_index: 3,
            category: 'wordiness',
            hint: 'Same paragraph, different category.',
            severity: 'high',
          },
          {
            paragraph_index: 4,
            category: 'tone',
            hint: 'Casual tone in a formal section.',
            severity: 'medium',
          },
        ],
      },
    });

    const paragraphs = [
      makeParagraph(3, 'Teh quick brown fox.'),
      makeParagraph(4, "Anyway here's the thing."),
    ];

    const result = await runProblemIdentificationPass(client, {
      paragraphs,
      instruction: 'cleanup',
    });

    expect(result.markers).toHaveLength(2);
    // First occurrence of index 3 wins.
    expect(result.markers[0]!.paragraph_index).toBe(3);
    expect(result.markers[0]!.category).toBe('grammar');
    expect(result.markers[1]!.paragraph_index).toBe(4);
    expect(result.focus_indices).toEqual([3, 4]);
  });

  it('sorts focus_indices ascending and contains only indices that appear in markers', async () => {
    const client = new MockLLMClient().enqueue({
      json: {
        markers: [
          {
            paragraph_index: 17,
            category: 'formatting',
            hint: 'Stray double space.',
            severity: 'low',
          },
          {
            paragraph_index: 3,
            category: 'grammar',
            hint: 'Missing period.',
            severity: 'medium',
          },
          {
            paragraph_index: 9,
            category: 'tone',
            hint: 'First-person in formal doc.',
            severity: 'medium',
          },
        ],
      },
    });

    const paragraphs = [
      makeParagraph(3, 'a'),
      makeParagraph(9, 'b'),
      makeParagraph(17, 'c'),
      makeParagraph(22, 'd'), // clean — should NOT appear in focus
    ];

    const result = await runProblemIdentificationPass(client, {
      paragraphs,
      instruction: 'cleanup',
    });

    expect(result.focus_indices).toEqual([3, 9, 17]);
    // Indices present in the chunk but NOT in the markers must not appear.
    expect(result.focus_indices).not.toContain(22);
  });

  it('rolls up token counts from the raw response', async () => {
    const client = new MockLLMClient().enqueue({
      json: { markers: [] },
      prompt_tokens: 987,
      completion_tokens: 12,
    });

    const result = await runProblemIdentificationPass(client, {
      paragraphs: [makeParagraph(0, 'hello')],
      instruction: '',
    });

    expect(result.tokens_in).toBe(987);
    expect(result.tokens_out).toBe(12);
    expect(result.markers).toEqual([]);
    expect(result.focus_indices).toEqual([]);
  });
});

// ─── narrowChunkToFocus ──────────────────────────────────────────

describe('narrowChunkToFocus', () => {
  it('returns paragraphs at indices 4,5,6,11,12,13 for focus=[5,12] with neighbor_window=1', () => {
    // Use a contiguous paragraph array whose absolute indices match
    // their positions 1:1 so the neighbor math is easy to reason about.
    const paragraphs = Array.from({ length: 20 }, (_, i) =>
      makeParagraph(i, `paragraph ${i}`),
    );

    const result = narrowChunkToFocus({
      paragraphs,
      focus_indices: [5, 12],
      neighbor_window: 1,
    });

    expect(result.paragraphs.map((p) => p.index)).toEqual([4, 5, 6, 11, 12, 13]);
  });

  it('editable_indices contains exactly the focus indices — neighbors are not editable', () => {
    const paragraphs = Array.from({ length: 20 }, (_, i) =>
      makeParagraph(i, `paragraph ${i}`),
    );

    const result = narrowChunkToFocus({
      paragraphs,
      focus_indices: [5, 12],
      neighbor_window: 1,
    });

    expect(result.editable_indices.size).toBe(2);
    expect(result.editable_indices.has(5)).toBe(true);
    expect(result.editable_indices.has(12)).toBe(true);
    expect(result.editable_indices.has(4)).toBe(false);
    expect(result.editable_indices.has(6)).toBe(false);
    expect(result.editable_indices.has(11)).toBe(false);
    expect(result.editable_indices.has(13)).toBe(false);
  });

  it('gracefully skips focus_indices that are not in the paragraph list', () => {
    const paragraphs = [
      makeParagraph(3, 'a'),
      makeParagraph(4, 'b'),
      makeParagraph(5, 'c'),
    ];

    const result = narrowChunkToFocus({
      paragraphs,
      focus_indices: [4, 999, 1000], // 999/1000 don't exist
      neighbor_window: 1,
    });

    // Only index 4 exists → with neighbor_window=1 we get 3,4,5.
    expect(result.paragraphs.map((p) => p.index)).toEqual([3, 4, 5]);
    expect(result.editable_indices.size).toBe(1);
    expect(result.editable_indices.has(4)).toBe(true);
  });

  it('with neighbor_window=0 returns just the focus paragraphs', () => {
    const paragraphs = Array.from({ length: 10 }, (_, i) =>
      makeParagraph(i, `paragraph ${i}`),
    );

    const result = narrowChunkToFocus({
      paragraphs,
      focus_indices: [2, 4, 7],
      neighbor_window: 0,
    });

    expect(result.paragraphs.map((p) => p.index)).toEqual([2, 4, 7]);
    expect(Array.from(result.editable_indices).sort((a, b) => a - b)).toEqual([
      2, 4, 7,
    ]);
  });

  it('defaults neighbor_window to 1 when omitted', () => {
    const paragraphs = Array.from({ length: 10 }, (_, i) =>
      makeParagraph(i, `paragraph ${i}`),
    );

    const result = narrowChunkToFocus({
      paragraphs,
      focus_indices: [5],
    });

    expect(result.paragraphs.map((p) => p.index)).toEqual([4, 5, 6]);
  });

  it('handles focus at the start of the paragraph list (no underflow)', () => {
    const paragraphs = Array.from({ length: 5 }, (_, i) =>
      makeParagraph(i, `paragraph ${i}`),
    );

    const result = narrowChunkToFocus({
      paragraphs,
      focus_indices: [0],
      neighbor_window: 2,
    });

    expect(result.paragraphs.map((p) => p.index)).toEqual([0, 1, 2]);
  });

  it('handles focus at the end of the paragraph list (no overflow)', () => {
    const paragraphs = Array.from({ length: 5 }, (_, i) =>
      makeParagraph(i, `paragraph ${i}`),
    );

    const result = narrowChunkToFocus({
      paragraphs,
      focus_indices: [4],
      neighbor_window: 2,
    });

    expect(result.paragraphs.map((p) => p.index)).toEqual([2, 3, 4]);
  });
});

// Tests for the scoped (selection-driven) single-shot edit module.
// Mirrors the MockLLMClient pattern used by prepass.test.ts.

import { describe, it, expect } from 'vitest';
import { runScopedEdit } from './scopedEdit';
import type { LLMClient } from '../provider/types';
import type { ModelInfo, QueryInput, QueryResponse } from '../asksage/types';
import type { ParagraphInfo } from '../template/parser';

// ─── Fixtures ────────────────────────────────────────────────────

function makeParagraph(
  index: number,
  text: string,
  runs?: Array<{ text: string }>,
): ParagraphInfo {
  return {
    index,
    text,
    runs: runs ?? [{ text }],
  } as unknown as ParagraphInfo;
}

function buildDoc(): ParagraphInfo[] {
  return [
    makeParagraph(0, 'Introduction section header'),
    makeParagraph(1, 'The quick brown fox jumps over the lazy dog.'),
    makeParagraph(2, 'This paragraph has teh typo in it and rambles a lot.'),
    makeParagraph(3, 'Another sentence in the middle selection region.'),
    makeParagraph(4, 'And yet another one that needs tightening.'),
    makeParagraph(5, 'Conclusion paragraph wraps the document up.'),
    makeParagraph(6, 'Final signature block.'),
  ];
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
    } as unknown as QueryResponse;
    return { data: next.json as T, raw };
  }
}

// ─── Tests ───────────────────────────────────────────────────────

describe('runScopedEdit', () => {
  it('parses the mocked response and returns validated ops', async () => {
    const client = new MockLLMClient().enqueue({
      json: {
        edits: [
          {
            op: 'replace_paragraph_text',
            index: 3,
            new_text: 'A tighter middle sentence.',
            rationale: 'tightened per instruction',
          },
          {
            op: 'replace_paragraph_text',
            index: 4,
            new_text: 'Another tightened line.',
            rationale: 'tightened per instruction',
          },
        ],
      },
      prompt_tokens: 500,
      completion_tokens: 80,
    });

    const result = await runScopedEdit(client, {
      all_paragraphs: buildDoc(),
      selected_indices: [3, 4],
      instruction: 'tighten this',
    });

    expect(result.ops).toHaveLength(2);
    expect(result.ops[0]!.op).toBe('replace_paragraph_text');
    expect(result.tokens_in).toBe(500);
    expect(result.tokens_out).toBe(80);
    expect(client.calls).toHaveLength(1);
  });

  it('throws if selected_indices is empty', async () => {
    const client = new MockLLMClient();
    await expect(
      runScopedEdit(client, {
        all_paragraphs: buildDoc(),
        selected_indices: [],
        instruction: 'fix grammar',
      }),
    ).rejects.toThrow(/selected_indices/);
    expect(client.calls).toHaveLength(0);
  });

  it('throws if instruction is whitespace-only', async () => {
    const client = new MockLLMClient();
    await expect(
      runScopedEdit(client, {
        all_paragraphs: buildDoc(),
        selected_indices: [2],
        instruction: '   \t\n  ',
      }),
    ).rejects.toThrow(/instruction/);
    expect(client.calls).toHaveLength(0);
  });

  it('drops ops targeting paragraphs outside the editable selection', async () => {
    const client = new MockLLMClient().enqueue({
      json: {
        edits: [
          // In-selection — should be kept
          {
            op: 'replace_paragraph_text',
            index: 3,
            new_text: 'Kept.',
          },
          // Leaked into a context paragraph — must be dropped
          {
            op: 'replace_paragraph_text',
            index: 1,
            new_text: 'Leaked rewrite of context paragraph.',
          },
          // Also leaked — run op on a context paragraph
          {
            op: 'replace_run_text',
            paragraph_index: 5,
            run_index: 0,
            new_text: 'Leaked run edit.',
          },
        ],
      },
    });

    const result = await runScopedEdit(client, {
      all_paragraphs: buildDoc(),
      selected_indices: [3],
      instruction: 'tighten',
    });

    expect(result.ops).toHaveLength(1);
    const op = result.ops[0]!;
    expect(op.op).toBe('replace_paragraph_text');
    if (op.op === 'replace_paragraph_text') {
      expect(op.index).toBe(3);
    }
  });

  it('includes the user instruction prominently in the prompt body', async () => {
    const client = new MockLLMClient().enqueue({ json: { edits: [] } });

    await runScopedEdit(client, {
      all_paragraphs: buildDoc(),
      selected_indices: [2, 3],
      instruction: 'make more formal',
    });

    const sentMessage = client.calls[0]!.message ?? '';
    expect(sentMessage).toContain('User instruction: make more formal');
    // Appears near the top of the prompt (first 200 chars).
    expect(sentMessage.slice(0, 200)).toContain('make more formal');
  });

  it('renders context paragraphs as [ctx] and selected paragraphs as [edit]', async () => {
    const client = new MockLLMClient().enqueue({ json: { edits: [] } });

    await runScopedEdit(client, {
      all_paragraphs: buildDoc(),
      selected_indices: [3],
      instruction: 'tighten',
      context_window: 2,
    });

    const sent = client.calls[0]!.message ?? '';
    // Selected paragraph index 3 → [edit][3]
    expect(sent).toMatch(/\[edit\]\[3\]/);
    // Context paragraphs on either side should appear as [ctx]
    expect(sent).toMatch(/\[ctx\][^\n]*\[1\]/);
    expect(sent).toMatch(/\[ctx\][^\n]*\[2\]/);
    expect(sent).toMatch(/\[ctx\][^\n]*\[4\]/);
    expect(sent).toMatch(/\[ctx\][^\n]*\[5\]/);
    // Paragraph 0 is outside the context window on the left — should NOT appear
    expect(sent).not.toMatch(/\[[a-z]+\]\[0\]/);
    // Paragraph 6 is outside the context window on the right — should NOT appear
    expect(sent).not.toMatch(/\[[a-z]+\]\[6\]/);
  });

  it('rolls up token counts from the raw response', async () => {
    const client = new MockLLMClient().enqueue({
      json: { edits: [] },
      prompt_tokens: 777,
      completion_tokens: 22,
    });

    const result = await runScopedEdit(client, {
      all_paragraphs: buildDoc(),
      selected_indices: [3],
      instruction: 'tighten',
    });

    expect(result.tokens_in).toBe(777);
    expect(result.tokens_out).toBe(22);
  });

  it('auto-promotes an oversized replace_run_text to replace_paragraph_text', async () => {
    // Paragraph 3 has a single 49-char run. The LLM emits a
    // replace_run_text with ~200 chars of new content — the scoped
    // edit module must promote it to replace_paragraph_text so the
    // writer doesn't strand the rest of the original paragraph.
    const longNewText =
      'This is a substantially longer replacement sentence that clearly spans well beyond the original run boundaries and would otherwise strand the rest of the paragraph in place behind the new content.';
    expect(longNewText.length).toBeGreaterThan(80);

    const client = new MockLLMClient().enqueue({
      json: {
        edits: [
          {
            op: 'replace_run_text',
            paragraph_index: 3,
            run_index: 0,
            new_text: longNewText,
            rationale: 'rewrite',
          },
        ],
      },
    });

    const result = await runScopedEdit(client, {
      all_paragraphs: buildDoc(),
      selected_indices: [3],
      instruction: 'rewrite this sentence',
    });

    expect(result.ops).toHaveLength(1);
    const op = result.ops[0]!;
    expect(op.op).toBe('replace_paragraph_text');
    if (op.op === 'replace_paragraph_text') {
      expect(op.index).toBe(3);
      expect(op.new_text).toBe(longNewText);
      expect(op.rationale ?? '').toContain('auto-promoted');
    }
  });

  it('keeps a short replace_run_text op as-is (no spurious promotion)', async () => {
    const client = new MockLLMClient().enqueue({
      json: {
        edits: [
          {
            op: 'replace_run_text',
            paragraph_index: 2,
            run_index: 0,
            new_text: 'This paragraph has the typo in it and rambles a lot.',
            rationale: 'fix typo',
          },
        ],
      },
    });

    const result = await runScopedEdit(client, {
      all_paragraphs: buildDoc(),
      selected_indices: [2],
      instruction: 'fix the typo',
    });

    expect(result.ops).toHaveLength(1);
    expect(result.ops[0]!.op).toBe('replace_run_text');
  });
});

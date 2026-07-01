import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestDocumentEdits } from './edit';
import type { LLMClient } from '../provider/types';
import type { ModelInfo, QueryInput, QueryResponse } from '../asksage/types';
import type { ParagraphInfo } from '../template/parser';

function makeParagraph(index: number, text: string): ParagraphInfo {
  return {
    index,
    text,
    runs: [{ text }],
    numbering_id: null,
  } as unknown as ParagraphInfo;
}

class FailingLLMClient implements LLMClient {
  readonly capabilities = { fileUpload: false, dataset: false, liveSearch: false };
  public calls: QueryInput[] = [];

  async getModels(): Promise<ModelInfo[]> {
    return [];
  }

  async query(input: QueryInput): Promise<QueryResponse> {
    const r = await this.queryJson<unknown>(input);
    return r.raw;
  }

  async queryJson<T>(input: QueryInput): Promise<{ data: T; raw: QueryResponse }> {
    this.calls.push(input);
    throw new Error(
      'Ask Sage queryJson: response was not parseable JSON. Raw response: Sorry, this model is experiencing issues.',
    );
  }
}

describe('requestDocumentEdits', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects with a clear error when every cleanup chunk fails', async () => {
    const client = new FailingLLMClient();
    const paragraphs = Array.from({ length: 42 }, (_, i) =>
      makeParagraph(i, `Paragraph ${i} has enough text to be treated as significant.`),
    );

    await expect(
      requestDocumentEdits(client, {
        document_name: 'issue-12.docx',
        paragraphs,
        instruction: 'Revise for clarity.',
        chunk_concurrency: 1,
      }),
    ).rejects.toThrow(/Document cleanup failed for all 2 chunks/);

    expect(client.calls).toHaveLength(2);
  });
});

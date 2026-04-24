import { describe, it, expect } from 'vitest';
import { draftFreeformDocument } from './drafter';
import { FREEFORM_STYLE_MAP } from './styles';
import type { LLMClient } from '../provider/types';
import type { QueryInput, QueryResponse } from '../asksage/types';

interface StubCall {
  input: QueryInput;
}

function stubClient(responses: { response: string; tokens_in?: number; tokens_out?: number }[]): {
  client: LLMClient;
  calls: StubCall[];
} {
  const calls: StubCall[] = [];
  let i = 0;
  const client: LLMClient = {
    capabilities: { fileUpload: false, dataset: false, liveSearch: false },
    async getModels() {
      return [];
    },
    async query(input: QueryInput): Promise<QueryResponse> {
      calls.push({ input });
      const r = responses[i++];
      if (!r) throw new Error(`stubClient exhausted after ${i - 1} calls`);
      // LLM completion goes in `message` on both providers; `response`
      // is the status marker ("OK"/"Failed"). The stub mirrors the real
      // Ask Sage / OpenRouter shape — the fixture field is still called
      // `response` at the call sites below to keep churn small.
      return {
        message: r.response,
        response: 'OK',
        status: 200,
        uuid: `stub-${i}`,
        references: '',
        usage: {
          prompt_tokens: r.tokens_in ?? 100,
          completion_tokens: r.tokens_out ?? 200,
          total_tokens: (r.tokens_in ?? 100) + (r.tokens_out ?? 200),
        },
      };
    },
    async queryJson<T>() {
      throw new Error('not used');
      return { data: {} as T, raw: {} as QueryResponse };
    },
  };
  return { client, calls };
}

function pointPaperStyle() {
  const s = FREEFORM_STYLE_MAP.get('point_paper');
  if (!s) throw new Error('point_paper style missing from registry');
  return s;
}

function awardStyle() {
  const s = FREEFORM_STYLE_MAP.get('award_bullets');
  if (!s) throw new Error('award_bullets style missing from registry');
  return s;
}

describe('draftFreeformDocument retry flow', () => {
  it('does not retry when output is clean', async () => {
    const { client, calls } = stubClient([
      { response: '## Key Points\n\n- FY26 DHA budget: $412M, down 7%.\n- Contract bridge expires 30 Sep 26.', tokens_in: 500, tokens_out: 80 },
    ]);
    const result = await draftFreeformDocument({
      client,
      style: pointPaperStyle(),
      project_description: 'FY26 DHA budget snapshot',
      context_items: [],
    });
    expect(calls).toHaveLength(1);
    expect(result.tokens_in).toBe(500);
    expect(result.tokens_out).toBe(80);
  });

  it('retries once on filler and aggregates tokens', async () => {
    const { client, calls } = stubClient([
      { response: '## Key Points\n\n- This paper covers FY26.\n- The purpose of this brief is to outline risk.', tokens_in: 500, tokens_out: 120 },
      { response: '## Key Points\n\n- FY26 DHA budget: $412M, down 7%.\n- Contract bridge expires 30 Sep 26.', tokens_in: 520, tokens_out: 90 },
    ]);
    const result = await draftFreeformDocument({
      client,
      style: pointPaperStyle(),
      project_description: 'FY26 DHA budget',
      context_items: [],
    });
    expect(calls).toHaveLength(2);
    expect(result.tokens_in).toBe(500 + 520);
    expect(result.tokens_out).toBe(120 + 90);
    // Retry's augmented user message should mention the banned opener
    // and the retry constraint.
    expect(calls[1]!.input.message).toMatch(/ADDITIONAL CONSTRAINT/);
    expect(calls[1]!.input.message).toContain('This paper');
  });

  it('falls back to the original draft if retry is also bad', async () => {
    const { client, calls } = stubClient([
      { response: '## Key Points\n\n- This paper covers FY26.\n- The purpose of this brief is risk.\n- It is important to note the bridge.', tokens_in: 500, tokens_out: 100 },
      // Retry also opens with filler — AND has MORE offenses than the
      // original. The drafter should keep the original output.
      { response: '## Key Points\n\n- This paper covers FY26.\n- The purpose of this brief is risk.\n- It is important to note the bridge.\n- It should be noted that timing matters.', tokens_in: 520, tokens_out: 110 },
    ]);
    const result = await draftFreeformDocument({
      client,
      style: pointPaperStyle(),
      project_description: 'FY26 DHA budget',
      context_items: [],
    });
    expect(calls).toHaveLength(2);
    // Both runs counted against the token budget.
    expect(result.tokens_in).toBe(500 + 520);
    // Kept the original (3 bullets, not 4), so the rendered text does
    // not contain the "It should be noted" opener from the retry.
    const joined = result.paragraphs.map((p) => p.text).join(' ');
    expect(joined).not.toContain('It should be noted');
  });

  it('does not retry for non-targeted styles', async () => {
    const { client, calls } = stubClient([
      { response: '# Executive Summary\n\nThis paper covers the FY26 budget.\n\n- Line one.\n- Line two.' },
    ]);
    await draftFreeformDocument({
      client,
      // EXSUM is NOT in the retry target set.
      style: FREEFORM_STYLE_MAP.get('exsum')!,
      project_description: 'FY26 DHA budget',
      context_items: [],
    });
    expect(calls).toHaveLength(1);
  });

  it('retries award bullets on filler verbs', async () => {
    const { client, calls } = stubClient([
      { response: '## Achievement Bullets\n\n- Was responsible for the library.\n- Served as primary POC for sustainment.', tokens_in: 400, tokens_out: 80 },
      { response: '## Achievement Bullets\n\n- Led $47M recompete, saved $1.2M.\n- Authored DHA first J&A library, cut staffing 73%.', tokens_in: 420, tokens_out: 90 },
    ]);
    const result = await draftFreeformDocument({
      client,
      style: awardStyle(),
      project_description: 'PCS award for SSG Jones',
      context_items: [],
    });
    expect(calls).toHaveLength(2);
    expect(calls[1]!.input.message).toMatch(/past-tense|action verb|metric/i);
    expect(result.tokens_in).toBe(820);
  });
});

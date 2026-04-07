import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { synthesizeSchema, DEFAULT_SYNTHESIS_MODEL } from './synthesize';
import { parseDocx } from '../parser';
import { AskSageClient } from '../../asksage/client';
import type { LLMSemanticOutput } from './types';

const FIXTURES = resolve(__dirname, '../../../test/fixtures');

function loadFixture(name: string): Uint8Array {
  const buf = readFileSync(resolve(FIXTURES, name));
  const u8 = new Uint8Array(buf.byteLength);
  u8.set(buf);
  return u8;
}

function mockClientWithResponse(jsonOutput: LLMSemanticOutput | string, opts: { usage?: unknown; rawText?: string } = {}) {
  const text = opts.rawText ?? (typeof jsonOutput === 'string' ? jsonOutput : JSON.stringify(jsonOutput));
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        response: 'OK',
        message: text,
        status: 200,
        uuid: 'test-uuid',
        references: '',
        usage: opts.usage ?? { prompt_tokens: 100, completion_tokens: 50 },
      }),
      { status: 200 },
    ),
  );
  return new AskSageClient(
    'https://api.asksage.health.mil',
    'test-key',
    fetchMock as unknown as typeof fetch,
  );
}

describe('synthesizeSchema (integration with mocked Ask Sage)', () => {
  it('runs the full pipeline against a real DHA template', async () => {
    const bytes = loadFixture('DHA Publication Template (updated 09.13.23).docx');
    const { schema, docx_blob } = await parseDocx(bytes, {
      filename: 'pub.docx',
      docx_blob_id: 'fixture://pub',
    });
    expect(schema.sections.length).toBeGreaterThan(0);

    // Build a fake LLM output that covers the actual section ids the
    // parser produced. We don't care about the content; we care that
    // the merger lines them up by id.
    const fakeOutput: LLMSemanticOutput = {
      style: {
        voice: 'third_person',
        tense: 'present',
        register: 'formal_government',
        jargon_policy: 'use DHA terminology',
        banned_phrases: ['utilize'],
      },
      sections: schema.sections.map((s, i) => ({
        id: s.id,
        name: s.name,
        paragraph_range: [i * 5, i * 5 + 4] as [number, number],
        intent: `Auto-generated intent ${i + 1}.`,
        target_words: [100, 200] as [number, number],
        depends_on: i === 0 ? [] : [schema.sections[i - 1]!.id],
      })),
    };

    const client = mockClientWithResponse(fakeOutput);
    const result = await synthesizeSchema(client, schema, docx_blob);

    expect(result.model).toBe(DEFAULT_SYNTHESIS_MODEL);
    expect(result.schema.style.voice).toBe('third_person');
    expect(result.schema.style.banned_phrases).toEqual(['utilize']);
    expect(result.schema.source.semantic_synthesizer).toBe(DEFAULT_SYNTHESIS_MODEL);
    // Every section should now have intent populated
    for (const section of result.schema.sections) {
      expect(section.intent).toBeTruthy();
      expect(section.target_words).toEqual([100, 200]);
    }
    expect(result.usage).toBeTruthy();
    expect(result.prompt_sent.length).toBeGreaterThan(0);
  });

  it('passes the correct model and parameters to Ask Sage', async () => {
    const bytes = loadFixture('DHA Publication Template (updated 09.13.23).docx');
    const { schema, docx_blob } = await parseDocx(bytes, {
      filename: 'pub.docx',
      docx_blob_id: 'fixture://pub',
    });
    const fakeOutput: LLMSemanticOutput = {
      style: { voice: 'x', tense: 'x', register: 'x', jargon_policy: 'x', banned_phrases: [] },
      sections: [],
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ response: 'OK', message: JSON.stringify(fakeOutput), status: 200, uuid: 'u' }),
        { status: 200 },
      ),
    );
    const client = new AskSageClient('https://api.asksage.health.mil', 'k', fetchMock as unknown as typeof fetch);

    await synthesizeSchema(client, schema, docx_blob);

    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(opts.body as string);
    expect(body.model).toBe(DEFAULT_SYNTHESIS_MODEL);
    expect(body.temperature).toBe(0);
    expect(body.dataset).toBe('none');
    expect(body.usage).toBe(true);
    expect(body.system_prompt).toContain('STRICT JSON');
    expect(body.message).toContain('pub.docx');
  });

  it('strips a markdown code fence around the JSON response', async () => {
    const bytes = loadFixture('DHA Publication Template (updated 09.13.23).docx');
    const { schema, docx_blob } = await parseDocx(bytes, {
      filename: 'pub.docx',
      docx_blob_id: 'fixture://pub',
    });
    const fakeOutput: LLMSemanticOutput = {
      style: { voice: 'x', tense: 'y', register: 'z', jargon_policy: 'q', banned_phrases: [] },
      sections: [],
    };
    const fenced = '```json\n' + JSON.stringify(fakeOutput) + '\n```';
    const client = mockClientWithResponse(fakeOutput, { rawText: fenced });
    const result = await synthesizeSchema(client, schema, docx_blob);
    expect(result.schema.style.voice).toBe('x');
  });

  it('throws AskSageError if the LLM response is not valid JSON', async () => {
    const bytes = loadFixture('DHA Publication Template (updated 09.13.23).docx');
    const { schema, docx_blob } = await parseDocx(bytes, {
      filename: 'pub.docx',
      docx_blob_id: 'fixture://pub',
    });
    const client = mockClientWithResponse('not json at all, just text');
    await expect(synthesizeSchema(client, schema, docx_blob)).rejects.toThrow(/not parseable JSON/);
  });

  it('honors a custom model option', async () => {
    const bytes = loadFixture('DHA Publication Template (updated 09.13.23).docx');
    const { schema, docx_blob } = await parseDocx(bytes, {
      filename: 'pub.docx',
      docx_blob_id: 'fixture://pub',
    });
    const fakeOutput: LLMSemanticOutput = {
      style: { voice: 'x', tense: 'y', register: 'z', jargon_policy: 'q', banned_phrases: [] },
      sections: [],
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ response: 'OK', message: JSON.stringify(fakeOutput), status: 200, uuid: 'u' }),
        { status: 200 },
      ),
    );
    const client = new AskSageClient('https://api.asksage.health.mil', 'k', fetchMock as unknown as typeof fetch);
    await synthesizeSchema(client, schema, docx_blob, { model: 'google-claude-46-sonnet' });
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.model).toBe('google-claude-46-sonnet');
  });
});

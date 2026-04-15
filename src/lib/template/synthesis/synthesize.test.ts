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
    const bytes = loadFixture('synthetic-publication.docx');
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
        style_notes: '',
        visual_style: { font_family: null, font_size_pt: null, alignment: null, numbering_convention: null },
      })),
      document_parts: [],
    };

    const client = mockClientWithResponse(fakeOutput);
    const result = await synthesizeSchema(client, schema, docx_blob);

    expect(result.model).toBe(DEFAULT_SYNTHESIS_MODEL);
    expect(result.schema.style.voice).toBe('third_person');
    expect(result.schema.style.banned_phrases).toEqual(['utilize']);
    expect(result.schema.source.semantic_synthesizer).toBe(DEFAULT_SYNTHESIS_MODEL);
    // Every LLM-authored section should now have intent and target_words.
    // document_part sections (page header / footer regions emitted by
    // the parser) are preserved through the merge unchanged — the LLM
    // never authors them, so they carry the parser-supplied intent and
    // no target_words. Filter them out before checking the LLM-authored
    // assertions.
    const llmAuthored = result.schema.sections.filter(
      (s) => s.fill_region.kind !== 'document_part',
    );
    expect(llmAuthored.length).toBeGreaterThan(0);
    for (const section of llmAuthored) {
      expect(section.intent).toBeTruthy();
      expect(section.target_words).toEqual([100, 200]);
    }
    // document_part sections, if any, should still have a non-empty
    // parser-supplied intent so the drafter knows what to do.
    for (const section of result.schema.sections) {
      if (section.fill_region.kind === 'document_part') {
        expect(section.intent).toBeTruthy();
      }
    }
    expect(result.usage).toBeTruthy();
    expect(result.prompt_sent.length).toBeGreaterThan(0);
  });

  it('passes the correct model and parameters to Ask Sage', async () => {
    const bytes = loadFixture('synthetic-publication.docx');
    const { schema, docx_blob } = await parseDocx(bytes, {
      filename: 'pub.docx',
      docx_blob_id: 'fixture://pub',
    });
    const fakeOutput: LLMSemanticOutput = {
      style: { voice: 'x', tense: 'x', register: 'x', jargon_policy: 'x', banned_phrases: [] },
      sections: [],
      document_parts: [],
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
    const bytes = loadFixture('synthetic-publication.docx');
    const { schema, docx_blob } = await parseDocx(bytes, {
      filename: 'pub.docx',
      docx_blob_id: 'fixture://pub',
    });
    const fakeOutput: LLMSemanticOutput = {
      style: { voice: 'x', tense: 'y', register: 'z', jargon_policy: 'q', banned_phrases: [] },
      sections: [],
      document_parts: [],
    };
    const fenced = '```json\n' + JSON.stringify(fakeOutput) + '\n```';
    const client = mockClientWithResponse(fakeOutput, { rawText: fenced });
    const result = await synthesizeSchema(client, schema, docx_blob);
    expect(result.schema.style.voice).toBe('x');
  });

  it('throws AskSageError if the LLM response is not valid JSON', async () => {
    const bytes = loadFixture('synthetic-publication.docx');
    const { schema, docx_blob } = await parseDocx(bytes, {
      filename: 'pub.docx',
      docx_blob_id: 'fixture://pub',
    });
    const client = mockClientWithResponse('not json at all, just text');
    await expect(synthesizeSchema(client, schema, docx_blob)).rejects.toThrow(/not parseable JSON/);
  });

  it('retries once when the merger rejects on source_text mismatch', async () => {
    // Build a template with a document_part header so the merger has a
    // chance to reject on source_text mismatch.
    const bytes = loadFixture('synthetic-memo.docx');
    const { schema, docx_blob } = await parseDocx(bytes, {
      filename: 'memo.docx',
      docx_blob_id: 'fixture://memo',
    });
    const headerSec = schema.sections.find(
      (s) => s.fill_region.kind === 'document_part' && s.fill_region.placement === 'header',
    );
    if (!headerSec || headerSec.fill_region.kind !== 'document_part') {
      // If the fixture lacks a header, skip this specific test path.
      return;
    }
    const firstTextDetail = headerSec.fill_region.paragraph_details.find(
      (d) => !d.has_drawing && !d.has_complex_content && d.text.trim().length > 0,
    );
    if (!firstTextDetail) return;

    const goodSlot = {
      slot_index: firstTextDetail.slot_index,
      source_text: firstTextDetail.text,
      intent: 'banner',
      style_notes: '',
      visual_style: {
        font_family: null,
        font_size_pt: null,
        alignment: null,
        numbering_convention: null,
      },
    };
    const badOutput: LLMSemanticOutput = {
      style: { voice: 'x', tense: 'y', register: 'z', jargon_policy: 'q', banned_phrases: [] },
      sections: [],
      document_parts: [
        {
          part_path: headerSec.fill_region.part_path,
          placement: 'header',
          slots: [{ ...goodSlot, source_text: 'NOT THE ACTUAL TEXT' }],
        },
      ],
    };
    const goodOutput: LLMSemanticOutput = {
      style: { voice: 'x', tense: 'y', register: 'z', jargon_policy: 'q', banned_phrases: [] },
      sections: [],
      document_parts: [
        {
          part_path: headerSec.fill_region.part_path,
          placement: 'header',
          slots: [goodSlot],
        },
      ],
    };
    const responses = [badOutput, goodOutput];
    const fetchMock = vi.fn().mockImplementation(() => {
      const next = responses.shift();
      if (!next) throw new Error('no more mock responses');
      return Promise.resolve(
        new Response(
          JSON.stringify({
            response: 'OK',
            message: JSON.stringify(next),
            status: 200,
            uuid: 'u',
            usage: { prompt_tokens: 100, completion_tokens: 50 },
          }),
          { status: 200 },
        ),
      );
    });
    const client = new AskSageClient(
      'https://api.asksage.health.mil',
      'k',
      fetchMock as unknown as typeof fetch,
    );
    const result = await synthesizeSchema(client, schema, docx_blob);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.schema).toBeTruthy();
  });

  it('throws after two failed attempts with source_text mismatch', async () => {
    const bytes = loadFixture('synthetic-memo.docx');
    const { schema, docx_blob } = await parseDocx(bytes, {
      filename: 'memo.docx',
      docx_blob_id: 'fixture://memo',
    });
    const headerSec = schema.sections.find(
      (s) => s.fill_region.kind === 'document_part' && s.fill_region.placement === 'header',
    );
    if (!headerSec || headerSec.fill_region.kind !== 'document_part') return;
    const firstTextDetail = headerSec.fill_region.paragraph_details.find(
      (d) => !d.has_drawing && !d.has_complex_content && d.text.trim().length > 0,
    );
    if (!firstTextDetail) return;

    const badOutput: LLMSemanticOutput = {
      style: { voice: 'x', tense: 'y', register: 'z', jargon_policy: 'q', banned_phrases: [] },
      sections: [],
      document_parts: [
        {
          part_path: headerSec.fill_region.part_path,
          placement: 'header',
          slots: [
            {
              slot_index: firstTextDetail.slot_index,
              source_text: 'WRONG AGAIN',
              intent: 'x',
              style_notes: '',
              visual_style: {
                font_family: null,
                font_size_pt: null,
                alignment: null,
                numbering_convention: null,
              },
            },
          ],
        },
      ],
    };
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            response: 'OK',
            message: JSON.stringify(badOutput),
            status: 200,
            uuid: 'u',
            usage: { prompt_tokens: 100, completion_tokens: 50 },
          }),
          { status: 200 },
        ),
      ),
    );
    const client = new AskSageClient(
      'https://api.asksage.health.mil',
      'k',
      fetchMock as unknown as typeof fetch,
    );
    await expect(synthesizeSchema(client, schema, docx_blob)).rejects.toThrow(
      /source_text mismatch/,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('honors a custom model option', async () => {
    const bytes = loadFixture('synthetic-publication.docx');
    const { schema, docx_blob } = await parseDocx(bytes, {
      filename: 'pub.docx',
      docx_blob_id: 'fixture://pub',
    });
    const fakeOutput: LLMSemanticOutput = {
      style: { voice: 'x', tense: 'y', register: 'z', jargon_policy: 'q', banned_phrases: [] },
      sections: [],
      document_parts: [],
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

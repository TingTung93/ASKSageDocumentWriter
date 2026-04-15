import { describe, it, expect } from 'vitest';
import {
  buildDocumentPartPrompt,
  parseSlotsResponse,
} from './draftDocumentPart';
import type { BodyFillRegion, TemplateSchema } from '../template/types';

function makeTemplate(): TemplateSchema {
  return {
    $schema: 'test',
    id: 'tpl',
    name: 'Memo',
    version: 1,
    source: {
      filename: 'memo.docx',
      ingested_at: 'x',
      structural_parser_version: '0.1.0',
      semantic_synthesizer: null,
      docx_blob_id: 'docx://x',
    },
    formatting: {
      page_setup: {
        paper: 'letter',
        orientation: 'portrait',
        margins_twips: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
        header_distance: 720,
        footer_distance: 720,
      },
      default_font: { family: null, size_pt: null },
      theme: null,
      named_styles: [],
      numbering_definitions: [],
      headers: [],
      footers: [],
    },
    metadata_fill_regions: [],
    sections: [],
    style: { voice: null, tense: null, register: null, jargon_policy: null, banned_phrases: [] },
  };
}

function makeDocPartSection(): BodyFillRegion & {
  fill_region: Extract<BodyFillRegion['fill_region'], { kind: 'document_part' }>;
} {
  return {
    id: 'header_header1',
    name: 'Page Header (header1)',
    order: 0,
    required: false,
    intent: 'Letterhead banner',
    fill_region: {
      kind: 'document_part',
      part_path: 'word/header1.xml',
      placement: 'header',
      original_text_lines: ['DEPARTMENT OF THE ARMY', '[UNIT NAME]'],
      permitted_roles: ['body', 'heading'],
      paragraph_details: [
        {
          slot_index: 0,
          text: 'DEPARTMENT OF THE ARMY',
          has_drawing: false,
          has_complex_content: false,
          alignment: 'center',
          font_family: 'Arial',
          font_size_pt: 14,
        },
        {
          slot_index: 1,
          text: '',
          has_drawing: true,
          has_complex_content: false,
          alignment: 'center',
          font_family: null,
          font_size_pt: null,
        },
        {
          slot_index: 2,
          text: '[UNIT NAME]',
          has_drawing: false,
          has_complex_content: false,
          alignment: 'center',
          font_family: null,
          font_size_pt: null,
        },
      ],
    },
  };
}

describe('buildDocumentPartPrompt', () => {
  it('builds per-slot prompt with [FIXED] markers on drawing paragraphs', () => {
    const prompt = buildDocumentPartPrompt({
      template: makeTemplate(),
      section: makeDocPartSection(),
      project_description: 'MFR for Supply Policy',
      shared_inputs: {},
    });
    expect(prompt).toContain('SLOT 0');
    expect(prompt).toContain('[FIXED] SLOT 1');
    expect(prompt).toContain('SLOT 2');
    expect(prompt).toContain('DEPARTMENT OF THE ARMY');
    expect(prompt).toContain('[UNIT NAME]');
    expect(prompt).toContain('Skip [FIXED] slots');
  });
});

describe('parseSlotsResponse', () => {
  it('parses { slots: [...] } response into DocumentPartDraft', () => {
    const draft = parseSlotsResponse('{"slots":[{"slot_index":0,"text":"X"}]}');
    expect(draft.kind).toBe('document_part');
    expect(draft.slots).toEqual([{ slot_index: 0, text: 'X' }]);
  });

  it('rejects responses whose slots point at drawing paragraphs', () => {
    expect(() =>
      parseSlotsResponse('{"slots":[{"slot_index":1,"text":"X"}]}', makeDocPartSection()),
    ).toThrow(/non-draftable/);
  });

  it('strips markdown code fences', () => {
    const raw = '```json\n{"slots":[{"slot_index":0,"text":"Y"}]}\n```';
    const draft = parseSlotsResponse(raw);
    expect(draft.slots).toEqual([{ slot_index: 0, text: 'Y' }]);
  });

  it('throws when slots is missing', () => {
    expect(() => parseSlotsResponse('{}')).toThrow(/slots/);
  });

  it('throws when an entry has wrong shape', () => {
    expect(() => parseSlotsResponse('{"slots":[{"slot_index":"a"}]}')).toThrow();
  });
});

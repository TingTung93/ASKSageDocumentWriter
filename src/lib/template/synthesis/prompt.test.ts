import { describe, it, expect } from 'vitest';
import { buildSynthesisPrompt } from './prompt';
import type { TemplateSchema } from '../types';
import type { FullBody } from './sample';

const EMPTY_BODY: FullBody = { lines: [], truncated: false, total_paragraphs: 0, total_chars: 0 };

function makeSchema(): TemplateSchema {
  return {
    $schema: 'test',
    id: 't1',
    name: 'Clinical SOP',
    version: 1,
    source: {
      filename: 'sop.docx',
      ingested_at: '2026-04-07T20:00:00Z',
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
      default_font: { family: 'Times New Roman', size_pt: 12 },
      theme: null,
      named_styles: [
        { id: 'Heading1', name: 'Heading 1', type: 'paragraph', based_on: null, outline_level: 0, numbering_id: null },
        { id: 'BodyText', name: 'Body Text', type: 'paragraph', based_on: null, outline_level: null, numbering_id: null },
      ],
      numbering_definitions: [],
      headers: [],
      footers: [],
    },
    metadata_fill_regions: [
      {
        id: 'cui_banner',
        kind: 'content_control',
        sdt_tag: 'CUIBanner',
        control_type: 'dropdown',
        allowed_values: ['UNCLASSIFIED', 'CUI'],
        project_input_field: 'cui_banner',
        required: true,
      },
    ],
    sections: [
      {
        id: 'purpose',
        name: '1. Purpose',
        order: 0,
        required: true,
        fill_region: {
          kind: 'heading_bounded',
          heading_text: '1. Purpose',
          heading_style_id: 'Heading1',
          body_style_id: 'BodyText',
          anchor_paragraph_index: 0,
          end_anchor_paragraph_index: 2,
          permitted_roles: ['body'],
        },
      },
    ],
    style: {
      voice: null,
      tense: null,
      register: null,
      jargon_policy: null,
      banned_phrases: [],
    },
  };
}

describe('buildSynthesisPrompt', () => {
  it('produces a system prompt that demands strict JSON', () => {
    const built = buildSynthesisPrompt({
      schema: makeSchema(),
      samples: [{ section_id: 'purpose', heading: '1. Purpose', sample_text: 'This SOP establishes the procedures for clinical care.', paragraph_range: [1, 3] }],
      full_body: EMPTY_BODY,
    });
    expect(built.system_prompt).toMatch(/STRICT JSON/);
    expect(built.system_prompt).toMatch(/JSON\.parse/);
    expect(built.system_prompt).toMatch(/sections/);
    expect(built.system_prompt).toMatch(/style/);
  });

  it('includes the template name and filename in the message', () => {
    const built = buildSynthesisPrompt({
      schema: makeSchema(),
      samples: [],
      full_body: EMPTY_BODY,
    });
    expect(built.message).toContain('Clinical SOP');
    expect(built.message).toContain('sop.docx');
  });

  it('lists each section sample under its id', () => {
    const built = buildSynthesisPrompt({
      schema: makeSchema(),
      samples: [
        { section_id: 'purpose', heading: '1. Purpose', sample_text: 'This SOP establishes the procedures.', paragraph_range: [1, 3] },
      ],
      full_body: EMPTY_BODY,
    });
    expect(built.message).toContain('id: purpose');
    expect(built.message).toContain('heading: 1. Purpose');
    expect(built.message).toContain('This SOP establishes the procedures.');
  });

  it('lists metadata fill regions separately so the LLM does not draft them', () => {
    const built = buildSynthesisPrompt({
      schema: makeSchema(),
      samples: [],
      full_body: EMPTY_BODY,
    });
    expect(built.message).toContain('Metadata fill regions');
    expect(built.message).toContain('cui_banner');
    expect(built.message).toContain('UNCLASSIFIED | CUI');
  });

  it('includes a user hint if provided', () => {
    const built = buildSynthesisPrompt({
      schema: makeSchema(),
      samples: [],
      user_hint: 'This is for an MTF infectious disease ward.',
      full_body: EMPTY_BODY,
    });
    expect(built.message).toContain('MTF infectious disease ward');
  });

  it('renders per-section samples with anchored_text and paragraph_range', () => {
    const built = buildSynthesisPrompt({
      schema: makeSchema(),
      samples: [
        {
          section_id: 'purpose',
          heading: '1. Purpose',
          sample_text: 'Establishes procedures for clinical care.',
          paragraph_range: [3, 7],
        },
      ],
      full_body: EMPTY_BODY,
    });
    expect(built.message).toContain('anchored_text:');
    expect(built.message).toContain('Establishes procedures for clinical care.');
    expect(built.message).toContain('paragraph_range: [3, 7]');
  });

  it('renders the full body block with paragraph indices', () => {
    const built = buildSynthesisPrompt({
      schema: makeSchema(),
      samples: [],
      full_body: {
        lines: [
          { index: 0, text: 'TITLE OF SOP' },
          { index: 1, text: '1. Purpose' },
          { index: 2, text: '[Insert purpose statement, 2-3 sentences.]' },
        ],
        truncated: false,
        total_paragraphs: 3,
        total_chars: 80,
      },
    });
    expect(built.message).toContain('FULL TEMPLATE BODY');
    expect(built.message).toContain('[0] TITLE OF SOP');
    expect(built.message).toContain('[2] [Insert purpose statement, 2-3 sentences.]');
    expect(built.message).toContain('END FULL TEMPLATE BODY');
  });

  it('marks the full body as truncated when not all paragraphs fit', () => {
    const built = buildSynthesisPrompt({
      schema: makeSchema(),
      samples: [],
      full_body: {
        lines: [{ index: 0, text: 'first' }],
        truncated: true,
        total_paragraphs: 100,
        total_chars: 5,
      },
    });
    expect(built.message).toContain('1/100');
    expect(built.message).toContain('TRAILING TRUNCATED');
  });
});

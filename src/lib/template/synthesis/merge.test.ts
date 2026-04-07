import { describe, it, expect } from 'vitest';
import { mergeSemanticIntoSchema } from './merge';
import type { TemplateSchema } from '../types';
import type { LLMSemanticOutput } from './types';

function makeStructural(): TemplateSchema {
  return {
    $schema: 'test://v2',
    id: 'tpl-1',
    name: 'Test SOP',
    version: 1,
    source: {
      filename: 'test.docx',
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
      named_styles: [],
      numbering_definitions: [],
      headers: [],
      footers: [],
    },
    metadata_fill_regions: [],
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
      {
        id: 'scope',
        name: '2. Scope',
        order: 1,
        required: true,
        fill_region: {
          kind: 'heading_bounded',
          heading_text: '2. Scope',
          heading_style_id: 'Heading1',
          body_style_id: 'BodyText',
          anchor_paragraph_index: 3,
          end_anchor_paragraph_index: 5,
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

function makeSemantic(): LLMSemanticOutput {
  return {
    style: {
      voice: 'third_person',
      tense: 'present',
      register: 'formal_government',
      jargon_policy: 'use DoD terminology',
      banned_phrases: ['leverage'],
    },
    sections: [
      {
        id: 'purpose',
        name: '1. Purpose',
        paragraph_range: [1, 3],
        intent: 'State the SOP goal.',
        target_words: [80, 150],
        depends_on: [],
        validation: { must_not_exceed_words: 200 },
      },
      {
        id: 'scope',
        name: '2. Scope',
        paragraph_range: [4, 6],
        intent: 'Define the SOP applicability.',
        target_words: [60, 120],
        depends_on: ['purpose'],
      },
    ],
  };
}

describe('mergeSemanticIntoSchema', () => {
  it('populates style block from LLM output', () => {
    const merged = mergeSemanticIntoSchema(makeStructural(), makeSemantic(), {
      semantic_synthesizer: 'google-gemini-2.5-flash',
    });
    expect(merged.style.voice).toBe('third_person');
    expect(merged.style.tense).toBe('present');
    expect(merged.style.banned_phrases).toEqual(['leverage']);
  });

  it('adds intent + target_words + depends_on + validation to each section', () => {
    const merged = mergeSemanticIntoSchema(makeStructural(), makeSemantic(), {
      semantic_synthesizer: 'google-gemini-2.5-flash',
    });
    const purpose = merged.sections.find((s) => s.id === 'purpose')!;
    expect(purpose.intent).toBe('State the SOP goal.');
    expect(purpose.target_words).toEqual([80, 150]);
    expect(purpose.depends_on).toEqual([]);
    expect(purpose.validation).toEqual({ must_not_exceed_words: 200 });

    const scope = merged.sections.find((s) => s.id === 'scope')!;
    expect(scope.intent).toBe('Define the SOP applicability.');
    expect(scope.depends_on).toEqual(['purpose']);
  });

  it('records the semantic_synthesizer model in source', () => {
    const merged = mergeSemanticIntoSchema(makeStructural(), makeSemantic(), {
      semantic_synthesizer: 'google-gemini-2.5-flash',
    });
    expect(merged.source.semantic_synthesizer).toBe('google-gemini-2.5-flash');
  });

  it('preserves the parser-derived structural formatting half', () => {
    const structural = makeStructural();
    const merged = mergeSemanticIntoSchema(structural, makeSemantic(), {
      semantic_synthesizer: 'google-gemini-2.5-flash',
    });
    expect(merged.formatting).toEqual(structural.formatting);
    expect(merged.metadata_fill_regions).toEqual(structural.metadata_fill_regions);
    expect(merged.id).toBe(structural.id);
  });

  it('builds new BodyFillRegions from LLM paragraph_range, replacing parser sections', () => {
    const merged = mergeSemanticIntoSchema(makeStructural(), makeSemantic(), {
      semantic_synthesizer: 'google-gemini-2.5-flash',
    });
    // The LLM-authored sections become the schema's sections.
    expect(merged.sections.length).toBe(2);
    const purpose = merged.sections.find((s) => s.id === 'purpose')!;
    expect(purpose.name).toBe('1. Purpose');
    expect(purpose.fill_region.kind).toBe('heading_bounded');
    if (purpose.fill_region.kind === 'heading_bounded') {
      // anchor = first - 1, end = last
      expect(purpose.fill_region.anchor_paragraph_index).toBe(0);
      expect(purpose.fill_region.end_anchor_paragraph_index).toBe(3);
    }
  });

  it('falls back to parser sections if the LLM emits zero sections', () => {
    const structural = makeStructural();
    const empty: LLMSemanticOutput = {
      style: makeSemantic().style,
      sections: [],
    };
    const merged = mergeSemanticIntoSchema(structural, empty, {
      semantic_synthesizer: 'google-gemini-2.5-flash',
    });
    // Section list comes from the parser, but the style block still
    // gets the LLM's output.
    expect(merged.sections.length).toBe(structural.sections.length);
    expect(merged.sections[0]!.id).toBe('purpose');
    expect(merged.style.voice).toBe('third_person');
  });

  it('does not mutate the input structural schema', () => {
    const structural = makeStructural();
    const beforeJson = JSON.stringify(structural);
    mergeSemanticIntoSchema(structural, makeSemantic(), {
      semantic_synthesizer: 'google-gemini-2.5-flash',
    });
    expect(JSON.stringify(structural)).toBe(beforeJson);
  });
});

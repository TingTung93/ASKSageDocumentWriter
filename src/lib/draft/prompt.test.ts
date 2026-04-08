import { describe, it, expect } from 'vitest';
import { buildDraftingPrompt } from './prompt';
import type { TemplateSchema, BodyFillRegion } from '../template/types';

function makeTemplate(): TemplateSchema {
  return {
    $schema: 'test',
    id: 'tpl',
    name: 'Sample SOP',
    version: 1,
    source: {
      filename: 'sop.docx',
      ingested_at: '2026-04-07T20:00:00Z',
      structural_parser_version: '0.1.0',
      semantic_synthesizer: 'google-claude-46-sonnet',
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
    style: {
      voice: 'third_person',
      tense: 'present',
      register: 'formal_government',
      jargon_policy: 'use FAR-defined contracting terms',
      banned_phrases: ['leverage'],
    },
  };
}

function makeSection(): BodyFillRegion {
  return {
    id: 'purpose',
    name: '1. Purpose',
    order: 0,
    required: true,
    fill_region: {
      kind: 'heading_bounded',
      heading_text: '1. Purpose',
      heading_style_id: null,
      body_style_id: null,
      anchor_paragraph_index: 0,
      end_anchor_paragraph_index: 4,
      permitted_roles: ['body', 'bullet'],
    },
    intent: 'State the SOP goal.',
    target_words: [80, 150],
    depends_on: [],
    validation: { must_not_exceed_words: 200 },
  };
}

describe('buildDraftingPrompt', () => {
  it('emits a system prompt that demands strict JSON with role-tagged paragraphs', () => {
    const built = buildDraftingPrompt({
      template: makeTemplate(),
      section: makeSection(),
      project_description: 'Maintenance contract',
      shared_inputs: {},
      prior_summaries: [],
    });
    expect(built.system_prompt).toMatch(/STRICT JSON/);
    expect(built.system_prompt).toMatch(/paragraphs/);
    expect(built.system_prompt).toMatch(/role/);
    expect(built.system_prompt).toMatch(/heading/);
    expect(built.system_prompt).toMatch(/bullet/);
  });

  it('includes the section spec and document context in the message', () => {
    const built = buildDraftingPrompt({
      template: makeTemplate(),
      section: makeSection(),
      project_description: 'Maintenance contract for Diasorin Liaison MDX',
      shared_inputs: { cui_banner: 'CUI', document_number: 'DHA-25-001' },
      prior_summaries: [],
    });
    expect(built.message).toContain('Sample SOP');
    expect(built.message).toContain('Maintenance contract for Diasorin Liaison MDX');
    expect(built.message).toContain('cui_banner: CUI');
    expect(built.message).toContain('document_number: DHA-25-001');
    expect(built.message).toContain('1. Purpose');
    expect(built.message).toContain('intent: State the SOP goal.');
    expect(built.message).toContain('target_words: 80-150');
    expect(built.message).toContain('permitted_roles: body, bullet');
    expect(built.message).toContain('voice: third_person');
    expect(built.message).toContain('register: formal_government');
  });

  it('lists prior section summaries when provided', () => {
    const built = buildDraftingPrompt({
      template: makeTemplate(),
      section: makeSection(),
      project_description: '',
      shared_inputs: {},
      prior_summaries: [
        { section_id: 'scope', name: '1.1 Scope', summary: 'Defines what the contract covers.' },
      ],
    });
    expect(built.message).toContain('PRIOR SECTIONS');
    expect(built.message).toContain('1.1 Scope');
    expect(built.message).toContain('Defines what the contract covers.');
  });

  it('omits the prior sections block when empty', () => {
    const built = buildDraftingPrompt({
      template: makeTemplate(),
      section: makeSection(),
      project_description: '',
      shared_inputs: {},
      prior_summaries: [],
    });
    expect(built.message).not.toContain('PRIOR SECTIONS');
  });

  it('puts the SUBJECT block at the top of the prompt', () => {
    const built = buildDraftingPrompt({
      template: makeTemplate(),
      section: makeSection(),
      project_description: 'Performance Work Statement for Diasorin Liaison maintenance.',
      shared_inputs: {},
      prior_summaries: [],
    });
    // SUBJECT must appear before any other block.
    const subjectIdx = built.message.indexOf('=== SUBJECT ===');
    const styleIdx = built.message.indexOf('=== STYLE BLOCK ===');
    const sectionIdx = built.message.indexOf('=== SECTION TO DRAFT ===');
    expect(subjectIdx).toBeGreaterThanOrEqual(0);
    expect(subjectIdx).toBeLessThan(styleIdx);
    expect(styleIdx).toBeLessThan(sectionIdx);
    expect(built.message).toContain('Diasorin Liaison maintenance');
  });

  it('inlines the references block immediately after SUBJECT', () => {
    const built = buildDraftingPrompt({
      template: makeTemplate(),
      section: makeSection(),
      project_description: 'X policy.',
      shared_inputs: {},
      prior_summaries: [],
      references_block:
        '=== ATTACHED REFERENCES (1 file, 100 chars) ===\nfull text of the user reference\n=== END ATTACHED REFERENCES ===',
    });
    expect(built.message).toContain('ATTACHED REFERENCES');
    expect(built.message).toContain('full text of the user reference');
    const subjectIdx = built.message.indexOf('=== SUBJECT ===');
    const refsIdx = built.message.indexOf('=== ATTACHED REFERENCES');
    expect(subjectIdx).toBeLessThan(refsIdx);
  });

  it('inlines the notes block when provided', () => {
    const built = buildDraftingPrompt({
      template: makeTemplate(),
      section: makeSection(),
      project_description: 'X policy.',
      shared_inputs: {},
      prior_summaries: [],
      notes_block: '=== PROJECT NOTES ===\nkey hint here\n=== END PROJECT NOTES ===',
    });
    expect(built.message).toContain('PROJECT NOTES');
    expect(built.message).toContain('key hint here');
  });

  it('inlines the template example for THIS section when provided', () => {
    const built = buildDraftingPrompt({
      template: makeTemplate(),
      section: makeSection(),
      project_description: 'X policy.',
      shared_inputs: {},
      prior_summaries: [],
      template_example: 'This is the actual paragraph text from the template.',
    });
    expect(built.message).toContain('TEMPLATE EXAMPLE FOR THIS SECTION');
    expect(built.message).toContain('actual paragraph text from the template');
  });

  it('omits all optional blocks when null/undefined', () => {
    const built = buildDraftingPrompt({
      template: makeTemplate(),
      section: makeSection(),
      project_description: 'X policy.',
      shared_inputs: {},
      prior_summaries: [],
    });
    expect(built.message).not.toContain('ATTACHED REFERENCES');
    expect(built.message).not.toContain('PROJECT NOTES');
    expect(built.message).not.toContain('TEMPLATE EXAMPLE FOR THIS SECTION');
  });

  it('drops must_mention/must_not_mention from validation rendering', () => {
    const sectionWithBakedRules = {
      ...makeSection(),
      validation: {
        must_mention: ['SHARP', 'harassment prevention'],
        must_not_mention: ['leverage'],
        must_not_exceed_words: 200,
      },
    };
    const built = buildDraftingPrompt({
      template: makeTemplate(),
      section: sectionWithBakedRules,
      project_description: 'Transfusion services policy.',
      shared_inputs: {},
      prior_summaries: [],
    });
    expect(built.message).not.toContain('must_mention');
    expect(built.message).not.toContain('SHARP');
    expect(built.message).not.toContain('harassment prevention');
    expect(built.message).toContain('must_not_exceed_words');
  });
});

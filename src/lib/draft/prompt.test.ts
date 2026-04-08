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
    expect(built.message).toContain('Prior sections');
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
    expect(built.message).not.toContain('Prior sections');
  });

  it('inlines the project context block when one is provided', () => {
    const built = buildDraftingPrompt({
      template: makeTemplate(),
      section: makeSection(),
      project_description: '',
      shared_inputs: {},
      prior_summaries: [],
      context_block:
        '=== PROJECT CONTEXT ===\nuser-attached guidance text here\n=== END PROJECT CONTEXT ===',
    });
    expect(built.message).toContain('PROJECT CONTEXT');
    expect(built.message).toContain('user-attached guidance text here');
  });

  it('omits the project context block when null', () => {
    const built = buildDraftingPrompt({
      template: makeTemplate(),
      section: makeSection(),
      project_description: '',
      shared_inputs: {},
      prior_summaries: [],
      context_block: null,
    });
    expect(built.message).not.toContain('PROJECT CONTEXT');
  });
});

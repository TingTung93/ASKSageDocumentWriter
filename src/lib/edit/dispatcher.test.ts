import { describe, it, expect } from 'vitest';
import { applySchemaEdits, applyDraftEdits } from './dispatcher';
import type { TemplateSchema, BodyFillRegion } from '../template/types';
import type { DraftParagraph } from '../draft/types';
import type { SchemaEditOutput, DraftEditOutput } from './types';

function makeSection(id: string, order: number): BodyFillRegion {
  return {
    id,
    name: `Section ${order + 1}`,
    order,
    required: true,
    fill_region: {
      kind: 'heading_bounded',
      heading_text: `Section ${order + 1}`,
      heading_style_id: null,
      body_style_id: null,
      anchor_paragraph_index: order * 5,
      end_anchor_paragraph_index: order * 5 + 4,
      permitted_roles: ['body'],
    },
    intent: `Original intent for ${id}`,
    target_words: [80, 150],
    depends_on: [],
  };
}

function makeSchema(): TemplateSchema {
  return {
    $schema: 'test',
    id: 'tpl',
    name: 'Test',
    version: 1,
    source: {
      filename: 'test.docx',
      ingested_at: '2026-04-07T20:00:00Z',
      structural_parser_version: '0.1.0',
      semantic_synthesizer: 'google-claude-46-sonnet',
      docx_blob_id: 'docx://x',
    },
    formatting: {
      page_setup: {
        paper: 'letter',
        orientation: 'portrait',
        margins_twips: { top: 0, right: 0, bottom: 0, left: 0 },
        header_distance: 0,
        footer_distance: 0,
      },
      default_font: { family: null, size_pt: null },
      theme: null,
      named_styles: [],
      numbering_definitions: [],
      headers: [],
      footers: [],
    },
    metadata_fill_regions: [],
    sections: [makeSection('purpose', 0), makeSection('scope', 1), makeSection('responsibilities', 2)],
    style: {
      voice: 'third_person',
      tense: 'present',
      register: 'formal_government',
      jargon_policy: 'use DoD terminology',
      banned_phrases: ['leverage'],
    },
  };
}

describe('applySchemaEdits', () => {
  it('updates a section intent without touching other fields', () => {
    const out: SchemaEditOutput = {
      edits: [
        { op: 'set_section_field', section_id: 'purpose', field: 'intent', value: 'Refined.' },
      ],
    };
    const { result, applied } = applySchemaEdits(makeSchema(), out);
    expect(applied[0]!.success).toBe(true);
    const purpose = result.sections.find((s) => s.id === 'purpose')!;
    expect(purpose.intent).toBe('Refined.');
    expect(purpose.target_words).toEqual([80, 150]);
    // Other sections untouched
    const scope = result.sections.find((s) => s.id === 'scope')!;
    expect(scope.intent).toBe('Original intent for scope');
  });

  it('updates target_words', () => {
    const out: SchemaEditOutput = {
      edits: [{ op: 'set_section_target_words', section_id: 'purpose', value: [200, 400] }],
    };
    const { result } = applySchemaEdits(makeSchema(), out);
    expect(result.sections.find((s) => s.id === 'purpose')!.target_words).toEqual([200, 400]);
  });

  it('sets a validation rule', () => {
    const out: SchemaEditOutput = {
      edits: [
        {
          op: 'set_section_validation',
          section_id: 'purpose',
          rule: 'must_mention',
          value: ['DHA'],
        },
      ],
    };
    const { result } = applySchemaEdits(makeSchema(), out);
    expect(result.sections.find((s) => s.id === 'purpose')!.validation).toEqual({
      must_mention: ['DHA'],
    });
  });

  it('removes a section and re-orders the rest', () => {
    const out: SchemaEditOutput = {
      edits: [{ op: 'remove_section', section_id: 'scope' }],
    };
    const { result, applied } = applySchemaEdits(makeSchema(), out);
    expect(applied[0]!.success).toBe(true);
    expect(result.sections).toHaveLength(2);
    expect(result.sections[0]!.id).toBe('purpose');
    expect(result.sections[0]!.order).toBe(0);
    expect(result.sections[1]!.id).toBe('responsibilities');
    expect(result.sections[1]!.order).toBe(1);
  });

  it('reorders sections with new_order', () => {
    const out: SchemaEditOutput = {
      edits: [{ op: 'reorder_sections', new_order: ['responsibilities', 'purpose', 'scope'] }],
    };
    const { result } = applySchemaEdits(makeSchema(), out);
    expect(result.sections.map((s) => s.id)).toEqual(['responsibilities', 'purpose', 'scope']);
    expect(result.sections.map((s) => s.order)).toEqual([0, 1, 2]);
  });

  it('sets style fields', () => {
    const out: SchemaEditOutput = {
      edits: [
        { op: 'set_style_field', field: 'register', value: 'technical' },
        { op: 'set_style_field', field: 'voice', value: 'second_person' },
      ],
    };
    const { result } = applySchemaEdits(makeSchema(), out);
    expect(result.style.register).toBe('technical');
    expect(result.style.voice).toBe('second_person');
  });

  it('adds and removes banned phrases', () => {
    const out: SchemaEditOutput = {
      edits: [
        { op: 'add_banned_phrase', phrase: 'going forward' },
        { op: 'add_banned_phrase', phrase: 'best practices' },
        { op: 'remove_banned_phrase', phrase: 'leverage' },
      ],
    };
    const { result } = applySchemaEdits(makeSchema(), out);
    expect(result.style.banned_phrases).toContain('going forward');
    expect(result.style.banned_phrases).toContain('best practices');
    expect(result.style.banned_phrases).not.toContain('leverage');
  });

  it('reports per-edit errors when section_id is unknown', () => {
    const out: SchemaEditOutput = {
      edits: [
        { op: 'set_section_field', section_id: 'unknown', field: 'intent', value: 'x' },
      ],
    };
    const { applied } = applySchemaEdits(makeSchema(), out);
    expect(applied[0]!.success).toBe(false);
    expect(applied[0]!.error).toContain('unknown');
  });

  it('does not mutate the input schema', () => {
    const schema = makeSchema();
    const before = JSON.stringify(schema);
    applySchemaEdits(schema, {
      edits: [{ op: 'set_section_field', section_id: 'purpose', field: 'intent', value: 'NEW' }],
    });
    expect(JSON.stringify(schema)).toBe(before);
  });
});

describe('applyDraftEdits', () => {
  function makeLookup(initial: Record<string, DraftParagraph[]>) {
    return {
      get(template_id: string, section_id: string) {
        return initial[`${template_id}::${section_id}`];
      },
    };
  }

  const PARAGRAPHS: DraftParagraph[] = [
    { role: 'body', text: 'First paragraph.' },
    { role: 'body', text: 'Second paragraph.' },
    { role: 'body', text: 'Third paragraph.' },
  ];

  it('replaces a single paragraph in place', () => {
    const out: DraftEditOutput = {
      edits: [
        {
          op: 'replace_paragraph',
          template_id: 't1',
          section_id: 's1',
          index: 1,
          text: 'Tightened second paragraph.',
        },
      ],
    };
    const { updated, applied } = applyDraftEdits(out, makeLookup({ 't1::s1': PARAGRAPHS }));
    expect(applied[0]!.success).toBe(true);
    const next = updated.get('t1::s1')!;
    expect(next[1]!.text).toBe('Tightened second paragraph.');
    expect(next[0]!.text).toBe('First paragraph.'); // unchanged
    expect(next.length).toBe(3);
  });

  it('inserts a paragraph after a given index', () => {
    const out: DraftEditOutput = {
      edits: [
        {
          op: 'insert_paragraph',
          template_id: 't1',
          section_id: 's1',
          after_index: 0,
          role: 'note',
          text: 'A note inserted after the first paragraph.',
        },
      ],
    };
    const { updated } = applyDraftEdits(out, makeLookup({ 't1::s1': PARAGRAPHS }));
    const next = updated.get('t1::s1')!;
    expect(next.length).toBe(4);
    expect(next[1]!.role).toBe('note');
    expect(next[1]!.text).toContain('A note inserted');
  });

  it('deletes a paragraph at index', () => {
    const out: DraftEditOutput = {
      edits: [{ op: 'delete_paragraph', template_id: 't1', section_id: 's1', index: 1 }],
    };
    const { updated } = applyDraftEdits(out, makeLookup({ 't1::s1': PARAGRAPHS }));
    const next = updated.get('t1::s1')!;
    expect(next.length).toBe(2);
    expect(next.map((p) => p.text)).toEqual(['First paragraph.', 'Third paragraph.']);
  });

  it('replaces text within all paragraphs of a section', () => {
    const out: DraftEditOutput = {
      edits: [
        {
          op: 'replace_text_in_section',
          template_id: 't1',
          section_id: 's1',
          find: 'paragraph',
          replace: 'block',
        },
      ],
    };
    const { updated } = applyDraftEdits(out, makeLookup({ 't1::s1': PARAGRAPHS }));
    const next = updated.get('t1::s1')!;
    expect(next.map((p) => p.text)).toEqual(['First block.', 'Second block.', 'Third block.']);
  });

  it('chains multiple edits on the same section in order', () => {
    const out: DraftEditOutput = {
      edits: [
        { op: 'delete_paragraph', template_id: 't1', section_id: 's1', index: 2 },
        {
          op: 'replace_paragraph',
          template_id: 't1',
          section_id: 's1',
          index: 0,
          text: 'New first.',
        },
      ],
    };
    const { updated } = applyDraftEdits(out, makeLookup({ 't1::s1': PARAGRAPHS }));
    const next = updated.get('t1::s1')!;
    expect(next.length).toBe(2);
    expect(next[0]!.text).toBe('New first.');
    expect(next[1]!.text).toBe('Second paragraph.');
  });

  it('reports per-edit errors when index is out of range', () => {
    const out: DraftEditOutput = {
      edits: [
        { op: 'replace_paragraph', template_id: 't1', section_id: 's1', index: 99, text: 'x' },
      ],
    };
    const { applied } = applyDraftEdits(out, makeLookup({ 't1::s1': PARAGRAPHS }));
    expect(applied[0]!.success).toBe(false);
    expect(applied[0]!.error).toContain('out of range');
  });
});

import { describe, expect, it } from 'vitest';
import type { TemplateSchema } from '../template/types';
import { buildDefaultFormattingInventory, buildFormattingInventory } from './formatting';

function schema(): TemplateSchema {
  return {
    $schema: 'asksage-document-template/v1',
    id: 'tpl',
    name: 'Template',
    version: 1,
    source: {
      filename: 'template.docx',
      ingested_at: '2026-07-01T00:00:00.000Z',
      structural_parser_version: 'test',
      semantic_synthesizer: null,
      docx_blob_id: 'blob',
    },
    formatting: {
      page_setup: {
        paper: 'letter',
        orientation: 'portrait',
        margins_twips: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
        header_distance: 720,
        footer_distance: 720,
      },
      default_font: { family: 'Calibri', size_pt: 11 },
      theme: null,
      named_styles: [
        { id: 'Normal', name: 'Normal', type: 'paragraph', based_on: null, outline_level: null, numbering_id: null, alignment: null, indent_left_twips: null, indent_first_line_twips: null, indent_hanging_twips: null },
        { id: 'Heading1', name: 'heading 1', type: 'paragraph', based_on: 'Normal', outline_level: 0, numbering_id: null, alignment: null, indent_left_twips: null, indent_first_line_twips: null, indent_hanging_twips: null },
        { id: 'Strong', name: 'Strong', type: 'character', based_on: null, outline_level: null, numbering_id: null, alignment: null, indent_left_twips: null, indent_first_line_twips: null, indent_hanging_twips: null },
        { id: 'TableGrid', name: 'Table Grid', type: 'table', based_on: null, outline_level: null, numbering_id: null, alignment: null, indent_left_twips: null, indent_first_line_twips: null, indent_hanging_twips: null },
      ],
      numbering_definitions: [
        { id: 1, abstract_id: 10, levels: [{ level: 0, format: 'bullet', text: '\u2022', indent_twips: 720 }] },
      ],
      headers: [{ type: 'default', part: 'word/header1.xml' }],
      footers: [{ type: 'default', part: 'word/footer1.xml' }],
    },
    metadata_fill_regions: [],
    sections: [],
    style: { voice: null, tense: null, register: null, jargon_policy: null, banned_phrases: [] },
  };
}

describe('buildFormattingInventory', () => {
  it('collects style ids, list templates, table styles, and document parts', () => {
    const inventory = buildFormattingInventory(schema());

    expect(inventory.paragraphStyleIds).toEqual(new Set(['Normal', 'Heading1']));
    expect(inventory.tableStyleIds).toEqual(new Set(['TableGrid']));
    expect(inventory.characterStyleIds).toEqual(new Set(['Strong']));
    expect(inventory.listTemplates).toEqual([{ num_id: 1, levels: [0] }]);
    expect(inventory.headerFooterParts).toEqual(['word/header1.xml', 'word/footer1.xml']);
    expect(inventory.defaultFont).toEqual({ family: 'Calibri', size_pt: 11 });
  });
});

describe('buildDefaultFormattingInventory', () => {
  it('returns a usable freeform default inventory', () => {
    const inventory = buildDefaultFormattingInventory();

    expect(inventory.paragraphStyleIds.has('Normal')).toBe(true);
    expect(inventory.paragraphStyleIds.has('Heading1')).toBe(true);
    expect(inventory.paragraphStyleIds.has('Heading2')).toBe(true);
    expect(inventory.paragraphStyleIds.has('Heading3')).toBe(true);
    expect(inventory.paragraphStyleIds.has('Heading4')).toBe(true);
    expect(inventory.paragraphStyleIds.has('ListBullet')).toBe(true);
    expect(inventory.paragraphStyleIds.has('ListNumber')).toBe(true);
    expect(inventory.paragraphStyleIds.has('Quote')).toBe(true);
    expect(inventory.tableStyleIds.has('TableGrid')).toBe(true);
    expect(inventory.listTemplates).toEqual([
      { num_id: 1, levels: [0, 1, 2, 3, 4, 5, 6, 7, 8] },
      { num_id: 2, levels: [0, 1, 2, 3, 4, 5, 6, 7, 8] },
    ]);
    expect(inventory.headerFooterParts).toEqual([]);
    expect(inventory.defaultFont).toEqual({ family: 'Calibri', size_pt: 11 });
  });
});

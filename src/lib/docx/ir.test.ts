import { describe, expect, it } from 'vitest';
import type { DraftParagraph } from '../draft/types';
import {
  normalizeDraftParagraphs,
  structuredBlocksToDraftParagraphs,
} from './ir';
import type { StructuredBlock } from './ir';

describe('normalizeDraftParagraphs', () => {
  it('collapses consecutive table_row paragraphs into a table block', () => {
    const input: DraftParagraph[] = [
      { role: 'body', text: 'Intro.' },
      { role: 'table_row', text: '', is_header: true, cells: ['Role', 'Duty'] },
      { role: 'table_row', text: '', cells: ['CO', 'Award'] },
      { role: 'body', text: 'Outro.' },
    ];

    const blocks = normalizeDraftParagraphs(input);

    expect(blocks).toHaveLength(3);
    expect(blocks[1]).toMatchObject({
      kind: 'table',
      rows: [
        { is_header: true, cells: [{ text: 'Role' }, { text: 'Duty' }] },
        { is_header: false, cells: [{ text: 'CO' }, { text: 'Award' }] },
      ],
    });
  });

  it('converts page_break_before into an explicit page_break block', () => {
    const blocks = normalizeDraftParagraphs([
      { role: 'heading', text: 'Appendix', page_break_before: true },
    ]);

    expect(blocks.map((b) => b.kind)).toEqual(['page_break', 'paragraph']);
    expect(blocks[1]).toMatchObject({ kind: 'paragraph', role: 'heading', text: 'Appendix' });
  });

  it('converts page_break_before on a table row into a page_break before the table', () => {
    const blocks = normalizeDraftParagraphs([
      { role: 'table_row', text: '', page_break_before: true, cells: ['A', 'B'] },
    ]);

    expect(blocks.map((b) => b.kind)).toEqual(['page_break', 'table']);
    expect(blocks[1]).toMatchObject({
      kind: 'table',
      rows: [{ cells: [{ text: 'A' }, { text: 'B' }] }],
    });
  });

  it('coerces invalid paragraph roles to body', () => {
    const blocks = normalizeDraftParagraphs([
      { role: 'unknown' as DraftParagraph['role'], text: 'Fallback text.' },
    ]);

    expect(blocks[0]).toMatchObject({
      kind: 'paragraph',
      role: 'body',
      text: 'Fallback text.',
    });
  });

  it('round-trips normalized tables back to legacy DraftParagraph rows', () => {
    const input: DraftParagraph[] = [
      { role: 'table_row', text: '', is_header: true, cells: ['A', 'B'] },
      { role: 'table_row', text: '', cells: ['1', '2'] },
    ];

    const flattened = structuredBlocksToDraftParagraphs(normalizeDraftParagraphs(input));

    expect(flattened).toEqual(input);
  });

  it('round-trips meaningful table cell metadata and omits default arrays', () => {
    const input: DraftParagraph[] = [
      {
        role: 'table_row',
        text: '',
        cells: ['Name', 'Description'],
        cell_shading: ['D9EAF7', ''],
        cell_colspans: [1, 2],
        cell_widths_pct: [35, 65],
      },
      {
        role: 'table_row',
        text: '',
        cells: ['Plain', 'Row'],
        cell_shading: ['', ''],
        cell_colspans: [1, 1],
        cell_widths_pct: [0, 0],
      },
    ];

    const flattened = structuredBlocksToDraftParagraphs(normalizeDraftParagraphs(input));

    expect(flattened[0]).toEqual(input[0]);
    expect(flattened[1]).toEqual({
      role: 'table_row',
      text: '',
      cells: ['Plain', 'Row'],
    });
  });

  it('round-trips row-level runs through a single structured table cell', () => {
    const input: DraftParagraph[] = [
      {
        role: 'table_row',
        text: '',
        cells: ['Formatted'],
        runs: [{ text: 'Formatted', bold: true }],
      },
    ];

    const blocks = normalizeDraftParagraphs(input);

    expect(blocks[0]).toMatchObject({
      kind: 'table',
      rows: [{ cells: [{ text: 'Formatted', runs: [{ text: 'Formatted', bold: true }] }] }],
    });
    expect(structuredBlocksToDraftParagraphs(blocks)).toEqual(input);
  });
});

describe('structuredBlocksToDraftParagraphs', () => {
  it('honors paragraph-local page_break_before when flattening', () => {
    const blocks: StructuredBlock[] = [
      { kind: 'paragraph', role: 'heading', text: 'Appendix', page_break_before: true },
    ];

    expect(structuredBlocksToDraftParagraphs(blocks)).toEqual([
      { role: 'heading', text: 'Appendix', page_break_before: true },
    ]);
  });
});

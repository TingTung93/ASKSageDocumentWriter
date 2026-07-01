import { describe, expect, it } from 'vitest';
import type { DraftParagraph } from '../draft/types';
import {
  normalizeDraftParagraphs,
  structuredBlocksToDraftParagraphs,
} from './ir';

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

  it('round-trips normalized tables back to legacy DraftParagraph rows', () => {
    const input: DraftParagraph[] = [
      { role: 'table_row', text: '', is_header: true, cells: ['A', 'B'] },
      { role: 'table_row', text: '', cells: ['1', '2'] },
    ];

    const flattened = structuredBlocksToDraftParagraphs(normalizeDraftParagraphs(input));

    expect(flattened).toEqual(input);
  });
});

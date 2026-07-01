import { describe, expect, it } from 'vitest';
import type { StructuredTableBlock } from './ir';
import {
  W_NS,
  appendTextRun,
  buildParagraphElement,
  buildTableElement,
  createWordDocument,
  serializeXml,
} from './ooxml';

describe('OOXML builders', () => {
  it('builds rich paragraph runs with toggles', () => {
    const dom = createWordDocument();
    const p = buildParagraphElement(dom, {
      kind: 'paragraph',
      role: 'body',
      text: '',
      runs: [
        { text: 'The ' },
        { text: 'term', bold: true, italic: true },
      ],
    });

    const xml = serializeXml(p);

    expect(xml).toContain('<w:b');
    expect(xml).toContain('<w:i');
    expect(xml).toContain('term');
  });

  it('adds pageBreakBefore when requested', () => {
    const dom = createWordDocument();
    const p = buildParagraphElement(dom, {
      kind: 'paragraph',
      role: 'heading',
      text: 'Appendix',
      page_break_before: true,
    } as never);

    expect(serializeXml(p)).toContain('<w:pageBreakBefore');
  });

  it('builds a table with header rows and padded cells', () => {
    const dom = createWordDocument();
    const table: StructuredTableBlock = {
      kind: 'table',
      rows: [
        { is_header: true, cells: [{ text: 'Role' }, { text: 'Duty' }] },
        { is_header: false, cells: [{ text: 'CO' }, { text: 'Award' }] },
      ],
    };

    const tbl = buildTableElement(dom, table);
    const xml = serializeXml(tbl);

    expect(tbl.namespaceURI).toBe(W_NS);
    expect(xml).toContain('<w:tblHeader');
    expect(xml).toContain('Role');
    expect(xml).toContain('Award');
  });

  it('builds table cell rich runs', () => {
    const dom = createWordDocument();
    const table: StructuredTableBlock = {
      kind: 'table',
      rows: [
        {
          is_header: false,
          cells: [
            {
              text: 'fallback',
              runs: [
                { text: 'Bold ', bold: true },
                { text: 'italic', italic: true, underline: true },
              ],
            },
          ],
        },
      ],
    };

    const tbl = buildTableElement(dom, table);
    const xml = serializeXml(tbl);

    expect(xml).toContain('<w:b');
    expect(xml).toContain('<w:i');
    expect(xml).toContain('<w:u');
    expect(xml).toContain('Bold ');
    expect(xml).toContain('italic');
    expect(xml).not.toContain('fallback');
  });

  it('appends a run with preserved whitespace', () => {
    const dom = createWordDocument();
    const p = dom.createElementNS(W_NS, 'w:p');
    appendTextRun(dom, p, '  spaced  ');

    expect(serializeXml(p)).toContain('xml:space="preserve"');
  });
});

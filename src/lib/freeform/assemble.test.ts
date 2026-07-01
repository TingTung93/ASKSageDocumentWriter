import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { assembleFreeformDocx } from './assemble';

async function documentXml(blob: Blob): Promise<string> {
  const zip = await JSZip.loadAsync(blob);
  const xml = await zip.file('word/document.xml')?.async('string');
  if (!xml) throw new Error('missing document.xml');
  return xml;
}

describe('assembleFreeformDocx', () => {
  it('builds rich runs through shared OOXML helpers', async () => {
    const result = await assembleFreeformDocx([
      {
        role: 'body',
        text: '',
        runs: [
          { text: 'Plain ' },
          { text: 'underlined', underline: true },
        ],
      },
    ]);

    const xml = await documentXml(result.blob);

    expect(xml).toContain('<w:u');
    expect(xml).toContain('underlined');
  });

  it('writes table cell shading through shared table builders', async () => {
    const result = await assembleFreeformDocx([
      { role: 'table_row', text: '', is_header: true, cells: ['A', 'B'], cell_shading: ['D9EAF7', 'D9EAF7'] },
      { role: 'table_row', text: '', cells: ['1', '2'] },
    ]);

    const xml = await documentXml(result.blob);

    expect(xml).toContain('D9EAF7');
    expect(xml).toMatch(/<w:shd[^>]+w:fill="D9EAF7"/);
  });

  it('preserves bold semantic labels for alert paragraphs without explicit runs', async () => {
    const result = await assembleFreeformDocx([
      { role: 'note', text: 'Review the checklist.' },
      { role: 'caution', text: 'Disconnect power first.' },
      { role: 'warning', text: 'Do not proceed.' },
    ]);

    const xml = await documentXml(result.blob);

    for (const label of ['NOTE: ', 'CAUTION: ', 'WARNING: ']) {
      const labelIndex = xml.indexOf(label);
      const runStart = xml.lastIndexOf('<w:r>', labelIndex);
      const runEnd = xml.indexOf('</w:r>', labelIndex);
      const labelRun = xml.slice(runStart, runEnd);

      expect(labelIndex).toBeGreaterThanOrEqual(0);
      expect(labelRun).toContain('<w:b');
    }
    expect(xml).toContain('Review the checklist.');
    expect(xml).toContain('Disconnect power first.');
    expect(xml).toContain('Do not proceed.');
  });

  it('does not add semantic labels when alert paragraphs provide explicit runs', async () => {
    const result = await assembleFreeformDocx([
      {
        role: 'note',
        text: 'Fallback text',
        runs: [{ text: 'Custom note', italic: true }],
      },
    ]);

    const xml = await documentXml(result.blob);

    expect(xml).toContain('Custom note');
    expect(xml).not.toContain('NOTE: ');
    expect(xml).not.toContain('Fallback text');
  });

  it('preserves page breaks before tables', async () => {
    const result = await assembleFreeformDocx([
      { role: 'table_row', text: '', page_break_before: true, cells: ['A'] },
    ]);

    const xml = await documentXml(result.blob);
    const pageBreakIndex = xml.indexOf('<w:pageBreakBefore');
    const tableIndex = xml.indexOf('<w:tbl');

    expect(pageBreakIndex).toBeGreaterThanOrEqual(0);
    expect(tableIndex).toBeGreaterThanOrEqual(0);
    expect(pageBreakIndex).toBeLessThan(tableIndex);
  });
});

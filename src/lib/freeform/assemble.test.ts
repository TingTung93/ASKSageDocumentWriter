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
  });
});

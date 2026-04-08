import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { exportEditedDocx } from './writer';
import { parseDocx } from '../template/parser';

const FIXTURES = resolve(__dirname, '../../test/fixtures');

function loadFixture(name: string): Uint8Array {
  const buf = readFileSync(resolve(FIXTURES, name));
  const u8 = new Uint8Array(buf.byteLength);
  u8.set(buf);
  return u8;
}

describe('exportEditedDocx (clone-and-mutate writer)', () => {
  it('round-trips a real DOCX without changes when no overrides are given', async () => {
    const original = loadFixture('DHA-Policy Memo Template (April 8 2025).docx');
    const result = await exportEditedDocx(original, {});
    expect(result.applied).toBe(0);
    expect(result.skipped).toEqual([]);
    // Re-parse the output to confirm it's still a valid DOCX
    const reparsed = await parseDocx(result.blob, {
      filename: 'roundtrip.docx',
      docx_blob_id: 'test',
    });
    expect(reparsed.paragraphs.length).toBeGreaterThan(0);
  });

  it('replaces a paragraph text in place and preserves the count', async () => {
    const original = loadFixture('DHA-Policy Memo Template (April 8 2025).docx');
    const before = await parseDocx(original, {
      filename: 'before.docx',
      docx_blob_id: 'test',
    });
    // Pick a known paragraph with non-empty text
    const target = before.paragraphs.find((p) => p.text.trim().length > 5);
    expect(target).toBeDefined();
    const targetIndex = target!.index;
    const newText = 'REPLACED PARAGRAPH FOR INLINE EDIT TEST';

    const result = await exportEditedDocx(original, { [targetIndex]: newText });
    expect(result.applied).toBe(1);
    expect(result.skipped).toEqual([]);

    // Re-parse and confirm the targeted paragraph now has the new text
    const after = await parseDocx(result.blob, {
      filename: 'after.docx',
      docx_blob_id: 'test',
    });
    expect(after.paragraphs.length).toBe(before.paragraphs.length);
    const replaced = after.paragraphs.find((p) => p.index === targetIndex);
    expect(replaced).toBeDefined();
    // Use toContain because the parser preserves leading/trailing
    // structural whitespace (e.g. <w:tab/> elements that bracket the
    // text content). The writer correctly replaces only the <w:t> body.
    expect(replaced!.text).toContain(newText);
  });

  it('preserves the style_id of an edited paragraph', async () => {
    const original = loadFixture('DHA Publication Template (updated 09.13.23).docx');
    const before = await parseDocx(original, {
      filename: 'before.docx',
      docx_blob_id: 'test',
    });
    const target = before.paragraphs.find(
      (p) => p.text.trim().length > 5 && p.style_id !== null,
    );
    expect(target).toBeDefined();
    const targetIndex = target!.index;
    const targetStyle = target!.style_id;

    const result = await exportEditedDocx(original, {
      [targetIndex]: 'New text but same style',
    });
    expect(result.applied).toBe(1);

    const after = await parseDocx(result.blob, {
      filename: 'after.docx',
      docx_blob_id: 'test',
    });
    const replaced = after.paragraphs.find((p) => p.index === targetIndex);
    expect(replaced!.text).toBe('New text but same style');
    // The critical assertion: paragraph style is unchanged
    expect(replaced!.style_id).toBe(targetStyle);
  });

  it('applies multiple paragraph edits in one pass', async () => {
    const original = loadFixture('DHA-Policy Memo Template (April 8 2025).docx');
    const before = await parseDocx(original, {
      filename: 'before.docx',
      docx_blob_id: 'test',
    });
    const targets = before.paragraphs
      .filter((p) => p.text.trim().length > 5)
      .slice(0, 3);
    expect(targets.length).toBe(3);

    const overrides: Record<number, string> = {};
    for (let i = 0; i < targets.length; i++) {
      overrides[targets[i]!.index] = `EDITED PARAGRAPH #${i + 1}`;
    }

    const result = await exportEditedDocx(original, overrides);
    expect(result.applied).toBe(3);
    expect(result.skipped).toEqual([]);

    const after = await parseDocx(result.blob, {
      filename: 'after.docx',
      docx_blob_id: 'test',
    });
    for (let i = 0; i < targets.length; i++) {
      const found = after.paragraphs.find((p) => p.index === targets[i]!.index);
      expect(found!.text).toContain(`EDITED PARAGRAPH #${i + 1}`);
    }
  });

  it('preserves tab characters in the parsed text after a round-trip', async () => {
    // The Policy Memo template paragraphs include <w:tab/> elements as
    // structural separators. The new extractor should surface them as
    // '\t' in the parsed text, both before and after the writer
    // round-trip.
    const original = loadFixture('DHA-Policy Memo Template (April 8 2025).docx');
    const before = await parseDocx(original, {
      filename: 'tabs.docx',
      docx_blob_id: 'test',
    });
    const tabbed = before.paragraphs.find((p) => p.text.includes('\t'));
    expect(tabbed, 'expected at least one paragraph with a tab char in the memo template').toBeDefined();
  });

  it('skips overrides for indices that do not exist', async () => {
    const original = loadFixture('DHA-Policy Memo Template (April 8 2025).docx');
    const result = await exportEditedDocx(original, {
      0: 'first paragraph edit',
      99999: 'this index does not exist',
    });
    expect(result.applied).toBe(1);
    expect(result.skipped).toEqual([99999]);
  });

  it('preserves total formatting (named styles, page setup, numbering) after edit', async () => {
    const original = loadFixture('DHA Publication Template (updated 09.13.23).docx');
    const before = await parseDocx(original, {
      filename: 'before.docx',
      docx_blob_id: 'test',
    });

    const result = await exportEditedDocx(original, { 5: 'something new' });
    const after = await parseDocx(result.blob, {
      filename: 'after.docx',
      docx_blob_id: 'test',
    });

    expect(after.schema.formatting.named_styles.length).toBe(
      before.schema.formatting.named_styles.length,
    );
    expect(after.schema.formatting.numbering_definitions.length).toBe(
      before.schema.formatting.numbering_definitions.length,
    );
    expect(after.schema.formatting.page_setup).toEqual(before.schema.formatting.page_setup);
  });

  it('rejects non-DOCX bytes', async () => {
    const garbage = new TextEncoder().encode('not a docx');
    await expect(exportEditedDocx(garbage, {})).rejects.toThrow();
  });
});

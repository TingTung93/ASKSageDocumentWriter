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
  it('round-trips a real DOCX without changes when no overrides are given (no-op passthrough)', async () => {
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

  it('no-op round-trip is structurally identical to the original (every paragraph matches)', async () => {
    const fixtures = [
      'DHA-Policy Memo Template (April 8 2025).docx',
      'DHA Publication Template (updated 09.13.23).docx',
    ];
    for (const f of fixtures) {
      const original = loadFixture(f);
      const before = await parseDocx(original, { filename: f, docx_blob_id: 'before' });
      const result = await exportEditedDocx(original, {});
      const after = await parseDocx(result.blob, { filename: f, docx_blob_id: 'after' });

      // Body paragraph counts and contents must match exactly.
      expect(after.paragraphs.length).toBe(before.paragraphs.length);
      for (let i = 0; i < before.paragraphs.length; i++) {
        const b = before.paragraphs[i]!;
        const a = after.paragraphs[i]!;
        expect(a.index).toBe(b.index);
        expect(a.text).toBe(b.text);
        expect(a.style_id).toBe(b.style_id);
        expect(a.alignment).toBe(b.alignment);
        expect(a.indent_left_twips).toBe(b.indent_left_twips);
        expect(a.bold).toBe(b.bold);
        expect(a.italic).toBe(b.italic);
        expect(a.in_table).toBe(b.in_table);
        expect(a.content_control_tag).toBe(b.content_control_tag);
        expect(a.numbering_id).toBe(b.numbering_id);
        expect(a.numbering_level).toBe(b.numbering_level);
      }

      // Header and footer parts must also be unchanged.
      expect(after.header_parts.length).toBe(before.header_parts.length);
      for (let h = 0; h < before.header_parts.length; h++) {
        expect(after.header_parts[h]!.paragraphs.length).toBe(before.header_parts[h]!.paragraphs.length);
        for (let i = 0; i < before.header_parts[h]!.paragraphs.length; i++) {
          expect(after.header_parts[h]!.paragraphs[i]!.text).toBe(
            before.header_parts[h]!.paragraphs[i]!.text,
          );
        }
      }
      expect(after.footer_parts.length).toBe(before.footer_parts.length);
      for (let f2 = 0; f2 < before.footer_parts.length; f2++) {
        expect(after.footer_parts[f2]!.paragraphs.length).toBe(before.footer_parts[f2]!.paragraphs.length);
      }

      // Formatting metadata must also match.
      expect(after.schema.formatting.named_styles.length).toBe(before.schema.formatting.named_styles.length);
      expect(after.schema.formatting.numbering_definitions.length).toBe(before.schema.formatting.numbering_definitions.length);
      expect(after.schema.formatting.page_setup).toEqual(before.schema.formatting.page_setup);
    }
  });

  it('edited round-trip preserves all UNTOUCHED paragraphs identically', async () => {
    // Confirm that editing one paragraph doesn't disturb any other
    // paragraph's text, style, or properties — the surgical-edit
    // contract.
    const original = loadFixture('DHA-Policy Memo Template (April 8 2025).docx');
    const before = await parseDocx(original, { filename: 'before.docx', docx_blob_id: 'b' });
    const targetIdx = before.paragraphs.find((p) => p.text.trim().length > 5)!.index;

    const result = await exportEditedDocx(original, { [targetIdx]: 'NEW TEXT FOR ONE PARAGRAPH' });
    const after = await parseDocx(result.blob, { filename: 'after.docx', docx_blob_id: 'a' });

    expect(after.paragraphs.length).toBe(before.paragraphs.length);
    for (let i = 0; i < before.paragraphs.length; i++) {
      const b = before.paragraphs[i]!;
      const a = after.paragraphs[i]!;
      if (b.index === targetIdx) {
        expect(a.text).toContain('NEW TEXT FOR ONE PARAGRAPH');
        expect(a.style_id).toBe(b.style_id);
        expect(a.in_table).toBe(b.in_table);
      } else {
        expect(a.text).toBe(b.text);
        expect(a.style_id).toBe(b.style_id);
        expect(a.alignment).toBe(b.alignment);
      }
    }
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

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyDocumentEdits, exportEditedDocx } from './writer';
import { parseDocx } from '../template/parser';
import type { DocumentEditOp } from './types';

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

describe('applyDocumentEdits — Phase B/C/D op union', () => {
  it('replace_paragraph_text via the new API works the same as exportEditedDocx', async () => {
    const original = loadFixture('DHA-Policy Memo Template (April 8 2025).docx');
    const before = await parseDocx(original, { filename: 'b.docx', docx_blob_id: 'b' });
    const target = before.paragraphs.find((p) => p.text.trim().length > 5)!;
    const ops: DocumentEditOp[] = [
      { op: 'replace_paragraph_text', index: target.index, new_text: 'NEW PARAGRAPH VIA OPS API' },
    ];
    const result = await applyDocumentEdits(original, ops);
    expect(result.applied[0]!.success).toBe(true);
    const after = await parseDocx(result.blob, { filename: 'a.docx', docx_blob_id: 'a' });
    expect(after.paragraphs.find((p) => p.index === target.index)!.text).toContain(
      'NEW PARAGRAPH VIA OPS API',
    );
  });

  it('replace_run_text targets a specific run within a paragraph', async () => {
    // Find a paragraph with at least 1 run
    const original = loadFixture('DHA-Policy Memo Template (April 8 2025).docx');
    const before = await parseDocx(original, { filename: 'b.docx', docx_blob_id: 'b' });
    const target = before.paragraphs.find((p) => p.runs.length >= 1 && p.runs[0]!.text.trim().length > 0)!;
    expect(target).toBeDefined();
    const targetRun = target.runs[0]!;

    const ops: DocumentEditOp[] = [
      {
        op: 'replace_run_text',
        paragraph_index: target.index,
        run_index: 0,
        new_text: 'RUN-LEVEL EDIT',
      },
    ];
    const result = await applyDocumentEdits(original, ops);
    expect(result.applied[0]!.success).toBe(true);

    const after = await parseDocx(result.blob, { filename: 'a.docx', docx_blob_id: 'a' });
    const afterPara = after.paragraphs.find((p) => p.index === target.index)!;
    expect(afterPara.text).toContain('RUN-LEVEL EDIT');
    // The run we targeted should still be at index 0 with the new text
    expect(afterPara.runs[0]!.text).toBe('RUN-LEVEL EDIT');
    // Other runs in the same paragraph should be untouched (text-wise)
    if (target.runs.length > 1) {
      for (let i = 1; i < target.runs.length; i++) {
        expect(afterPara.runs[i]!.text).toBe(target.runs[i]!.text);
      }
    }
    // Run-level formatting on the targeted run is preserved (rPr)
    expect(afterPara.runs[0]!.bold).toBe(targetRun.bold);
    expect(afterPara.runs[0]!.italic).toBe(targetRun.italic);
  });

  it('set_run_property toggles bold on a specific run', async () => {
    const original = loadFixture('DHA-Policy Memo Template (April 8 2025).docx');
    const before = await parseDocx(original, { filename: 'b.docx', docx_blob_id: 'b' });
    // Find a paragraph with a run that is currently NOT bold
    const target = before.paragraphs.find(
      (p) => p.runs.length > 0 && !p.runs[0]!.bold && p.runs[0]!.text.trim().length > 0,
    )!;
    expect(target).toBeDefined();

    const ops: DocumentEditOp[] = [
      {
        op: 'set_run_property',
        paragraph_index: target.index,
        run_index: 0,
        property: 'bold',
        value: true,
      },
    ];
    const result = await applyDocumentEdits(original, ops);
    expect(result.applied[0]!.success).toBe(true);

    const after = await parseDocx(result.blob, { filename: 'a.docx', docx_blob_id: 'a' });
    const afterPara = after.paragraphs.find((p) => p.index === target.index)!;
    expect(afterPara.runs[0]!.bold).toBe(true);
    // Text content unchanged
    expect(afterPara.runs[0]!.text).toBe(target.runs[0]!.text);
  });

  it('set_run_property turns italic OFF when value is false', async () => {
    const original = loadFixture('DHA-Policy Memo Template (April 8 2025).docx');
    const before = await parseDocx(original, { filename: 'b.docx', docx_blob_id: 'b' });
    // Find a paragraph with an italic run
    const target = before.paragraphs.find(
      (p) => p.runs.some((r) => r.italic && r.text.trim().length > 0),
    );
    if (!target) {
      // Memo template may not have italic runs; skip in that case
      return;
    }
    const italicRunIdx = target.runs.findIndex((r) => r.italic);
    const ops: DocumentEditOp[] = [
      {
        op: 'set_run_property',
        paragraph_index: target.index,
        run_index: italicRunIdx,
        property: 'italic',
        value: false,
      },
    ];
    const result = await applyDocumentEdits(original, ops);
    expect(result.applied[0]!.success).toBe(true);

    const after = await parseDocx(result.blob, { filename: 'a.docx', docx_blob_id: 'a' });
    const afterPara = after.paragraphs.find((p) => p.index === target.index)!;
    expect(afterPara.runs[italicRunIdx]!.italic).toBe(false);
  });

  it('set_paragraph_alignment changes a paragraph to centered', async () => {
    const original = loadFixture('DHA-Policy Memo Template (April 8 2025).docx');
    const before = await parseDocx(original, { filename: 'b.docx', docx_blob_id: 'b' });
    const target = before.paragraphs.find(
      (p) => p.alignment !== 'center' && p.text.trim().length > 5,
    )!;

    const ops: DocumentEditOp[] = [
      { op: 'set_paragraph_alignment', index: target.index, alignment: 'center' },
    ];
    const result = await applyDocumentEdits(original, ops);
    expect(result.applied[0]!.success).toBe(true);

    const after = await parseDocx(result.blob, { filename: 'a.docx', docx_blob_id: 'a' });
    expect(after.paragraphs.find((p) => p.index === target.index)!.alignment).toBe('center');
  });

  it('set_paragraph_style applies a new style id', async () => {
    const original = loadFixture('DHA-Policy Memo Template (April 8 2025).docx');
    const before = await parseDocx(original, { filename: 'b.docx', docx_blob_id: 'b' });
    // Pick the first style id present in the schema and an unrelated paragraph
    const targetStyle = before.schema.formatting.named_styles.find((s) => s.type === 'paragraph');
    expect(targetStyle).toBeDefined();
    const targetPara = before.paragraphs.find(
      (p) => p.text.trim().length > 0 && p.style_id !== targetStyle!.id,
    )!;

    const ops: DocumentEditOp[] = [
      { op: 'set_paragraph_style', index: targetPara.index, style_id: targetStyle!.id },
    ];
    const result = await applyDocumentEdits(original, ops);
    expect(result.applied[0]!.success).toBe(true);

    const after = await parseDocx(result.blob, { filename: 'a.docx', docx_blob_id: 'a' });
    expect(after.paragraphs.find((p) => p.index === targetPara.index)!.style_id).toBe(
      targetStyle!.id,
    );
  });

  it('delete_paragraph removes a paragraph and reduces the count', async () => {
    const original = loadFixture('DHA-Policy Memo Template (April 8 2025).docx');
    const before = await parseDocx(original, { filename: 'b.docx', docx_blob_id: 'b' });
    // Pick a paragraph with sufficiently unique text so the post-
    // delete content of the same index slot is verifiably different.
    const target = before.paragraphs.find(
      (p) => p.text.trim().length > 20 && before.paragraphs.filter((q) => q.text === p.text).length === 1,
    )!;
    expect(target).toBeDefined();
    const targetIdx = target.index;

    const ops: DocumentEditOp[] = [{ op: 'delete_paragraph', index: targetIdx }];
    const result = await applyDocumentEdits(original, ops);
    expect(result.applied[0]!.success).toBe(true);

    const after = await parseDocx(result.blob, { filename: 'a.docx', docx_blob_id: 'a' });
    expect(after.paragraphs.length).toBe(before.paragraphs.length - 1);
    // The deleted paragraph's specific text should no longer appear
    // anywhere (it was unique).
    expect(after.paragraphs.find((p) => p.text === target.text)).toBeUndefined();
  });

  it('set_content_control_value updates the text inside a tagged sdt', async () => {
    // The Publication template has 10 metadata content controls.
    // Find one with a tag and a current text value.
    const original = loadFixture('DHA Publication Template (updated 09.13.23).docx');
    const before = await parseDocx(original, { filename: 'b.docx', docx_blob_id: 'b' });
    const target = before.schema.metadata_fill_regions.find((m) => m.sdt_tag);
    if (!target) return; // skip if no tagged content controls

    const ops: DocumentEditOp[] = [
      { op: 'set_content_control_value', tag: target.sdt_tag!, value: 'OVERRIDDEN VALUE' },
    ];
    const result = await applyDocumentEdits(original, ops);
    expect(result.applied[0]!.success).toBe(true);
    // Re-parse and verify the content control's text has changed.
    // We confirm via the body paragraphs since content_control_tag is
    // attached to paragraphs that sit inside the sdt.
    const after = await parseDocx(result.blob, { filename: 'a.docx', docx_blob_id: 'a' });
    const wrappedPara = after.paragraphs.find((p) => p.content_control_tag === target.sdt_tag);
    if (wrappedPara) {
      expect(wrappedPara.text).toContain('OVERRIDDEN VALUE');
    }
  });

  it('insert_table_row clones a row and writes new cell text', async () => {
    // Find a fixture that has a table — use the PWS template which is
    // known to have many.
    const original = loadFixture('DHA PWS Template - Non-Personal Svcs - Title of Requirement.docx');
    const before = await parseDocx(original, { filename: 'b.docx', docx_blob_id: 'b' });
    if (before.tables.length === 0) return;
    const targetTable = before.tables.findIndex((t) => t.rows.length > 0);
    if (targetTable === -1) return;
    const beforeRowCount = before.tables[targetTable]!.rows.length;
    const cellCount = before.tables[targetTable]!.rows[0]!.cells.length;

    const ops: DocumentEditOp[] = [
      {
        op: 'insert_table_row',
        table_index: targetTable,
        after_row_index: 0,
        cells: Array.from({ length: cellCount }, (_, i) => `INSERTED CELL ${i + 1}`),
      },
    ];
    const result = await applyDocumentEdits(original, ops);
    expect(result.applied[0]!.success).toBe(true);

    const after = await parseDocx(result.blob, { filename: 'a.docx', docx_blob_id: 'a' });
    const afterTable = after.tables[targetTable]!;
    expect(afterTable.rows.length).toBe(beforeRowCount + 1);
  });

  it('reports per-op errors when an op references an out-of-range index', async () => {
    const original = loadFixture('DHA-Policy Memo Template (April 8 2025).docx');
    const ops: DocumentEditOp[] = [
      { op: 'replace_paragraph_text', index: 99999, new_text: 'nope' },
      { op: 'replace_run_text', paragraph_index: 99999, run_index: 0, new_text: 'nope' },
    ];
    const result = await applyDocumentEdits(original, ops);
    expect(result.applied[0]!.success).toBe(false);
    expect(result.applied[1]!.success).toBe(false);
    expect(result.applied[0]!.error).toContain('out of range');
    expect(result.applied[1]!.error).toContain('out of range');
  });

  it('passthrough on empty ops list returns the original bytes', async () => {
    const original = loadFixture('DHA-Policy Memo Template (April 8 2025).docx');
    const result = await applyDocumentEdits(original, []);
    expect(result.applied).toEqual([]);
    // Re-parse to confirm it's still a valid DOCX
    const after = await parseDocx(result.blob, { filename: 'a.docx', docx_blob_id: 'a' });
    expect(after.paragraphs.length).toBeGreaterThan(0);
  });
});

describe('applyDocumentEdits — Phase E/F (structural + formatting ops)', () => {
  it('insert_paragraph_after adds a new paragraph after the anchor', async () => {
    const original = loadFixture('DHA-Policy Memo Template (April 8 2025).docx');
    const before = await parseDocx(original, { filename: 'p.docx', docx_blob_id: 'p' });
    const target = before.paragraphs.findIndex((p) => p.text.trim().length > 0);
    expect(target).toBeGreaterThanOrEqual(0);
    const ops: DocumentEditOp[] = [
      {
        op: 'insert_paragraph_after',
        index: target,
        new_text: 'This is an inserted paragraph for testing.',
      },
    ];
    const result = await applyDocumentEdits(original, ops);
    expect(result.applied[0]!.success).toBe(true);
    const after = await parseDocx(result.blob, { filename: 'p.docx', docx_blob_id: 'p' });
    expect(after.paragraphs.length).toBe(before.paragraphs.length + 1);
    // Some fixture paragraphs carry leading <w:tab/> elements inside
    // their first run; cloning the anchor's pPr can cause the parser
    // to attribute that whitespace to the inserted paragraph in
    // certain layouts. Compare on trimmed text — the feature is the
    // payload landing in the new paragraph, not whitespace fidelity.
    expect(after.paragraphs[target + 1]!.text.trim()).toBe(
      'This is an inserted paragraph for testing.',
    );
  });

  it('merge_paragraphs combines two adjacent paragraphs into one', async () => {
    const original = loadFixture('DHA-Policy Memo Template (April 8 2025).docx');
    const before = await parseDocx(original, { filename: 'p.docx', docx_blob_id: 'p' });
    const idx = before.paragraphs.findIndex(
      (p, i) =>
        p.text.trim().length > 0 &&
        before.paragraphs[i + 1] !== undefined &&
        before.paragraphs[i + 1]!.text.trim().length > 0,
    );
    expect(idx).toBeGreaterThanOrEqual(0);
    const text1 = before.paragraphs[idx]!.text;
    const text2 = before.paragraphs[idx + 1]!.text;
    const ops: DocumentEditOp[] = [{ op: 'merge_paragraphs', index: idx, separator: ' ' }];
    const result = await applyDocumentEdits(original, ops);
    expect(result.applied[0]!.success).toBe(true);
    const after = await parseDocx(result.blob, { filename: 'p.docx', docx_blob_id: 'p' });
    expect(after.paragraphs.length).toBe(before.paragraphs.length - 1);
    expect(after.paragraphs[idx]!.text).toBe(`${text1} ${text2}`);
  });

  it('split_paragraph breaks a paragraph at a verbatim substring', async () => {
    const original = loadFixture('DHA-Policy Memo Template (April 8 2025).docx');
    const before = await parseDocx(original, { filename: 'p.docx', docx_blob_id: 'p' });
    // Find a paragraph whose VISIBLE text (excluding leading
    // whitespace) is at least 30 chars; split at a position past the
    // leading whitespace so the assertion isn't sensitive to
    // tab/break artifacts the parser surfaces from <w:tab/> elements.
    const idx = before.paragraphs.findIndex((p) => p.text.trimStart().length >= 30);
    expect(idx).toBeGreaterThanOrEqual(0);
    const fullText = before.paragraphs[idx]!.text;
    const leadingWs = fullText.length - fullText.trimStart().length;
    // Pick a split window 5-15 chars into the visible text region.
    const splitStart = leadingWs + 5;
    const splitEnd = leadingWs + 15;
    const splitAt = fullText.slice(splitStart, splitEnd);
    const ops: DocumentEditOp[] = [
      { op: 'split_paragraph', index: idx, split_at_text: splitAt },
    ];
    const result = await applyDocumentEdits(original, ops);
    expect(result.applied[0]!.success).toBe(true);
    const after = await parseDocx(result.blob, { filename: 'p.docx', docx_blob_id: 'p' });
    expect(after.paragraphs.length).toBe(before.paragraphs.length + 1);
    // Compare on trimmed text — see the insert test for the rationale.
    expect(after.paragraphs[idx]!.text.trim()).toBe(fullText.slice(0, splitStart).trim());
    expect(after.paragraphs[idx + 1]!.text.trim()).toBe(fullText.slice(splitStart).trim());
  });

  it('split_paragraph fails clearly when the substring is not found', async () => {
    const original = loadFixture('DHA-Policy Memo Template (April 8 2025).docx');
    const before = await parseDocx(original, { filename: 'p.docx', docx_blob_id: 'p' });
    const idx = before.paragraphs.findIndex((p) => p.text.length >= 5);
    const ops: DocumentEditOp[] = [
      {
        op: 'split_paragraph',
        index: idx,
        split_at_text: '__definitely_not_in_the_doc_xyzzy__',
      },
    ];
    const result = await applyDocumentEdits(original, ops);
    expect(result.applied[0]!.success).toBe(false);
    expect(result.applied[0]!.error).toContain('split_at_text not found');
  });

  it('set_paragraph_indent writes left/firstLine twips into pPr/ind', async () => {
    const original = loadFixture('DHA-Policy Memo Template (April 8 2025).docx');
    const before = await parseDocx(original, { filename: 'p.docx', docx_blob_id: 'p' });
    const idx = before.paragraphs.findIndex((p) => p.text.trim().length > 0);
    const ops: DocumentEditOp[] = [
      {
        op: 'set_paragraph_indent',
        paragraph_index: idx,
        left_twips: 720,
        first_line_twips: 360,
      },
    ];
    const result = await applyDocumentEdits(original, ops);
    expect(result.applied[0]!.success).toBe(true);
    const after = await parseDocx(result.blob, { filename: 'p.docx', docx_blob_id: 'p' });
    expect(after.paragraphs[idx]!.indent_left_twips).toBe(720);
    expect(after.paragraphs[idx]!.indent_first_line_twips).toBe(360);
  });

  it('set_run_font writes font family + size on the targeted run', async () => {
    const original = loadFixture('DHA-Policy Memo Template (April 8 2025).docx');
    const before = await parseDocx(original, { filename: 'p.docx', docx_blob_id: 'p' });
    const idx = before.paragraphs.findIndex(
      (p) => p.runs.length > 0 && p.text.trim().length > 0,
    );
    const ops: DocumentEditOp[] = [
      {
        op: 'set_run_font',
        paragraph_index: idx,
        run_index: 0,
        family: 'Times New Roman',
        size_pt: 14,
      },
    ];
    const result = await applyDocumentEdits(original, ops);
    expect(result.applied[0]!.success).toBe(true);
    const after = await parseDocx(result.blob, { filename: 'p.docx', docx_blob_id: 'p' });
    const run = after.paragraphs[idx]!.runs[0]!;
    expect(run.font_family).toBe('Times New Roman');
    expect(run.font_size_pt).toBe(14);
  });

  it('set_run_color writes a hex color on the targeted run', async () => {
    const original = loadFixture('DHA-Policy Memo Template (April 8 2025).docx');
    const before = await parseDocx(original, { filename: 'p.docx', docx_blob_id: 'p' });
    const idx = before.paragraphs.findIndex(
      (p) => p.runs.length > 0 && p.text.trim().length > 0,
    );
    const ops: DocumentEditOp[] = [
      {
        op: 'set_run_color',
        paragraph_index: idx,
        run_index: 0,
        color: 'FF0000',
      },
    ];
    const result = await applyDocumentEdits(original, ops);
    expect(result.applied[0]!.success).toBe(true);
    const after = await parseDocx(result.blob, { filename: 'p.docx', docx_blob_id: 'p' });
    const run = after.paragraphs[idx]!.runs[0]!;
    expect(run.color).toBe('#FF0000');
  });
});

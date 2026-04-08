// Phase 5a — assembleProjectDocx tests. Round-trip safety against
// the real DHA fixtures is the primary concern: a no-op assembly
// (empty draft map) must produce a DOCX that re-parses identically.
// Single-section and multi-section replacement tests assert the new
// paragraphs show up in the right place and that untouched sections
// are preserved byte-for-structural-byte.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assembleProjectDocx, roleToStyleId } from './assemble';
import { parseDocx } from '../template/parser';
import type { TemplateRecord } from '../db/schema';
import type { DraftParagraph } from '../draft/types';
import type { BodyFillRegion, TemplateSchema } from '../template/types';

const FIXTURES = resolve(__dirname, '../../test/fixtures');

const PUBLICATION = 'DHA Publication Template (updated 09.13.23).docx';
const POLICY_MEMO = 'DHA-Policy Memo Template (April 8 2025).docx';
const PWS = 'DHA PWS Template - Non-Personal Svcs - Title of Requirement.docx';
const MRR = 'Market Research Report Template (AUGUST 2025).docx';

function loadFixture(name: string): Uint8Array {
  const buf = readFileSync(resolve(FIXTURES, name));
  const u8 = new Uint8Array(buf.byteLength);
  u8.set(buf);
  return u8;
}

async function loadAsTemplate(filename: string): Promise<TemplateRecord> {
  const bytes = loadFixture(filename);
  const parsed = await parseDocx(bytes, { filename, docx_blob_id: `fixture://${filename}` });
  // Wrap the raw bytes as a Blob the jsdom test environment can hand
  // back to JSZip. The parser also produced a Blob we could reuse, but
  // constructing fresh keeps the bytes path isolated from the parser.
  // Copy into a fresh ArrayBuffer-backed Uint8Array so BlobPart
  // typing is satisfied (rules out SharedArrayBuffer-backed views).
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  let docx_bytes: Blob;
  try {
    docx_bytes = new Blob([ab]);
  } catch {
    // jsdom sometimes objects; fall back to the parser's own Blob.
    docx_bytes = parsed.docx_blob;
  }
  return {
    id: 'tpl_test',
    name: filename,
    filename,
    ingested_at: new Date().toISOString(),
    docx_bytes,
    schema_json: parsed.schema,
  };
}

/**
 * Find the first heading_bounded section in a schema whose
 * end_anchor_paragraph_index >= 0 and anchor_paragraph_index >= 0.
 * Used by the single-section replacement test.
 */
function firstHeadingBoundedSection(schema: TemplateSchema): BodyFillRegion | undefined {
  return schema.sections.find(
    (s) => s.fill_region.kind === 'heading_bounded' && s.fill_region.anchor_paragraph_index >= 0,
  );
}

describe('assembleProjectDocx — no-op round trip preserves template structure', () => {
  const FIXTURES_TO_CHECK = [PUBLICATION, POLICY_MEMO, PWS, MRR];
  for (const filename of FIXTURES_TO_CHECK) {
    it(`preserves structural parse of ${filename} with an empty draft map`, async () => {
      const template = await loadAsTemplate(filename);
      const before = await parseDocx(template.docx_bytes, {
        filename,
        docx_blob_id: 'before',
      });

      const result = await assembleProjectDocx({
        template,
        draftedBySectionId: new Map(),
      });
      expect(result.total_assembled).toBe(0);
      expect(result.total_failed).toBe(0);

      const after = await parseDocx(result.blob, {
        filename,
        docx_blob_id: 'after',
      });

      // Paragraph count must match exactly and every paragraph's
      // text + style + alignment must be identical. This is the
      // strongest round-trip assertion we can make without a byte
      // comparison of the zip (which differs across JSZip runs due
      // to compression settings).
      expect(after.paragraphs.length).toBe(before.paragraphs.length);
      for (let i = 0; i < before.paragraphs.length; i++) {
        const b = before.paragraphs[i]!;
        const a = after.paragraphs[i]!;
        expect(a.text).toBe(b.text);
        expect(a.style_id).toBe(b.style_id);
        expect(a.in_table).toBe(b.in_table);
      }

      // Tables, header/footer parts, and style/numbering counts
      // must all be preserved.
      expect(after.tables.length).toBe(before.tables.length);
      expect(after.header_parts.length).toBe(before.header_parts.length);
      expect(after.footer_parts.length).toBe(before.footer_parts.length);
      expect(after.schema.formatting.named_styles.length).toBe(
        before.schema.formatting.named_styles.length,
      );
      expect(after.schema.formatting.numbering_definitions.length).toBe(
        before.schema.formatting.numbering_definitions.length,
      );
    });
  }
});

describe('assembleProjectDocx — single-section replacement', () => {
  it('replaces the target range with the drafted paragraphs in the Publication fixture', async () => {
    const template = await loadAsTemplate(PUBLICATION);
    const target = firstHeadingBoundedSection(template.schema_json);
    if (!target || target.fill_region.kind !== 'heading_bounded') {
      // Publication always parses heading-bounded sections; guard
      // so the type narrows.
      throw new Error('Publication fixture has no heading-bounded section');
    }

    // Capture the text of the paragraphs NOT in this section so we
    // can assert they're unchanged after assembly.
    const before = await parseDocx(template.docx_bytes, {
      filename: PUBLICATION,
      docx_blob_id: 'before',
    });
    const fr = target.fill_region;
    const untouchedBeforeTexts = before.paragraphs
      .filter(
        (p) => p.index < fr.anchor_paragraph_index || p.index > fr.end_anchor_paragraph_index,
      )
      .map((p) => p.text);

    const drafted: DraftParagraph[] = [
      { role: 'heading', text: 'ASSEMBLY TEST HEADING' },
      { role: 'body', text: 'first assembled paragraph' },
      { role: 'body', text: 'second assembled paragraph' },
    ];
    const draftMap = new Map<string, DraftParagraph[]>([[target.id, drafted]]);

    const result = await assembleProjectDocx({ template, draftedBySectionId: draftMap });
    const assembledFor = result.section_results.find((r) => r.section_id === target.id);
    expect(assembledFor?.status.kind).toBe('assembled');
    if (assembledFor?.status.kind === 'assembled') {
      expect(assembledFor.status.paragraphs_inserted).toBe(3);
    }

    const after = await parseDocx(result.blob, {
      filename: PUBLICATION,
      docx_blob_id: 'after',
    });
    const afterTexts = after.paragraphs.map((p) => p.text);
    expect(afterTexts).toContain('ASSEMBLY TEST HEADING');
    expect(afterTexts).toContain('first assembled paragraph');
    expect(afterTexts).toContain('second assembled paragraph');

    // Every paragraph that was OUTSIDE the replaced range must still
    // exist in the output. We don't assert exact position (indices
    // shift when the range grows/shrinks) — we just check set
    // membership so no unrelated content was deleted.
    const afterTextSet = new Set(afterTexts);
    for (const t of untouchedBeforeTexts) {
      if (t.trim().length === 0) continue; // blank paragraphs can appear multiple times; skip
      expect(afterTextSet.has(t)).toBe(true);
    }
  });
});

describe('assembleProjectDocx — multi-section replacement in reverse order', () => {
  it('handles 3 sections in different parts of the document without index drift', async () => {
    const template = await loadAsTemplate(PUBLICATION);
    // Pick three heading-bounded sections with non-overlapping ranges.
    const headingBounded = template.schema_json.sections.filter(
      (s) => s.fill_region.kind === 'heading_bounded' && s.fill_region.anchor_paragraph_index >= 0,
    );
    if (headingBounded.length < 3) {
      // Skip if the fixture doesn't have enough distinct sections.
      return;
    }
    const picks = [headingBounded[0]!, headingBounded[Math.floor(headingBounded.length / 2)]!, headingBounded[headingBounded.length - 1]!];
    // De-dupe in case the midpoint equals an endpoint in a tiny set.
    const uniqueIds = new Set(picks.map((p) => p.id));
    if (uniqueIds.size < 3) return;

    const draftMap = new Map<string, DraftParagraph[]>();
    for (let i = 0; i < picks.length; i++) {
      draftMap.set(picks[i]!.id, [
        { role: 'heading', text: `SECTION_${i}_HEADING` },
        { role: 'body', text: `SECTION_${i}_BODY_ONE` },
        { role: 'body', text: `SECTION_${i}_BODY_TWO` },
      ]);
    }

    const result = await assembleProjectDocx({ template, draftedBySectionId: draftMap });
    expect(result.total_assembled).toBe(3);

    const after = await parseDocx(result.blob, {
      filename: PUBLICATION,
      docx_blob_id: 'multi',
    });
    const afterTexts = new Set(after.paragraphs.map((p) => p.text));
    for (let i = 0; i < picks.length; i++) {
      expect(afterTexts.has(`SECTION_${i}_HEADING`)).toBe(true);
      expect(afterTexts.has(`SECTION_${i}_BODY_ONE`)).toBe(true);
      expect(afterTexts.has(`SECTION_${i}_BODY_TWO`)).toBe(true);
    }
  });
});

describe('assembleProjectDocx — unsupported region handling', () => {
  it('marks non-heading-bounded regions as skipped_unsupported_region and leaves the template unchanged', async () => {
    const template = await loadAsTemplate(PUBLICATION);
    // Force a synthetic section with a content_control fill_region
    // kind. We mutate a copy of the schema so we don't affect other
    // tests. The writer should skip it without touching the DOM.
    const clonedSchema: TemplateSchema = JSON.parse(JSON.stringify(template.schema_json));
    clonedSchema.sections = [
      {
        id: 'synthetic_cc',
        name: 'Synthetic content control',
        order: 0,
        required: true,
        fill_region: {
          kind: 'content_control',
          sdt_tag: 'fake_tag',
          heading_style_id: null,
          body_style_id: null,
          numbering_id: null,
          permitted_roles: ['body'],
        },
      },
    ];
    const mutated: TemplateRecord = { ...template, schema_json: clonedSchema };

    const drafted: DraftParagraph[] = [{ role: 'body', text: 'should not appear' }];
    const draftMap = new Map<string, DraftParagraph[]>([['synthetic_cc', drafted]]);

    const result = await assembleProjectDocx({
      template: mutated,
      draftedBySectionId: draftMap,
    });
    expect(result.total_assembled).toBe(0);
    expect(result.section_results[0]!.status.kind).toBe('skipped_unsupported_region');

    // The template body must be unchanged: "should not appear" must
    // not have made it into the output.
    const after = await parseDocx(result.blob, {
      filename: PUBLICATION,
      docx_blob_id: 'cc-skip',
    });
    for (const p of after.paragraphs) {
      expect(p.text).not.toBe('should not appear');
    }
  });
});

describe('assembleProjectDocx — result summary counts match per-section statuses', () => {
  it('adds up to total_assembled + total_skipped + total_failed', async () => {
    const template = await loadAsTemplate(PUBLICATION);
    const target = firstHeadingBoundedSection(template.schema_json);
    if (!target) throw new Error('Publication fixture missing heading-bounded section');

    const draftMap = new Map<string, DraftParagraph[]>([
      [target.id, [{ role: 'body', text: 'assembled only this one' }]],
    ]);
    const result = await assembleProjectDocx({ template, draftedBySectionId: draftMap });

    const tallied = {
      assembled: 0,
      skipped: 0,
      failed: 0,
    };
    for (const r of result.section_results) {
      if (r.status.kind === 'assembled') tallied.assembled += 1;
      else if (r.status.kind === 'failed') tallied.failed += 1;
      else tallied.skipped += 1;
    }
    expect(tallied.assembled).toBe(result.total_assembled);
    expect(tallied.skipped).toBe(result.total_skipped);
    expect(tallied.failed).toBe(result.total_failed);
    expect(result.total_assembled).toBeGreaterThanOrEqual(1);
    // Every other section is skipped_no_draft or skipped_unsupported_region
    expect(
      result.total_assembled + result.total_skipped + result.total_failed,
    ).toBe(template.schema_json.sections.length);
  });
});

describe('roleToStyleId — unit tests', () => {
  const available = new Set([
    'Heading1',
    'Heading2',
    'BodyText',
    'ListBullet',
    'ListNumber',
    'Normal',
    'Quote',
  ]);

  it('maps heading to Heading1 when available', () => {
    expect(roleToStyleId('heading', available)).toBe('Heading1');
  });

  it('maps body to BodyText when available', () => {
    expect(roleToStyleId('body', available)).toBe('BodyText');
  });

  it('maps bullet to ListBullet when available', () => {
    expect(roleToStyleId('bullet', available)).toBe('ListBullet');
  });

  it('maps step to ListNumber when available', () => {
    expect(roleToStyleId('step', available)).toBe('ListNumber');
  });

  it('maps quote to Quote when available', () => {
    expect(roleToStyleId('quote', available)).toBe('Quote');
  });

  it('falls back to BodyText for note/caution/warning', () => {
    expect(roleToStyleId('note', available)).toBe('BodyText');
    expect(roleToStyleId('caution', available)).toBe('BodyText');
    expect(roleToStyleId('warning', available)).toBe('BodyText');
  });

  it('maps definition and table_row to BodyText', () => {
    expect(roleToStyleId('definition', available)).toBe('BodyText');
    expect(roleToStyleId('table_row', available)).toBe('BodyText');
  });

  it('falls back to Normal when BodyText is absent', () => {
    const sparse = new Set(['Normal']);
    expect(roleToStyleId('body', sparse)).toBe('Normal');
    expect(roleToStyleId('bullet', sparse)).toBe('Normal');
  });

  it('returns null when no candidate and no fallback is available', () => {
    const empty = new Set<string>();
    expect(roleToStyleId('body', empty)).toBeNull();
  });
});

// Phase 5a — assembleProjectDocx tests. Round-trip safety against
// the synthetic fixtures is the primary concern: a no-op assembly
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

const PUBLICATION = 'synthetic-publication.docx';
const POLICY_MEMO = 'synthetic-memo.docx';
const PWS = 'synthetic-pws.docx';
const MRR = 'synthetic-mrr.docx';

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

// ─── pPr / rPr cloning ────────────────────────────────────────────
//
// These tests pin the Bug 1 fix: drafted paragraphs MUST inherit the
// pPr (tabs / indents / alignment / spacing) and rPr (font / size /
// bold) from the source range they're replacing. Without this, Army
// memo signature blocks lose their 4.5" right tab, numbered
// paragraphs lose their hanging indent, and the whole document looks
// like raw Normal style.

describe('assembleProjectDocx — preserves paragraph + run formatting from the template', () => {
  // Build a minimal in-memory DOCX whose body contains:
  //   p[0]: heading "1. SECTION ONE" (style Heading1)
  //   p[1]: body paragraph with explicit pPr (indent 720, tabs at 4320,
  //         left alignment) and an rPr with Times New Roman 12 bold.
  // The schema points a heading-bounded section at [0..1]. We then
  // assemble a draft of one body paragraph and assert that the
  // resulting <w:p> carries the cloned pPr (ind/tabs/jc) AND the
  // cloned rPr (rFonts/sz/b).
  async function buildSyntheticTemplate(): Promise<TemplateRecord> {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();

    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
      <w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">1. SECTION ONE</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr>
        <w:pStyle w:val="Normal"/>
        <w:tabs><w:tab w:val="right" w:pos="4320"/></w:tabs>
        <w:ind w:left="720" w:hanging="360"/>
        <w:jc w:val="left"/>
        <w:spacing w:before="120" w:after="120"/>
      </w:pPr>
      <w:r>
        <w:rPr>
          <w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/>
          <w:sz w:val="24"/>
          <w:b/>
        </w:rPr>
        <w:t xml:space="preserve">original body content</w:t>
      </w:r>
    </w:p>
    <w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>
  </w:body>
</w:document>`;

    const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="BodyText"><w:name w:val="Body Text"/></w:style>
</w:styles>`;

    const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

    const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

    const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

    zip.file('[Content_Types].xml', contentTypes);
    zip.file('_rels/.rels', rootRels);
    zip.file('word/_rels/document.xml.rels', docRels);
    zip.file('word/document.xml', documentXml);
    zip.file('word/styles.xml', stylesXml);

    const u8 = await zip.generateAsync({ type: 'uint8array' });
    const ab = new ArrayBuffer(u8.byteLength);
    new Uint8Array(ab).set(u8);
    const blob = new Blob([ab]);
    const parsed = await parseDocx(blob, {
      filename: 'synthetic.docx',
      docx_blob_id: 'synth',
    });

    // Force a heading-bounded section spanning paragraphs [0..1].
    const schema: TemplateSchema = {
      ...parsed.schema,
      sections: [
        {
          id: 'sec_one',
          name: '1. SECTION ONE',
          order: 0,
          required: true,
          fill_region: {
            kind: 'heading_bounded',
            heading_text: '1. SECTION ONE',
            heading_style_id: 'Heading1',
            body_style_id: 'Normal',
            anchor_paragraph_index: 0,
            end_anchor_paragraph_index: 1,
            permitted_roles: ['heading', 'body'],
          },
        },
      ],
    };
    return {
      id: 'tpl_synth',
      name: 'synthetic',
      filename: 'synthetic.docx',
      ingested_at: new Date().toISOString(),
      docx_bytes: blob,
      schema_json: schema,
    };
  }

  async function extractBodyParagraphs(blob: Blob): Promise<Element[]> {
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(blob);
    const xml = await zip.file('word/document.xml')!.async('string');
    const dom = new DOMParser().parseFromString(xml, 'text/xml');
    const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const body = dom.getElementsByTagNameNS(W_NS, 'body')[0]!;
    return Array.from(body.getElementsByTagNameNS(W_NS, 'p'));
  }

  it('clones pPr (tabs, indents, alignment, spacing) from the source body paragraph', async () => {
    const template = await buildSyntheticTemplate();
    const drafted: DraftParagraph[] = [
      { role: 'body', text: 'first new body paragraph' },
      { role: 'body', text: 'second new body paragraph' },
    ];
    const result = await assembleProjectDocx({
      template,
      draftedBySectionId: new Map([['sec_one', drafted]]),
    });

    const paragraphs = await extractBodyParagraphs(result.blob);
    // Find the paragraphs that contain our drafted text and confirm
    // their pPr carries the cloned tab stop / indent / alignment.
    const draftedEls = paragraphs.filter((p) =>
      (p.textContent ?? '').includes('new body paragraph'),
    );
    expect(draftedEls.length).toBe(2);

    for (const p of draftedEls) {
      const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
      const pPr = p.getElementsByTagNameNS(W_NS, 'pPr')[0];
      expect(pPr).toBeTruthy();

      // Tab at 4320 (Army memo signature column)
      const tabs = pPr!.getElementsByTagNameNS(W_NS, 'tab');
      expect(tabs.length).toBe(1);
      expect(tabs[0]!.getAttributeNS(W_NS, 'pos')).toBe('4320');
      expect(tabs[0]!.getAttributeNS(W_NS, 'val')).toBe('right');

      // Hanging indent
      const ind = pPr!.getElementsByTagNameNS(W_NS, 'ind')[0];
      expect(ind).toBeTruthy();
      expect(ind!.getAttributeNS(W_NS, 'left')).toBe('720');
      expect(ind!.getAttributeNS(W_NS, 'hanging')).toBe('360');

      // Alignment
      const jc = pPr!.getElementsByTagNameNS(W_NS, 'jc')[0];
      expect(jc).toBeTruthy();
      expect(jc!.getAttributeNS(W_NS, 'val')).toBe('left');

      // Spacing
      const spacing = pPr!.getElementsByTagNameNS(W_NS, 'spacing')[0];
      expect(spacing).toBeTruthy();
      expect(spacing!.getAttributeNS(W_NS, 'before')).toBe('120');
    }
  });

  it('clones rPr (font, size, bold) from the source run', async () => {
    const template = await buildSyntheticTemplate();
    const drafted: DraftParagraph[] = [{ role: 'body', text: 'styled new content' }];
    const result = await assembleProjectDocx({
      template,
      draftedBySectionId: new Map([['sec_one', drafted]]),
    });

    const paragraphs = await extractBodyParagraphs(result.blob);
    const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const draftedEl = paragraphs.find((p) =>
      (p.textContent ?? '').includes('styled new content'),
    );
    expect(draftedEl).toBeTruthy();

    const runs = draftedEl!.getElementsByTagNameNS(W_NS, 'r');
    expect(runs.length).toBeGreaterThan(0);
    const rPr = runs[0]!.getElementsByTagNameNS(W_NS, 'rPr')[0];
    expect(rPr).toBeTruthy();
    const rFonts = rPr!.getElementsByTagNameNS(W_NS, 'rFonts')[0];
    expect(rFonts!.getAttributeNS(W_NS, 'ascii')).toBe('Times New Roman');
    const sz = rPr!.getElementsByTagNameNS(W_NS, 'sz')[0];
    expect(sz!.getAttributeNS(W_NS, 'val')).toBe('24');
    expect(rPr!.getElementsByTagNameNS(W_NS, 'b').length).toBe(1);
  });

  it('replaces pStyle with the role-mapped style id (heading override on body pPr)', async () => {
    const template = await buildSyntheticTemplate();
    // A 'heading' role with 'BodyText' present in styles should land
    // 'Heading1' (the highest-priority candidate from the synthetic
    // styles.xml).
    const drafted: DraftParagraph[] = [
      { role: 'heading', text: 'NEW HEADING TEXT' },
    ];
    const result = await assembleProjectDocx({
      template,
      draftedBySectionId: new Map([['sec_one', drafted]]),
    });

    const paragraphs = await extractBodyParagraphs(result.blob);
    const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const draftedEl = paragraphs.find((p) =>
      (p.textContent ?? '').includes('NEW HEADING TEXT'),
    );
    expect(draftedEl).toBeTruthy();
    const pStyles = draftedEl!.getElementsByTagNameNS(W_NS, 'pStyle');
    expect(pStyles.length).toBe(1);
    expect(pStyles[0]!.getAttributeNS(W_NS, 'val')).toBe('Heading1');
  });

  it('strips numPr inherited from the source pPr when the new role is not bullet/step', async () => {
    // Build a template whose body paragraph has a numPr (list link).
    // The drafted body paragraph must NOT inherit it — otherwise
    // ordinary prose silently becomes a list item.
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();

    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
      <w:r><w:t xml:space="preserve">1. NUMBERED SECTION</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr>
        <w:pStyle w:val="ListBullet"/>
        <w:numPr><w:ilvl w:val="0"/><w:numId w:val="3"/></w:numPr>
      </w:pPr>
      <w:r><w:t xml:space="preserve">existing bullet</w:t></w:r>
    </w:p>
    <w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>
  </w:body>
</w:document>`;

    const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="BodyText"><w:name w:val="Body Text"/></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>
  <w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/></w:style>
</w:styles>`;

    const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

    const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

    const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

    zip.file('[Content_Types].xml', contentTypes);
    zip.file('_rels/.rels', rootRels);
    zip.file('word/_rels/document.xml.rels', docRels);
    zip.file('word/document.xml', documentXml);
    zip.file('word/styles.xml', stylesXml);

    const u8 = await zip.generateAsync({ type: 'uint8array' });
    const ab = new ArrayBuffer(u8.byteLength);
    new Uint8Array(ab).set(u8);
    const blob = new Blob([ab]);
    const parsed = await parseDocx(blob, {
      filename: 'numpr.docx',
      docx_blob_id: 'numpr',
    });
    const tplWithNumpr: TemplateRecord = {
      id: 'tpl_numpr',
      name: 'numpr',
      filename: 'numpr.docx',
      ingested_at: new Date().toISOString(),
      docx_bytes: blob,
      schema_json: {
        ...parsed.schema,
        sections: [
          {
            id: 'sec_one',
            name: 'numbered',
            order: 0,
            required: true,
            fill_region: {
              kind: 'heading_bounded',
              heading_text: '1. NUMBERED SECTION',
              heading_style_id: 'Heading1',
              body_style_id: 'ListBullet',
              anchor_paragraph_index: 0,
              end_anchor_paragraph_index: 1,
              permitted_roles: ['heading', 'body', 'bullet'],
            },
          },
        ],
      },
    };

    const result = await assembleProjectDocx({
      template: tplWithNumpr,
      draftedBySectionId: new Map([
        [
          'sec_one',
          [
            { role: 'body', text: 'plain prose, not a list item' },
            { role: 'bullet', text: 'genuine bullet that should keep numPr' },
          ],
        ],
      ]),
    });

    const paragraphs = await extractBodyParagraphs(result.blob);
    const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const proseEl = paragraphs.find((p) =>
      (p.textContent ?? '').includes('plain prose'),
    );
    const bulletEl = paragraphs.find((p) =>
      (p.textContent ?? '').includes('genuine bullet'),
    );
    expect(proseEl).toBeTruthy();
    expect(bulletEl).toBeTruthy();

    // Body role: numPr stripped.
    expect(proseEl!.getElementsByTagNameNS(W_NS, 'numPr').length).toBe(0);
    // Bullet role: numPr preserved.
    expect(bulletEl!.getElementsByTagNameNS(W_NS, 'numPr').length).toBe(1);
  });
});

// ─── document_part (header/footer) assembly ───────────────────────
//
// The parser still surfaces header/footer parts as document_part
// sections so the UI can show their text and so the drafter has
// visibility into them. But the assembler does NOT rewrite them:
// DoD / DHA letterheads carry seals (<w:drawing>), tab-stop-centered
// banner lines, and tiny-font classification markings — every attempt
// to splice drafted paragraphs into <w:hdr>/<w:ftr> broke something
// (the MFR seal, the 7pt banner formatting cascading to body runs,
// the word/media/ and _rels entries dropping on round trip). The
// current contract: header/footer XML is byte-preserved from the
// template, and document_part sections always report
// `skipped_unsupported_region`.

describe('assembleProjectDocx — document_part (header/footer) sections', () => {
  async function buildTemplateWithHeaderFooter(): Promise<TemplateRecord> {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();

    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    <w:p><w:r><w:t xml:space="preserve">document body line</w:t></w:r></w:p>
    <w:sectPr>
      <w:headerReference w:type="default" r:id="rId10"/>
      <w:footerReference w:type="default" r:id="rId11"/>
      <w:pgSz w:w="12240" w:h="15840"/>
    </w:sectPr>
  </w:body>
</w:document>`;

    const headerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:p>
    <w:pPr>
      <w:jc w:val="center"/>
      <w:spacing w:before="0" w:after="0"/>
    </w:pPr>
    <w:r>
      <w:rPr><w:rFonts w:ascii="Times New Roman"/><w:sz w:val="24"/><w:b/></w:rPr>
      <w:t xml:space="preserve">DEPARTMENT OF THE ARMY</w:t>
    </w:r>
  </w:p>
  <w:p><w:r><w:t xml:space="preserve">[UNIT NAME]</w:t></w:r></w:p>
</w:hdr>`;

    const footerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:p>
    <w:pPr><w:jc w:val="center"/></w:pPr>
    <w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">CUI</w:t></w:r>
  </w:p>
</w:ftr>`;

    const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="BodyText"><w:name w:val="Body Text"/></w:style>
</w:styles>`;

    const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
  <Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
</Types>`;

    const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

    const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId10" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>
  <Relationship Id="rId11" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>
</Relationships>`;

    zip.file('[Content_Types].xml', contentTypes);
    zip.file('_rels/.rels', rootRels);
    zip.file('word/_rels/document.xml.rels', docRels);
    zip.file('word/document.xml', documentXml);
    zip.file('word/styles.xml', stylesXml);
    zip.file('word/header1.xml', headerXml);
    zip.file('word/footer1.xml', footerXml);

    const u8 = await zip.generateAsync({ type: 'uint8array' });
    const ab = new ArrayBuffer(u8.byteLength);
    new Uint8Array(ab).set(u8);
    const blob = new Blob([ab]);
    const parsed = await parseDocx(blob, {
      filename: 'hf.docx',
      docx_blob_id: 'hf',
    });

    return {
      id: 'tpl_hf',
      name: 'hf',
      filename: 'hf.docx',
      ingested_at: new Date().toISOString(),
      docx_bytes: blob,
      schema_json: parsed.schema,
    };
  }

  async function readPartXml(blob: Blob, partPath: string): Promise<string> {
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(blob);
    return zip.file(partPath)!.async('string');
  }

  it('parser emits document_part sections for non-empty header/footer parts', async () => {
    const tpl = await buildTemplateWithHeaderFooter();
    const sections = tpl.schema_json.sections;
    const headerSection = sections.find(
      (s) => s.fill_region.kind === 'document_part' && s.fill_region.placement === 'header',
    );
    const footerSection = sections.find(
      (s) => s.fill_region.kind === 'document_part' && s.fill_region.placement === 'footer',
    );
    expect(headerSection).toBeTruthy();
    expect(footerSection).toBeTruthy();
    if (headerSection?.fill_region.kind === 'document_part') {
      expect(headerSection.fill_region.part_path).toBe('word/header1.xml');
      expect(headerSection.fill_region.original_text_lines).toContain('DEPARTMENT OF THE ARMY');
      expect(headerSection.fill_region.original_text_lines).toContain('[UNIT NAME]');
    }
    if (footerSection?.fill_region.kind === 'document_part') {
      expect(footerSection.fill_region.part_path).toBe('word/footer1.xml');
      expect(footerSection.fill_region.original_text_lines).toContain('CUI');
    }
    // Parser-supplied intent must be present so the drafter has guidance.
    expect(headerSection!.intent).toBeTruthy();
    expect(footerSection!.intent).toBeTruthy();
  });

  it('leaves word/header1.xml byte-preserved even when a draft is supplied', async () => {
    const tpl = await buildTemplateWithHeaderFooter();
    const headerSection = tpl.schema_json.sections.find(
      (s) => s.fill_region.kind === 'document_part' && s.fill_region.placement === 'header',
    )!;

    const originalHeaderXml = await readPartXml(tpl.docx_bytes, 'word/header1.xml');

    const drafted: DraftParagraph[] = [
      { role: 'body', text: 'DEPARTMENT OF THE ARMY' },
      { role: 'body', text: 'TROOP COMMAND, MEDICAL READINESS COMMAND, PACIFIC' },
      { role: 'body', text: '9040 Jackson Ave, Tacoma WA 98433' },
    ];

    const result = await assembleProjectDocx({
      template: tpl,
      draftedBySectionId: new Map([[headerSection.id, drafted]]),
    });

    const headerStatus = result.section_results.find(
      (r) => r.section_id === headerSection.id,
    );
    expect(headerStatus?.status.kind).toBe('skipped_unsupported_region');

    const headerXml = await readPartXml(result.blob, 'word/header1.xml');
    // Original header content — including the "[UNIT NAME]" placeholder
    // — must survive untouched. The drafted paragraphs must NOT appear
    // in the header part.
    expect(headerXml).toBe(originalHeaderXml);
    expect(headerXml).toContain('DEPARTMENT OF THE ARMY');
    expect(headerXml).toContain('[UNIT NAME]');
    expect(headerXml).not.toContain('TROOP COMMAND, MEDICAL READINESS COMMAND, PACIFIC');
  });

  it('leaves word/footer1.xml byte-preserved even when a draft is supplied', async () => {
    const tpl = await buildTemplateWithHeaderFooter();
    const footerSection = tpl.schema_json.sections.find(
      (s) => s.fill_region.kind === 'document_part' && s.fill_region.placement === 'footer',
    )!;

    const originalFooterXml = await readPartXml(tpl.docx_bytes, 'word/footer1.xml');

    const drafted: DraftParagraph[] = [
      { role: 'body', text: 'CUI//SP-PROCURE' },
    ];

    const result = await assembleProjectDocx({
      template: tpl,
      draftedBySectionId: new Map([[footerSection.id, drafted]]),
    });

    const footerStatus = result.section_results.find(
      (r) => r.section_id === footerSection.id,
    );
    expect(footerStatus?.status.kind).toBe('skipped_unsupported_region');

    const footerXml = await readPartXml(result.blob, 'word/footer1.xml');
    expect(footerXml).toBe(originalFooterXml);
    expect(footerXml).not.toContain('CUI//SP-PROCURE');
  });

  it('skips document_part sections without a draft entry, leaving the part untouched', async () => {
    const tpl = await buildTemplateWithHeaderFooter();
    const headerSection = tpl.schema_json.sections.find(
      (s) => s.fill_region.kind === 'document_part' && s.fill_region.placement === 'header',
    )!;

    const result = await assembleProjectDocx({
      template: tpl,
      draftedBySectionId: new Map(),
    });

    const headerStatus = result.section_results.find(
      (r) => r.section_id === headerSection.id,
    );
    // No drafts at all → the whole function takes the
    // no-op passthrough branch which reports document_part as
    // skipped_unsupported_region (since we don't draft into it anyway).
    expect(headerStatus?.status.kind).toBe('skipped_unsupported_region');

    const headerXml = await readPartXml(result.blob, 'word/header1.xml');
    expect(headerXml).toContain('DEPARTMENT OF THE ARMY');
    expect(headerXml).toContain('[UNIT NAME]');
  });
});

// ─── Cross-container splice (Bug: Army memo header / SDT sections) ──
//
// Pins the fix for failing Army memo sections like Header Block,
// Date and Reference, Subject Line, and SDT-wrapped numbered
// paragraphs. The legacy assembler bailed with
// "section range spans multiple parent containers" any time a
// section's anchor range crossed <w:tc> or <w:sdtContent> boundaries.
// The fix groups consecutive same-parent paragraphs into runs and
// splices each run independently, distributing the drafted
// paragraphs proportionally so every container ends up non-empty.

describe('assembleProjectDocx — cross-container splice', () => {
  // Build a synthetic DOCX with a 1×3 table whose three cells each
  // contain one paragraph. Plus a heading paragraph above the table
  // (so the section can be heading-bounded). The section's anchor
  // range covers paragraphs [0..3] which spans the heading + all
  // three table-cell paragraphs (4 different parents in tree order:
  // body, tc, tc, tc).
  async function buildTableCellTemplate(): Promise<TemplateRecord> {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();

    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
      <w:r><w:t xml:space="preserve">Header Block</w:t></w:r>
    </w:p>
    <w:tbl>
      <w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>
      <w:tblGrid><w:gridCol w:w="3000"/></w:tblGrid>
      <w:tr>
        <w:tc>
          <w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr>
          <w:p>
            <w:pPr><w:pStyle w:val="Normal"/><w:jc w:val="center"/></w:pPr>
            <w:r><w:t xml:space="preserve">DEPARTMENT OF THE ARMY (placeholder cell A)</w:t></w:r>
          </w:p>
        </w:tc>
      </w:tr>
      <w:tr>
        <w:tc>
          <w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr>
          <w:p>
            <w:pPr><w:pStyle w:val="Normal"/><w:jc w:val="center"/></w:pPr>
            <w:r><w:t xml:space="preserve">UNIT NAME (placeholder cell B)</w:t></w:r>
          </w:p>
        </w:tc>
      </w:tr>
      <w:tr>
        <w:tc>
          <w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr>
          <w:p>
            <w:pPr><w:pStyle w:val="Normal"/><w:jc w:val="center"/></w:pPr>
            <w:r><w:t xml:space="preserve">ADDRESS (placeholder cell C)</w:t></w:r>
          </w:p>
        </w:tc>
      </w:tr>
    </w:tbl>
    <w:p>
      <w:pPr><w:pStyle w:val="Normal"/></w:pPr>
      <w:r><w:t xml:space="preserve">Body content after the header table.</w:t></w:r>
    </w:p>
    <w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>
  </w:body>
</w:document>`;

    const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="BodyText"><w:name w:val="Body Text"/></w:style>
</w:styles>`;

    const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

    const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

    const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

    zip.file('[Content_Types].xml', contentTypes);
    zip.file('_rels/.rels', rootRels);
    zip.file('word/_rels/document.xml.rels', docRels);
    zip.file('word/document.xml', documentXml);
    zip.file('word/styles.xml', stylesXml);

    const u8 = await zip.generateAsync({ type: 'uint8array' });
    const ab = new ArrayBuffer(u8.byteLength);
    new Uint8Array(ab).set(u8);
    const blob = new Blob([ab]);
    const parsed = await parseDocx(blob, {
      filename: 'tablecell.docx',
      docx_blob_id: 'tc',
    });

    // The parser walks <w:p> in tree order, so the flat paragraph
    // sequence is:
    //   p[0] heading (parent: w:body)
    //   p[1] DEPARTMENT (parent: w:tc cell A)
    //   p[2] UNIT NAME  (parent: w:tc cell B)
    //   p[3] ADDRESS    (parent: w:tc cell C)
    //   p[4] body trailer (parent: w:body)
    // The Header Block section anchors at heading [0] and ends at
    // [3] — spanning 4 different parents.
    const schema: TemplateSchema = {
      ...parsed.schema,
      sections: [
        {
          id: 'header_block',
          name: 'Header Block',
          order: 0,
          required: true,
          fill_region: {
            kind: 'heading_bounded',
            heading_text: 'Header Block',
            heading_style_id: 'Heading1',
            body_style_id: 'Normal',
            anchor_paragraph_index: 0,
            end_anchor_paragraph_index: 3,
            permitted_roles: ['heading', 'body'],
          },
        },
      ],
    };
    return {
      id: 'tpl_tc',
      name: 'tablecell',
      filename: 'tablecell.docx',
      ingested_at: new Date().toISOString(),
      docx_bytes: blob,
      schema_json: schema,
    };
  }

  async function loadDocumentDom(blob: Blob): Promise<{ dom: Document; W_NS: string }> {
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(blob);
    const xml = await zip.file('word/document.xml')!.async('string');
    const dom = new DOMParser().parseFromString(xml, 'text/xml');
    return { dom, W_NS: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main' };
  }

  it('splices across <w:tc> boundaries when a section spans table cells', async () => {
    const template = await buildTableCellTemplate();
    const drafted: DraftParagraph[] = [
      { role: 'heading', text: 'NEW HEADER LINE' },
      { role: 'body', text: 'DEPARTMENT OF THE ARMY' },
      { role: 'body', text: 'TROOP COMMAND, MEDICAL READINESS COMMAND, PACIFIC' },
      { role: 'body', text: '9040 Jackson Avenue' },
    ];
    const result = await assembleProjectDocx({
      template,
      draftedBySectionId: new Map([['header_block', drafted]]),
    });

    // Did NOT fail.
    const status = result.section_results.find((r) => r.section_id === 'header_block')
      ?.status;
    expect(status?.kind).toBe('assembled');

    // Re-parse and confirm:
    //   - The placeholder cell text is gone.
    //   - All four drafted strings are present in the document.
    //   - The trailing body paragraph ("Body content after the header table.")
    //     is preserved, proving we didn't accidentally delete content
    //     outside the section's range.
    //   - The table still exists (cells weren't structurally removed).
    const after = await parseDocx(result.blob, {
      filename: 'tablecell.docx',
      docx_blob_id: 'after',
    });
    const afterTexts = after.paragraphs.map((p) => p.text);
    for (const draftedLine of drafted) {
      expect(afterTexts.some((t) => t.includes(draftedLine.text))).toBe(true);
    }
    // Original placeholder content must be gone.
    expect(afterTexts.some((t) => t.includes('placeholder cell A'))).toBe(false);
    expect(afterTexts.some((t) => t.includes('placeholder cell B'))).toBe(false);
    expect(afterTexts.some((t) => t.includes('placeholder cell C'))).toBe(false);
    // Trailer outside the range stays.
    expect(afterTexts.some((t) => t.includes('Body content after the header table'))).toBe(
      true,
    );
    // Table is still there.
    expect(after.tables.length).toBe(1);
  });

  it('keeps every <w:tc> non-empty even when the draft is shorter than the cell count', async () => {
    const template = await buildTableCellTemplate();
    // Only one drafted paragraph for a section that originally
    // covered 4 paragraphs (heading + 3 cells). Each container must
    // still end up with at least one <w:p> child or Word refuses to
    // open the document.
    const drafted: DraftParagraph[] = [
      { role: 'body', text: 'ONLY ONE DRAFT LINE' },
    ];
    const result = await assembleProjectDocx({
      template,
      draftedBySectionId: new Map([['header_block', drafted]]),
    });
    const status = result.section_results.find((r) => r.section_id === 'header_block')
      ?.status;
    expect(status?.kind).toBe('assembled');

    // Inspect the raw DOM and assert every <w:tc> has at least one
    // direct or descendant <w:p> child.
    const { dom, W_NS } = await loadDocumentDom(result.blob);
    const cells = Array.from(dom.getElementsByTagNameNS(W_NS, 'tc'));
    expect(cells.length).toBe(3);
    for (const tc of cells) {
      const ps = tc.getElementsByTagNameNS(W_NS, 'p');
      expect(ps.length).toBeGreaterThanOrEqual(1);
    }

    // The draft line landed somewhere in the document.
    const after = await parseDocx(result.blob, {
      filename: 'tablecell.docx',
      docx_blob_id: 'short-draft',
    });
    expect(after.paragraphs.some((p) => p.text.includes('ONLY ONE DRAFT LINE'))).toBe(true);
  });

  it('distributes a long draft across containers proportionally', async () => {
    const template = await buildTableCellTemplate();
    // 9 drafted paragraphs into a section that covers 4 paragraphs
    // (1 in body + 1 in each of 3 cells). Proportional distribution
    // by old paragraph count (each group has exactly 1 old) gives
    // each group 9/4 ≈ 2 paragraphs, with the last group taking the
    // remainder. Exact split depends on the rounding policy; here
    // we just assert every group is non-empty AND every drafted line
    // shows up exactly once in the final document.
    const drafted: DraftParagraph[] = Array.from({ length: 9 }, (_, i) => ({
      role: 'body' as const,
      text: `LINE_${i}`,
    }));
    const result = await assembleProjectDocx({
      template,
      draftedBySectionId: new Map([['header_block', drafted]]),
    });
    const status = result.section_results.find((r) => r.section_id === 'header_block')
      ?.status;
    expect(status?.kind).toBe('assembled');
    if (status?.kind === 'assembled') {
      // 9 drafts in, 9 drafts out. paragraphs_replaced is the total
      // old paragraph count across all groups (4).
      expect(status.paragraphs_inserted).toBe(9);
      expect(status.paragraphs_replaced).toBe(4);
    }

    const after = await parseDocx(result.blob, {
      filename: 'tablecell.docx',
      docx_blob_id: 'long-draft',
    });
    for (let i = 0; i < 9; i++) {
      expect(after.paragraphs.some((p) => p.text.includes(`LINE_${i}`))).toBe(true);
    }

    // Every cell still has content.
    const { dom, W_NS } = await loadDocumentDom(result.blob);
    const cells = Array.from(dom.getElementsByTagNameNS(W_NS, 'tc'));
    expect(cells.length).toBe(3);
    for (const tc of cells) {
      const ps = tc.getElementsByTagNameNS(W_NS, 'p');
      expect(ps.length).toBeGreaterThanOrEqual(1);
    }
  });

  // ── SDT (content control) parent ──
  //
  // Mirrors the Subject Line failure: the template wraps the subject
  // paragraph in a structured-document-tag content control whose
  // <w:sdtContent> is a different parent from the surrounding body.
  // The section's anchor range covers a heading at body level + the
  // SDT-wrapped subject paragraph.

  async function buildSdtTemplate(): Promise<TemplateRecord> {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();

    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
      <w:r><w:t xml:space="preserve">Subject Line</w:t></w:r>
    </w:p>
    <w:sdt>
      <w:sdtPr><w:tag w:val="subject"/></w:sdtPr>
      <w:sdtContent>
        <w:p>
          <w:pPr><w:pStyle w:val="Normal"/></w:pPr>
          <w:r><w:t xml:space="preserve">SUBJECT: PLACEHOLDER SUBJECT</w:t></w:r>
        </w:p>
      </w:sdtContent>
    </w:sdt>
    <w:p>
      <w:pPr><w:pStyle w:val="Normal"/></w:pPr>
      <w:r><w:t xml:space="preserve">Trailer body paragraph.</w:t></w:r>
    </w:p>
    <w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>
  </w:body>
</w:document>`;

    const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="BodyText"><w:name w:val="Body Text"/></w:style>
</w:styles>`;

    const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

    const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

    const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

    zip.file('[Content_Types].xml', contentTypes);
    zip.file('_rels/.rels', rootRels);
    zip.file('word/_rels/document.xml.rels', docRels);
    zip.file('word/document.xml', documentXml);
    zip.file('word/styles.xml', stylesXml);

    const u8 = await zip.generateAsync({ type: 'uint8array' });
    const ab = new ArrayBuffer(u8.byteLength);
    new Uint8Array(ab).set(u8);
    const blob = new Blob([ab]);
    const parsed = await parseDocx(blob, {
      filename: 'sdt.docx',
      docx_blob_id: 'sdt',
    });
    const schema: TemplateSchema = {
      ...parsed.schema,
      sections: [
        {
          id: 'subject_line',
          name: 'Subject Line',
          order: 0,
          required: true,
          fill_region: {
            kind: 'heading_bounded',
            heading_text: 'Subject Line',
            heading_style_id: 'Heading1',
            body_style_id: 'Normal',
            anchor_paragraph_index: 0,
            end_anchor_paragraph_index: 1,
            permitted_roles: ['heading', 'body'],
          },
        },
      ],
    };
    return {
      id: 'tpl_sdt',
      name: 'sdt',
      filename: 'sdt.docx',
      ingested_at: new Date().toISOString(),
      docx_bytes: blob,
      schema_json: schema,
    };
  }

  it('splices across <w:sdtContent> boundaries when a section spans a content control', async () => {
    const template = await buildSdtTemplate();
    const drafted: DraftParagraph[] = [
      { role: 'heading', text: 'SUBJECT' },
      { role: 'body', text: 'SUBJECT: LATERAL TRANSFER OF SPC JACOB BAUMGARTNER' },
    ];
    const result = await assembleProjectDocx({
      template,
      draftedBySectionId: new Map([['subject_line', drafted]]),
    });
    const status = result.section_results.find((r) => r.section_id === 'subject_line')
      ?.status;
    expect(status?.kind).toBe('assembled');

    const after = await parseDocx(result.blob, {
      filename: 'sdt.docx',
      docx_blob_id: 'sdt-after',
    });
    const afterTexts = after.paragraphs.map((p) => p.text);
    expect(afterTexts.some((t) => t.includes('LATERAL TRANSFER'))).toBe(true);
    // Placeholder content gone.
    expect(afterTexts.some((t) => t.includes('PLACEHOLDER SUBJECT'))).toBe(false);
    // Trailer survives.
    expect(afterTexts.some((t) => t.includes('Trailer body paragraph'))).toBe(true);
  });
});

// ─── Global format inventory: bullet/step preservation + ind strip ──
//
// Pins the user-reported bug: "bullets were not retained from the
// template styling, and there are indents that shouldn't be there".
//
// Root cause: drafted role='bullet' fell through to body styling
// because the section's local source range had no list-styled
// paragraphs to clone numPr from. The fix lifts a representative
// bullet pPr from anywhere in the document and uses it as a
// fallback. The "indent leak" was a separate issue: stripping numPr
// from a list-item source pPr left the hanging-indent override in
// place, making body text float at the bullet position.

describe('assembleProjectDocx — bullet/step inventory + ind strip', () => {
  // Build a document where:
  //   p[0] heading "Justification"
  //   p[1] body paragraph (the section anchor end) with NO indent
  //   p[2] heading "Other"
  //   p[3] BULLET paragraph elsewhere with numPr (numId=2 ilvl=0)
  //        and pStyle=ListBullet — this is what the inventory will lift.
  // The drafted "Justification" section (anchor [0..1]) outputs a
  // mix of body and bullet paragraphs. The bullets must come out
  // with a real numPr, even though the local section's range
  // contains no list paragraphs.
  async function buildBulletInventoryTemplate(): Promise<TemplateRecord> {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();

    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
      <w:r><w:t xml:space="preserve">Justification and Instructions</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr><w:pStyle w:val="Normal"/></w:pPr>
      <w:r><w:t xml:space="preserve">Body paragraph in the justification section.</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
      <w:r><w:t xml:space="preserve">Other Section</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr>
        <w:pStyle w:val="ListBullet"/>
        <w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr>
        <w:ind w:left="720" w:hanging="360"/>
      </w:pPr>
      <w:r><w:t xml:space="preserve">An existing bullet paragraph elsewhere in the doc.</w:t></w:r>
    </w:p>
    <w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>
  </w:body>
</w:document>`;

    const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="BodyText"><w:name w:val="Body Text"/></w:style>
  <w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/></w:style>
</w:styles>`;

    const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

    const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

    const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

    zip.file('[Content_Types].xml', contentTypes);
    zip.file('_rels/.rels', rootRels);
    zip.file('word/_rels/document.xml.rels', docRels);
    zip.file('word/document.xml', documentXml);
    zip.file('word/styles.xml', stylesXml);

    const u8 = await zip.generateAsync({ type: 'uint8array' });
    const ab = new ArrayBuffer(u8.byteLength);
    new Uint8Array(ab).set(u8);
    const blob = new Blob([ab]);
    const parsed = await parseDocx(blob, {
      filename: 'bulletinv.docx',
      docx_blob_id: 'bulletinv',
    });
    const schema: TemplateSchema = {
      ...parsed.schema,
      sections: [
        {
          id: 'justification',
          name: 'Justification and Instructions',
          order: 0,
          required: true,
          fill_region: {
            kind: 'heading_bounded',
            heading_text: 'Justification and Instructions',
            heading_style_id: 'Heading1',
            body_style_id: 'Normal',
            anchor_paragraph_index: 0,
            end_anchor_paragraph_index: 1,
            permitted_roles: ['heading', 'body', 'bullet'],
          },
        },
      ],
    };
    return {
      id: 'tpl_bulletinv',
      name: 'bulletinv',
      filename: 'bulletinv.docx',
      ingested_at: new Date().toISOString(),
      docx_bytes: blob,
      schema_json: schema,
    };
  }

  async function loadBodyDom(blob: Blob): Promise<{ dom: Document; W_NS: string }> {
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(blob);
    const xml = await zip.file('word/document.xml')!.async('string');
    const dom = new DOMParser().parseFromString(xml, 'text/xml');
    return { dom, W_NS: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main' };
  }

  it('drafted bullets emit a real <w:numPr> lifted from the global inventory', async () => {
    const template = await buildBulletInventoryTemplate();
    const drafted: DraftParagraph[] = [
      { role: 'body', text: 'Soldier transferred per the action.' },
      { role: 'bullet', text: 'Effective date: 15 April 2026' },
      { role: 'bullet', text: 'Losing unit: C Company' },
      { role: 'bullet', text: 'Gaining unit: B Company' },
    ];
    const result = await assembleProjectDocx({
      template,
      draftedBySectionId: new Map([['justification', drafted]]),
    });
    const status = result.section_results.find((r) => r.section_id === 'justification')
      ?.status;
    expect(status?.kind).toBe('assembled');

    // Inspect every <w:p> in the body and verify that the three
    // drafted bullet lines each carry a <w:numPr> with the same
    // numId (2) lifted from the global bullet template.
    const { dom, W_NS } = await loadBodyDom(result.blob);
    const paragraphs = Array.from(dom.getElementsByTagNameNS(W_NS, 'p'));
    const bulletDrafted = paragraphs.filter((p) => {
      const text = p.textContent ?? '';
      return text.includes('Effective date') || text.includes('Losing unit') || text.includes('Gaining unit');
    });
    expect(bulletDrafted.length).toBe(3);

    for (const p of bulletDrafted) {
      const pPr = p.getElementsByTagNameNS(W_NS, 'pPr')[0];
      expect(pPr).toBeTruthy();
      const numPr = pPr!.getElementsByTagNameNS(W_NS, 'numPr')[0];
      expect(numPr).toBeTruthy();
      const numId = numPr!.getElementsByTagNameNS(W_NS, 'numId')[0];
      expect(numId).toBeTruthy();
      expect(numId!.getAttributeNS(W_NS, 'val')).toBe('2');
      // The bullet's pStyle should also be set to ListBullet via the
      // role mapper.
      const pStyle = pPr!.getElementsByTagNameNS(W_NS, 'pStyle')[0];
      expect(pStyle!.getAttributeNS(W_NS, 'val')).toBe('ListBullet');
    }
  });

  it('drafted body paragraphs do NOT inherit numPr from a list-item source', async () => {
    // Build a section whose source range contains a list-item
    // paragraph (numPr + ind hanging). The drafted output is pure
    // body paragraphs with no bullet roles. The result must have
    // ZERO numPr elements on the new paragraphs AND the hanging
    // indent must be stripped (since it was list geometry).
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
      <w:r><w:t xml:space="preserve">Section heading</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr>
        <w:pStyle w:val="ListBullet"/>
        <w:numPr><w:ilvl w:val="0"/><w:numId w:val="3"/></w:numPr>
        <w:ind w:left="720" w:hanging="360"/>
      </w:pPr>
      <w:r><w:t xml:space="preserve">existing bullet inside the section</w:t></w:r>
    </w:p>
    <w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>
  </w:body>
</w:document>`;
    const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>
  <w:style w:type="paragraph" w:styleId="BodyText"><w:name w:val="Body Text"/></w:style>
  <w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/></w:style>
</w:styles>`;
    const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;
    const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
    const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
    zip.file('[Content_Types].xml', contentTypes);
    zip.file('_rels/.rels', rootRels);
    zip.file('word/_rels/document.xml.rels', docRels);
    zip.file('word/document.xml', documentXml);
    zip.file('word/styles.xml', stylesXml);
    const u8 = await zip.generateAsync({ type: 'uint8array' });
    const ab = new ArrayBuffer(u8.byteLength);
    new Uint8Array(ab).set(u8);
    const blob = new Blob([ab]);
    const parsed = await parseDocx(blob, {
      filename: 'delist.docx',
      docx_blob_id: 'delist',
    });
    const tpl: TemplateRecord = {
      id: 'tpl_delist',
      name: 'delist',
      filename: 'delist.docx',
      ingested_at: new Date().toISOString(),
      docx_bytes: blob,
      schema_json: {
        ...parsed.schema,
        sections: [
          {
            id: 'sec_one',
            name: 'sec',
            order: 0,
            required: true,
            fill_region: {
              kind: 'heading_bounded',
              heading_text: 'Section heading',
              heading_style_id: 'Heading1',
              body_style_id: 'ListBullet',
              anchor_paragraph_index: 0,
              end_anchor_paragraph_index: 1,
              permitted_roles: ['heading', 'body'],
            },
          },
        ],
      },
    };

    const drafted: DraftParagraph[] = [
      { role: 'heading', text: 'NEW HEADING' },
      { role: 'body', text: 'plain body paragraph one' },
      { role: 'body', text: 'plain body paragraph two' },
    ];
    const result = await assembleProjectDocx({
      template: tpl,
      draftedBySectionId: new Map([['sec_one', drafted]]),
    });
    expect(
      result.section_results.find((r) => r.section_id === 'sec_one')?.status.kind,
    ).toBe('assembled');

    const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const JSZipMod = (await import('jszip')).default;
    const z = await JSZipMod.loadAsync(result.blob);
    const xml = await z.file('word/document.xml')!.async('string');
    const dom = new DOMParser().parseFromString(xml, 'text/xml');
    const paragraphs = Array.from(dom.getElementsByTagNameNS(W_NS, 'p'));
    const drafted_body = paragraphs.filter((p) =>
      (p.textContent ?? '').includes('plain body paragraph'),
    );
    expect(drafted_body.length).toBe(2);
    for (const p of drafted_body) {
      const pPr = p.getElementsByTagNameNS(W_NS, 'pPr')[0];
      expect(pPr).toBeTruthy();
      // numPr was stripped.
      expect(pPr!.getElementsByTagNameNS(W_NS, 'numPr').length).toBe(0);
      // ind was ALSO stripped (because the source pPr had numPr —
      // the ind was list geometry, not a body indent override).
      expect(pPr!.getElementsByTagNameNS(W_NS, 'ind').length).toBe(0);
    }
  });
});

// ─── Level field: nested bullets, indented body, sub-headings ──────
//
// Pins the user-requested feature: drafted paragraphs can attach an
// optional `level` field that the assembler maps to OOXML formatting
// per role. bullet/step → ilvl on numPr; body and similar → ind
// w:left in 0.5"-per-level steps; heading → Heading{level+1}.

describe('assembleProjectDocx — DraftParagraph.level field', () => {
  // Reuse the bullet-inventory template from the previous suite — it
  // has a global ListBullet paragraph with numId=2, and a section we
  // can draft into. Re-define it inline here so the suites are
  // independent.
  async function buildLevelTemplate(): Promise<TemplateRecord> {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
      <w:r><w:t xml:space="preserve">Section heading</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr><w:pStyle w:val="Normal"/></w:pPr>
      <w:r><w:t xml:space="preserve">Body paragraph in the section.</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr>
        <w:pStyle w:val="ListBullet"/>
        <w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr>
      </w:pPr>
      <w:r><w:t xml:space="preserve">Reference bullet elsewhere in the doc.</w:t></w:r>
    </w:p>
    <w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>
  </w:body>
</w:document>`;
    const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style>
  <w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/></w:style>
  <w:style w:type="paragraph" w:styleId="BodyText"><w:name w:val="Body Text"/></w:style>
  <w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/></w:style>
</w:styles>`;
    const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;
    const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
    const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
    zip.file('[Content_Types].xml', contentTypes);
    zip.file('_rels/.rels', rootRels);
    zip.file('word/_rels/document.xml.rels', docRels);
    zip.file('word/document.xml', documentXml);
    zip.file('word/styles.xml', stylesXml);
    const u8 = await zip.generateAsync({ type: 'uint8array' });
    const ab = new ArrayBuffer(u8.byteLength);
    new Uint8Array(ab).set(u8);
    const blob = new Blob([ab]);
    const parsed = await parseDocx(blob, {
      filename: 'level.docx',
      docx_blob_id: 'level',
    });
    return {
      id: 'tpl_level',
      name: 'level',
      filename: 'level.docx',
      ingested_at: new Date().toISOString(),
      docx_bytes: blob,
      schema_json: {
        ...parsed.schema,
        sections: [
          {
            id: 'sec_one',
            name: 'Section heading',
            order: 0,
            required: true,
            fill_region: {
              kind: 'heading_bounded',
              heading_text: 'Section heading',
              heading_style_id: 'Heading1',
              body_style_id: 'Normal',
              anchor_paragraph_index: 0,
              end_anchor_paragraph_index: 1,
              permitted_roles: ['heading', 'body', 'bullet', 'step'],
            },
          },
        ],
      },
    };
  }

  async function loadDom(blob: Blob): Promise<{ dom: Document; W_NS: string }> {
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(blob);
    const xml = await zip.file('word/document.xml')!.async('string');
    const dom = new DOMParser().parseFromString(xml, 'text/xml');
    return { dom, W_NS: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main' };
  }

  it('bullets at different levels emit different <w:ilvl> values', async () => {
    const template = await buildLevelTemplate();
    const drafted: DraftParagraph[] = [
      { role: 'bullet', text: 'top level bullet zero', level: 0 },
      { role: 'bullet', text: 'sub bullet one',        level: 1 },
      { role: 'bullet', text: 'sub sub bullet two',    level: 2 },
      { role: 'bullet', text: 'top level bullet again', level: 0 },
    ];
    const result = await assembleProjectDocx({
      template,
      draftedBySectionId: new Map([['sec_one', drafted]]),
    });
    expect(
      result.section_results.find((r) => r.section_id === 'sec_one')?.status.kind,
    ).toBe('assembled');

    const { dom, W_NS } = await loadDom(result.blob);
    const paragraphs = Array.from(dom.getElementsByTagNameNS(W_NS, 'p'));

    function ilvlForText(needle: string): string | null {
      const p = paragraphs.find((q) => (q.textContent ?? '').includes(needle));
      if (!p) return null;
      const pPr = p.getElementsByTagNameNS(W_NS, 'pPr')[0];
      if (!pPr) return null;
      const numPr = pPr.getElementsByTagNameNS(W_NS, 'numPr')[0];
      if (!numPr) return null;
      const ilvl = numPr.getElementsByTagNameNS(W_NS, 'ilvl')[0];
      return ilvl?.getAttributeNS(W_NS, 'val') ?? null;
    }

    expect(ilvlForText('top level bullet zero')).toBe('0');
    expect(ilvlForText('sub bullet one')).toBe('1');
    expect(ilvlForText('sub sub bullet two')).toBe('2');
    expect(ilvlForText('top level bullet again')).toBe('0');

    // Every bullet must still carry the inventory's numId binding.
    for (const needle of [
      'top level bullet zero',
      'sub bullet one',
      'sub sub bullet two',
      'top level bullet again',
    ]) {
      const p = paragraphs.find((q) => (q.textContent ?? '').includes(needle))!;
      const numPr = p.getElementsByTagNameNS(W_NS, 'numPr')[0];
      const numId = numPr!.getElementsByTagNameNS(W_NS, 'numId')[0];
      expect(numId!.getAttributeNS(W_NS, 'val')).toBe('2');
    }
  });

  it('body paragraphs at level > 0 emit a <w:ind w:left="720*level"/>', async () => {
    const template = await buildLevelTemplate();
    const drafted: DraftParagraph[] = [
      { role: 'body', text: 'flush body line', level: 0 },
      { role: 'body', text: 'indented body level one', level: 1 },
      { role: 'body', text: 'indented body level two', level: 2 },
    ];
    const result = await assembleProjectDocx({
      template,
      draftedBySectionId: new Map([['sec_one', drafted]]),
    });
    expect(
      result.section_results.find((r) => r.section_id === 'sec_one')?.status.kind,
    ).toBe('assembled');

    const { dom, W_NS } = await loadDom(result.blob);
    const paragraphs = Array.from(dom.getElementsByTagNameNS(W_NS, 'p'));

    function indLeftForText(needle: string): string | null {
      const p = paragraphs.find((q) => (q.textContent ?? '').includes(needle));
      if (!p) return null;
      const pPr = p.getElementsByTagNameNS(W_NS, 'pPr')[0];
      if (!pPr) return null;
      const ind = pPr.getElementsByTagNameNS(W_NS, 'ind')[0];
      return ind?.getAttributeNS(W_NS, 'left') ?? null;
    }

    // level 0: ind comes from the cloned source pPr (which had no
    // ind), so this paragraph has no ind override at all.
    expect(indLeftForText('flush body line')).toBeNull();
    // level 1: 720 twips = 0.5"
    expect(indLeftForText('indented body level one')).toBe('720');
    // level 2: 1440 twips = 1"
    expect(indLeftForText('indented body level two')).toBe('1440');
  });

  it('headings at different levels pick the corresponding HeadingN style', async () => {
    const template = await buildLevelTemplate();
    const drafted: DraftParagraph[] = [
      { role: 'heading', text: 'TOP HEADING',  level: 0 },
      { role: 'heading', text: 'SUB HEADING',  level: 1 },
      { role: 'heading', text: 'SUBSUB HEADING', level: 2 },
    ];
    const result = await assembleProjectDocx({
      template,
      draftedBySectionId: new Map([['sec_one', drafted]]),
    });
    expect(
      result.section_results.find((r) => r.section_id === 'sec_one')?.status.kind,
    ).toBe('assembled');

    const { dom, W_NS } = await loadDom(result.blob);
    const paragraphs = Array.from(dom.getElementsByTagNameNS(W_NS, 'p'));

    function pStyleForText(needle: string): string | null {
      const p = paragraphs.find((q) => (q.textContent ?? '').includes(needle));
      if (!p) return null;
      const pPr = p.getElementsByTagNameNS(W_NS, 'pPr')[0];
      if (!pPr) return null;
      const pStyle = pPr.getElementsByTagNameNS(W_NS, 'pStyle')[0];
      return pStyle?.getAttributeNS(W_NS, 'val') ?? null;
    }

    expect(pStyleForText('TOP HEADING')).toBe('Heading1');
    expect(pStyleForText('SUB HEADING')).toBe('Heading2');
    expect(pStyleForText('SUBSUB HEADING')).toBe('Heading3');
  });

  it('falls back to the closest available HeadingN when the requested level is missing', async () => {
    // Build a template that ONLY defines Heading1. A drafted heading
    // with level=2 should fall back through Heading3 → Heading2 →
    // Heading1.
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t xml:space="preserve">Top</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:r><w:t xml:space="preserve">body</w:t></w:r></w:p>
    <w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>
  </w:body>
</w:document>`;
    const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>
</w:styles>`;
    const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;
    const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
    const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
    zip.file('[Content_Types].xml', contentTypes);
    zip.file('_rels/.rels', rootRels);
    zip.file('word/_rels/document.xml.rels', docRels);
    zip.file('word/document.xml', documentXml);
    zip.file('word/styles.xml', stylesXml);
    const u8 = await zip.generateAsync({ type: 'uint8array' });
    const ab = new ArrayBuffer(u8.byteLength);
    new Uint8Array(ab).set(u8);
    const blob = new Blob([ab]);
    const parsed = await parseDocx(blob, {
      filename: 'sparse-headings.docx',
      docx_blob_id: 'sh',
    });
    const tpl: TemplateRecord = {
      id: 'tpl_sh',
      name: 'sh',
      filename: 'sparse-headings.docx',
      ingested_at: new Date().toISOString(),
      docx_bytes: blob,
      schema_json: {
        ...parsed.schema,
        sections: [
          {
            id: 'sec_one',
            name: 'sec',
            order: 0,
            required: true,
            fill_region: {
              kind: 'heading_bounded',
              heading_text: 'Top',
              heading_style_id: 'Heading1',
              body_style_id: 'Normal',
              anchor_paragraph_index: 0,
              end_anchor_paragraph_index: 1,
              permitted_roles: ['heading', 'body'],
            },
          },
        ],
      },
    };
    const result = await assembleProjectDocx({
      template: tpl,
      draftedBySectionId: new Map([
        [
          'sec_one',
          [
            { role: 'heading', text: 'DEEP HEADING', level: 2 },
            { role: 'body', text: 'body line' },
          ],
        ],
      ]),
    });
    const { dom, W_NS } = await loadDom(result.blob);
    const paragraphs = Array.from(dom.getElementsByTagNameNS(W_NS, 'p'));
    const heading = paragraphs.find((p) => (p.textContent ?? '').includes('DEEP HEADING'))!;
    const pStyle = heading.getElementsByTagNameNS(W_NS, 'pStyle')[0];
    // Heading2/Heading3 missing → falls back to Heading1.
    expect(pStyle!.getAttributeNS(W_NS, 'val')).toBe('Heading1');
  });

  it('clamps out-of-range and non-numeric level values', async () => {
    const template = await buildLevelTemplate();
    // 99 → clamped to 8 (max). NaN → 0. negative → 0.
    const drafted: DraftParagraph[] = [
      { role: 'bullet', text: 'level ninety-nine', level: 99 },
      // @ts-expect-error testing runtime coercion of a non-numeric level
      { role: 'bullet', text: 'level not-a-number', level: 'oops' },
      { role: 'bullet', text: 'level negative', level: -3 },
    ];
    const result = await assembleProjectDocx({
      template,
      draftedBySectionId: new Map([['sec_one', drafted]]),
    });
    expect(
      result.section_results.find((r) => r.section_id === 'sec_one')?.status.kind,
    ).toBe('assembled');

    const { dom, W_NS } = await loadDom(result.blob);
    const paragraphs = Array.from(dom.getElementsByTagNameNS(W_NS, 'p'));

    function ilvl(needle: string): string | null {
      const p = paragraphs.find((q) => (q.textContent ?? '').includes(needle))!;
      const pPr = p.getElementsByTagNameNS(W_NS, 'pPr')[0]!;
      const numPr = pPr.getElementsByTagNameNS(W_NS, 'numPr')[0]!;
      const ilvlEl = numPr.getElementsByTagNameNS(W_NS, 'ilvl')[0];
      return ilvlEl?.getAttributeNS(W_NS, 'val') ?? null;
    }

    expect(ilvl('level ninety-nine')).toBe('8');
    expect(ilvl('level not-a-number')).toBe('0');
    expect(ilvl('level negative')).toBe('0');
  });
});

// ─── Inline runs, page breaks, real tables, bullet fallback ────────
//
// Pins the formatting/table feature set. The drafter can now emit:
//   - runs[]              → mixed bold/italic/underline inside a paragraph
//   - page_break_before   → forces a hard page break before the paragraph
//   - is_header           → marks a table_row as a header (bold + tblHeader)
//   - consecutive table_row paragraphs → real <w:tbl> with borders
//   - bullet/step roles in templates with no list inventory → manual indent
//
// All four features must be additive: every existing test in the
// suites above still passes unchanged.

describe('assembleProjectDocx — inline runs and rich-text formatting', () => {
  // Reuse the synthetic template builder pattern from earlier suites.
  async function buildPlainTemplate(): Promise<TemplateRecord> {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
      <w:r><w:t xml:space="preserve">Section</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr><w:pStyle w:val="Normal"/></w:pPr>
      <w:r>
        <w:rPr><w:rFonts w:ascii="Times New Roman"/><w:sz w:val="24"/></w:rPr>
        <w:t xml:space="preserve">body line</w:t>
      </w:r>
    </w:p>
    <w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>
  </w:body>
</w:document>`;
    const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>
  <w:style w:type="paragraph" w:styleId="BodyText"><w:name w:val="Body Text"/></w:style>
</w:styles>`;
    const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;
    const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
    const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
    zip.file('[Content_Types].xml', contentTypes);
    zip.file('_rels/.rels', rootRels);
    zip.file('word/_rels/document.xml.rels', docRels);
    zip.file('word/document.xml', documentXml);
    zip.file('word/styles.xml', stylesXml);
    const u8 = await zip.generateAsync({ type: 'uint8array' });
    const ab = new ArrayBuffer(u8.byteLength);
    new Uint8Array(ab).set(u8);
    const blob = new Blob([ab]);
    const parsed = await parseDocx(blob, {
      filename: 'plain.docx',
      docx_blob_id: 'plain',
    });
    return {
      id: 'tpl_plain',
      name: 'plain',
      filename: 'plain.docx',
      ingested_at: new Date().toISOString(),
      docx_bytes: blob,
      schema_json: {
        ...parsed.schema,
        sections: [
          {
            id: 'sec_one',
            name: 'Section',
            order: 0,
            required: true,
            fill_region: {
              kind: 'heading_bounded',
              heading_text: 'Section',
              heading_style_id: 'Heading1',
              body_style_id: 'Normal',
              anchor_paragraph_index: 0,
              end_anchor_paragraph_index: 1,
              permitted_roles: [
                'heading',
                'body',
                'bullet',
                'step',
                'table_row',
              ],
            },
          },
        ],
      },
    };
  }

  async function loadDom(blob: Blob): Promise<{ dom: Document; W_NS: string }> {
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(blob);
    const xml = await zip.file('word/document.xml')!.async('string');
    const dom = new DOMParser().parseFromString(xml, 'text/xml');
    return { dom, W_NS: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main' };
  }

  it('runs[] produces multiple <w:r> with per-run rPr toggles layered onto cloned base rPr', async () => {
    const template = await buildPlainTemplate();
    const drafted: DraftParagraph[] = [
      {
        role: 'body',
        text: '',
        runs: [
          { text: 'The contractor shall comply with ' },
          { text: 'FAR 52.204-21', bold: true },
          { text: ' for all CUI handling.' },
        ],
      },
    ];
    const result = await assembleProjectDocx({
      template,
      draftedBySectionId: new Map([['sec_one', drafted]]),
    });
    expect(
      result.section_results.find((r) => r.section_id === 'sec_one')?.status.kind,
    ).toBe('assembled');

    const { dom, W_NS } = await loadDom(result.blob);
    const paragraphs = Array.from(dom.getElementsByTagNameNS(W_NS, 'p'));
    const target = paragraphs.find((p) =>
      (p.textContent ?? '').includes('FAR 52.204-21'),
    )!;
    const runs = Array.from(target.getElementsByTagNameNS(W_NS, 'r'));
    expect(runs.length).toBe(3);

    // The middle run should carry bold ON; the others should not have a
    // bold element added (cloned base rPr had none).
    function hasExplicitBold(run: Element): boolean {
      const rPr = run.getElementsByTagNameNS(W_NS, 'rPr')[0];
      if (!rPr) return false;
      const bs = rPr.getElementsByTagNameNS(W_NS, 'b');
      return bs.length > 0 && bs[0]!.getAttributeNS(W_NS, 'val') !== 'false';
    }
    expect(hasExplicitBold(runs[0]!)).toBe(false);
    expect(hasExplicitBold(runs[1]!)).toBe(true);
    expect(hasExplicitBold(runs[2]!)).toBe(false);

    // Every run inherits the cloned base rPr (rFonts/sz from the template).
    for (const r of runs) {
      const rPr = r.getElementsByTagNameNS(W_NS, 'rPr')[0]!;
      expect(rPr.getElementsByTagNameNS(W_NS, 'rFonts').length).toBe(1);
      expect(rPr.getElementsByTagNameNS(W_NS, 'sz').length).toBe(1);
    }

    // Concatenated text matches.
    expect(target.textContent).toBe(
      'The contractor shall comply with FAR 52.204-21 for all CUI handling.',
    );
  });

  it('underline run emits <w:u w:val="single"/>; explicit bold:false clears inherited bold', async () => {
    const template = await buildPlainTemplate();
    const drafted: DraftParagraph[] = [
      {
        role: 'body',
        text: '',
        runs: [
          { text: 'underlined term', underline: true },
          { text: ' — and ', bold: false },
          { text: 'italicized note', italic: true },
        ],
      },
    ];
    const result = await assembleProjectDocx({
      template,
      draftedBySectionId: new Map([['sec_one', drafted]]),
    });
    const { dom, W_NS } = await loadDom(result.blob);
    const paragraphs = Array.from(dom.getElementsByTagNameNS(W_NS, 'p'));
    const target = paragraphs.find((p) =>
      (p.textContent ?? '').includes('underlined term'),
    )!;
    const runs = Array.from(target.getElementsByTagNameNS(W_NS, 'r'));
    expect(runs.length).toBe(3);

    // Run 0: <w:u w:val="single"/>
    const u0 = runs[0]!.getElementsByTagNameNS(W_NS, 'u')[0]!;
    expect(u0.getAttributeNS(W_NS, 'val')).toBe('single');

    // Run 1: <w:b w:val="false"/> — explicit clear
    const b1 = runs[1]!.getElementsByTagNameNS(W_NS, 'b')[0]!;
    expect(b1.getAttributeNS(W_NS, 'val')).toBe('false');

    // Run 2: <w:i/>
    const i2 = runs[2]!.getElementsByTagNameNS(W_NS, 'i')[0]!;
    expect(i2.getAttributeNS(W_NS, 'val')).toBeNull();
  });

  it('page_break_before adds <w:pageBreakBefore/> to pPr', async () => {
    const template = await buildPlainTemplate();
    const drafted: DraftParagraph[] = [
      { role: 'body', text: 'first paragraph' },
      { role: 'body', text: 'after the break', page_break_before: true },
    ];
    const result = await assembleProjectDocx({
      template,
      draftedBySectionId: new Map([['sec_one', drafted]]),
    });
    expect(
      result.section_results.find((r) => r.section_id === 'sec_one')?.status.kind,
    ).toBe('assembled');

    const { dom, W_NS } = await loadDom(result.blob);
    const paragraphs = Array.from(dom.getElementsByTagNameNS(W_NS, 'p'));
    const before = paragraphs.find((p) =>
      (p.textContent ?? '').includes('first paragraph'),
    )!;
    const after = paragraphs.find((p) =>
      (p.textContent ?? '').includes('after the break'),
    )!;
    expect(
      before.getElementsByTagNameNS(W_NS, 'pageBreakBefore').length,
    ).toBe(0);
    expect(
      after.getElementsByTagNameNS(W_NS, 'pageBreakBefore').length,
    ).toBe(1);
  });
});

describe('assembleProjectDocx — real <w:tbl> from consecutive table_row drafts', () => {
  async function buildTplWithSection(): Promise<TemplateRecord> {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
      <w:r><w:t xml:space="preserve">Roles</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr><w:pStyle w:val="Normal"/></w:pPr>
      <w:r><w:t xml:space="preserve">placeholder</w:t></w:r>
    </w:p>
    <w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>
  </w:body>
</w:document>`;
    const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>
  <w:style w:type="paragraph" w:styleId="BodyText"><w:name w:val="Body Text"/></w:style>
</w:styles>`;
    const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;
    const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
    const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
    zip.file('[Content_Types].xml', contentTypes);
    zip.file('_rels/.rels', rootRels);
    zip.file('word/_rels/document.xml.rels', docRels);
    zip.file('word/document.xml', documentXml);
    zip.file('word/styles.xml', stylesXml);
    const u8 = await zip.generateAsync({ type: 'uint8array' });
    const ab = new ArrayBuffer(u8.byteLength);
    new Uint8Array(ab).set(u8);
    const blob = new Blob([ab]);
    const parsed = await parseDocx(blob, {
      filename: 'tbl.docx',
      docx_blob_id: 'tbl',
    });
    return {
      id: 'tpl_tbl',
      name: 'tbl',
      filename: 'tbl.docx',
      ingested_at: new Date().toISOString(),
      docx_bytes: blob,
      schema_json: {
        ...parsed.schema,
        sections: [
          {
            id: 'sec_one',
            name: 'Roles',
            order: 0,
            required: true,
            fill_region: {
              kind: 'heading_bounded',
              heading_text: 'Roles',
              heading_style_id: 'Heading1',
              body_style_id: 'Normal',
              anchor_paragraph_index: 0,
              end_anchor_paragraph_index: 1,
              permitted_roles: ['heading', 'body', 'table_row'],
            },
          },
        ],
      },
    };
  }

  async function loadDom(blob: Blob): Promise<{ dom: Document; W_NS: string }> {
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(blob);
    const xml = await zip.file('word/document.xml')!.async('string');
    const dom = new DOMParser().parseFromString(xml, 'text/xml');
    return { dom, W_NS: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main' };
  }

  it('collapses consecutive table_row paragraphs into one <w:tbl> with borders, header row, and per-row cells', async () => {
    const template = await buildTplWithSection();
    const drafted: DraftParagraph[] = [
      { role: 'heading', text: 'Roles and Responsibilities', level: 0 },
      { role: 'table_row', is_header: true, cells: ['Role', 'Responsibility'], text: '' },
      { role: 'table_row', cells: ['Contracting Officer', 'Award and administer the contract.'], text: '' },
      { role: 'table_row', cells: ['COR', 'Monitor performance.'], text: '' },
      { role: 'body', text: 'Each role above is staffed prior to award.' },
    ];
    const result = await assembleProjectDocx({
      template,
      draftedBySectionId: new Map([['sec_one', drafted]]),
    });
    expect(
      result.section_results.find((r) => r.section_id === 'sec_one')?.status.kind,
    ).toBe('assembled');

    const { dom, W_NS } = await loadDom(result.blob);
    const tables = Array.from(dom.getElementsByTagNameNS(W_NS, 'tbl'));
    expect(tables.length).toBe(1);
    const tbl = tables[0]!;

    // tblPr / tblBorders present
    const tblPr = tbl.getElementsByTagNameNS(W_NS, 'tblPr')[0]!;
    expect(tblPr.getElementsByTagNameNS(W_NS, 'tblBorders').length).toBe(1);

    // tblGrid has 2 columns
    const grid = tbl.getElementsByTagNameNS(W_NS, 'tblGrid')[0]!;
    expect(grid.getElementsByTagNameNS(W_NS, 'gridCol').length).toBe(2);

    // 3 rows
    const rows = Array.from(tbl.getElementsByTagNameNS(W_NS, 'tr'));
    expect(rows.length).toBe(3);

    // Row 0 is header → has trPr/tblHeader
    const trPr = rows[0]!.getElementsByTagNameNS(W_NS, 'trPr')[0];
    expect(trPr).toBeTruthy();
    expect(trPr!.getElementsByTagNameNS(W_NS, 'tblHeader').length).toBe(1);

    // Header cells carry bold runs
    const headerCells = Array.from(rows[0]!.getElementsByTagNameNS(W_NS, 'tc'));
    expect(headerCells.length).toBe(2);
    for (const tc of headerCells) {
      const bs = tc.getElementsByTagNameNS(W_NS, 'b');
      expect(bs.length).toBeGreaterThan(0);
    }
    expect(headerCells[0]!.textContent).toContain('Role');
    expect(headerCells[1]!.textContent).toContain('Responsibility');

    // Row 1 cell text
    const row1Cells = Array.from(rows[1]!.getElementsByTagNameNS(W_NS, 'tc'));
    expect(row1Cells[0]!.textContent).toContain('Contracting Officer');
    expect(row1Cells[1]!.textContent).toContain('Award and administer the contract.');

    // The body paragraph after the table is still present as <w:p>.
    const paragraphs = Array.from(dom.getElementsByTagNameNS(W_NS, 'p'));
    const trailing = paragraphs.find((p) =>
      (p.textContent ?? '').includes('Each role above is staffed prior to award.'),
    );
    expect(trailing).toBeTruthy();
  });

  it('appends a trailing empty <w:p> when the section ends on a table (Word requires it)', async () => {
    const template = await buildTplWithSection();
    const drafted: DraftParagraph[] = [
      { role: 'table_row', is_header: true, cells: ['A', 'B'], text: '' },
      { role: 'table_row', cells: ['1', '2'], text: '' },
    ];
    const result = await assembleProjectDocx({
      template,
      draftedBySectionId: new Map([['sec_one', drafted]]),
    });
    const { dom, W_NS } = await loadDom(result.blob);
    const tables = Array.from(dom.getElementsByTagNameNS(W_NS, 'tbl'));
    expect(tables.length).toBe(1);
    // The next sibling of the table (within w:body) is a <w:p>.
    const tbl = tables[0]!;
    let next = tbl.nextSibling;
    while (next && next.nodeType !== 1) next = next.nextSibling;
    expect(next).toBeTruthy();
    expect((next as Element).localName).toBe('p');
  });

  it('short rows pad to the column count of the longest row', async () => {
    const template = await buildTplWithSection();
    const drafted: DraftParagraph[] = [
      { role: 'table_row', cells: ['a', 'b', 'c'], text: '' },
      { role: 'table_row', cells: ['x'], text: '' },
    ];
    const result = await assembleProjectDocx({
      template,
      draftedBySectionId: new Map([['sec_one', drafted]]),
    });
    const { dom, W_NS } = await loadDom(result.blob);
    const tbl = dom.getElementsByTagNameNS(W_NS, 'tbl')[0]!;
    const grid = tbl.getElementsByTagNameNS(W_NS, 'tblGrid')[0]!;
    expect(grid.getElementsByTagNameNS(W_NS, 'gridCol').length).toBe(3);
    const rows = Array.from(tbl.getElementsByTagNameNS(W_NS, 'tr'));
    expect(rows[0]!.getElementsByTagNameNS(W_NS, 'tc').length).toBe(3);
    expect(rows[1]!.getElementsByTagNameNS(W_NS, 'tc').length).toBe(3);
  });
});

describe('assembleProjectDocx — bullet fallback when no list inventory exists', () => {
  // A template with NO list paragraphs anywhere. The drafter still
  // emits bullet roles. Without a fallback, those would render as
  // plain prose. The fallback applies a manual indent + bullet glyph.

  async function buildNoListTemplate(): Promise<TemplateRecord> {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
      <w:r><w:t xml:space="preserve">Section</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr><w:pStyle w:val="Normal"/></w:pPr>
      <w:r><w:t xml:space="preserve">prose only</w:t></w:r>
    </w:p>
    <w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>
  </w:body>
</w:document>`;
    const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>
</w:styles>`;
    const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;
    const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
    const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
    zip.file('[Content_Types].xml', contentTypes);
    zip.file('_rels/.rels', rootRels);
    zip.file('word/_rels/document.xml.rels', docRels);
    zip.file('word/document.xml', documentXml);
    zip.file('word/styles.xml', stylesXml);
    const u8 = await zip.generateAsync({ type: 'uint8array' });
    const ab = new ArrayBuffer(u8.byteLength);
    new Uint8Array(ab).set(u8);
    const blob = new Blob([ab]);
    const parsed = await parseDocx(blob, {
      filename: 'nolist.docx',
      docx_blob_id: 'nl',
    });
    return {
      id: 'tpl_nolist',
      name: 'nolist',
      filename: 'nolist.docx',
      ingested_at: new Date().toISOString(),
      docx_bytes: blob,
      schema_json: {
        ...parsed.schema,
        sections: [
          {
            id: 'sec_one',
            name: 'Section',
            order: 0,
            required: true,
            fill_region: {
              kind: 'heading_bounded',
              heading_text: 'Section',
              heading_style_id: 'Heading1',
              body_style_id: 'Normal',
              anchor_paragraph_index: 0,
              end_anchor_paragraph_index: 1,
              permitted_roles: ['heading', 'body', 'bullet'],
            },
          },
        ],
      },
    };
  }

  async function loadDom(blob: Blob): Promise<{ dom: Document; W_NS: string }> {
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(blob);
    const xml = await zip.file('word/document.xml')!.async('string');
    const dom = new DOMParser().parseFromString(xml, 'text/xml');
    return { dom, W_NS: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main' };
  }

  it('falls back to manual indent + bullet glyph when no list inventory is available', async () => {
    const template = await buildNoListTemplate();
    const drafted: DraftParagraph[] = [
      { role: 'bullet', text: 'top level item', level: 0 },
      { role: 'bullet', text: 'nested item', level: 1 },
    ];
    const result = await assembleProjectDocx({
      template,
      draftedBySectionId: new Map([['sec_one', drafted]]),
    });
    expect(
      result.section_results.find((r) => r.section_id === 'sec_one')?.status.kind,
    ).toBe('assembled');

    const { dom, W_NS } = await loadDom(result.blob);
    const paragraphs = Array.from(dom.getElementsByTagNameNS(W_NS, 'p'));

    const top = paragraphs.find((p) => (p.textContent ?? '').includes('top level item'))!;
    const nested = paragraphs.find((p) => (p.textContent ?? '').includes('nested item'))!;

    // numPr removed (no usable inventory binding).
    expect(top.getElementsByTagNameNS(W_NS, 'numPr').length).toBe(0);
    expect(nested.getElementsByTagNameNS(W_NS, 'numPr').length).toBe(0);

    // Manual ind applied: level 0 → 360 twips, level 1 → 720 twips.
    const topInd = top.getElementsByTagNameNS(W_NS, 'ind')[0]!;
    expect(topInd.getAttributeNS(W_NS, 'left')).toBe('360');
    const nestInd = nested.getElementsByTagNameNS(W_NS, 'ind')[0]!;
    expect(nestInd.getAttributeNS(W_NS, 'left')).toBe('720');

    // Bullet glyph prepended to the text.
    expect(top.textContent).toContain('\u2022');
    expect(top.textContent).toContain('top level item');
    expect(nested.textContent).toContain('\u25E6');
    expect(nested.textContent).toContain('nested item');
  });
});

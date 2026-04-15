import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseDocx } from './index';
import { classifyParagraph } from './document';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function pFromXml(inner: string): Element {
  const xml = `<w:p xmlns:w="${W_NS}">${inner}</w:p>`;
  return new DOMParser().parseFromString(xml, 'text/xml').documentElement;
}

const FIXTURES = resolve(__dirname, '../../../test/fixtures');

const DHA_PUBLICATION = 'synthetic-publication.docx';
const DHA_POLICY_MEMO = 'synthetic-memo.docx';

function loadFixture(name: string): Uint8Array {
  const buf = readFileSync(resolve(FIXTURES, name));
  // Return a fresh Uint8Array. Avoid Node Buffer / jsdom ArrayBuffer
  // identity issues by copying into a brand-new buffer that jsdom owns.
  const u8 = new Uint8Array(buf.byteLength);
  u8.set(buf);
  return u8;
}

describe('parseDocx — synthetic templates', () => {
  describe(DHA_PUBLICATION, () => {
    it('parses without throwing and returns a complete TemplateSchema', async () => {
      const bytes = loadFixture(DHA_PUBLICATION);
      const { schema, docx_blob } = await parseDocx(bytes, {
        filename: DHA_PUBLICATION,
        docx_blob_id: 'fixture://publication',
      });

      expect(schema.$schema).toBeTruthy();
      expect(schema.source.filename).toBe(DHA_PUBLICATION);
      expect(schema.source.structural_parser_version).toBe('0.1.0');
      expect(schema.source.semantic_synthesizer).toBeNull();
      expect(docx_blob.size).toBeGreaterThan(0);
    });

    it('extracts page setup from sectPr', async () => {
      const { schema } = await parseDocx(loadFixture(DHA_PUBLICATION), {
        filename: DHA_PUBLICATION,
        docx_blob_id: 'fixture://publication',
      });
      const ps = schema.formatting.page_setup;
      // We don't assert specific values (DHA template could change), but
      // every dimension must be a positive integer and orientation valid.
      expect(['letter', 'a4', 'legal', 'unknown']).toContain(ps.paper);
      expect(['portrait', 'landscape']).toContain(ps.orientation);
      expect(ps.margins_twips.top).toBeGreaterThan(0);
      expect(ps.margins_twips.right).toBeGreaterThan(0);
      expect(ps.margins_twips.bottom).toBeGreaterThan(0);
      expect(ps.margins_twips.left).toBeGreaterThan(0);
    });

    it('extracts named styles', async () => {
      const { schema } = await parseDocx(loadFixture(DHA_PUBLICATION), {
        filename: DHA_PUBLICATION,
        docx_blob_id: 'fixture://publication',
      });
      // A real DHA template has dozens of styles
      expect(schema.formatting.named_styles.length).toBeGreaterThan(5);
      // Should include at least one heading style
      const headings = schema.formatting.named_styles.filter(
        (s) => /^Heading/i.test(s.name) || /^Heading/i.test(s.id),
      );
      expect(headings.length).toBeGreaterThan(0);
    });

    it('captures alignment and indent on style definitions when present', async () => {
      const { schema } = await parseDocx(loadFixture(DHA_PUBLICATION), {
        filename: DHA_PUBLICATION,
        docx_blob_id: 'fixture://publication',
      });
      // At least one style in the template defines either an alignment
      // or an indent — without this, paragraphs that inherit those
      // values would lose them on the way through the parser.
      const hasAlignmentOrIndent = schema.formatting.named_styles.some(
        (s) =>
          s.alignment !== null ||
          s.indent_left_twips !== null ||
          s.indent_first_line_twips !== null ||
          s.indent_hanging_twips !== null,
      );
      expect(hasAlignmentOrIndent).toBe(true);
    });

    it('resolves style-inherited alignment and indent onto each paragraph', async () => {
      const { paragraphs, schema } = await parseDocx(loadFixture(DHA_PUBLICATION), {
        filename: DHA_PUBLICATION,
        docx_blob_id: 'fixture://publication',
      });
      // Find a style that defines an alignment or indent and pick a
      // paragraph that uses it. After the inherited-formatting pass,
      // that paragraph must show the inherited value even if its own
      // pPr didn't specify it.
      const formattedStyle = schema.formatting.named_styles.find(
        (s) =>
          s.alignment !== null ||
          (s.indent_left_twips !== null && s.indent_left_twips > 0),
      );
      if (!formattedStyle) {
        // No formatted styles in this fixture — nothing to assert.
        return;
      }
      const sample = paragraphs.find((p) => p.style_id === formattedStyle.id);
      if (!sample) return;
      if (formattedStyle.alignment !== null) {
        expect(sample.alignment).toBe(formattedStyle.alignment);
      }
      if (formattedStyle.indent_left_twips !== null) {
        expect(sample.indent_left_twips).toBe(formattedStyle.indent_left_twips);
      }
    });

    it('lists header and footer parts', async () => {
      const { schema } = await parseDocx(loadFixture(DHA_PUBLICATION), {
        filename: DHA_PUBLICATION,
        docx_blob_id: 'fixture://publication',
      });
      // The Publication template has 1 header and 8 footers per the
      // zip listing. The parser only enumerates parts at top level
      // (word/headerN.xml, word/footerN.xml).
      expect(schema.formatting.headers.length).toBeGreaterThanOrEqual(1);
      expect(schema.formatting.footers.length).toBeGreaterThanOrEqual(1);
    });

    it('produces at least one body fill region (heading-bounded fallback)', async () => {
      const { schema } = await parseDocx(loadFixture(DHA_PUBLICATION), {
        filename: DHA_PUBLICATION,
        docx_blob_id: 'fixture://publication',
      });
      // Either content controls give us body regions, OR heading-bounded
      // sections do. We just need at least one body region.
      expect(schema.sections.length).toBeGreaterThan(0);
    });
  });

  describe(DHA_POLICY_MEMO, () => {
    it('parses without throwing', async () => {
      const { schema } = await parseDocx(loadFixture(DHA_POLICY_MEMO), {
        filename: DHA_POLICY_MEMO,
        docx_blob_id: 'fixture://memo',
      });
      expect(schema.source.filename).toBe(DHA_POLICY_MEMO);
      expect(schema.formatting.named_styles.length).toBeGreaterThan(0);
    });

    it('extracts numbering definitions if present', async () => {
      const { schema } = await parseDocx(loadFixture(DHA_POLICY_MEMO), {
        filename: DHA_POLICY_MEMO,
        docx_blob_id: 'fixture://memo',
      });
      // The fixture has word/numbering.xml so we expect at least one def.
      expect(schema.formatting.numbering_definitions.length).toBeGreaterThan(0);
      const def = schema.formatting.numbering_definitions[0]!;
      expect(def.id).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(def.levels)).toBe(true);
    });

    it('produces at least one body section (whole-body fallback when no headings/sdt)', async () => {
      const { schema } = await parseDocx(loadFixture(DHA_POLICY_MEMO), {
        filename: DHA_POLICY_MEMO,
        docx_blob_id: 'fixture://memo',
      });
      // The memo template uses neither OOXML heading styles nor body
      // content controls, so the parser falls back to a single
      // whole-document section. Section breakdown for memos is the
      // LLM's job at synthesis time, not the parser's.
      expect(schema.sections.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('synthetic-pws.docx', () => {
    const NAME = 'synthetic-pws.docx';

    it('parses without throwing', async () => {
      const { schema, paragraphs } = await parseDocx(loadFixture(NAME), {
        filename: NAME,
        docx_blob_id: 'fixture://pws',
      });
      expect(schema.formatting.named_styles.length).toBeGreaterThan(0);
      // Sanity: PWS is a large template with many paragraphs
      expect(paragraphs.length).toBeGreaterThan(100);
    });

    it('extracts content controls into metadata_fill_regions', async () => {
      const { schema } = await parseDocx(loadFixture(NAME), {
        filename: NAME,
        docx_blob_id: 'fixture://pws',
      });
      // The PWS template has explicit content controls for metadata
      // (CUI banner, doc number, dates, etc.). These should be picked
      // up deterministically by the parser regardless of the LLM.
      expect(schema.metadata_fill_regions.length).toBeGreaterThan(0);
    });

    it('produces at least one body section (LLM owns the breakdown)', async () => {
      const { schema } = await parseDocx(loadFixture(NAME), {
        filename: NAME,
        docx_blob_id: 'fixture://pws',
      });
      // Whether the parser produces 1 (whole-body fallback), 2 (one
      // stray Heading1), or many sections, there must be at least one.
      // Real section breakdown is the LLM's responsibility.
      expect(schema.sections.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('synthetic-mrr.docx', () => {
    const NAME = 'synthetic-mrr.docx';

    it('parses without throwing and yields a body section', async () => {
      const { schema } = await parseDocx(loadFixture(NAME), {
        filename: NAME,
        docx_blob_id: 'fixture://mrr',
      });
      expect(schema.formatting.named_styles.length).toBeGreaterThan(0);
      expect(schema.sections.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('rejects bytes that are not a DOCX', async () => {
    const notADocx = new TextEncoder().encode('this is not a docx');
    await expect(
      parseDocx(notADocx, {
        filename: 'fake.docx',
        docx_blob_id: 'fixture://fake',
      }),
    ).rejects.toThrow();
  });

  describe('header and footer parts', () => {
    it('parses header part contents into ParagraphInfo lists for the policy memo', async () => {
      const result = await parseDocx(loadFixture(DHA_POLICY_MEMO), {
        filename: DHA_POLICY_MEMO,
        docx_blob_id: 'fixture://memo',
      });
      expect(result.header_parts.length).toBeGreaterThan(0);
      const totalHeaderParas = result.header_parts.reduce(
        (acc, hp) => acc + hp.paragraphs.length,
        0,
      );
      expect(totalHeaderParas).toBeGreaterThan(0);
    });

    it('parses footer part contents into ParagraphInfo lists for the policy memo', async () => {
      const result = await parseDocx(loadFixture(DHA_POLICY_MEMO), {
        filename: DHA_POLICY_MEMO,
        docx_blob_id: 'fixture://memo',
      });
      expect(result.footer_parts.length).toBeGreaterThan(0);
      const totalFooterParas = result.footer_parts.reduce(
        (acc, fp) => acc + fp.paragraphs.length,
        0,
      );
      expect(totalFooterParas).toBeGreaterThan(0);
    });

    it('header part labels are derived from the part filename', async () => {
      const result = await parseDocx(loadFixture(DHA_POLICY_MEMO), {
        filename: DHA_POLICY_MEMO,
        docx_blob_id: 'fixture://memo',
      });
      for (const hp of result.header_parts) {
        expect(hp.label).toMatch(/^header\d+$/i);
        expect(hp.part).toMatch(/^word\/header\d+\.xml$/);
      }
    });
  });
});

describe('classifyParagraph', () => {
  it('flags drawing-bearing paragraphs', () => {
    const p = pFromXml('<w:r><w:drawing/></w:r>');
    expect(classifyParagraph(p)).toEqual({
      has_drawing: true,
      has_complex_content: false,
    });
  });

  it('flags pict and object as drawings', () => {
    expect(classifyParagraph(pFromXml('<w:r><w:pict/></w:r>')).has_drawing).toBe(true);
    expect(classifyParagraph(pFromXml('<w:r><w:object/></w:r>')).has_drawing).toBe(true);
  });

  it('flags sdt, footnoteReference, endnoteReference, and fldChar as complex', () => {
    expect(classifyParagraph(pFromXml('<w:sdt/>')).has_complex_content).toBe(true);
    expect(classifyParagraph(pFromXml('<w:r><w:footnoteReference/></w:r>')).has_complex_content).toBe(true);
    expect(classifyParagraph(pFromXml('<w:r><w:endnoteReference/></w:r>')).has_complex_content).toBe(true);
    expect(classifyParagraph(pFromXml('<w:r><w:fldChar/></w:r>')).has_complex_content).toBe(true);
  });

  it('returns {false, false} for plain text paragraphs', () => {
    expect(classifyParagraph(pFromXml('<w:r><w:t>hello</w:t></w:r>'))).toEqual({
      has_drawing: false,
      has_complex_content: false,
    });
  });
});

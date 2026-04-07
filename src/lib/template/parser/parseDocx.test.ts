import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseDocx } from './index';

const FIXTURES = resolve(__dirname, '../../../test/fixtures');

const DHA_PUBLICATION = 'DHA Publication Template (updated 09.13.23).docx';
const DHA_POLICY_MEMO = 'DHA-Policy Memo Template (April 8 2025).docx';

function loadFixture(name: string): Uint8Array {
  const buf = readFileSync(resolve(FIXTURES, name));
  // Return a fresh Uint8Array. Avoid Node Buffer / jsdom ArrayBuffer
  // identity issues by copying into a brand-new buffer that jsdom owns.
  const u8 = new Uint8Array(buf.byteLength);
  u8.set(buf);
  return u8;
}

describe('parseDocx — real DHA templates', () => {
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
});

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseDocx } from '../parser';
import { extractFullBody, DEFAULT_FULL_BODY_CAP } from './sample';

const FIXTURES = resolve(__dirname, '../../../test/fixtures');
const DHA_PWS = 'synthetic-pws.docx';

function loadFixture(name: string): Uint8Array {
  const buf = readFileSync(resolve(FIXTURES, name));
  const u8 = new Uint8Array(buf.byteLength);
  u8.set(buf);
  return u8;
}

describe('extractFullBody — body truncation cap', () => {
  it('default cap accommodates the full DHA PWS template (regression for the part-2 truncation bug)', async () => {
    const { paragraphs, schema } = await parseDocx(loadFixture(DHA_PWS), {
      filename: DHA_PWS,
      docx_blob_id: 'fixture://pws',
    });
    const body = extractFullBody(paragraphs, schema);

    // Every significant paragraph from the document must fit. The PWS
    // template is ~84k chars / ~1k significant paragraphs. The previous
    // 40k cap silently dropped roughly the back half ("only went up to
    // part 2").
    expect(body.truncated).toBe(false);
    expect(body.lines.length).toBe(body.total_paragraphs);
    expect(body.total_paragraphs).toBeGreaterThan(200);
  });

  it('truncates and reports it when the cap is intentionally tiny', async () => {
    const { paragraphs, schema } = await parseDocx(loadFixture(DHA_PWS), {
      filename: DHA_PWS,
      docx_blob_id: 'fixture://pws',
    });
    const body = extractFullBody(paragraphs, schema, { body_cap_chars: 5_000 });
    expect(body.truncated).toBe(true);
    expect(body.lines.length).toBeLessThan(body.total_paragraphs);
  });

  it('default cap is sized for a 200k context model with comfortable headroom', () => {
    // Sanity-check that nobody dropped the cap back to 40k. The PWS
    // template is the canonical "make sure this fits" benchmark.
    expect(DEFAULT_FULL_BODY_CAP).toBeGreaterThanOrEqual(200_000);
  });
});

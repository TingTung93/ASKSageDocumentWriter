import { describe, expect, it } from 'vitest';
import {
  base64ToBlob,
  blobToBase64,
  buildProjectBundle,
  buildTemplateBundle,
  validateBundle,
  BUNDLE_VERSION,
  type TemplateBundle,
} from './bundle';
import type { DraftRecord, ProjectRecord, TemplateRecord } from '../db/schema';
import type { TemplateSchema } from '../template/types';

const STUB_SCHEMA: TemplateSchema = {
  $schema: 'asd-template-schema-1',
  id: 'tpl_stub',
  name: 'Stub',
  version: 1,
  source: {
    filename: 'stub.docx',
    ingested_at: '2026-04-01T00:00:00.000Z',
    structural_parser_version: '0.1.0',
    semantic_synthesizer: null,
    docx_blob_id: 'mem://stub',
  },
  formatting: {
    page_setup: {
      paper: 'letter',
      orientation: 'portrait',
      margins_twips: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
      header_distance: 720,
      footer_distance: 720,
    },
    default_font: { family: null, size_pt: null },
    theme: null,
    named_styles: [],
    numbering_definitions: [],
    headers: [],
    footers: [],
  },
  metadata_fill_regions: [],
  sections: [],
  style: {
    voice: null,
    tense: null,
    register: null,
    jargon_policy: null,
    banned_phrases: [],
  },
};

function makeTemplate(id: string, name: string): TemplateRecord {
  // 16 bytes of dummy DOCX content. Real DOCX bytes are tested in the
  // round-trip test that uses an actual fixture.
  const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
  return {
    id,
    name,
    filename: `${name}.docx`,
    ingested_at: '2026-04-01T00:00:00.000Z',
    docx_bytes: new Blob([bytes]),
    schema_json: { ...STUB_SCHEMA, id, name },
  };
}

describe('share bundle', () => {
  it('round-trips a template bundle through base64 + JSON', async () => {
    const tpl = makeTemplate('tpl_a', 'Alpha');
    const bundle = await buildTemplateBundle(tpl);

    expect(bundle.kind).toBe('template');
    expect(bundle.bundle_version).toBe(BUNDLE_VERSION);
    expect(bundle.template.id).toBe('tpl_a');
    expect(bundle.template.docx_base64.length).toBeGreaterThan(0);

    const json = JSON.stringify(bundle);
    const reparsed = JSON.parse(json);
    const validated = validateBundle(reparsed) as TemplateBundle;
    expect(validated.template.name).toBe('Alpha');

    // Decode the bytes and verify they match the original. We
    // re-encode to base64 (jsdom-friendly path) and compare strings
    // instead of touching the Blob's arrayBuffer().
    const restoredB64 = await blobToBase64(base64ToBlob(validated.template.docx_base64));
    expect(restoredB64).toBe(validated.template.docx_base64);
  });

  it('builds a project bundle that includes every referenced template', async () => {
    const t1 = makeTemplate('tpl_1', 'PWS');
    const t2 = makeTemplate('tpl_2', 'MarketResearch');
    const project: ProjectRecord = {
      id: 'proj_x',
      name: 'Liaison MDX',
      description: 'maintenance contract',
      template_ids: ['tpl_1', 'tpl_2'],
      reference_dataset_names: ['far-clauses'],
      shared_inputs: { cui_banner: 'CUI' },
      model_overrides: {},
      live_search: 0,
      created_at: '2026-04-01T00:00:00.000Z',
      updated_at: '2026-04-02T00:00:00.000Z',
    };

    const bundle = await buildProjectBundle(project, [t1, t2], []);
    expect(bundle.kind).toBe('project');
    expect(bundle.templates).toHaveLength(2);
    expect(bundle.project.template_ids).toEqual(['tpl_1', 'tpl_2']);
    expect(bundle.drafts).toBeUndefined();
  });

  it('includes drafts when includeDrafts is set', async () => {
    const t = makeTemplate('tpl_d', 'D');
    const project: ProjectRecord = {
      id: 'p',
      name: 'P',
      description: '',
      template_ids: ['tpl_d'],
      reference_dataset_names: [],
      shared_inputs: {},
      model_overrides: {},
      live_search: 0,
      created_at: '',
      updated_at: '',
    };
    const draft: DraftRecord = {
      id: 'p::tpl_d::s1',
      project_id: 'p',
      template_id: 'tpl_d',
      section_id: 's1',
      paragraphs: [{ role: 'body', text: 'hello' }],
      references: '',
      status: 'ready',
      generated_at: '2026-04-02T00:00:00.000Z',
      model: 'google-claude-46-sonnet',
      tokens_in: 100,
      tokens_out: 50,
    };
    const bundle = await buildProjectBundle(project, [t], [draft], { includeDrafts: true });
    expect(bundle.drafts).toHaveLength(1);
    expect(bundle.drafts?.[0]?.section_id).toBe('s1');
  });

  it('rejects bundles with unknown future versions', () => {
    expect(() =>
      validateBundle({ bundle_version: 999, kind: 'template', template: {} }),
    ).toThrow(/version 999/);
  });

  it('rejects malformed bundles with precise messages', () => {
    expect(() => validateBundle(null)).toThrow(/JSON object/);
    expect(() => validateBundle({})).toThrow(/bundle_version/);
    expect(() =>
      validateBundle({ bundle_version: 1, kind: 'template' }),
    ).toThrow(/template/);
    expect(() =>
      validateBundle({ bundle_version: 1, kind: 'unknown' }),
    ).toThrow(/Unknown bundle kind/);
  });

  it('blobToBase64 handles large blobs via the chunked-encode path', async () => {
    // 100 KB of pseudo-random bytes — exercises the chunked-encode path.
    // We can't read the round-tripped Blob back via arrayBuffer() under
    // jsdom, so we re-encode and compare base64 strings instead.
    const bytes = new Uint8Array(100_000);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 37) & 0xff;
    const b64Once = await blobToBase64(new Blob([bytes]));
    const b64Twice = await blobToBase64(base64ToBlob(b64Once));
    expect(b64Twice).toBe(b64Once);
    // Reasonable size sanity: ceil(100000 / 3) * 4 = 133336 chars.
    expect(b64Once.length).toBeGreaterThan(133_000);
  });
});

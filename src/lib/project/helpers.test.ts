import { describe, it, expect } from 'vitest';
import { deriveSharedInputFields } from './helpers';
import type { TemplateRecord } from '../db/schema';
import type { TemplateSchema, MetadataFillRegion } from '../template/types';

function makeTemplate(id: string, name: string, metadata: MetadataFillRegion[]): TemplateRecord {
  const schema: TemplateSchema = {
    $schema: 'test',
    id,
    name,
    version: 1,
    source: {
      filename: `${id}.docx`,
      ingested_at: '2026-04-07T20:00:00Z',
      structural_parser_version: '0.1.0',
      semantic_synthesizer: null,
      docx_blob_id: `docx://${id}`,
    },
    formatting: {
      page_setup: {
        paper: 'letter',
        orientation: 'portrait',
        margins_twips: { top: 0, right: 0, bottom: 0, left: 0 },
        header_distance: 0,
        footer_distance: 0,
      },
      default_font: { family: null, size_pt: null },
      theme: null,
      named_styles: [],
      numbering_definitions: [],
      headers: [],
      footers: [],
    },
    metadata_fill_regions: metadata,
    sections: [],
    style: {
      voice: null,
      tense: null,
      register: null,
      jargon_policy: null,
      banned_phrases: [],
    },
  };
  return {
    id,
    name,
    filename: `${id}.docx`,
    ingested_at: '2026-04-07T20:00:00Z',
    docx_bytes: new Blob(),
    schema_json: schema,
  };
}

const cuiBanner: MetadataFillRegion = {
  id: 'cui_banner',
  kind: 'content_control',
  control_type: 'dropdown',
  allowed_values: ['UNCLASSIFIED', 'CUI'],
  project_input_field: 'cui_banner',
  required: true,
};

const docNumber: MetadataFillRegion = {
  id: 'doc_number',
  kind: 'content_control',
  control_type: 'plain_text',
  project_input_field: 'document_number',
  required: false,
};

describe('deriveSharedInputFields', () => {
  it('returns an empty list for no templates', () => {
    expect(deriveSharedInputFields([])).toEqual([]);
  });

  it('produces one entry per metadata fill region', () => {
    const tpl = makeTemplate('a', 'A', [cuiBanner, docNumber]);
    const fields = deriveSharedInputFields([tpl]);
    expect(fields).toHaveLength(2);
    expect(fields.find((f) => f.key === 'cui_banner')).toBeDefined();
    expect(fields.find((f) => f.key === 'document_number')).toBeDefined();
  });

  it('deduplicates fields that appear in multiple templates', () => {
    const a = makeTemplate('a', 'A', [cuiBanner]);
    const b = makeTemplate('b', 'B', [cuiBanner]);
    const fields = deriveSharedInputFields([a, b]);
    expect(fields).toHaveLength(1);
    expect(fields[0]!.template_ids).toEqual(['a', 'b']);
  });

  it('unions allowed_values across templates with the same field', () => {
    const a = makeTemplate('a', 'A', [
      { ...cuiBanner, allowed_values: ['UNCLASSIFIED', 'CUI'] },
    ]);
    const b = makeTemplate('b', 'B', [
      { ...cuiBanner, allowed_values: ['CUI', 'CUI//SP-PRVCY'] },
    ]);
    const fields = deriveSharedInputFields([a, b]);
    expect(fields[0]!.allowed_values).toContain('UNCLASSIFIED');
    expect(fields[0]!.allowed_values).toContain('CUI');
    expect(fields[0]!.allowed_values).toContain('CUI//SP-PRVCY');
  });

  it('marks the merged field required if any source was required', () => {
    const a = makeTemplate('a', 'A', [{ ...docNumber, required: false }]);
    const b = makeTemplate('b', 'B', [{ ...docNumber, required: true }]);
    const fields = deriveSharedInputFields([a, b]);
    expect(fields[0]!.required).toBe(true);
  });
});

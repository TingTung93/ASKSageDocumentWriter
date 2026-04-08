// Tests for the Phase 2 pre-flight module. We never call a real LLM
// here — a tiny MockLLMClient lets each test inject a fixed JSON
// payload that the module would normally receive from /server/query.
//
// The structural fields (missing_shared_inputs, ready_to_draft) are
// computed by the module and asserted directly. The LLM-derived fields
// (coverage, vague_subject, actions) are asserted to be parsed and
// passed through correctly.

import { describe, it, expect } from 'vitest';
import {
  runReadinessCheck,
  suggestTemplate,
  proposeSharedInputs,
} from './preflight';
import type { LLMClient } from '../provider/types';
import type { QueryInput, QueryResponse } from '../asksage/types';
import type { ProjectRecord, TemplateRecord, ProjectContextFile } from '../db/schema';
import type { TemplateSchema, MetadataFillRegion } from '../template/types';
import type { SharedInputField } from '../project/helpers';

// ─── Mock LLMClient ──────────────────────────────────────────────────

interface CapturedCall {
  input: QueryInput;
}

class MockLLMClient implements LLMClient {
  public readonly calls: CapturedCall[] = [];
  constructor(private readonly fixedData: unknown) {}

  async getModels() {
    return [];
  }

  async query(input: QueryInput): Promise<QueryResponse> {
    this.calls.push({ input });
    return {
      message: JSON.stringify(this.fixedData),
      response: '',
      status: 200,
      uuid: 'mock',
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    };
  }

  async queryJson<T>(input: QueryInput): Promise<{ data: T; raw: QueryResponse }> {
    this.calls.push({ input });
    const raw: QueryResponse = {
      message: JSON.stringify(this.fixedData),
      response: '',
      status: 200,
      uuid: 'mock',
      usage: { prompt_tokens: 123, completion_tokens: 45 },
    };
    return { data: this.fixedData as T, raw };
  }
}

// ─── Fixtures ────────────────────────────────────────────────────────

function makeMetadataField(
  key: string,
  required: boolean,
): MetadataFillRegion {
  return {
    id: `meta_${key}`,
    kind: 'content_control',
    sdt_tag: key,
    control_type: 'plain_text',
    project_input_field: key,
    required,
  };
}

function makeTemplate(
  id: string,
  name: string,
  sectionIds: string[],
  metadataFields: MetadataFillRegion[] = [],
): TemplateRecord {
  const schema: TemplateSchema = {
    $schema: 'test',
    id,
    name,
    version: 1,
    source: {
      filename: `${id}.docx`,
      ingested_at: '2026-04-07T00:00:00Z',
      structural_parser_version: '0.1.0',
      semantic_synthesizer: null,
      docx_blob_id: `docx://${id}`,
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
    metadata_fill_regions: metadataFields,
    sections: sectionIds.map((sid, i) => ({
      id: sid,
      name: `Section ${sid}`,
      order: i,
      required: true,
      fill_region: {
        kind: 'heading_bounded' as const,
        heading_text: '',
        heading_style_id: null,
        body_style_id: null,
        anchor_paragraph_index: i,
        end_anchor_paragraph_index: i + 1,
        permitted_roles: ['body'],
      },
      intent: `Subject-agnostic intent for ${sid}.`,
    })),
    style: {
      voice: 'third_person',
      tense: 'present',
      register: 'formal_government',
      jargon_policy: null,
      banned_phrases: [],
    },
  };
  return {
    id,
    name,
    filename: `${id}.docx`,
    ingested_at: '2026-04-07T00:00:00Z',
    docx_bytes: new Blob([]),
    schema_json: schema,
  };
}

function makeProject(
  description: string,
  shared_inputs: Record<string, string>,
  template_ids: string[],
): ProjectRecord {
  return {
    id: 'proj1',
    name: 'Test Project',
    description,
    template_ids,
    reference_dataset_names: [],
    shared_inputs,
    model_overrides: {},
    live_search: 0,
    created_at: '2026-04-07T00:00:00Z',
    updated_at: '2026-04-07T00:00:00Z',
  };
}

function makeReferenceFile(filename: string): ProjectContextFile {
  return {
    kind: 'file',
    id: `f_${filename}`,
    filename,
    mime_type: 'application/pdf',
    size_bytes: 1234,
    bytes: new Blob([]),
    created_at: '2026-04-07T00:00:00Z',
  };
}

// ─── runReadinessCheck ───────────────────────────────────────────────

describe('runReadinessCheck', () => {
  it('computes missing_shared_inputs deterministically (not from the LLM)', async () => {
    const tpl = makeTemplate('t1', 'PWS', ['scope', 'requirements'], [
      makeMetadataField('document_number', true),
      makeMetadataField('cui_banner', true),
      makeMetadataField('optional_field', false),
    ]);
    const project = makeProject(
      'Performance work statement for laboratory equipment maintenance services covering twelve months.',
      { cui_banner: 'CUI' }, // document_number missing, optional_field missing-but-not-required
      ['t1'],
    );

    // The mock returns an LLM payload that LIES about missing inputs —
    // we want to prove the module ignores it and computes its own.
    const client = new MockLLMClient({
      vague_subject: false,
      subject_warnings: [],
      coverage: [
        {
          template_id: 't1',
          template_name: 'PWS',
          covered_sections: ['scope'],
          thin_coverage_sections: ['requirements'],
          no_coverage_sections: [],
        },
      ],
      actions: [],
      // These should be IGNORED by the module — model output garbage on purpose.
      missing_shared_inputs: ['totally_made_up'],
      ready_to_draft: true,
    });

    const report = await runReadinessCheck(client, {
      project,
      templates: [tpl],
      reference_files: [],
    });

    expect(report.missing_shared_inputs).toEqual(['document_number']);
    expect(report.missing_shared_inputs).not.toContain('totally_made_up');
    expect(report.missing_shared_inputs).not.toContain('optional_field');
    // Subject is fine + nothing required missing => not ready (still missing document_number)
    expect(report.ready_to_draft).toBe(false);
  });

  it('parses the LLM payload into the typed report shape', async () => {
    const tpl = makeTemplate('t1', 'PWS', ['scope', 'requirements']);
    const project = makeProject(
      'Performance work statement for laboratory equipment maintenance services.',
      {},
      ['t1'],
    );

    const client = new MockLLMClient({
      vague_subject: false,
      subject_warnings: [],
      coverage: [
        {
          template_id: 't1',
          template_name: 'PWS',
          covered_sections: ['scope'],
          thin_coverage_sections: [],
          no_coverage_sections: ['requirements'],
        },
      ],
      actions: [
        {
          severity: 'warning',
          message: 'No reference covers performance requirements.',
          hint: { kind: 'attach_reference', section: 'requirements' },
        },
      ],
    });

    const report = await runReadinessCheck(client, {
      project,
      templates: [tpl],
      reference_files: [makeReferenceFile('quote_sheet.pdf')],
    });

    expect(report.coverage).toHaveLength(1);
    expect(report.coverage[0]?.template_id).toBe('t1');
    expect(report.coverage[0]?.covered_sections).toEqual(['scope']);
    expect(report.coverage[0]?.no_coverage_sections).toEqual(['requirements']);
    expect(report.actions).toHaveLength(1);
    expect(report.actions[0]?.severity).toBe('warning');
    expect(report.actions[0]?.hint).toEqual({
      kind: 'attach_reference',
      section: 'requirements',
    });
    expect(report.tokens_in).toBe(123);
    expect(report.tokens_out).toBe(45);
    // No required metadata fields, no errors, not vague => ready.
    expect(report.ready_to_draft).toBe(true);
  });

  it('fills in missing template coverage rows when the LLM drops one', async () => {
    const t1 = makeTemplate('t1', 'PWS', ['scope']);
    const t2 = makeTemplate('t2', 'JA', ['justification']);
    const project = makeProject(
      'Sole-source justification for proprietary reagents used by an existing instrument.',
      {},
      ['t1', 't2'],
    );

    // LLM only returns coverage for t1 — we should still get a row for t2.
    const client = new MockLLMClient({
      vague_subject: false,
      subject_warnings: [],
      coverage: [
        {
          template_id: 't1',
          template_name: 'PWS',
          covered_sections: ['scope'],
          thin_coverage_sections: [],
          no_coverage_sections: [],
        },
      ],
      actions: [],
    });

    const report = await runReadinessCheck(client, {
      project,
      templates: [t1, t2],
      reference_files: [],
    });
    expect(report.coverage.map((c) => c.template_id).sort()).toEqual(['t1', 't2']);
    const t2cov = report.coverage.find((c) => c.template_id === 't2');
    expect(t2cov?.no_coverage_sections).toEqual(['justification']);
  });

  it('marks ready_to_draft false when an error-severity action is present', async () => {
    const tpl = makeTemplate('t1', 'PWS', ['scope']);
    const project = makeProject('A reasonable subject sentence with enough detail.', {}, ['t1']);

    const client = new MockLLMClient({
      vague_subject: false,
      subject_warnings: [],
      coverage: [],
      actions: [
        { severity: 'error', message: 'Catastrophic mismatch.' },
      ],
    });

    const report = await runReadinessCheck(client, {
      project,
      templates: [tpl],
      reference_files: [],
    });
    expect(report.ready_to_draft).toBe(false);
  });

  it('passes temperature 0 and the strict-JSON system prompt to the client', async () => {
    const tpl = makeTemplate('t1', 'PWS', ['scope']);
    const project = makeProject('Subject.', {}, ['t1']);
    const client = new MockLLMClient({
      vague_subject: false,
      subject_warnings: [],
      coverage: [],
      actions: [],
    });
    await runReadinessCheck(client, {
      project,
      templates: [tpl],
      reference_files: [],
    });
    expect(client.calls).toHaveLength(1);
    const call = client.calls[0]!;
    expect(call.input.temperature).toBe(0);
    expect(call.input.system_prompt).toMatch(/STRICT JSON/);
  });
});

// ─── suggestTemplate ─────────────────────────────────────────────────

describe('suggestTemplate', () => {
  it('returns null when no templates are available', async () => {
    const client = new MockLLMClient({});
    const project = makeProject('Anything.', {}, []);
    const result = await suggestTemplate(client, {
      project,
      templates: [],
      reference_files: [],
    });
    expect(result).toBeNull();
    // Should NOT have called the LLM at all.
    expect(client.calls).toHaveLength(0);
  });

  it('returns the model-picked template with confidence and reasoning', async () => {
    const t1 = makeTemplate('t1', 'PWS', ['scope']);
    const t2 = makeTemplate('t2', 'Justification & Approval', ['justification']);
    const project = makeProject(
      'Sole-source justification for replacement parts on an existing instrument.',
      {},
      [],
    );

    const client = new MockLLMClient({
      template_id: 't2',
      confidence: 0.92,
      reasoning: 'User asked for a sole-source justification and the J&A template matches that document type.',
    });

    const result = await suggestTemplate(client, {
      project,
      templates: [t1, t2],
      reference_files: [],
    });
    expect(result).not.toBeNull();
    expect(result?.template_id).toBe('t2');
    expect(result?.template_name).toBe('Justification & Approval');
    expect(result?.confidence).toBeCloseTo(0.92);
    expect(result?.reasoning).toMatch(/document type/);
  });

  it('clamps out-of-range confidence into [0, 1]', async () => {
    const t1 = makeTemplate('t1', 'PWS', ['scope']);
    const project = makeProject('PWS for stuff.', {}, []);
    const client = new MockLLMClient({
      template_id: 't1',
      confidence: 5.0,
      reasoning: 'ok',
    });
    const result = await suggestTemplate(client, {
      project,
      templates: [t1],
      reference_files: [],
    });
    expect(result?.confidence).toBe(1);
  });

  it('falls back to the first template with zero confidence on unknown id', async () => {
    const t1 = makeTemplate('t1', 'PWS', ['scope']);
    const project = makeProject('PWS for stuff.', {}, []);
    const client = new MockLLMClient({
      template_id: 'does_not_exist',
      confidence: 0.8,
      reasoning: 'wrong id',
    });
    const result = await suggestTemplate(client, {
      project,
      templates: [t1],
      reference_files: [],
    });
    expect(result?.template_id).toBe('t1');
    expect(result?.confidence).toBe(0);
  });
});

// ─── proposeSharedInputs ─────────────────────────────────────────────

describe('proposeSharedInputs', () => {
  function makeField(key: string): SharedInputField {
    return {
      key,
      display_name: key.replace(/_/g, ' '),
      control_type: 'plain_text',
      required: true,
      template_ids: ['t1'],
    };
  }

  it('returns the parsed proposals map keyed by requested field', async () => {
    const project = makeProject(
      'PWS for laboratory equipment maintenance, contract HT0011-25-D-1234.',
      {},
      [],
    );
    const fields = [
      makeField('document_number'),
      makeField('cui_banner'),
      makeField('contracting_officer_name'),
    ];
    const client = new MockLLMClient({
      proposals: {
        document_number: {
          value: 'HT0011-25-D-1234',
          source: 'project_subject',
          confidence: 0.95,
        },
        cui_banner: {
          value: 'CUI',
          source: 'default',
          confidence: 0.8,
        },
        // contracting_officer_name omitted on purpose — no evidence
      },
    });

    const result = await proposeSharedInputs(client, {
      project,
      shared_fields: fields,
      reference_files: [makeReferenceFile('quote_sheet.pdf')],
    });

    expect(Object.keys(result).sort()).toEqual(['cui_banner', 'document_number']);
    expect(result.document_number?.value).toBe('HT0011-25-D-1234');
    expect(result.document_number?.source).toBe('project_subject');
    expect(result.document_number?.confidence).toBeCloseTo(0.95);
    expect(result.cui_banner?.value).toBe('CUI');
    expect(result.contracting_officer_name).toBeUndefined();
  });

  it('skips fields with empty value strings', async () => {
    const project = makeProject('Subj.', {}, []);
    const fields = [makeField('a'), makeField('b')];
    const client = new MockLLMClient({
      proposals: {
        a: { value: 'real', source: 'inferred', confidence: 0.6 },
        b: { value: '   ', source: 'inferred', confidence: 0.6 },
      },
    });
    const result = await proposeSharedInputs(client, {
      project,
      shared_fields: fields,
      reference_files: [],
    });
    expect(Object.keys(result)).toEqual(['a']);
  });

  it('ignores hallucinated keys not in the requested fields list', async () => {
    const project = makeProject('Subj.', {}, []);
    const fields = [makeField('document_number')];
    const client = new MockLLMClient({
      proposals: {
        document_number: { value: 'X', source: 'project_subject', confidence: 1 },
        totally_invented_field: { value: 'Y', source: 'inferred', confidence: 1 },
      },
    });
    const result = await proposeSharedInputs(client, {
      project,
      shared_fields: fields,
      reference_files: [],
    });
    expect(Object.keys(result)).toEqual(['document_number']);
  });

  it('returns an empty map and skips the LLM call when no fields are requested', async () => {
    const project = makeProject('Subj.', {}, []);
    const client = new MockLLMClient({ proposals: {} });
    const result = await proposeSharedInputs(client, {
      project,
      shared_fields: [],
      reference_files: [],
    });
    expect(result).toEqual({});
    expect(client.calls).toHaveLength(0);
  });
});

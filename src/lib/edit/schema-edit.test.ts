import { describe, expect, it } from 'vitest';
import { requestSchemaEdits } from './schema-edit';
import type { LLMClient } from '../provider/types';
import type { ModelInfo, QueryInput, QueryResponse } from '../asksage/types';
import type { TemplateSchema, BodyFillRegion } from '../template/types';

function makeSection(id: string, order: number): BodyFillRegion {
  return {
    id,
    name: `Section ${order + 1}`,
    order,
    required: true,
    fill_region: {
      kind: 'heading_bounded',
      heading_text: `Section ${order + 1}`,
      heading_style_id: null,
      body_style_id: null,
      anchor_paragraph_index: order * 5,
      end_anchor_paragraph_index: order * 5 + 4,
      permitted_roles: ['body'],
    },
    intent: `Original intent for ${id}`,
    target_words: [80, 150],
    depends_on: [],
  };
}

function makeSchema(): TemplateSchema {
  return {
    $schema: 'test',
    id: 'tpl',
    name: 'Test',
    version: 1,
    source: {
      filename: 'test.docx',
      ingested_at: '2026-04-07T20:00:00Z',
      structural_parser_version: '0.1.0',
      semantic_synthesizer: 'google-claude-46-sonnet',
      docx_blob_id: 'docx://x',
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
    metadata_fill_regions: [],
    sections: [makeSection('purpose', 0), makeSection('scope', 1)],
    style: {
      voice: 'third_person',
      tense: 'present',
      register: 'formal_government',
      jargon_policy: 'use DoD terminology',
      banned_phrases: [],
    },
  };
}

class MockLLMClient implements LLMClient {
  readonly capabilities = { fileUpload: false, dataset: false, liveSearch: false };
  public calls: QueryInput[] = [];

  async getModels(): Promise<ModelInfo[]> {
    return [];
  }

  async query(input: QueryInput): Promise<QueryResponse> {
    const r = await this.queryJson<unknown>(input);
    return r.raw;
  }

  async queryJson<T>(input: QueryInput): Promise<{ data: T; raw: QueryResponse }> {
    this.calls.push(input);
    const data = {
      edits: [],
      rationale: 'Schema expansion is outside the current operation catalog.',
    };
    return {
      data: data as T,
      raw: {
        message: JSON.stringify(data),
        response: JSON.stringify(data),
        status: 200,
        uuid: `mock-${this.calls.length}`,
        references: '',
        usage: { prompt_tokens: 100, completion_tokens: 20 },
      } as unknown as QueryResponse,
    };
  }
}

describe('requestSchemaEdits', () => {
  it('tells the model to explain broader schema changes that exceed the current op catalog', async () => {
    const client = new MockLLMClient();

    await requestSchemaEdits(client, {
      schema: makeSchema(),
      instruction: 'Add a new section for compliance checkpoints.',
    });

    const systemPrompt = client.calls[0]!.system_prompt ?? '';
    expect(systemPrompt).toContain('Do not invent new sections');
    expect(systemPrompt).toContain('outside the current operation catalog');
    expect(systemPrompt).toContain('schema scope needs expansion');
  });
});

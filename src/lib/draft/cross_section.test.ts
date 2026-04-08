// Tests for the cross-section (document-level) review module. Mirrors
// the mock-client pattern from lib/draft/critique.test.ts and
// lib/draft/prompt.test.ts — no real network, just a tiny
// MockLLMClient that feeds JSON out of a queue.

import { describe, it, expect } from 'vitest';
import {
  runCrossSectionReview,
  groupIssuesBySection,
  type CrossSectionIssue,
  type DraftedSectionInput,
} from './cross_section';
import type { LLMClient } from '../provider/types';
import type { ModelInfo, QueryInput, QueryResponse } from '../asksage/types';
import type { BodyFillRegion, TemplateSchema } from '../template/types';

// ─── Fixtures ────────────────────────────────────────────────────

function makeTemplate(): TemplateSchema {
  return {
    $schema: 'test',
    id: 'tpl',
    name: 'Sample SOP',
    version: 1,
    source: {
      filename: 'sop.docx',
      ingested_at: '2026-04-07T20:00:00Z',
      structural_parser_version: '0.1.0',
      semantic_synthesizer: 'google-claude-46-sonnet',
      docx_blob_id: 'docx://x',
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
      voice: 'third_person',
      tense: 'present',
      register: 'formal_government',
      jargon_policy: null,
      banned_phrases: ['leverage'],
    },
  };
}

function makeSection(id: string, name: string): BodyFillRegion {
  return {
    id,
    name,
    order: 0,
    required: true,
    fill_region: {
      kind: 'heading_bounded',
      heading_text: name,
      heading_style_id: null,
      body_style_id: null,
      anchor_paragraph_index: 0,
      end_anchor_paragraph_index: 4,
      permitted_roles: ['body', 'bullet'],
    },
    intent: `Intent of ${name}.`,
    target_words: [80, 150],
    depends_on: [],
    validation: { must_not_exceed_words: 200 },
  };
}

function makeDraftedSections(): DraftedSectionInput[] {
  return [
    {
      template_id: 'tpl',
      template_name: 'Sample SOP',
      section: makeSection('purpose', '1. Purpose'),
      paragraphs: [
        { role: 'body', text: 'Purpose paragraph one addresses the subject directly.' },
      ],
    },
    {
      template_id: 'tpl',
      template_name: 'Sample SOP',
      section: makeSection('scope', '2. Scope'),
      paragraphs: [
        { role: 'body', text: 'Scope paragraph one addresses the subject directly.' },
        { role: 'bullet', text: 'Bullet item inside scope.' },
      ],
    },
    {
      template_id: 'tpl',
      template_name: 'Sample SOP',
      section: makeSection('roles', '3. Roles'),
      paragraphs: [
        { role: 'body', text: 'Roles paragraph one addresses the subject directly.' },
      ],
    },
  ];
}

// ─── Mock LLMClient ──────────────────────────────────────────────

interface MockResponse {
  json: unknown;
  prompt_tokens?: number;
  completion_tokens?: number;
}

/**
 * MockLLMClient feeds responses out of a queue, one per queryJson call.
 * Test cases push responses in the order they expect calls.
 */
class MockLLMClient implements LLMClient {
  public calls: QueryInput[] = [];
  private queue: MockResponse[] = [];

  enqueue(r: MockResponse): this {
    this.queue.push(r);
    return this;
  }

  async getModels(): Promise<ModelInfo[]> {
    return [];
  }

  async query(input: QueryInput): Promise<QueryResponse> {
    const r = await this.queryJson<unknown>(input);
    return r.raw;
  }

  async queryJson<T>(input: QueryInput): Promise<{ data: T; raw: QueryResponse }> {
    this.calls.push(input);
    const next = this.queue.shift();
    if (!next) {
      throw new Error(
        `MockLLMClient: queue empty (call #${this.calls.length}). Test forgot to enqueue a response.`,
      );
    }
    const raw: QueryResponse = {
      message: JSON.stringify(next.json),
      response: JSON.stringify(next.json),
      status: 200,
      uuid: `mock-${this.calls.length}`,
      references: '',
      usage: {
        prompt_tokens: next.prompt_tokens ?? 1234,
        completion_tokens: next.completion_tokens ?? 56,
      },
    };
    return { data: next.json as T, raw };
  }
}

// ─── runCrossSectionReview ───────────────────────────────────────

describe('runCrossSectionReview', () => {
  it('returns passed=true when the model returns an empty issue list', async () => {
    const client = new MockLLMClient().enqueue({
      json: { passed: true, issues: [] },
    });
    const result = await runCrossSectionReview({
      client,
      project_description: 'Test subject',
      templates: [makeTemplate()],
      sections: makeDraftedSections(),
    });
    expect(result.passed).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.tokens_in).toBe(1234);
    expect(result.tokens_out).toBe(56);
    expect(result.prompt_sent).toContain('=== SUBJECT ===');
    expect(result.prompt_sent).toContain('=== SECTION LIST (document order) ===');
  });

  it('parses populated issue lists and passes through fields correctly', async () => {
    const client = new MockLLMClient().enqueue({
      json: {
        passed: false,
        issues: [
          {
            severity: 'high',
            category: 'contradiction',
            message: 'Section purpose and section scope disagree on a core fact.',
            affected_section_ids: ['purpose', 'scope'],
            suggested_fix: 'Pick one value and use it in both sections.',
          },
          {
            severity: 'medium',
            category: 'terminology_drift',
            message: 'Section scope and section roles use different names for the same concept.',
            affected_section_ids: ['scope', 'roles'],
          },
        ],
      },
    });
    const result = await runCrossSectionReview({
      client,
      project_description: 'Test',
      templates: [makeTemplate()],
      sections: makeDraftedSections(),
    });
    expect(result.passed).toBe(false);
    expect(result.issues).toHaveLength(2);
    expect(result.issues[0]!.severity).toBe('high');
    expect(result.issues[0]!.category).toBe('contradiction');
    expect(result.issues[0]!.affected_section_ids).toEqual(['purpose', 'scope']);
    expect(result.issues[0]!.suggested_fix).toBe('Pick one value and use it in both sections.');
    expect(result.issues[1]!.suggested_fix).toBeUndefined();
  });

  it('filters out malformed issues missing affected_section_ids', async () => {
    const client = new MockLLMClient().enqueue({
      json: {
        passed: false,
        issues: [
          {
            severity: 'high',
            category: 'contradiction',
            message: 'Good issue naming purpose and scope.',
            affected_section_ids: ['purpose', 'scope'],
          },
          {
            // Missing affected_section_ids entirely.
            severity: 'high',
            category: 'contradiction',
            message: 'Dangling issue without ids.',
          },
          {
            // Empty affected_section_ids array.
            severity: 'medium',
            category: 'redundancy',
            message: 'Empty-id issue.',
            affected_section_ids: [],
          },
          {
            // Missing message field.
            severity: 'medium',
            category: 'redundancy',
            affected_section_ids: ['purpose'],
          },
          {
            // All affected ids unknown — should be dropped.
            severity: 'medium',
            category: 'redundancy',
            message: 'Refers to sections that do not exist.',
            affected_section_ids: ['not_a_real_section', 'also_fake'],
          },
        ],
      },
    });
    const result = await runCrossSectionReview({
      client,
      project_description: 'Test',
      templates: [makeTemplate()],
      sections: makeDraftedSections(),
    });
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]!.affected_section_ids).toEqual(['purpose', 'scope']);
  });

  it('computes passed=false if ANY medium+ issue exists (low-only → passed=true)', async () => {
    const lowOnlyClient = new MockLLMClient().enqueue({
      json: {
        passed: true,
        issues: [
          {
            severity: 'low',
            category: 'tone_drift',
            message: 'Minor tonal shift between purpose and scope.',
            affected_section_ids: ['purpose', 'scope'],
          },
        ],
      },
    });
    const lowResult = await runCrossSectionReview({
      client: lowOnlyClient,
      project_description: 'T',
      templates: [makeTemplate()],
      sections: makeDraftedSections(),
    });
    expect(lowResult.passed).toBe(true);
    expect(lowResult.issues).toHaveLength(1);

    const withMediumClient = new MockLLMClient().enqueue({
      json: {
        passed: true, // model lies — we recompute
        issues: [
          {
            severity: 'medium',
            category: 'redundancy',
            message: 'purpose and scope repeat the same sentence.',
            affected_section_ids: ['purpose', 'scope'],
          },
        ],
      },
    });
    const mediumResult = await runCrossSectionReview({
      client: withMediumClient,
      project_description: 'T',
      templates: [makeTemplate()],
      sections: makeDraftedSections(),
    });
    // Our decidePassed recomputes independently of what the model said.
    expect(mediumResult.passed).toBe(false);
  });

  it('rolls up token counts from the raw response usage field', async () => {
    const client = new MockLLMClient().enqueue({
      json: { passed: true, issues: [] },
      prompt_tokens: 42000,
      completion_tokens: 321,
    });
    const result = await runCrossSectionReview({
      client,
      project_description: 'T',
      templates: [makeTemplate()],
      sections: makeDraftedSections(),
    });
    expect(result.tokens_in).toBe(42000);
    expect(result.tokens_out).toBe(321);
  });

  it('preserves every section id verbatim in the compressed prompt body', async () => {
    const client = new MockLLMClient().enqueue({
      json: { passed: true, issues: [] },
    });
    const sections = makeDraftedSections();
    const result = await runCrossSectionReview({
      client,
      project_description: 'T',
      templates: [makeTemplate()],
      sections,
    });
    // The compression must not swallow section ids.
    for (const s of sections) {
      const idRegex = new RegExp(`id=${s.section.id}\\b`);
      expect(result.prompt_sent).toMatch(idRegex);
    }
    // And the compressed `[role] text` lines must appear.
    expect(result.prompt_sent).toMatch(/\[body\] Purpose paragraph one/);
    expect(result.prompt_sent).toMatch(/\[bullet\] Bullet item inside scope/);
  });

  it('sends model override when provided and always disables RAG/live', async () => {
    const client = new MockLLMClient().enqueue({
      json: { passed: true, issues: [] },
    });
    await runCrossSectionReview({
      client,
      project_description: 'T',
      templates: [makeTemplate()],
      sections: makeDraftedSections(),
      model: 'google-claude-46-opus',
    });
    const call = client.calls[0]!;
    expect(call.model).toBe('google-claude-46-opus');
    expect(call.dataset).toBe('none');
    expect(call.limit_references).toBe(0);
    expect(call.live).toBe(0);
    expect(call.temperature).toBe(0);
    expect(call.usage).toBe(true);
  });
});

// ─── groupIssuesBySection ────────────────────────────────────────

describe('groupIssuesBySection', () => {
  it('returns an empty map for an empty issue list', () => {
    const out = groupIssuesBySection([]);
    expect(out.size).toBe(0);
  });

  it('fans issues out to every affected section id', () => {
    const issues: CrossSectionIssue[] = [
      {
        severity: 'high',
        category: 'contradiction',
        message: 'A and B disagree.',
        affected_section_ids: ['a', 'b'],
      },
      {
        severity: 'medium',
        category: 'redundancy',
        message: 'B and C repeat.',
        affected_section_ids: ['b', 'c'],
      },
      {
        severity: 'low',
        category: 'tone_drift',
        message: 'A drifts tonally.',
        affected_section_ids: ['a'],
      },
    ];
    const out = groupIssuesBySection(issues);
    expect(out.size).toBe(3);
    expect(out.get('a')).toHaveLength(2);
    expect(out.get('b')).toHaveLength(2);
    expect(out.get('c')).toHaveLength(1);
    expect(out.get('a')![0]!.message).toBe('A and B disagree.');
    expect(out.get('a')![1]!.message).toBe('A drifts tonally.');
    expect(out.get('b')![0]!.category).toBe('contradiction');
    expect(out.get('b')![1]!.category).toBe('redundancy');
    expect(out.get('c')![0]!.category).toBe('redundancy');
  });
});

// Tests for the section critic loop module. Mirrors the mock-client
// pattern used by lib/draft/prompt.test.ts but exercises the loop
// runner with controllable per-call mock responses so we can drive the
// converge / not-converge / revise paths.

import { describe, it, expect, vi } from 'vitest';
import {
  critiqueDraft,
  runDraftWithCriticLoop,
  formatRevisionNotes,
  type CritiqueIssue,
  type CritiqueResult,
} from './critique';
import type { LLMClient } from '../provider/types';
import type { ModelInfo, QueryInput, QueryResponse } from '../asksage/types';
import type { BodyFillRegion, TemplateSchema } from '../template/types';
import type { DraftParagraph } from './types';

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

function makeSection(): BodyFillRegion {
  return {
    id: 'purpose',
    name: '1. Purpose',
    order: 0,
    required: true,
    fill_region: {
      kind: 'heading_bounded',
      heading_text: '1. Purpose',
      heading_style_id: null,
      body_style_id: null,
      anchor_paragraph_index: 0,
      end_anchor_paragraph_index: 4,
      permitted_roles: ['body', 'bullet'],
    },
    intent: 'State the SOP goal.',
    target_words: [80, 150],
    depends_on: [],
    validation: { must_not_exceed_words: 200 },
  };
}

function makeDraft(): DraftParagraph[] {
  return [
    { role: 'body', text: 'A clean body paragraph that addresses the subject directly.' },
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
 * Test cases push responses in the order they expect calls. If the queue
 * empties, throws so the test fails loudly instead of returning undefined.
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
        prompt_tokens: next.prompt_tokens ?? 100,
        completion_tokens: next.completion_tokens ?? 50,
      },
    };
    return { data: next.json as T, raw };
  }
}

// ─── critiqueDraft ───────────────────────────────────────────────

describe('critiqueDraft', () => {
  it('returns passed=true when the critic emits an empty issues array', async () => {
    const client = new MockLLMClient().enqueue({ json: { issues: [] } });
    const result = await critiqueDraft(client, {
      template: makeTemplate(),
      section: makeSection(),
      draft: makeDraft(),
      project_description: 'Test subject',
      references_block: null,
      template_example: null,
      prior_summaries: [],
    });
    expect(result.passed).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.tokens_in).toBe(100);
    expect(result.tokens_out).toBe(50);
    expect(result.prompt_sent).toContain('=== SUBJECT ===');
    expect(result.prompt_sent).toContain('=== DRAFT TO CRITIQUE ===');
    expect(result.prompt_sent).toContain('strictness_level: moderate');
  });

  it('parses returned issues and decides passed=false when any are medium+', async () => {
    const client = new MockLLMClient().enqueue({
      json: {
        issues: [
          {
            severity: 'high',
            category: 'hallucination',
            message: 'Paragraph 0 cites a value not in references.',
            suggested_fix: 'Remove the cited value.',
          },
          {
            severity: 'low',
            category: 'vague',
            message: 'Paragraph 0 second sentence is generic.',
          },
        ],
      },
    });
    const result = await critiqueDraft(client, {
      template: makeTemplate(),
      section: makeSection(),
      draft: makeDraft(),
      project_description: 'Test',
      references_block: null,
      template_example: null,
      prior_summaries: [],
    });
    expect(result.passed).toBe(false);
    expect(result.issues).toHaveLength(2);
    expect(result.issues[0]!.severity).toBe('high');
    expect(result.issues[0]!.category).toBe('hallucination');
    expect(result.issues[0]!.suggested_fix).toBe('Remove the cited value.');
    expect(result.issues[1]!.severity).toBe('low');
  });

  it('returns passed=true when only low-severity issues exist', async () => {
    const client = new MockLLMClient().enqueue({
      json: {
        issues: [
          { severity: 'low', category: 'vague', message: 'Mildly generic.' },
        ],
      },
    });
    const result = await critiqueDraft(client, {
      template: makeTemplate(),
      section: makeSection(),
      draft: makeDraft(),
      project_description: 'X',
      references_block: null,
      template_example: null,
      prior_summaries: [],
    });
    expect(result.passed).toBe(true);
    expect(result.issues).toHaveLength(1);
  });

  it('strictness flows through: lenient says passed, strict says failed for the same draft', async () => {
    // Two separate calls to critiqueDraft with two separate mocks; the
    // critic is presumed to return different issue lists per strictness.
    const lenientClient = new MockLLMClient().enqueue({ json: { issues: [] } });
    const strictClient = new MockLLMClient().enqueue({
      json: {
        issues: [
          {
            severity: 'medium',
            category: 'vague',
            message: 'Paragraph 0 lacks specifics.',
          },
        ],
      },
    });

    const lenientResult = await critiqueDraft(lenientClient, {
      template: makeTemplate(),
      section: makeSection(),
      draft: makeDraft(),
      project_description: 'X',
      references_block: null,
      template_example: null,
      prior_summaries: [],
      strictness: 'lenient',
    });
    const strictResult = await critiqueDraft(strictClient, {
      template: makeTemplate(),
      section: makeSection(),
      draft: makeDraft(),
      project_description: 'X',
      references_block: null,
      template_example: null,
      prior_summaries: [],
      strictness: 'strict',
    });

    expect(lenientResult.passed).toBe(true);
    expect(strictResult.passed).toBe(false);
    // The strictness directive must reach the prompt body so the LLM
    // can act on it.
    expect(lenientClient.calls[0]!.message).toContain('strictness_level: lenient');
    expect(strictClient.calls[0]!.message).toContain('strictness_level: strict');
  });

  it('uses a per-call model override when provided', async () => {
    const client = new MockLLMClient().enqueue({ json: { issues: [] } });
    await critiqueDraft(client, {
      template: makeTemplate(),
      section: makeSection(),
      draft: makeDraft(),
      project_description: 'X',
      references_block: null,
      template_example: null,
      prior_summaries: [],
      model: 'google-claude-46-opus',
    });
    expect(client.calls[0]!.model).toBe('google-claude-46-opus');
  });
});

// ─── formatRevisionNotes ─────────────────────────────────────────

describe('formatRevisionNotes', () => {
  it('returns an empty string when there are no issues', () => {
    expect(formatRevisionNotes([])).toBe('');
  });

  it('orders issues high → medium → low', () => {
    const issues: CritiqueIssue[] = [
      { severity: 'low', category: 'vague', message: 'low one' },
      { severity: 'high', category: 'hallucination', message: 'high one' },
      { severity: 'medium', category: 'banned_phrase', message: 'medium one' },
    ];
    const out = formatRevisionNotes(issues);
    const hi = out.indexOf('high one');
    const mi = out.indexOf('medium one');
    const lo = out.indexOf('low one');
    expect(hi).toBeGreaterThan(-1);
    expect(hi).toBeLessThan(mi);
    expect(mi).toBeLessThan(lo);
    expect(out).toContain('=== REVISION NOTES');
    expect(out).toContain('=== END REVISION NOTES ===');
  });
});

// ─── runDraftWithCriticLoop ──────────────────────────────────────

interface DraftFnSpy {
  fn: (notes: string | null) => Promise<{
    paragraphs: DraftParagraph[];
    prompt_sent: string;
    references: string;
    tokens_in: number;
    tokens_out: number;
    model: string;
  }>;
  callsWith: (string | null)[];
}

function makeDraftFn(): DraftFnSpy {
  const callsWith: (string | null)[] = [];
  let n = 0;
  const fn = vi.fn(async (notes: string | null) => {
    callsWith.push(notes);
    n++;
    return {
      paragraphs: [
        { role: 'body' as const, text: `draft attempt ${n}` },
      ],
      prompt_sent: `prompt for attempt ${n}${notes ? ' WITH NOTES' : ''}`,
      references: `refs ${n}`,
      tokens_in: 1000,
      tokens_out: 200,
      model: 'google-claude-46-sonnet',
    };
  });
  return { fn, callsWith };
}

describe('runDraftWithCriticLoop', () => {
  it('max_iterations=0 → calls draftFn once and skips the critic entirely', async () => {
    const client = new MockLLMClient(); // queue empty — should never be touched
    const draftFn = makeDraftFn();
    const result = await runDraftWithCriticLoop({
      client,
      draftFn: draftFn.fn,
      template: makeTemplate(),
      section: makeSection(),
      project_description: 'X',
      references_block: null,
      template_example: null,
      prior_summaries: [],
      max_iterations: 0,
    });
    expect(draftFn.callsWith).toHaveLength(1);
    expect(draftFn.callsWith[0]).toBeNull();
    expect(result.iterations).toHaveLength(1);
    expect(result.iterations[0]!.critique).toBeNull();
    expect(result.converged).toBe(true);
    expect(client.calls).toHaveLength(0);
    expect(result.total_tokens_in).toBe(1000);
    expect(result.total_tokens_out).toBe(200);
  });

  it('max_iterations=2, first critique passes → calls draftFn once, no revision', async () => {
    const client = new MockLLMClient().enqueue({
      json: { issues: [] },
      prompt_tokens: 500,
      completion_tokens: 25,
    });
    const draftFn = makeDraftFn();
    const result = await runDraftWithCriticLoop({
      client,
      draftFn: draftFn.fn,
      template: makeTemplate(),
      section: makeSection(),
      project_description: 'X',
      references_block: null,
      template_example: null,
      prior_summaries: [],
      max_iterations: 2,
    });
    expect(draftFn.callsWith).toHaveLength(1);
    expect(client.calls).toHaveLength(1);
    expect(result.converged).toBe(true);
    expect(result.iterations).toHaveLength(1);
    expect(result.iterations[0]!.was_revised).toBe(false);
    // 1 draft + 1 critique tokens
    expect(result.total_tokens_in).toBe(1000 + 500);
    expect(result.total_tokens_out).toBe(200 + 25);
  });

  it('failing then passing critique → calls draftFn twice and converges', async () => {
    const client = new MockLLMClient()
      .enqueue({
        json: {
          issues: [
            {
              severity: 'high',
              category: 'hallucination',
              message: 'Paragraph 0 invents a fact.',
            },
          ],
        },
      })
      .enqueue({ json: { issues: [] } });
    const draftFn = makeDraftFn();
    const result = await runDraftWithCriticLoop({
      client,
      draftFn: draftFn.fn,
      template: makeTemplate(),
      section: makeSection(),
      project_description: 'X',
      references_block: null,
      template_example: null,
      prior_summaries: [],
      max_iterations: 2,
    });
    expect(draftFn.callsWith).toHaveLength(2);
    expect(draftFn.callsWith[0]).toBeNull();
    expect(draftFn.callsWith[1]).toContain('REVISION NOTES');
    expect(draftFn.callsWith[1]).toContain('hallucination');
    expect(client.calls).toHaveLength(2);
    expect(result.converged).toBe(true);
    expect(result.iterations).toHaveLength(2);
    expect(result.iterations[0]!.was_revised).toBe(true);
    expect(result.iterations[1]!.was_revised).toBe(false);
    expect(result.paragraphs[0]!.text).toBe('draft attempt 2');
  });

  it('always-failing critique with max_iterations=2 → 3 draftFn calls, converged=false, iterations.length=3', async () => {
    const failingIssue = {
      severity: 'high',
      category: 'hallucination',
      message: 'Paragraph 0 invents a fact.',
    };
    const client = new MockLLMClient()
      .enqueue({ json: { issues: [failingIssue] } })
      .enqueue({ json: { issues: [failingIssue] } })
      .enqueue({ json: { issues: [failingIssue] } });
    const draftFn = makeDraftFn();
    const result = await runDraftWithCriticLoop({
      client,
      draftFn: draftFn.fn,
      template: makeTemplate(),
      section: makeSection(),
      project_description: 'X',
      references_block: null,
      template_example: null,
      prior_summaries: [],
      max_iterations: 2,
    });
    expect(draftFn.callsWith).toHaveLength(3);
    expect(client.calls).toHaveLength(3);
    expect(result.converged).toBe(false);
    expect(result.iterations).toHaveLength(3);
    // Final draft is attempt 3.
    expect(result.paragraphs[0]!.text).toBe('draft attempt 3');
    // Sum of 3 drafts (1000 each) + 3 critiques (100 each) by default mock.
    expect(result.total_tokens_in).toBe(3 * 1000 + 3 * 100);
    expect(result.total_tokens_out).toBe(3 * 200 + 3 * 50);
    // Last iteration's was_revised should be false (we never revised
    // after the final critique).
    expect(result.iterations[2]!.was_revised).toBe(false);
    expect(result.iterations[0]!.was_revised).toBe(true);
    expect(result.iterations[1]!.was_revised).toBe(true);
  });

  it('max_iterations=1 critiques once and never revises even on failure', async () => {
    const client = new MockLLMClient().enqueue({
      json: {
        issues: [
          {
            severity: 'high',
            category: 'hallucination',
            message: 'Bad.',
          },
        ],
      },
    });
    const draftFn = makeDraftFn();
    const result = await runDraftWithCriticLoop({
      client,
      draftFn: draftFn.fn,
      template: makeTemplate(),
      section: makeSection(),
      project_description: 'X',
      references_block: null,
      template_example: null,
      prior_summaries: [],
      max_iterations: 1,
    });
    expect(draftFn.callsWith).toHaveLength(1);
    expect(client.calls).toHaveLength(1);
    expect(result.converged).toBe(false);
    expect(result.iterations).toHaveLength(1);
    expect(result.iterations[0]!.was_revised).toBe(false);
  });

  it('clamps max_iterations above the hard cap of 3', async () => {
    const failingIssue = {
      severity: 'high',
      category: 'hallucination',
      message: 'Bad.',
    };
    const client = new MockLLMClient()
      .enqueue({ json: { issues: [failingIssue] } })
      .enqueue({ json: { issues: [failingIssue] } })
      .enqueue({ json: { issues: [failingIssue] } })
      .enqueue({ json: { issues: [failingIssue] } });
    const draftFn = makeDraftFn();
    const result = await runDraftWithCriticLoop({
      client,
      draftFn: draftFn.fn,
      template: makeTemplate(),
      section: makeSection(),
      project_description: 'X',
      references_block: null,
      template_example: null,
      prior_summaries: [],
      max_iterations: 99,
    });
    // Hard cap is 3 → maxPasses = 4, draftFn called 4 times (initial + 3 revises).
    expect(draftFn.callsWith.length).toBeLessThanOrEqual(4);
    expect(result.converged).toBe(false);
  });
});

// ─── Diagnostic helpers smoke check ───────────────────────────────

describe('CritiqueResult shape', () => {
  it('exposes raw_output for the diagnostics view', async () => {
    const raw = { issues: [], extra: 'preserved' };
    const client = new MockLLMClient().enqueue({ json: raw });
    const result: CritiqueResult = await critiqueDraft(client, {
      template: makeTemplate(),
      section: makeSection(),
      draft: makeDraft(),
      project_description: 'X',
      references_block: null,
      template_example: null,
      prior_summaries: [],
    });
    expect(result.raw_output).toEqual(raw);
  });
});

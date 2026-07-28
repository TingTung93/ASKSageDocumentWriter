import { describe, expect, it } from 'vitest';
import type { ProjectRecord, DraftRecord } from '../../db/schema';
import type { BodyFillRegion, TemplateSchema } from '../../template/types';
import {
  createTemplateSectionSnapshot,
  templateSectionOperation,
  validateProposalAgainstTemplateSection,
} from './template-section';

const section: BodyFillRegion = {
  id: 'purpose',
  name: 'Purpose',
  order: 0,
  required: true,
  intent: 'Explain why the policy exists.',
  target_words: [4, 30],
  fill_region: {
    kind: 'heading_bounded',
    heading_text: 'Purpose',
    heading_style_id: 'Heading1',
    body_style_id: 'Normal',
    anchor_paragraph_index: 1,
    end_anchor_paragraph_index: 4,
    permitted_roles: ['body', 'bullet'],
  },
};

const project = {
  id: 'project-1',
  name: 'Policy',
  description: 'Draft a concise policy.',
  template_ids: ['template-1'],
  reference_dataset_names: [],
  shared_inputs: {},
  model_overrides: {},
  live_search: 0,
  context_items: [
    { kind: 'note', id: 'note-1', role: 'user', text: 'Audience is leadership.', created_at: 'now' },
  ],
  created_at: 'now',
  updated_at: 'now',
} satisfies ProjectRecord;

const template = {
  $schema: 'test',
  id: 'template-1',
  name: 'Policy Template',
  version: 2,
  source: {},
  formatting: {},
  metadata_fill_regions: [],
  sections: [section],
  style: {},
} as unknown as TemplateSchema;

const draft = {
  id: 'project-1::template-1::purpose',
  project_id: 'project-1',
  template_id: 'template-1',
  section_id: 'purpose',
  paragraphs: [
    { role: 'body', text: 'Existing supported text [Source: policy.pdf].' },
    { role: 'body', text: 'Owner: [INSERT: policy owner]' },
  ],
  references: '',
  status: 'ready',
  validation_issues: ['Confirm owner'],
  generated_at: 'now',
  model: 'test',
  tokens_in: 1,
  tokens_out: 1,
} satisfies DraftRecord;

async function snapshot() {
  return createTemplateSectionSnapshot({
    project,
    template,
    section,
    draft,
    selectedSources: [
      { id: 'source-1', label: 'Policy', text: 'A'.repeat(10) },
      { id: 'source-2', label: 'Overflow', text: 'B'.repeat(100) },
    ],
    neighbors: [{ sectionId: 'scope', name: 'Scope', summary: 'Neighbor' }],
    maxContextCharacters: 20,
  });
}

describe('template section snapshot', () => {
  it('captures an immutable bounded snapshot with a deterministic hash', async () => {
    const first = await snapshot();
    const second = await snapshot();
    expect(first.baseHash).toBe(second.baseHash);
    expect(first.project.notes).toEqual([
      { id: 'note-1', role: 'user', text: 'Audience is leadership.' },
    ]);
    expect(first.context.sources.map((source) => source.id)).toEqual(['source-1']);
    expect(first.context.neighbors.map((neighbor) => neighbor.sectionId)).toEqual(['scope']);
    expect(first.context.omitted).toEqual([{ id: 'source-2', reason: 'context_limit' }]);
    expect(Object.isFrozen(first.draft.paragraphs)).toBe(true);
    expect(() => {
      (first.draft.paragraphs as Array<{ text: string }>)[0]!.text = 'mutated';
    }).toThrow();
    expect(draft.paragraphs[0]!.text).toContain('Existing');
  });

  it('rejects mismatched persisted identities', async () => {
    await expect(createTemplateSectionSnapshot({
      project,
      template,
      section,
      draft: { ...draft, project_id: 'other' },
    })).rejects.toThrow(/selected project/i);
  });
});

describe('template section deterministic proposal validation', () => {
  it('accepts a target-scoped immutable replacement', async () => {
    const base = await snapshot();
    const operation = templateSectionOperation(base, {
      op: 'replace_paragraph',
      index: 0,
      text: 'Revised supported policy text [Source: policy.pdf].',
    });
    const report = validateProposalAgainstTemplateSection(base, {
      target: base.target,
      baseHash: base.baseHash,
      operations: [operation],
    });
    expect(report.ok).toBe(true);
    expect(report.result?.[0]?.text).toContain('Revised');
    expect(base.draft.paragraphs[0]!.text).toContain('Existing');
  });

  it('rejects stale bases and cross-target operations', async () => {
    const base = await snapshot();
    const report = validateProposalAgainstTemplateSection(base, {
      target: base.target,
      baseHash: 'stale',
      operations: [{
        op: 'delete_paragraph',
        template_id: 'template-1',
        section_id: 'other',
        index: 0,
      }],
    });
    expect(report.errors).toEqual(expect.arrayContaining([
      expect.stringMatching(/stale/i),
      expect.stringMatching(/different template section/i),
    ]));
  });

  it.each([
    {
      name: 'empty destructive replacement',
      operation: { op: 'replace_paragraph', index: 0, text: '' },
      message: /empty replacement/i,
    },
    {
      name: 'unpermitted paragraph role',
      operation: { op: 'insert_paragraph', after_index: 0, role: 'heading', text: 'Heading' },
      message: /not permitted/i,
    },
    {
      name: 'new unresolved placeholder',
      operation: { op: 'replace_paragraph', index: 0, text: 'New [INSERT: approver]' },
      message: /introduces unresolved placeholder/i,
    },
    {
      name: 'malformed citation marker',
      operation: { op: 'replace_paragraph', index: 0, text: 'Claim [Source: policy.pdf' },
      message: /malformed citation/i,
    },
  ])('rejects $name', async ({ operation, message }) => {
    const base = await snapshot();
    const report = validateProposalAgainstTemplateSection(base, {
      target: base.target,
      baseHash: base.baseHash,
      operations: [templateSectionOperation(base, operation as never)],
    });
    expect(report.ok).toBe(false);
    expect(report.errors).toEqual(expect.arrayContaining([expect.stringMatching(message)]));
  });

  it('rejects deleting all content and invalid paragraph levels', async () => {
    const base = await snapshot();
    const empty = validateProposalAgainstTemplateSection(base, {
      target: base.target,
      baseHash: base.baseHash,
      operations: [1, 0].map((index) => templateSectionOperation(base, {
        op: 'delete_paragraph',
        index,
      })),
    });
    expect(empty.errors).toContain('Proposal would leave the required section empty.');

    const invalidLevel = await createTemplateSectionSnapshot({
      project,
      template,
      section,
      draft: {
        ...draft,
        paragraphs: [{ role: 'body', text: 'Text.', level: 9 }],
      },
    });
    const levelReport = validateProposalAgainstTemplateSection(invalidLevel, {
      target: invalidLevel.target,
      baseHash: invalidLevel.baseHash,
      operations: [templateSectionOperation(invalidLevel, {
        op: 'replace_paragraph',
        index: 0,
        text: 'Changed.',
      })],
    });
    expect(levelReport.errors).toContain('Paragraph 0 has an invalid nesting level.');
  });
});

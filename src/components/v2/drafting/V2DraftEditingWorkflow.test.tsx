import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db, type DraftRecord } from '../../../lib/db/schema';
import type { LLMClient } from '../../../lib/provider/types';
import { getCurrentAcceptedVersion } from '../../../lib/agentic-editing/versions';
import { useDraftEditingSession } from './useDraftEditingSession';

const source = [{ role: 'body' as const, text: 'Long original policy sentence.' }];
const draft: DraftRecord = {
  id: 'project::template::purpose',
  project_id: 'project',
  template_id: 'template',
  section_id: 'purpose',
  paragraphs: source,
  references: '',
  status: 'ready',
  generated_at: '2026-01-01T00:00:00.000Z',
  model: 'local-model',
  tokens_in: 1,
  tokens_out: 1,
};

function providerMock(): LLMClient {
  const outputs = [
    {
      summary: 'Tighten purpose',
      scope: { sectionIds: ['purpose'], paragraphIds: ['0'], broadDocumentChange: false },
      steps: [],
      requiredContext: [],
      risks: [],
    },
    {
      summary: 'Tightened wording',
      operations: [{
        target: 'draft_paragraphs',
        operation: {
          op: 'replace_paragraph',
          template_id: 'template',
          section_id: 'purpose',
          index: 0,
          text: 'Concise policy sentence.',
        },
      }],
      criterionCoverage: [],
      evidence: [],
      assumptions: [],
      unresolvedQuestions: [],
    },
    {
      verdict: 'pass',
      score: 98,
      criteria: [],
      unsupportedClaims: [],
      structuralRisks: [],
      styleIssues: [],
      repairInstructions: [],
    },
  ];
  let call = 0;
  return {
    capabilities: {
      fileUpload: false,
      dataset: false,
      liveSearch: false,
      tools: false,
      jsonOutput: true,
      embeddings: false,
    },
    getModels: vi.fn().mockResolvedValue([]),
    query: vi.fn(),
    queryJson: async <T,>() => ({
      data: outputs[call++]! as T,
      raw: { message: '', response: 'OK', status: 200, uuid: `local-${call}` },
    }),
  };
}

function options(client: LLMClient, onDocumentChanged = vi.fn()) {
  return {
    target: {
      kind: 'template_draft' as const,
      targetId: draft.id,
      projectId: draft.project_id,
      templateId: draft.template_id,
      sectionId: draft.section_id,
    },
    source,
    client: () => client,
    providerId: 'local_openai' as const,
    model: 'local-model',
    onDocumentChanged,
  };
}

describe('integrated V2 draft editing workflow', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
    await db.drafts.add(structuredClone(draft));
  });

  it('proposes without mutation, recovers after remount, accepts, reloads, and undoes', async () => {
    const client = providerMock();
    const onDocumentChanged = vi.fn();
    const first = renderHook(() =>
      useDraftEditingSession(options(client, onDocumentChanged)));

    await act(() => first.result.current.propose('Tighten this section.'));
    expect(first.result.current.preview?.after[0]?.text).toBe('Concise policy sentence.');
    expect((await db.drafts.get(draft.id))?.paragraphs).toEqual(source);
    expect(await db.document_versions.where('status').equals('preview').count()).toBe(1);

    first.unmount();
    const recovered = renderHook(() =>
      useDraftEditingSession(options(client, onDocumentChanged)));
    await waitFor(() =>
      expect(recovered.result.current.preview?.after[0]?.text)
        .toBe('Concise policy sentence.'));

    await act(() => recovered.result.current.accept());
    expect((await db.drafts.get(draft.id))?.paragraphs[0]?.text)
      .toBe('Concise policy sentence.');
    expect(onDocumentChanged).toHaveBeenCalledWith('accepted');
    const accepted = await getCurrentAcceptedVersion('template_draft', draft.id);
    expect(accepted?.label).toBe('Tightened wording');

    await db.close();
    await db.open();
    expect((await db.drafts.get(draft.id))?.paragraphs[0]?.text)
      .toBe('Concise policy sentence.');
    const initial = (await db.document_versions
      .where('target_kind')
      .equals('template_draft')
      .and((version) => version.target_id === draft.id && !version.parent_version_id)
      .first())!;
    await act(() => recovered.result.current.undo(initial));
    expect((await db.drafts.get(draft.id))?.paragraphs).toEqual(source);
    expect(onDocumentChanged).toHaveBeenCalledWith('restored');
    expect(await db.document_versions
      .where('target_kind')
      .equals('template_draft')
      .and((version) => version.target_id === draft.id && version.status === 'accepted')
      .count()).toBe(3);
  });

  it('rejects a proposal without changing canonical content', async () => {
    const hook = renderHook(() =>
      useDraftEditingSession(options(providerMock())));
    await act(() => hook.result.current.propose('Tighten this section.'));
    await act(() => hook.result.current.reject());

    expect((await db.drafts.get(draft.id))?.paragraphs).toEqual(source);
    expect(hook.result.current.preview).toBeNull();
    const turn = await db.editing_turns.toCollection().first();
    expect(turn).toMatchObject({ user_decision: 'rejected', status: 'cancelled' });
  });
});

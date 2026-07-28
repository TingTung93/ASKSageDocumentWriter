import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LLMClient } from '../../../lib/provider/types';
import { useDraftEditingSession } from './useDraftEditingSession';

const mocks = vi.hoisted(() => ({
  startTurn: vi.fn(),
  putVersion: vi.fn(),
  setTurnStatus: vi.fn(),
  updateSession: vi.fn(),
  updateTurn: vi.fn(),
  findSession: vi.fn<(...args: any[]) => Promise<any>>(async () => undefined),
  getVersion: vi.fn<(...args: any[]) => Promise<any>>(),
  listTurns: vi.fn<(...args: any[]) => Promise<any[]>>(async () => []),
  listVersions: vi.fn<(...args: any[]) => Promise<any[]>>(async () => []),
  commitVersion: vi.fn(async () => ({})),
  commitFreeformVersion: vi.fn(async () => ({})),
  currentVersion: vi.fn<(...args: any[]) => Promise<any>>(async () => undefined),
  undoVersion: vi.fn(async () => ({})),
  undoFreeformVersion: vi.fn(async () => ({})),
}));
const {
  commitVersion, currentVersion, findSession, getVersion, listTurns,
  listVersions, putVersion, setTurnStatus, startTurn, undoVersion,
  updateTurn, commitFreeformVersion, undoFreeformVersion,
} = mocks;

vi.mock('../../../lib/agentic-editing/runner', () => ({
  startPromptOnlyEditingTurn: (...args: unknown[]) => mocks.startTurn(...args),
}));
vi.mock('../../../lib/agentic-editing/store', () => ({
  putDocumentVersion: (...args: unknown[]) => mocks.putVersion(...args),
  setEditingTurnStatus: (...args: unknown[]) => mocks.setTurnStatus(...args),
  updateEditingSessionStatus: (...args: unknown[]) => mocks.updateSession(...args),
  updateEditingTurn: (...args: unknown[]) => mocks.updateTurn(...args),
  findActiveSessionForTarget: mocks.findSession,
  getDocumentVersion: mocks.getVersion,
  listSessionTurns: mocks.listTurns,
  listTargetVersions: mocks.listVersions,
}));
vi.mock('../../../lib/agentic-editing/versions', () => ({
  commitTemplateDraftVersion: mocks.commitVersion,
  commitFreeformDraftVersion: mocks.commitFreeformVersion,
  getCurrentAcceptedVersion: mocks.currentVersion,
  undoTemplateDraftVersion: mocks.undoVersion,
  undoFreeformDraftVersion: mocks.undoFreeformVersion,
}));

const client = {} as LLMClient;
const source = [{ role: 'body' as const, text: 'Long original text.' }];
const turn = {
  id: 'turn-1',
  session_id: 'session-1',
  target: {
    kind: 'template_draft' as const,
    targetId: 'draft-1',
    templateId: 'template-1',
    sectionId: 'section-1',
  },
  base_version_id: 'version-1',
  instruction: 'Tighten',
  acceptance_criteria: [],
  proposal: {
    summary: 'Tightened wording',
    operations: [{
      target: 'draft_paragraphs' as const,
      operation: {
        op: 'replace_paragraph' as const,
        template_id: 'template-1',
        section_id: 'section-1',
        index: 0,
        text: 'Concise text.',
      },
    }],
    criterionCoverage: [],
    evidence: [],
    assumptions: [],
    unresolvedQuestions: [],
  },
  provider_id: 'asksage' as const,
  models_used: ['model'],
  status: 'awaiting_user_approval' as const,
  created_at: '2026-07-27T00:00:00.000Z',
};

describe('useDraftEditingSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    startTurn.mockResolvedValue({ sessionId: 'session-1', turn });
    findSession.mockResolvedValue(undefined);
    listTurns.mockResolvedValue([]);
    listVersions.mockResolvedValue([]);
    currentVersion.mockResolvedValue(undefined);
  });

  function setup(onDocumentChanged = vi.fn()) {
    const hook = renderHook(() => useDraftEditingSession({
      target: {
        kind: 'template_draft',
        targetId: 'draft-1',
        templateId: 'template-1',
        sectionId: 'section-1',
      },
      source,
      client: () => client,
      providerId: 'asksage',
      model: 'model',
      onDocumentChanged,
    }));
    return { ...hook, onDocumentChanged };
  }

  it('persists a preview but does not mutate the draft before approval', async () => {
    const { result } = setup();
    await act(() => result.current.propose('Tighten'));

    expect(result.current.preview?.after[0].text).toBe('Concise text.');
    expect(commitVersion).not.toHaveBeenCalled();
    expect(putVersion).toHaveBeenCalledWith(expect.objectContaining({ status: 'preview' }));
  });

  it('does not preview a proposal that requires repair or user input', async () => {
    startTurn.mockResolvedValue({
      sessionId: 'session-1',
      turn: { ...turn, status: 'awaiting_plan_approval' },
    });
    const { result } = setup();
    await act(() => result.current.propose('Tighten'));

    expect(result.current.preview).toBeNull();
    expect(result.current.error).toMatch(/requires repair or additional input/i);
    expect(putVersion).not.toHaveBeenCalled();
  });

  it('keeps adapter validation failures out of the approval preview', async () => {
    const { result } = renderHook(() => useDraftEditingSession({
      target: turn.target,
      source,
      client: () => client,
      providerId: 'asksage',
      model: 'model',
      applyProposal: async () => {
        throw new Error('Proposal would leave the required section empty.');
      },
    }));
    await act(() => result.current.propose('Delete everything'));

    expect(result.current.preview).toBeNull();
    expect(result.current.error).toMatch(/required section empty/i);
    expect(putVersion).not.toHaveBeenCalled();
  });

  it('applies and records an accepted proposal', async () => {
    const { result, onDocumentChanged } = setup();
    await act(() => result.current.propose('Tighten'));
    await act(() => result.current.accept());

    expect(commitVersion).toHaveBeenCalledWith(expect.objectContaining({
      draftId: 'draft-1',
      paragraphs: [{ role: 'body', text: 'Concise text.' }],
      sourceTurnId: 'turn-1',
    }));
    expect(onDocumentChanged).toHaveBeenCalledWith('accepted');
    await waitFor(() => expect(result.current.preview).toBeNull());
  });

  it('records rejection without applying the proposal', async () => {
    const { result } = setup();
    await act(() => result.current.propose('Tighten'));
    await act(() => result.current.reject());

    expect(commitVersion).not.toHaveBeenCalled();
    expect(updateTurn).toHaveBeenCalledWith('turn-1', { user_decision: 'rejected' });
    expect(setTurnStatus).toHaveBeenCalledWith('turn-1', 'cancelled');
  });

  it('recovers an awaiting proposal and its durable snapshots after reload', async () => {
    findSession.mockResolvedValue({
      id: 'session-1',
      target_kind: 'template_draft',
      target_id: 'draft-1',
      status: 'awaiting_approval',
      active_turn_id: 'turn-1',
    });
    listTurns.mockResolvedValue([turn]);
    listVersions.mockResolvedValue([{
      id: 'preview-1',
      target_kind: 'template_draft',
      target_id: 'draft-1',
      source_turn_id: 'turn-1',
      label: 'Proposed edit',
      status: 'preview',
      snapshot_json: JSON.stringify([{ role: 'body', text: 'Concise text.' }]),
      created_at: '2026-07-27T00:01:00.000Z',
    }]);
    getVersion.mockResolvedValue({
      id: 'version-1',
      target_kind: 'template_draft',
      target_id: 'draft-1',
      label: 'Original',
      status: 'accepted',
      snapshot_json: JSON.stringify(source),
      created_at: '2026-07-27T00:00:00.000Z',
    });

    const { result } = setup();
    await waitFor(() => expect(result.current.preview?.previewVersionId).toBe('preview-1'));
    expect(result.current.preview?.before).toEqual(source);
  });

  it('routes undo through the atomic version service', async () => {
    currentVersion.mockResolvedValue({ id: 'current' });
    const { result } = setup();
    await act(() => result.current.undo({
      id: 'old',
      target_kind: 'template_draft',
      target_id: 'draft-1',
      label: 'Initial',
      status: 'accepted',
      snapshot_json: JSON.stringify(source),
      created_at: '2026-07-27T00:00:00.000Z',
    }));
    expect(undoVersion).toHaveBeenCalledWith({
      draftId: 'draft-1',
      expectedParentVersionId: 'current',
      restoreVersionId: 'old',
    });
  });

  it('uses the same proposal lifecycle with atomic freeform commit and undo adapters', async () => {
    currentVersion.mockResolvedValue({ id: 'freeform-current' });
    const { result } = renderHook(() => useDraftEditingSession({
      target: {
        kind: 'freeform_draft',
        targetId: 'project-1',
        projectId: 'project-1',
        sectionId: 'block-1',
      },
      source,
      client: () => client,
      providerId: 'asksage',
      model: 'model',
      applyProposal: async () => [{ role: 'body', text: 'Freeform revision.' }],
    }));

    await act(() => result.current.propose('Revise block'));
    await act(() => result.current.accept());
    expect(commitFreeformVersion).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      paragraphs: [{ role: 'body', text: 'Freeform revision.' }],
      sourceTurnId: 'turn-1',
    }));

    await act(() => result.current.undo({
      id: 'freeform-old',
      target_kind: 'freeform_draft',
      target_id: 'project-1',
      label: 'Initial freeform draft',
      status: 'accepted',
      snapshot_json: JSON.stringify(source),
      created_at: '2026-07-27T00:00:00.000Z',
    }));
    expect(undoFreeformVersion).toHaveBeenCalledWith({
      projectId: 'project-1',
      expectedParentVersionId: 'freeform-current',
      restoreVersionId: 'freeform-old',
    });
  });
});

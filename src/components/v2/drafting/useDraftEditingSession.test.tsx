import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LLMClient } from '../../../lib/provider/types';
import { useDraftEditingSession } from './useDraftEditingSession';

const startTurn = vi.fn();
const putVersion = vi.fn();
const setTurnStatus = vi.fn();
const updateSession = vi.fn();
const updateTurn = vi.fn();

vi.mock('../../../lib/agentic-editing/runner', () => ({
  startPromptOnlyEditingTurn: (...args: unknown[]) => startTurn(...args),
}));
vi.mock('../../../lib/agentic-editing/store', () => ({
  putDocumentVersion: (...args: unknown[]) => putVersion(...args),
  setEditingTurnStatus: (...args: unknown[]) => setTurnStatus(...args),
  updateEditingSessionStatus: (...args: unknown[]) => updateSession(...args),
  updateEditingTurn: (...args: unknown[]) => updateTurn(...args),
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
  });

  function setup(onAccept = vi.fn(async () => undefined)) {
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
      onAccept,
    }));
    return { ...hook, onAccept };
  }

  it('persists a preview but does not mutate the draft before approval', async () => {
    const { result, onAccept } = setup();
    await act(() => result.current.propose('Tighten'));

    expect(result.current.preview?.after[0].text).toBe('Concise text.');
    expect(onAccept).not.toHaveBeenCalled();
    expect(putVersion).toHaveBeenCalledWith(expect.objectContaining({ status: 'preview' }));
  });

  it('applies and records an accepted proposal', async () => {
    const { result, onAccept } = setup();
    await act(() => result.current.propose('Tighten'));
    await act(() => result.current.accept());

    expect(onAccept).toHaveBeenCalledWith([{ role: 'body', text: 'Concise text.' }]);
    expect(updateTurn).toHaveBeenCalledWith('turn-1', expect.objectContaining({
      user_decision: 'accepted',
    }));
    expect(setTurnStatus).toHaveBeenCalledWith('turn-1', 'completed');
    await waitFor(() => expect(result.current.preview).toBeNull());
  });

  it('records rejection without applying the proposal', async () => {
    const { result, onAccept } = setup();
    await act(() => result.current.propose('Tighten'));
    await act(() => result.current.reject());

    expect(onAccept).not.toHaveBeenCalled();
    expect(updateTurn).toHaveBeenCalledWith('turn-1', { user_decision: 'rejected' });
    expect(setTurnStatus).toHaveBeenCalledWith('turn-1', 'cancelled');
  });
});

import { useCallback, useState } from 'react';
import type { DraftParagraph } from '../../../lib/draft/types';
import { applyDraftEdits } from '../../../lib/edit/dispatcher';
import type { LLMClient } from '../../../lib/provider/types';
import { makeAgentId } from '../../../lib/agentic-editing/ids';
import { startPromptOnlyEditingTurn } from '../../../lib/agentic-editing/runner';
import {
  putDocumentVersion,
  setEditingTurnStatus,
  updateEditingSessionStatus,
  updateEditingTurn,
} from '../../../lib/agentic-editing/store';
import type {
  AcceptanceCriterion,
  EditingTargetRef,
  EditingTurnRecord,
} from '../../../lib/agentic-editing/types';

export interface DraftEditingPreview {
  before: DraftParagraph[];
  after: DraftParagraph[];
  turn: EditingTurnRecord;
  sessionId: string;
  previewVersionId: string;
}

export interface DraftEditingSessionOptions {
  target: EditingTargetRef & { templateId: string; sectionId: string };
  source: DraftParagraph[];
  client: () => LLMClient;
  providerId: EditingTurnRecord['provider_id'];
  model: string;
  onAccept: (paragraphs: DraftParagraph[]) => Promise<void>;
}

export function useDraftEditingSession(options: DraftEditingSessionOptions) {
  const [preview, setPreview] = useState<DraftEditingPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const propose = useCallback(async (
    instruction: string,
    criteria: AcceptanceCriterion[] = [],
  ) => {
    setBusy(true);
    setError(null);
    try {
      const result = await startPromptOnlyEditingTurn(options.client(), {
        target: options.target,
        source: options.source,
        instruction,
        criteria,
        providerId: options.providerId,
        model: options.model,
      });
      const edits = (result.turn.proposal?.operations ?? [])
        .filter((operation) => operation.target === 'draft_paragraphs')
        .map((operation) => operation.operation);
      if (edits.length === 0) throw new Error('The model proposed no applicable draft changes.');
      const applied = applyDraftEdits(
        { edits },
        {
          get: (templateId, sectionId) =>
            templateId === options.target.templateId &&
            sectionId === options.target.sectionId
              ? options.source
              : undefined,
        },
      );
      const failures = applied.applied.filter((item) => !item.success);
      const after = applied.updated.get(`${options.target.templateId}::${options.target.sectionId}`);
      if (failures.length || !after) {
        throw new Error(failures[0]?.error ?? 'The proposal did not change the selected section.');
      }
      const previewVersionId = makeAgentId('version');
      await putDocumentVersion({
        id: previewVersionId,
        target_kind: options.target.kind,
        target_id: options.target.targetId,
        parent_version_id: result.turn.base_version_id,
        source_turn_id: result.turn.id,
        label: 'Proposed edit',
        status: 'preview',
        snapshot_json: JSON.stringify(after),
        created_at: new Date().toISOString(),
      });
      setPreview({
        before: options.source,
        after,
        turn: result.turn,
        sessionId: result.sessionId,
        previewVersionId,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [options]);

  const accept = useCallback(async () => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      await options.onAccept(preview.after);
      await putDocumentVersion({
        id: preview.previewVersionId,
        target_kind: options.target.kind,
        target_id: options.target.targetId,
        parent_version_id: preview.turn.base_version_id,
        source_turn_id: preview.turn.id,
        label: 'Accepted edit',
        status: 'accepted',
        snapshot_json: JSON.stringify(preview.after),
        created_at: new Date().toISOString(),
      });
      await updateEditingTurn(preview.turn.id, {
        result_version_id: preview.previewVersionId,
        user_decision: 'accepted',
      });
      await setEditingTurnStatus(preview.turn.id, 'completed');
      await updateEditingSessionStatus(preview.sessionId, 'completed', preview.turn.id);
      setPreview(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [options, preview]);

  const reject = useCallback(async () => {
    if (!preview) return;
    setBusy(true);
    try {
      await updateEditingTurn(preview.turn.id, { user_decision: 'rejected' });
      await setEditingTurnStatus(preview.turn.id, 'cancelled');
      await updateEditingSessionStatus(preview.sessionId, 'cancelled', preview.turn.id);
      setPreview(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [preview]);

  return { accept, busy, error, preview, propose, reject };
}

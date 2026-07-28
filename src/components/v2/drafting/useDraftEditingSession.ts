import { useCallback, useEffect, useState } from 'react';
import type { DraftParagraph } from '../../../lib/draft/types';
import { applyDraftEdits } from '../../../lib/edit/dispatcher';
import type { LLMClient } from '../../../lib/provider/types';
import { makeAgentId } from '../../../lib/agentic-editing/ids';
import { startPromptOnlyEditingTurn } from '../../../lib/agentic-editing/runner';
import {
  putDocumentVersion,
  findActiveSessionForTarget,
  getDocumentVersion,
  listSessionTurns,
  listTargetVersions,
  setEditingTurnStatus,
  updateEditingSessionStatus,
  updateEditingTurn,
} from '../../../lib/agentic-editing/store';
import type {
  AcceptanceCriterion,
  EditingTargetRef,
  EditingTurnRecord,
  DocumentVersionRecord,
} from '../../../lib/agentic-editing/types';
import {
  commitTemplateDraftVersion,
  getCurrentAcceptedVersion,
  undoTemplateDraftVersion,
} from '../../../lib/agentic-editing/versions';

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
  onDocumentChanged?: (change: 'accepted' | 'restored') => void;
}

export function useDraftEditingSession(options: DraftEditingSessionOptions) {
  const [preview, setPreview] = useState<DraftEditingPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [versions, setVersions] = useState<DocumentVersionRecord[]>([]);

  const refreshVersions = useCallback(async () => {
    setVersions(await listTargetVersions(options.target.kind, options.target.targetId));
  }, [options.target.kind, options.target.targetId]);

  useEffect(() => {
    let active = true;
    const recover = async () => {
      try {
        const [session] = await Promise.all([
          findActiveSessionForTarget(options.target.kind, options.target.targetId),
          refreshVersions(),
        ]);
        if (!active || !session?.active_turn_id) return;
        const turns = await listSessionTurns(session.id);
        const turn = turns.find((item) => item.id === session.active_turn_id);
        if (!turn?.proposal || turn.status !== 'awaiting_user_approval') return;
        const targetVersions = await listTargetVersions(options.target.kind, options.target.targetId);
        const proposalVersion = targetVersions.find(
          (version) => version.source_turn_id === turn.id && version.status === 'preview',
        );
        const baseVersion = await getDocumentVersion(turn.base_version_id);
        if (!active || !proposalVersion || !baseVersion) return;
        const before = parseParagraphSnapshot(baseVersion.snapshot_json);
        const after = parseParagraphSnapshot(proposalVersion.snapshot_json);
        if (!before || !after) return;
        setPreview({
          before,
          after,
          turn,
          sessionId: session.id,
          previewVersionId: proposalVersion.id,
        });
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : String(cause));
      }
    };
    void recover();
    return () => { active = false; };
  }, [
    options.target.kind,
    options.target.targetId,
    refreshVersions,
  ]);

  const propose = useCallback(async (
    instruction: string,
    criteria: AcceptanceCriterion[] = [],
  ) => {
    setBusy(true);
    setError(null);
    try {
      if (preview) {
        await updateEditingTurn(preview.turn.id, { user_decision: 'refined' });
        await setEditingTurnStatus(preview.turn.id, 'cancelled');
        await updateEditingSessionStatus(preview.sessionId, 'completed', preview.turn.id);
        await putDocumentVersion({
          id: preview.previewVersionId,
          target_kind: options.target.kind,
          target_id: options.target.targetId,
          parent_version_id: preview.turn.base_version_id,
          source_turn_id: preview.turn.id,
          label: 'Superseded proposal',
          status: 'superseded',
          snapshot_json: JSON.stringify(preview.after),
          created_at: new Date().toISOString(),
        });
      }
      const currentVersion = await getCurrentAcceptedVersion(
        options.target.kind,
        options.target.targetId,
      );
      const result = await startPromptOnlyEditingTurn(options.client(), {
        target: options.target,
        source: options.source,
        instruction,
        criteria,
        providerId: options.providerId,
        model: options.model,
        baseVersionId: currentVersion?.id,
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
      await refreshVersions();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [options, preview, refreshVersions]);

  const accept = useCallback(async () => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      await commitTemplateDraftVersion({
        draftId: options.target.targetId,
        expectedParentVersionId: preview.turn.base_version_id,
        paragraphs: preview.after,
        sourceTurnId: preview.turn.id,
        summary: preview.turn.proposal?.summary || preview.turn.instruction,
      });
      await updateEditingSessionStatus(preview.sessionId, 'completed', preview.turn.id);
      setPreview(null);
      await refreshVersions();
      options.onDocumentChanged?.('accepted');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [options, preview, refreshVersions]);

  const reject = useCallback(async () => {
    if (!preview) return;
    setBusy(true);
    try {
      await updateEditingTurn(preview.turn.id, { user_decision: 'rejected' });
      await setEditingTurnStatus(preview.turn.id, 'cancelled');
      await updateEditingSessionStatus(preview.sessionId, 'cancelled', preview.turn.id);
      setPreview(null);
      await refreshVersions();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [preview, refreshVersions]);

  const undo = useCallback(async (version: DocumentVersionRecord) => {
    setBusy(true);
    setError(null);
    try {
      const current = await getCurrentAcceptedVersion(options.target.kind, options.target.targetId);
      if (!current) throw new Error('There is no current revision to undo.');
      await undoTemplateDraftVersion({
        draftId: options.target.targetId,
        expectedParentVersionId: current.id,
        restoreVersionId: version.id,
      });
      await refreshVersions();
      options.onDocumentChanged?.('restored');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [options, refreshVersions]);

  return { accept, busy, error, preview, propose, reject, undo, versions };
}

function parseParagraphSnapshot(snapshot: string): DraftParagraph[] | null {
  try {
    const value = JSON.parse(snapshot);
    if (
      !Array.isArray(value) ||
      value.some((paragraph) =>
        !paragraph ||
        typeof paragraph !== 'object' ||
        typeof paragraph.text !== 'string' ||
        typeof paragraph.role !== 'string'
      )
    ) return null;
    return value as DraftParagraph[];
  } catch {
    return null;
  }
}

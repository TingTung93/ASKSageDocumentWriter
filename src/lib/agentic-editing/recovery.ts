import { db } from '../db/schema';
import {
  assertLegalSessionTransition,
  assertLegalTurnTransition,
  statusTransitionMetadata,
} from './lifecycle';
import type {
  EditingSessionRecord,
  EditingTargetRef,
  EditingTurnRecord,
  StoredAgentCheckpoint,
} from './types';

const EXECUTING_SESSION_STATUSES = new Set<EditingSessionRecord['status']>([
  'preparing',
  'running',
  'validating',
]);
const EXECUTING_TURN_STATUSES = new Set<EditingTurnRecord['status']>([
  'preparing',
  'running',
  'validating',
]);
const RECOVERABLE_SESSION_STATUSES = new Set<EditingSessionRecord['status']>([
  'preparing',
  'running',
  'validating',
  'awaiting_approval',
  'awaiting_connection',
  'interrupted',
]);
const APPROVAL_TURN_STATUSES = new Set<EditingTurnRecord['status']>([
  'awaiting_plan_approval',
  'awaiting_tool_approval',
  'awaiting_user_approval',
  'awaiting_approval',
]);

export interface EditingRecoveryPolicy {
  /** Recovery readers never invoke external side effects. */
  replayProviderCalls: false;
  replayToolCalls: false;
  autoAccept: false;
  autoCommit: false;
}

export const SAFE_EDITING_RECOVERY_POLICY: EditingRecoveryPolicy = Object.freeze({
  replayProviderCalls: false,
  replayToolCalls: false,
  autoAccept: false,
  autoCommit: false,
});

export type EditingRecoveryMode =
  | 'awaiting_approval'
  | 'resume_checkpoint'
  | 'restart_generation'
  | 'in_progress';

export interface RecoveredEditingState {
  session: EditingSessionRecord;
  turn: EditingTurnRecord | null;
  checkpoint: StoredAgentCheckpoint | null;
  mode: EditingRecoveryMode;
  interrupted: boolean;
  policy: EditingRecoveryPolicy;
  explanation: string;
}

export interface RecoverEditingOptions {
  now?: Date;
  staleAfterMs?: number;
}

function targetMatches(
  session: EditingSessionRecord,
  target: EditingTargetRef,
): boolean {
  return session.target_kind === target.kind
    && session.target_id === target.targetId
    && (target.projectId === undefined || session.project_id === target.projectId);
}

async function findRecoveryCheckpoint(
  sessionId: string,
  turnId: string | undefined,
): Promise<StoredAgentCheckpoint | null> {
  const threadIds = turnId ? [turnId, sessionId] : [sessionId];
  const rows: StoredAgentCheckpoint[] = [];
  for (const threadId of threadIds) {
    rows.push(...await db.agent_checkpoints.where('thread_id').equals(threadId).toArray());
  }
  return rows.sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0] ?? null;
}

/**
 * Reconstructs persisted editing state only. It deliberately accepts no
 * provider or tool executor, making repeated external side effects impossible.
 */
export async function recoverActiveEditingTarget(
  target: EditingTargetRef,
  options: RecoverEditingOptions = {},
): Promise<RecoveredEditingState | null> {
  const now = options.now ?? new Date();
  const staleAfterMs = options.staleAfterMs ?? 60_000;
  const sessions = await db.editing_sessions
    .where('target_kind')
    .equals(target.kind)
    .and((session) => targetMatches(session, target) && RECOVERABLE_SESSION_STATUSES.has(session.status))
    .toArray();
  let session = sessions.sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
  if (!session) return null;

  const turns = await db.editing_turns.where('session_id').equals(session.id).toArray();
  let turn = session.active_turn_id
    ? turns.find(({ id }) => id === session.active_turn_id)
    : undefined;
  turn ??= turns.sort((a, b) => b.created_at.localeCompare(a.created_at))[0];

  const lastUpdateMs = Date.parse(session.updated_at);
  const stale = EXECUTING_SESSION_STATUSES.has(session.status)
    && Number.isFinite(lastUpdateMs)
    && now.getTime() - lastUpdateMs >= staleAfterMs;

  if (stale) {
    const reason = `Execution became stale after ${staleAfterMs} ms; recovered without replaying side effects.`;
    await db.transaction('rw', db.editing_sessions, db.editing_turns, async () => {
      assertLegalSessionTransition(session!.status, 'interrupted');
      await db.editing_sessions.update(session!.id, {
        status: 'interrupted',
        updated_at: now.toISOString(),
        ...statusTransitionMetadata(session!.status, 'interrupted', reason, now),
      });
      if (turn && EXECUTING_TURN_STATUSES.has(turn.status)) {
        assertLegalTurnTransition(turn.status, 'interrupted');
        await db.editing_turns.update(turn.id, {
          status: 'interrupted',
          ...statusTransitionMetadata(turn.status, 'interrupted', reason, now),
        });
      }
    });
    session = (await db.editing_sessions.get(session.id))!;
    if (turn) turn = await db.editing_turns.get(turn.id);
  }

  const checkpoint = await findRecoveryCheckpoint(session.id, turn?.id);
  if (turn && APPROVAL_TURN_STATUSES.has(turn.status)) {
    return {
      session,
      turn,
      checkpoint,
      mode: 'awaiting_approval',
      interrupted: false,
      policy: SAFE_EDITING_RECOVERY_POLICY,
      explanation: 'A durable proposal is awaiting explicit user approval; no generation or commit was replayed.',
    };
  }
  if (session.status === 'awaiting_approval' && turn?.proposal) {
    return {
      session,
      turn,
      checkpoint,
      mode: 'awaiting_approval',
      interrupted: false,
      policy: SAFE_EDITING_RECOVERY_POLICY,
      explanation: 'A durable proposal is awaiting explicit user approval; no generation or commit was replayed.',
    };
  }
  if (session.status === 'interrupted' || turn?.status === 'interrupted') {
    return {
      session,
      turn: turn ?? null,
      checkpoint,
      mode: checkpoint ? 'resume_checkpoint' : 'restart_generation',
      interrupted: true,
      policy: SAFE_EDITING_RECOVERY_POLICY,
      explanation: checkpoint
        ? 'Resume from the latest durable checkpoint; completed provider and tool results must be reused.'
        : 'No safe checkpoint exists. Start a new generation turn while preserving this interrupted record.',
    };
  }
  return {
    session,
    turn: turn ?? null,
    checkpoint,
    mode: 'in_progress',
    interrupted: false,
    policy: SAFE_EDITING_RECOVERY_POLICY,
    explanation: 'Execution is still within its freshness window; recovery did not start another run.',
  };
}

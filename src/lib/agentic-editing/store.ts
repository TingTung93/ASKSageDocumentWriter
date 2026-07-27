import { db } from '../db/schema';
import type {
  DocumentVersionRecord,
  EditingSessionRecord,
  EditingSessionStatus,
  EditingTurnRecord,
  EditingTurnStatus,
} from './types';

export async function createEditingSession(record: EditingSessionRecord): Promise<void> {
  await db.editing_sessions.put(record);
}

export async function getEditingSession(id: string): Promise<EditingSessionRecord | undefined> {
  return db.editing_sessions.get(id);
}

export async function findActiveSessionForTarget(
  targetKind: EditingSessionRecord['target_kind'],
  targetId: string,
): Promise<EditingSessionRecord | undefined> {
  const rows = await db.editing_sessions
    .where('target_kind')
    .equals(targetKind)
    .and((row) => row.target_id === targetId)
    .toArray();
  return rows
    .filter((row) => row.status === 'running' || row.status === 'awaiting_approval' || row.status === 'awaiting_connection')
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
}

export async function updateEditingSessionStatus(
  id: string,
  status: EditingSessionStatus,
  activeTurnId?: string,
): Promise<void> {
  await db.editing_sessions.update(id, {
    status,
    active_turn_id: activeTurnId,
    updated_at: new Date().toISOString(),
  });
}

export async function appendEditingTurn(record: EditingTurnRecord): Promise<void> {
  await db.editing_turns.add(record);
}

export async function updateEditingTurn(
  id: string,
  patch: Partial<Omit<EditingTurnRecord, 'id' | 'session_id' | 'created_at'>>,
): Promise<void> {
  await db.editing_turns.update(id, patch);
}

export async function setEditingTurnStatus(
  id: string,
  status: EditingTurnStatus,
): Promise<void> {
  await updateEditingTurn(id, {
    status,
    ...(status === 'completed' || status === 'failed' || status === 'cancelled' || status === 'budget_exceeded'
      ? { completed_at: new Date().toISOString() }
      : {}),
  });
}

export async function listSessionTurns(sessionId: string): Promise<EditingTurnRecord[]> {
  const rows = await db.editing_turns.where('session_id').equals(sessionId).toArray();
  return rows.sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export async function putDocumentVersion(record: DocumentVersionRecord): Promise<void> {
  await db.document_versions.put(record);
}

export async function getDocumentVersion(id: string): Promise<DocumentVersionRecord | undefined> {
  return db.document_versions.get(id);
}

export async function listTargetVersions(
  targetKind: DocumentVersionRecord['target_kind'],
  targetId: string,
): Promise<DocumentVersionRecord[]> {
  const rows = await db.document_versions
    .where('target_kind')
    .equals(targetKind)
    .and((row) => row.target_id === targetId)
    .toArray();
  return rows.sort((a, b) => a.created_at.localeCompare(b.created_at));
}

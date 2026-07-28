import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/schema';
import {
  createEditingSession,
  findActiveSessionForTarget,
  listSessionTurns,
  setEditingTurnStatus,
  updateEditingSessionStatus,
} from './store';
import type { EditingSessionRecord, EditingTurnRecord } from './types';

const now = '2026-07-27T00:00:00.000Z';

function session(): EditingSessionRecord {
  return {
    id: 'session_1', target_kind: 'uploaded_document', target_id: 'document_1',
    status: 'running', created_at: now, updated_at: now,
  };
}

describe('agentic editing store', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  it('finds active sessions by target', async () => {
    await createEditingSession(session());
    await expect(findActiveSessionForTarget('uploaded_document', 'document_1')).resolves.toMatchObject({ id: 'session_1' });
  });

  it('orders session turns by creation time', async () => {
    const first: EditingTurnRecord = {
      id: 'turn_1', session_id: 'session_1', target: { kind: 'uploaded_document', targetId: 'document_1' },
      base_version_id: 'version_1', instruction: 'First', acceptance_criteria: [], provider_id: 'asksage',
      models_used: [], status: 'running', created_at: '2026-07-27T00:00:00.000Z',
    };
    await db.editing_turns.add(first);
    await db.editing_turns.add({ ...first, id: 'turn_2', instruction: 'Second', created_at: '2026-07-27T00:01:00.000Z' });
    expect((await listSessionTurns('session_1')).map((turn) => turn.id)).toEqual(['turn_1', 'turn_2']);
  });

  it('enforces durable transitions and records their reason', async () => {
    await createEditingSession(session());
    const first: EditingTurnRecord = {
      id: 'turn_1', session_id: 'session_1', target: { kind: 'uploaded_document', targetId: 'document_1' },
      base_version_id: 'version_1', instruction: 'First', acceptance_criteria: [], provider_id: 'asksage',
      models_used: [], status: 'running', created_at: now,
    };
    await db.editing_turns.add(first);

    await updateEditingSessionStatus('session_1', 'interrupted', 'turn_1', 'Browser closed.');
    await setEditingTurnStatus('turn_1', 'interrupted', 'Browser closed.');

    expect(await db.editing_sessions.get('session_1')).toMatchObject({
      status: 'interrupted',
      status_reason: 'Browser closed.',
    });
    expect(await db.editing_turns.get('turn_1')).toMatchObject({
      status: 'interrupted',
      status_reason: 'Browser closed.',
    });

    await setEditingTurnStatus('turn_1', 'failed', 'Cannot resume safely.');
    await expect(setEditingTurnStatus('turn_1', 'running')).rejects.toThrow(
      /failed -> running/,
    );
  });
});

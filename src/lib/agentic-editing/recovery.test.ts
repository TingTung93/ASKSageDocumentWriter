import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/schema';
import { recoverActiveEditingTarget } from './recovery';
import type {
  EditingSessionRecord,
  EditingTurnRecord,
} from './types';

const old = '2026-07-27T00:00:00.000Z';
const now = new Date('2026-07-27T00:10:00.000Z');

function session(overrides: Partial<EditingSessionRecord> = {}): EditingSessionRecord {
  return {
    id: 'session-1',
    target_kind: 'template_draft',
    target_id: 'draft-1',
    project_id: 'project-1',
    status: 'running',
    active_turn_id: 'turn-1',
    created_at: old,
    updated_at: old,
    ...overrides,
  };
}

function turn(overrides: Partial<EditingTurnRecord> = {}): EditingTurnRecord {
  return {
    id: 'turn-1',
    session_id: 'session-1',
    target: {
      kind: 'template_draft',
      targetId: 'draft-1',
      projectId: 'project-1',
      templateId: 'template-1',
      sectionId: 'section-1',
    },
    base_version_id: 'version-1',
    instruction: 'Tighten this section.',
    acceptance_criteria: [],
    provider_id: 'local_openai',
    models_used: ['local-model'],
    status: 'running',
    created_at: old,
    ...overrides,
  };
}

describe('editing recovery', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  it('derives stale running state as interrupted without replaying side effects', async () => {
    await db.editing_sessions.add(session());
    await db.editing_turns.add(turn());

    const recovered = await recoverActiveEditingTarget(turn().target, {
      now,
      staleAfterMs: 30_000,
    });

    expect(recovered).toMatchObject({
      mode: 'restart_generation',
      interrupted: true,
      policy: {
        replayProviderCalls: false,
        replayToolCalls: false,
        autoAccept: false,
        autoCommit: false,
      },
    });
    expect((await db.editing_sessions.get('session-1'))?.status).toBe('interrupted');
    expect((await db.editing_turns.get('turn-1'))?.status).toBe('interrupted');
    expect(recovered?.session.status_reason).toMatch(/without replaying side effects/i);
  });

  it('restores an awaiting-approval proposal without accepting it', async () => {
    const proposal = {
      summary: 'Tightened section',
      operations: [],
      criterionCoverage: [],
      evidence: [],
      assumptions: [],
      unresolvedQuestions: [],
    };
    await db.editing_sessions.add(session({
      status: 'awaiting_approval',
      updated_at: now.toISOString(),
    }));
    await db.editing_turns.add(turn({
      status: 'awaiting_user_approval',
      proposal,
    }));

    const recovered = await recoverActiveEditingTarget(turn().target, { now });

    expect(recovered?.mode).toBe('awaiting_approval');
    expect(recovered?.turn?.proposal).toEqual(proposal);
    expect(recovered?.turn?.user_decision).toBeUndefined();
    expect(recovered?.turn?.result_version_id).toBeUndefined();
  });

  it('selects the latest checkpoint but never executes it during recovery', async () => {
    await db.editing_sessions.add(session());
    await db.editing_turns.add(turn());
    await db.agent_checkpoints.bulkAdd([
      {
        id: 'checkpoint-1',
        thread_id: 'turn-1',
        checkpoint_ns: '',
        checkpoint_id: '1',
        payload_json: '{"completedToolResults":["result-1"]}',
        updated_at: '2026-07-27T00:01:00.000Z',
      },
      {
        id: 'checkpoint-2',
        thread_id: 'turn-1',
        checkpoint_ns: '',
        checkpoint_id: '2',
        payload_json: '{"completedToolResults":["result-1","result-2"]}',
        updated_at: '2026-07-27T00:02:00.000Z',
      },
    ]);

    const recovered = await recoverActiveEditingTarget(turn().target, {
      now,
      staleAfterMs: 30_000,
    });

    expect(recovered?.mode).toBe('resume_checkpoint');
    expect(recovered?.checkpoint?.id).toBe('checkpoint-2');
    expect(recovered?.policy.replayToolCalls).toBe(false);
  });

  it('isolates recovery by project and target', async () => {
    await db.editing_sessions.bulkAdd([
      session({ id: 'session-a', active_turn_id: undefined }),
      session({
        id: 'session-b',
        target_id: 'draft-1',
        project_id: 'project-2',
        active_turn_id: undefined,
        updated_at: '2026-07-27T00:09:00.000Z',
      }),
    ]);

    const recovered = await recoverActiveEditingTarget(turn().target, {
      now,
      staleAfterMs: 15 * 60_000,
    });

    expect(recovered?.session.id).toBe('session-a');
  });

  it('returns null when the target has no recoverable session', async () => {
    await db.editing_sessions.add(session({ status: 'accepted' }));
    await expect(recoverActiveEditingTarget(turn().target, { now })).resolves.toBeNull();
  });
});

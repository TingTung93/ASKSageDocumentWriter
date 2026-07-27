import { listTurnArtifacts } from './artifacts';
import { listTurnTrace } from './journal';
import { getEditingSession, listSessionTurns } from './store';

export type TraceExportMode = 'sanitized' | 'full';

/** Export a deterministic diagnostic package. Sanitized exports retain event
 * metadata but omit artifacts containing document text. */
export async function exportEditingDiagnostics(sessionId: string, mode: TraceExportMode): Promise<string> {
  const session = await getEditingSession(sessionId);
  if (!session) throw new Error(`Editing session ${sessionId} was not found.`);
  const turns = await listSessionTurns(sessionId);
  const details = await Promise.all(turns.map(async (turn) => ({
    turn: mode === 'full' ? turn : redactTurn(turn),
    events: await listTurnTrace(turn.id),
    artifacts: (await listTurnArtifacts(turn.id)).filter((artifact) => mode === 'full' || !artifact.containsDocumentContent).map((artifact) => mode === 'full' ? artifact : ({ ...artifact, content: '[omitted from sanitized export]' })),
  })));
  return JSON.stringify({ format: 'asksage-agent-trace/v1', mode, exportedAt: new Date().toISOString(), session, turns: details }, null, 2);
}

function redactTurn(turn: Awaited<ReturnType<typeof listSessionTurns>>[number]) {
  return {
    id: turn.id,
    session_id: turn.session_id,
    parent_turn_id: turn.parent_turn_id,
    base_version_id: turn.base_version_id,
    result_version_id: turn.result_version_id,
    provider_id: turn.provider_id,
    models_used: turn.models_used,
    execution_path: turn.execution_path,
    status: turn.status,
    user_decision: turn.user_decision,
    created_at: turn.created_at,
    completed_at: turn.completed_at,
    redacted: true,
  };
}

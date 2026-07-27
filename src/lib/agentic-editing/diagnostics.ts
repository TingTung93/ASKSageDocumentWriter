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
    turn,
    events: await listTurnTrace(turn.id),
    artifacts: (await listTurnArtifacts(turn.id)).filter((artifact) => mode === 'full' || !artifact.containsDocumentContent).map((artifact) => mode === 'full' ? artifact : ({ ...artifact, content: '[omitted from sanitized export]' })),
  })));
  return JSON.stringify({ format: 'asksage-agent-trace/v1', mode, exportedAt: new Date().toISOString(), session, turns: details }, null, 2);
}

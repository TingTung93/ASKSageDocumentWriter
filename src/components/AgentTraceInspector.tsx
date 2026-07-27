import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db/schema';
import type { EditingTargetKind } from '../lib/agentic-editing/types';
import type { AgentTraceArtifact, AgentTraceEvent } from '../lib/agentic-editing/types';

export function AgentTraceInspector({ targetKind, targetId }: { targetKind: EditingTargetKind; targetId: string }): JSX.Element | null {
  const sessions = useLiveQuery(
    () => db.editing_sessions.where('target_kind').equals(targetKind).and((row) => row.target_id === targetId).reverse().sortBy('updated_at'),
    [targetKind, targetId],
  );
  const [selectedTurnId, setSelectedTurnId] = useState<string | null>(null);
  const turnId = selectedTurnId ?? sessions?.[0]?.active_turn_id ?? null;
  const events = useLiveQuery<AgentTraceEvent[]>(async () => turnId ? db.agent_trace_events.where('turnId').equals(turnId).sortBy('sequence') : [], [turnId]);
  const artifacts = useLiveQuery<AgentTraceArtifact[]>(async () => turnId ? db.agent_trace_artifacts.where('turnId').equals(turnId).sortBy('createdAt') : [], [turnId]);
  const [artifactId, setArtifactId] = useState<string | null>(null);
  const selectedArtifact = artifacts?.find((item) => item.id === artifactId) ?? null;
  if (!sessions || sessions.length === 0) return null;

  return (
    <section className="agent-trace-inspector" aria-label="Agent execution trace">
      <h3>Agent execution trace</h3>
      <p className="muted">Every stage, routing decision, model request, response, and validation result is recorded here. This shows prompts and provider output, not hidden reasoning.</p>
      <label>
        Turn
        <select value={turnId ?? ''} onChange={(event) => setSelectedTurnId(event.target.value)}>
          {sessions.flatMap((session) => session.active_turn_id ? [session.active_turn_id] : []).map((id) => <option key={id} value={id}>{id}</option>)}
        </select>
      </label>
      <ol className="agent-trace-timeline">
        {(events ?? []).map((event) => (
          <li key={event.id} data-status={event.status}>
            <strong>{event.sequence}. {event.node}</strong> — {event.summary}
            {event.reason && <div className="muted">Why: {event.reason}</div>}
            {event.error && <div role="alert">{event.error.message}</div>}
          </li>
        ))}
      </ol>
      <div>
        <h4>Trace artifacts</h4>
        {(artifacts ?? []).map((artifact) => (
          <button key={artifact.id} type="button" onClick={() => setArtifactId(artifact.id)}>
            View {artifact.kind}{artifact.truncated ? ' (truncated)' : ''}
          </button>
        ))}
      </div>
      {selectedArtifact && <details open><summary>{selectedArtifact.kind}</summary><pre>{selectedArtifact.content}</pre></details>}
    </section>
  );
}

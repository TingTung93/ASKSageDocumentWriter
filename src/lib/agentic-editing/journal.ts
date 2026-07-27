import { db } from '../db/schema';
import { makeAgentId } from './ids';
import type { AgentTraceEvent, AgentTraceEventType, WorkflowError } from './types';

export interface JournalEventInput {
  sessionId: string;
  turnId: string;
  spanId?: string;
  parentSpanId?: string;
  node: string;
  attempt?: number;
  type: AgentTraceEventType;
  status: AgentTraceEvent['status'];
  summary: string;
  reason?: string;
  inputArtifactIds?: string[];
  outputArtifactIds?: string[];
  checkpointId?: string;
  durationMs?: number;
  tokensIn?: number;
  tokensOut?: number;
  error?: WorkflowError;
}

export async function appendTraceEvent(input: JournalEventInput): Promise<AgentTraceEvent> {
  if (input.type === 'route.selected' && !input.reason?.trim()) {
    throw new Error('route.selected trace events require a reason');
  }
  const event = await db.transaction('rw', db.agent_trace_events, async () => {
    const rows = await db.agent_trace_events.where('turnId').equals(input.turnId).toArray();
    const sequence = rows.reduce((highest, row) => Math.max(highest, row.sequence), 0) + 1;
    const next: AgentTraceEvent = {
      id: makeAgentId('trace'),
      sessionId: input.sessionId,
      turnId: input.turnId,
      sequence,
      timestamp: new Date().toISOString(),
      spanId: input.spanId ?? input.node,
      ...(input.parentSpanId ? { parentSpanId: input.parentSpanId } : {}),
      node: input.node,
      attempt: input.attempt ?? 1,
      type: input.type,
      status: input.status,
      summary: input.summary,
      ...(input.reason ? { reason: input.reason } : {}),
      inputArtifactIds: input.inputArtifactIds ?? [],
      outputArtifactIds: input.outputArtifactIds ?? [],
      ...(input.checkpointId ? { checkpointId: input.checkpointId } : {}),
      ...(input.durationMs === undefined ? {} : { durationMs: input.durationMs }),
      ...(input.tokensIn === undefined ? {} : { tokensIn: input.tokensIn }),
      ...(input.tokensOut === undefined ? {} : { tokensOut: input.tokensOut }),
      ...(input.error ? { error: input.error } : {}),
    };
    await db.agent_trace_events.add(next);
    return next;
  });
  return event;
}

export async function listTurnTrace(turnId: string): Promise<AgentTraceEvent[]> {
  const rows = await db.agent_trace_events.where('turnId').equals(turnId).toArray();
  return rows.sort((a, b) => a.sequence - b.sequence);
}

export async function hasTerminalSpanEvent(turnId: string, spanId: string): Promise<boolean> {
  const rows = await db.agent_trace_events.where('turnId').equals(turnId).toArray();
  return rows.some((event) => event.spanId === spanId && (
    event.type === 'node.completed' || event.type === 'node.failed' || event.type === 'node.cancelled' || event.type === 'node.skipped'
  ));
}

import { db } from '../db/schema';
import { makeAgentId } from './ids';
import type { AgentTraceArtifact, AgentTraceArtifactKind } from './types';

export async function sha256(content: string): Promise<string> {
  const bytes = new TextEncoder().encode(content);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function putTraceArtifact(args: {
  sessionId: string;
  turnId: string;
  kind: AgentTraceArtifactKind;
  mediaType?: AgentTraceArtifact['mediaType'];
  content: string;
  containsDocumentContent: boolean;
  maxCharacters?: number;
}): Promise<AgentTraceArtifact> {
  const maxCharacters = args.maxCharacters ?? 250_000;
  const originalCharacterCount = args.content.length;
  const truncated = originalCharacterCount > maxCharacters;
  const content = truncated ? args.content.slice(0, maxCharacters) : args.content;
  const contentHash = await sha256(content);
  const existing = await db.agent_trace_artifacts
    .where('sha256')
    .equals(contentHash)
    .and((artifact) => artifact.turnId === args.turnId && artifact.kind === args.kind)
    .first();
  if (existing) return existing;

  const artifact: AgentTraceArtifact = {
    id: makeAgentId('artifact'),
    sessionId: args.sessionId,
    turnId: args.turnId,
    kind: args.kind,
    mediaType: args.mediaType ?? 'application/json',
    content,
    sha256: contentHash,
    createdAt: new Date().toISOString(),
    containsDocumentContent: args.containsDocumentContent,
    truncated,
    ...(truncated ? { originalCharacterCount } : {}),
  };
  await db.agent_trace_artifacts.add(artifact);
  return artifact;
}

export async function getTraceArtifact(id: string): Promise<AgentTraceArtifact | undefined> {
  return db.agent_trace_artifacts.get(id);
}

export async function listTurnArtifacts(turnId: string): Promise<AgentTraceArtifact[]> {
  const rows = await db.agent_trace_artifacts.where('turnId').equals(turnId).toArray();
  return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function deleteTurnTraceArtifacts(turnId: string): Promise<void> {
  const rows = await db.agent_trace_artifacts.where('turnId').equals(turnId).toArray();
  await db.agent_trace_artifacts.bulkDelete(rows.map((row) => row.id));
}

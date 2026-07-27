import type { ModelInfo } from '../asksage/types';
import type { LLMClient } from '../provider/types';
import { putTraceArtifact } from './artifacts';
import { resolveAgentCapabilities } from './capabilities';
import { makeAgentId } from './ids';
import { appendTraceEvent } from './journal';
import { runPromptOnlyEditing } from './prompt-only';
import { withAuditedTransport } from './transport';
import {
  appendEditingTurn, createEditingSession, putDocumentVersion, updateEditingSessionStatus, updateEditingTurn,
} from './store';
import type { AcceptanceCriterion, EditingTargetRef, EditingTurnRecord } from './types';

export interface StartEditingTurnInput {
  target: EditingTargetRef;
  source: unknown;
  instruction: string;
  criteria: AcceptanceCriterion[];
  providerId: EditingTurnRecord['provider_id'];
  model: string;
  modelInfo?: ModelInfo;
  baseVersionId?: string;
}

export interface StartEditingTurnResult {
  sessionId: string;
  turn: EditingTurnRecord;
}

/**
 * Executes the provider-independent first pass and writes a replayable audit
 * record before returning. Applying a proposal is intentionally separate:
 * no generated edit reaches a document until the user approves it.
 */
export async function startPromptOnlyEditingTurn(
  client: LLMClient,
  input: StartEditingTurnInput,
): Promise<StartEditingTurnResult> {
  const sessionId = makeAgentId('edit-session');
  const turnId = makeAgentId('edit-turn');
  const now = new Date().toISOString();
  const baseVersionId = input.baseVersionId ?? makeAgentId('version');
  const capabilities = resolveAgentCapabilities(client, input.modelInfo);
  // The first shipped editing graph is deliberately provider-neutral. Even
  // on a tool-capable API it starts with the durable prompt-only baseline;
  // no UI or trace can therefore imply that an opaque tool loop occurred.
  const route = 'prompt_only' as const;

  await createEditingSession({
    id: sessionId, target_kind: input.target.kind, target_id: input.target.targetId,
    project_id: input.target.projectId, status: 'running', active_turn_id: turnId,
    created_at: now, updated_at: now,
  });
  if (!input.baseVersionId) {
    await putDocumentVersion({
      id: baseVersionId, target_kind: input.target.kind, target_id: input.target.targetId,
      label: 'Original snapshot', status: 'accepted', snapshot_json: JSON.stringify(input.source), created_at: now,
    });
  }
  const turn: EditingTurnRecord = {
    id: turnId, session_id: sessionId, target: input.target, base_version_id: baseVersionId,
    instruction: input.instruction, acceptance_criteria: input.criteria,
    provider_id: input.providerId, models_used: [input.model], execution_path: route,
    status: 'running', created_at: now,
  };
  await appendEditingTurn(turn);
  await appendTraceEvent({ sessionId, turnId, node: 'turn', type: 'turn.started', status: 'running', summary: 'Editing turn started.' });
  await appendTraceEvent({ sessionId, turnId, node: 'route', type: 'route.selected', status: 'succeeded', summary: 'Using auditable prompt-only workflow.', reason: `${capabilities.evidence.map((item) => item.reason).join(' ')} This editing flow intentionally uses its provider-neutral prompt-only baseline.` });
  const capabilityArtifact = await putTraceArtifact({ sessionId, turnId, kind: 'context_manifest', content: JSON.stringify({ capabilities, target: input.target }), containsDocumentContent: false });
  try {
    const result = await runPromptOnlyEditing(withAuditedTransport(client, { sessionId, turnId }), {
      target: input.target, source: input.source, instruction: input.instruction,
      criteria: input.criteria, model: input.model,
    });
    const artifacts = await Promise.all([
      putTraceArtifact({ sessionId, turnId, kind: 'rendered_prompt', content: result.prompts.plan, containsDocumentContent: true }),
      putTraceArtifact({ sessionId, turnId, kind: 'edit_plan', content: JSON.stringify(result.plan), containsDocumentContent: true }),
      putTraceArtifact({ sessionId, turnId, kind: 'rendered_prompt', content: result.prompts.proposal, containsDocumentContent: true }),
      putTraceArtifact({ sessionId, turnId, kind: 'edit_proposal', content: JSON.stringify(result.proposal), containsDocumentContent: true }),
      putTraceArtifact({ sessionId, turnId, kind: 'rendered_prompt', content: result.prompts.critique, containsDocumentContent: true }),
      putTraceArtifact({ sessionId, turnId, kind: 'critique', content: JSON.stringify(result.critique), containsDocumentContent: true }),
    ]);
    await appendTraceEvent({ sessionId, turnId, node: 'plan-propose-critique', type: 'node.completed', status: 'succeeded', summary: `Proposal reviewed: ${result.critique.verdict}.`, inputArtifactIds: [capabilityArtifact.id], outputArtifactIds: artifacts.map((item) => item.id) });
    // A repair verdict is not an approval. Keep it out of the edit queue
    // until a future repair pass or explicit user intervention resolves it.
    const status = result.critique.verdict === 'pass' ? 'awaiting_user_approval' : 'awaiting_plan_approval';
    const completed: EditingTurnRecord = { ...turn, plan: result.plan, proposal: result.proposal, critique: result.critique, status };
    await updateEditingTurn(turnId, { plan: result.plan, proposal: result.proposal, critique: result.critique, status });
    await updateEditingSessionStatus(sessionId, 'awaiting_approval', turnId);
    await appendTraceEvent({ sessionId, turnId, node: 'turn', type: 'turn.completed', status: 'succeeded', summary: 'Proposal is ready for user approval.' });
    return { sessionId, turn: completed };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await putTraceArtifact({ sessionId, turnId, kind: 'error_detail', content: message, containsDocumentContent: false });
    await updateEditingTurn(turnId, { status: 'failed', completed_at: new Date().toISOString() });
    await updateEditingSessionStatus(sessionId, 'failed');
    await appendTraceEvent({ sessionId, turnId, node: 'plan-propose-critique', type: 'node.failed', status: 'failed', summary: 'Editing turn failed.', error: { code: 'invalid_model_output', message } });
    throw error;
  }
}

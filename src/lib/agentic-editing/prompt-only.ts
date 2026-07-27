import type { LLMClient } from '../provider/types';
import type {
  AcceptanceCriterion, AgentEditOperation, EditCritique, EditPlan, EditProposal,
  EditingTargetRef,
} from './types';

const JSON_ONLY = 'Return strict JSON only. Do not use markdown fences or add commentary outside the JSON object.';

export interface PromptOnlyInput {
  target: EditingTargetRef;
  instruction: string;
  source: unknown;
  criteria: AcceptanceCriterion[];
  model: string;
}

export interface PromptOnlyResult {
  plan: EditPlan;
  proposal: EditProposal;
  critique: EditCritique;
  prompts: { plan: string; proposal: string; critique: string };
}

/**
 * Provider-agnostic plan/propose/critique loop. It deliberately relies only
 * on queryJson, making it usable by GenAI.mil and as the fallback for tool
 * capable APIs. The caller persists every prompt and parsed result.
 */
export async function runPromptOnlyEditing(
  client: LLMClient,
  input: PromptOnlyInput,
): Promise<PromptOnlyResult> {
  const source = JSON.stringify(input.source);
  const criteria = JSON.stringify(input.criteria);
  const planPrompt = [
    'You are an auditable document-editing planner.',
    `Target: ${input.target.kind} ${input.target.targetId}`,
    `Instruction: ${input.instruction}`,
    `Acceptance criteria: ${criteria}`,
    `Source snapshot: ${source}`,
    'Create a narrow edit plan with summary, scope, steps, requiredContext, and risks.', JSON_ONLY,
  ].join('\n\n');
  const plan = await client.queryJson<EditPlan>({ message: planPrompt, model: input.model, temperature: 0, usage: true });

  const proposalPrompt = [
    'You are an auditable document editor. Propose typed operations only; do not modify source directly.',
    `Target: ${input.target.kind}`,
    `Instruction: ${input.instruction}`,
    `Plan: ${JSON.stringify(plan.data)}`,
    `Acceptance criteria: ${criteria}`,
    `Source snapshot: ${source}`,
    'Return summary, operations, criterionCoverage, evidence, assumptions, and unresolvedQuestions.',
    'Each operation must have target plus operation. Never emit an operation outside the target.', JSON_ONLY,
  ].join('\n\n');
  const proposal = await client.queryJson<EditProposal>({ message: proposalPrompt, model: input.model, temperature: 0, usage: true });
  assertProposalTarget(input.target, proposal.data.operations);

  const critiquePrompt = [
    'You are a strict independent reviewer. Do not revise the document.',
    `Instruction: ${input.instruction}`,
    `Acceptance criteria: ${criteria}`,
    `Plan: ${JSON.stringify(plan.data)}`,
    `Proposal: ${JSON.stringify(proposal.data)}`,
    'Return verdict (pass|repair|needs_user), score 0-100, criteria, unsupportedClaims, structuralRisks, styleIssues, repairInstructions.', JSON_ONLY,
  ].join('\n\n');
  const critique = await client.queryJson<EditCritique>({ message: critiquePrompt, model: input.model, temperature: 0, usage: true });
  return { plan: plan.data, proposal: proposal.data, critique: critique.data, prompts: { plan: planPrompt, proposal: proposalPrompt, critique: critiquePrompt } };
}

function assertProposalTarget(target: EditingTargetRef, operations: AgentEditOperation[]): void {
  const expected = target.kind === 'uploaded_document' ? 'uploaded_document'
    : target.kind === 'template_draft' ? 'draft_paragraphs' : 'draft_paragraphs';
  if (operations.some((item) => item.target !== expected)) {
    throw new Error(`The model proposed operations incompatible with ${target.kind}.`);
  }
}

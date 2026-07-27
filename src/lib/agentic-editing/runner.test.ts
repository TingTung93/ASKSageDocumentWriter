import { afterEach, describe, expect, it } from 'vitest';
import { db } from '../db/schema';
import type { LLMClient } from '../provider/types';
import { listTurnTrace } from './journal';
import { startPromptOnlyEditingTurn } from './runner';

const rows = [
  { summary: 'Plan', scope: { sectionIds: [], paragraphIds: [], broadDocumentChange: false }, steps: [], requiredContext: [], risks: [] },
  { summary: 'Proposal', operations: [], criterionCoverage: [], evidence: [], assumptions: [], unresolvedQuestions: [] },
  { verdict: 'pass', score: 100, criteria: [], unsupportedClaims: [], structuralRisks: [], styleIssues: [], repairInstructions: [] },
];
afterEach(async () => { await db.delete(); await db.open(); });

describe('startPromptOnlyEditingTurn', () => {
  it('persists source, prompts, outputs, route, and approval state', async () => {
    let index = 0;
    const client = { capabilities: { fileUpload: false, dataset: false, liveSearch: false, tools: false }, getModels: async () => [], query: async () => ({ message: '', response: '', status: 200, uuid: '' }), queryJson: async () => ({ data: rows[index++]!, raw: { message: '', response: '', status: 200, uuid: '' } }) } as LLMClient;
    const result = await startPromptOnlyEditingTurn(client, { target: { kind: 'uploaded_document', targetId: 'doc-1' }, source: { paragraphs: ['Text'] }, instruction: 'Improve it', criteria: [], providerId: 'genai_mil', model: 'model' });
    expect(result.turn.status).toBe('awaiting_user_approval');
    expect(result.turn.execution_path).toBe('prompt_only');
    expect((await listTurnTrace(result.turn.id)).map((event) => event.type)).toContain('route.selected');
    expect(await db.agent_trace_artifacts.where('turnId').equals(result.turn.id).count()).toBeGreaterThan(4);
  });
});

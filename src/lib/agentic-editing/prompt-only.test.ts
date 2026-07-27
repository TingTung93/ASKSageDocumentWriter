import { describe, expect, it } from 'vitest';
import type { LLMClient } from '../provider/types';
import { runPromptOnlyEditing } from './prompt-only';

const outputs = [
  { summary: 'Fix one sentence', scope: { sectionIds: [], paragraphIds: ['0'], broadDocumentChange: false }, steps: [], requiredContext: [], risks: [] },
  { summary: 'Fix', operations: [{ target: 'uploaded_document', operation: { op: 'replace_paragraph_text', index: 0, new_text: 'Revised.' } }], criterionCoverage: [], evidence: [], assumptions: [], unresolvedQuestions: [] },
  { verdict: 'pass', score: 98, criteria: [], unsupportedClaims: [], structuralRisks: [], styleIssues: [], repairInstructions: [] },
];

describe('runPromptOnlyEditing', () => {
  it('plans, proposes and critiques using JSON-only provider calls', async () => {
    let i = 0;
    const client = { capabilities: { fileUpload: false, dataset: false, liveSearch: false }, getModels: async () => [], query: async () => ({ message: '', response: '', status: 200, uuid: '' }), queryJson: async () => ({ data: outputs[i++]!, raw: { message: '', response: '', status: 200, uuid: '' } }) } as LLMClient;
    const result = await runPromptOnlyEditing(client, { target: { kind: 'uploaded_document', targetId: 'd1' }, instruction: 'Improve grammar', source: { paragraphs: ['Bad sentence'] }, criteria: [], model: 'model' });
    expect(result.critique.verdict).toBe('pass');
    expect(result.prompts.proposal).toContain('typed operations');
  });
});

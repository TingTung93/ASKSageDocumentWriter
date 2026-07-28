import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { EditingTurnRecord } from '../lib/agentic-editing/types';
import { AgentProposalReviewCard, describeAgentOperation } from './AgentProposalReview';

const turn: EditingTurnRecord = {
  id: 'turn-1',
  session_id: 'session-1',
  target: { kind: 'uploaded_document', targetId: 'doc-1' },
  base_version_id: 'version-1',
  instruction: 'Make the opening concise.',
  acceptance_criteria: [],
  provider_id: 'genai_mil',
  models_used: ['gemini-2.5-flash'],
  status: 'awaiting_user_approval',
  created_at: '2026-01-01T00:00:00.000Z',
  plan: {
    summary: 'Tighten the opening.',
    scope: { sectionIds: [], paragraphIds: ['0'], broadDocumentChange: false },
    steps: [{ id: 'step-1', description: 'Remove redundant wording.', targetIds: ['0'] }],
    requiredContext: [],
    risks: [],
  },
  proposal: {
    summary: 'Shorten the first paragraph without changing meaning.',
    operations: [{
      target: 'uploaded_document',
      operation: {
        op: 'replace_paragraph_text',
        index: 0,
        new_text: 'Concise opening.',
      },
    }],
    criterionCoverage: [{
      criterionId: 'preserve-intent',
      operationIndexes: [0],
      explanation: 'Meaning is preserved.',
    }],
    evidence: [],
    assumptions: ['The opening is paragraph one.'],
    unresolvedQuestions: [],
  },
  critique: {
    verdict: 'pass',
    score: 96,
    criteria: [],
    unsupportedClaims: [],
    structuralRisks: [],
    styleIssues: [],
    repairInstructions: [],
  },
};

describe('AgentProposalReviewCard', () => {
  it('renders a readable proposal and directs applicable changes to approval', () => {
    render(<AgentProposalReviewCard turn={turn} applicableEditCount={1} />);

    expect(screen.getByRole('heading', { name: /agent proposal review/i })).toBeInTheDocument();
    expect(screen.getByText(/Shorten the first paragraph/i)).toBeInTheDocument();
    expect(screen.getByText(/Paragraph 1: replace paragraph text/i)).toBeInTheDocument();
    expect(screen.getByText(/1 applicable change is in the decision queue/i)).toBeInTheDocument();
    expect(screen.queryByText(/"operations":/i)).not.toBeInTheDocument();
  });

  it('explains when model operations cannot be accepted safely', () => {
    render(<AgentProposalReviewCard turn={turn} applicableEditCount={0} />);

    expect(screen.getByRole('alert')).toHaveTextContent(/cannot be safely applied/i);
  });
});

describe('describeAgentOperation', () => {
  it('humanizes typed edits without exposing raw JSON', () => {
    expect(describeAgentOperation({
      target: 'uploaded_document',
      operation: { op: 'delete_paragraph', index: 2 },
    })).toBe('Paragraph 3: delete paragraph');
  });
});

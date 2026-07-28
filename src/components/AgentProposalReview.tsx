import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db/schema';
import type {
  AgentEditOperation,
  EditingTargetKind,
  EditingTurnRecord,
} from '../lib/agentic-editing/types';
import type { StoredEdit } from '../lib/document/types';

export function AgentProposalReview({
  targetKind,
  targetId,
  edits,
}: {
  targetKind: EditingTargetKind;
  targetId: string;
  edits: StoredEdit[];
}): JSX.Element | null {
  const session = useLiveQuery(
    async () => {
      const rows = await db.editing_sessions
        .where('target_kind')
        .equals(targetKind)
        .and((row) => row.target_id === targetId)
        .toArray();
      return rows.sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
    },
    [targetKind, targetId],
  );
  const turn = useLiveQuery(
    async () => session?.active_turn_id
      ? await db.editing_turns.get(session.active_turn_id)
      : undefined,
    [session?.active_turn_id],
  );

  if (!turn?.proposal) return null;
  const applicableEditCount = edits.filter((edit) =>
    edit.id.startsWith(`agent_${turn.id}_`),
  ).length;
  return (
    <AgentProposalReviewCard
      turn={turn}
      applicableEditCount={applicableEditCount}
    />
  );
}

export function AgentProposalReviewCard({
  turn,
  applicableEditCount,
}: {
  turn: EditingTurnRecord;
  applicableEditCount: number;
}): JSX.Element {
  const proposal = turn.proposal;
  const plan = turn.plan;
  const critique = turn.critique;
  const operationCount = proposal?.operations.length ?? 0;
  const unavailableCount = Math.max(0, operationCount - applicableEditCount);
  const reviewWarnings = [
    ...(critique?.unsupportedClaims ?? []),
    ...(critique?.structuralRisks ?? []),
    ...(critique?.styleIssues ?? []),
  ];

  return (
    <section
      aria-label="Agent proposal review"
      className="card"
      style={{ marginTop: '1rem', borderLeft: '4px solid var(--color-primary)' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0 }}>Agent proposal review</h3>
        {critique && (
          <span className={critique.verdict === 'pass' ? 'badge badge-primary' : 'badge'}>
            Review: {humanize(critique.verdict)} · {critique.score}/100
          </span>
        )}
      </div>

      <p style={{ marginBottom: '0.4rem' }}>
        <strong>Requested:</strong> {turn.instruction || 'General document cleanup'}
      </p>
      <p style={{ marginTop: 0 }}>
        <strong>Proposed outcome:</strong>{' '}
        {proposal?.summary || plan?.summary || 'No summary was returned.'}
      </p>

      {plan?.steps && plan.steps.length > 0 && (
        <>
          <h4>Plan</h4>
          <ol>
            {plan.steps.map((step) => (
              <li key={step.id}>{step.description}</li>
            ))}
          </ol>
        </>
      )}

      <h4>Changes</h4>
      {operationCount > 0 ? (
        <ol aria-label="Proposed agent operations">
          {proposal!.operations.map((operation, index) => (
            <li key={`${index}:${describeAgentOperation(operation)}`}>
              {describeAgentOperation(operation)}
            </li>
          ))}
        </ol>
      ) : (
        <p className="note">The agent did not propose any document changes.</p>
      )}

      {proposal?.criterionCoverage && proposal.criterionCoverage.length > 0 && (
        <details>
          <summary>Acceptance criteria coverage</summary>
          <ul>
            {proposal.criterionCoverage.map((coverage) => (
              <li key={coverage.criterionId}>
                <strong>{coverage.criterionId}:</strong> {coverage.explanation}
              </li>
            ))}
          </ul>
        </details>
      )}

      {(reviewWarnings.length > 0 ||
        (critique?.repairInstructions.length ?? 0) > 0 ||
        (proposal?.unresolvedQuestions.length ?? 0) > 0) && (
        <div className="callout" style={{ marginTop: '0.75rem' }}>
          <strong>Review before accepting</strong>
          <ul>
            {reviewWarnings.map((warning, index) => (
              <li key={`warning:${index}`}>{warning}</li>
            ))}
            {(critique?.repairInstructions ?? []).map((instruction, index) => (
              <li key={`repair:${index}`}>{instruction}</li>
            ))}
            {(proposal?.unresolvedQuestions ?? []).map((question, index) => (
              <li key={`question:${index}`}>Question: {question}</li>
            ))}
          </ul>
        </div>
      )}

      {(proposal?.assumptions.length ?? 0) > 0 && (
        <details>
          <summary>Assumptions</summary>
          <ul>
            {proposal!.assumptions.map((assumption, index) => (
              <li key={`${index}:${assumption}`}>{assumption}</li>
            ))}
          </ul>
        </details>
      )}

      {applicableEditCount > 0 ? (
        <p className="note" role="status">
          {applicableEditCount} applicable change{applicableEditCount === 1 ? '' : 's'}{' '}
          {applicableEditCount === 1 ? 'is' : 'are'} in the decision queue below.
          Review the before/after text, then choose Accept or Reject.
        </p>
      ) : operationCount > 0 ? (
        <p className="error" role="alert">
          The proposed operations cannot be safely applied to this document.
          They remain visible above for review, but acceptance is disabled.
        </p>
      ) : null}
      {unavailableCount > 0 && applicableEditCount > 0 && (
        <p className="note">
          {unavailableCount} additional operation{unavailableCount === 1 ? '' : 's'}{' '}
          could not be mapped safely and cannot be accepted.
        </p>
      )}
    </section>
  );
}

export function describeAgentOperation(item: AgentEditOperation): string {
  const operation = item.operation as unknown as Record<string, unknown>;
  const op = String(operation.op ?? 'unknown operation');
  const paragraph = operation.index ?? operation.paragraph_index;
  const location = typeof paragraph === 'number' ? `Paragraph ${paragraph + 1}: ` : '';

  switch (op) {
    case 'replace_paragraph_text':
      return `${location}replace paragraph text with “${excerpt(operation.new_text)}”`;
    case 'replace_run_text':
      return `${location}replace text in run ${Number(operation.run_index) + 1} with “${excerpt(operation.new_text)}”`;
    case 'delete_paragraph':
      return `${location}delete paragraph`;
    case 'insert_paragraph_after':
      return `${location}insert a new paragraph after it: “${excerpt(operation.new_text)}”`;
    case 'merge_paragraphs':
      return `${location}merge with the following paragraph`;
    case 'split_paragraph':
      return `${location}split paragraph before “${excerpt(operation.split_at_text)}”`;
    case 'set_paragraph_style':
      return `${location}apply style “${String(operation.style_id ?? '')}”`;
    case 'set_paragraph_alignment':
      return `${location}set alignment to ${String(operation.alignment ?? '')}`;
    case 'set_run_property':
      return `${location}set ${String(operation.property ?? 'formatting')} to ${String(operation.value)}`;
    case 'set_run_font':
      return `${location}change run ${Number(operation.run_index) + 1} font`;
    case 'set_run_color':
      return `${location}change run ${Number(operation.run_index) + 1} color`;
    case 'set_paragraph_indent':
      return `${location}adjust paragraph indentation`;
    case 'set_paragraph_spacing':
      return `${location}adjust paragraph spacing`;
    case 'set_cell_text':
      return `Table ${Number(operation.table_index) + 1}, row ${Number(operation.row_index) + 1}, cell ${Number(operation.cell_index) + 1}: replace text with “${excerpt(operation.new_text)}”`;
    case 'insert_table_row':
      return `Table ${Number(operation.table_index) + 1}: insert a row`;
    case 'delete_table_row':
      return `Table ${Number(operation.table_index) + 1}: delete row ${Number(operation.row_index) + 1}`;
    case 'set_content_control_value':
      return `Set content control “${String(operation.tag ?? '')}” to “${excerpt(operation.value)}”`;
    default:
      return humanize(op);
  }
}

function excerpt(value: unknown): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > 120 ? `${text.slice(0, 117)}…` : text;
}

function humanize(value: string): string {
  return value.replace(/[_-]+/g, ' ');
}

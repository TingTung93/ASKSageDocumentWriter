import type { DraftParagraph } from '../../../lib/draft/types';
import type { LLMClient } from '../../../lib/provider/types';
import type { EditingTargetRef, EditingTurnRecord } from '../../../lib/agentic-editing/types';
import { paragraphsToMarkdown } from '../../../lib/freeform/drafter';
import { DraftActionBar } from './DraftActionBar';
import { DraftDiffPreview } from './DraftDiffPreview';
import { InstructionComposer } from './InstructionComposer';
import { useDraftEditingSession } from './useDraftEditingSession';
import { RevisionTimeline } from './RevisionTimeline';

export function EditSessionPanel({
  client,
  model,
  providerId,
  onDocumentChanged,
  source,
  target,
}: {
  client: () => LLMClient;
  model: string;
  onDocumentChanged?: (change: 'accepted' | 'restored') => void;
  providerId: EditingTurnRecord['provider_id'];
  source: DraftParagraph[];
  target: EditingTargetRef & { templateId: string; sectionId: string };
}) {
  const session = useDraftEditingSession({
    client, model, onDocumentChanged, providerId, source, target,
  });
  return (
    <aside style={{
      background: 'var(--paper)',
      border: '1px solid var(--line)',
      borderRadius: 8,
      marginTop: 14,
      padding: 12,
    }}>
      {!session.preview ? (
        <>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Improve this section</div>
          <DraftActionBar
            disabled={session.busy}
            onSelect={(action) => session.propose(action.instruction, action.criteria)}
          />
          <div style={{ marginTop: 10 }}>
            <InstructionComposer busy={session.busy} onSubmit={session.propose} />
          </div>
        </>
      ) : (
        <>
          <DraftDiffPreview
            after={paragraphsToMarkdown(session.preview.after)}
            before={paragraphsToMarkdown(session.preview.before)}
            summary={session.preview.turn.proposal?.summary}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button className="btn btn-primary btn-sm" disabled={session.busy} onClick={session.accept}>
              Accept change
            </button>
            <button className="btn btn-sm" disabled={session.busy} onClick={session.reject}>
              Reject
            </button>
          </div>
          <div style={{ marginTop: 10 }}>
            <InstructionComposer
              busy={session.busy}
              initialInstruction={session.preview.turn.instruction}
              onSubmit={(instruction) => session.propose(instruction)}
            />
            <div style={{ color: 'var(--ink-4)', fontSize: 11, marginTop: 4 }}>
              Submitting replaces this proposal; it does not change the draft.
            </div>
          </div>
        </>
      )}
      {session.error && <div className="error-box" role="alert" style={{ marginTop: 10 }}>{session.error}</div>}
      <RevisionTimeline
        busy={session.busy}
        canUndo
        onUndo={session.undo}
        versions={session.versions}
      />
    </aside>
  );
}

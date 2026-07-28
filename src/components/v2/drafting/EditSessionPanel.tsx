import type { DraftParagraph } from '../../../lib/draft/types';
import type { DraftEditOp } from '../../../lib/edit/types';
import type { LLMClient } from '../../../lib/provider/types';
import type { EditingTargetRef, EditingTurnRecord } from '../../../lib/agentic-editing/types';
import { paragraphsToMarkdown } from '../../../lib/freeform/drafter';
import { DraftActionBar } from './DraftActionBar';
import { DraftDiffPreview } from './DraftDiffPreview';
import { InstructionComposer } from './InstructionComposer';
import { useDraftEditingSession } from './useDraftEditingSession';
import { RevisionTimeline } from './RevisionTimeline';
import { CitationProvenance } from './CitationProvenance';
import { SourceScopePicker } from './SourceScopePicker';
import type { DraftGroundingSource } from './grounding';
import { resolveAgentCapabilities } from '../../../lib/agentic-editing/capabilities';
import { resolveSourceScope } from '../../../lib/agentic-editing/context/source-scope';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useDraftActionController } from './DraftActionController';

export function EditSessionPanel({
  client,
  model,
  providerId,
  onDocumentChanged,
  groundingSources = [],
  source,
  target,
  targetSelection,
  applyProposal,
  active = true,
  scopeLabel = 'selected draft target',
}: {
  client: () => LLMClient;
  model: string;
  onDocumentChanged?: (change: 'accepted' | 'restored') => void;
  groundingSources?: DraftGroundingSource[];
  providerId: EditingTurnRecord['provider_id'];
  source: DraftParagraph[];
  target: EditingTargetRef;
  targetSelection?: unknown;
  applyProposal?: (
    edits: DraftEditOp[],
    current: DraftParagraph[],
    baseVersionId: string,
  ) => Promise<DraftParagraph[]>;
  active?: boolean;
  scopeLabel?: string;
}) {
  const capabilities = useMemo(() => resolveAgentCapabilities(client()), [client]);
  const [sourceScope, setSourceScope] = useState(() => resolveSourceScope({
    sources: groundingSources,
    maxContextCharacters: 24_000,
  }, capabilities));
  const grounding = useMemo(() => ({
    scope: sourceScope,
    targetSelection,
    contents: sourceScope.entries
      .filter((entry) => entry.included && entry.allocatedCharacters > 0)
      .flatMap((entry) => {
        const text = groundingSources.find((source) => source.id === entry.id)?.promptText;
        return text ? [{ sourceId: entry.id, text: text.slice(0, entry.allocatedCharacters) }] : [];
      }),
  }), [groundingSources, sourceScope, targetSelection]);
  const session = useDraftEditingSession({
    applyProposal, client, grounding, model, onDocumentChanged, providerId, source, target,
  });
  const controller = useDraftActionController();
  const [focusRequest, setFocusRequest] = useState(0);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  useEffect(() => {
    if (!active) return;
    controller.register({
      scopeLabel,
      busy: session.busy,
      hasProposal: Boolean(session.preview),
      propose: (action) => void sessionRef.current.propose(action.instruction, action.criteria),
      proposeCustom: (instruction) => void sessionRef.current.propose(instruction),
      focusInstruction: () => setFocusRequest((value) => value + 1),
      accept: () => void sessionRef.current.accept(),
      reject: () => void sessionRef.current.reject(),
    });
    return () => controller.register(null);
  }, [active, controller.register, scopeLabel, session.busy, session.preview]);
  return (
    <aside
      className={`edit-session-panel ${session.preview ? 'state-awaiting-approval' : ''}`}
      onClick={(event) => event.stopPropagation()}
    >
      {!session.preview ? (
        <>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Improve this section</div>
          <DraftActionBar
            disabled={session.busy}
            onSelect={(action) => void session.propose(action.instruction, action.criteria)}
            scopeLabel={scopeLabel}
          />
          <div style={{ marginTop: 10 }}>
            <InstructionComposer
              busy={session.busy}
              focusRequest={focusRequest}
              onSubmit={(instruction) => void session.propose(instruction)}
            />
          </div>
          <div style={{ marginTop: 10 }}>
            <SourceScopePicker
              capabilities={capabilities}
              onChange={setSourceScope}
              scope={sourceScope}
              sources={groundingSources}
            />
          </div>
        </>
      ) : (
        <>
          <DraftDiffPreview
            after={paragraphsToMarkdown(session.preview.after)}
            before={paragraphsToMarkdown(session.preview.before)}
            summary={session.preview.turn.proposal?.summary}
          />
          <CitationProvenance
            after={paragraphsToMarkdown(session.preview.after)}
            before={paragraphsToMarkdown(session.preview.before)}
            evidence={session.preview.turn.proposal?.evidence ?? []}
          />
          <div className="approval-actions" role="group" aria-label="Review proposed change">
            <button
              aria-label={`Accept proposal for ${scopeLabel}`}
              className="btn btn-primary btn-sm"
              disabled={session.busy}
              onClick={() => void session.accept()}
            >
              Accept change
            </button>
            <button
              aria-label={`Reject proposal for ${scopeLabel}`}
              className="btn btn-sm"
              disabled={session.busy}
              onClick={() => void session.reject()}
            >
              Reject
            </button>
          </div>
          <div style={{ marginTop: 10 }}>
            <InstructionComposer
              busy={session.busy}
              focusRequest={focusRequest}
              initialInstruction={session.preview.turn.instruction}
              onSubmit={(instruction) => void session.propose(instruction)}
            />
            <div style={{ color: 'var(--ink-4)', fontSize: 11, marginTop: 4 }}>
              Submitting replaces this proposal; it does not change the draft.
            </div>
          </div>
        </>
      )}
      {active && <div aria-live="polite" className="sr-only" role="status">
        {session.busy
          ? `Editing ${scopeLabel}.`
          : session.preview
            ? `Proposal ready for ${scopeLabel}.`
            : `Editing controls ready for ${scopeLabel}.`}
      </div>}
      {session.error && (
        <div className="workspace-state state-error compact" role="alert">
          <div>
            <strong>The edit could not be completed.</strong>
            <p>{session.error}</p>
          </div>
          <a className="btn btn-sm" href="#/settings">Review provider settings</a>
        </div>
      )}
      <RevisionTimeline
        busy={session.busy}
        canUndo
        onUndo={session.undo}
        versions={session.versions}
      />
    </aside>
  );
}

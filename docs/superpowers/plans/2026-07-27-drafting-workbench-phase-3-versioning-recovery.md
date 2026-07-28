# Phase 3 — Versioning, Recovery, Revision, and Undo

> **Phase rule:** Recovery reconstructs state from durable records. It must not repeat completed provider calls, tool calls, approvals, or commits.

**Goal:** Make editing sessions dependable across reloads and failures, give accepted edits immutable version lineage, and let users revise proposals and undo accepted changes without erasing history.

**Depends on:** Phase 2 template-section vertical slice.

**Produces:** Durable session state machine, immutable versions, commit transactions, reload recovery, revision timeline, proposal revision, and undo.

## Scope

### Included

- Durable editing-session lifecycle
- Checkpoint recovery
- Interrupted-state handling
- Immutable versions
- Parent lineage
- Proposal revise/supersede
- Revision timeline
- Undo as a new version
- Retention and cleanup policy
- Export from latest accepted version

### Excluded

- New target kinds
- Source provenance expansion
- Collaborative merges
- Cloud synchronization
- Branch merging

## Files

- Create or complete `src/lib/agentic-editing/versions.ts`
- Create `src/lib/agentic-editing/versions.test.ts`
- Modify `src/lib/agentic-editing/store.ts`
- Modify `src/lib/agentic-editing/store.test.ts`
- Modify `src/lib/agentic-editing/runner.ts`
- Modify checkpoint and journal helpers
- Modify `src/lib/db/schema.ts` only if required
- Create `src/components/v2/drafting/RevisionTimeline.tsx`
- Create `src/components/v2/drafting/RevisionTimeline.test.tsx`
- Modify editing-session hook and panel
- Modify export readers
- Create integrated recovery tests
- Modify `release/index.html` through the build

## Task 3.1 — State Machine

Define allowed transitions among:

- preparing;
- running;
- validating;
- awaiting approval;
- accepted;
- rejected;
- failed;
- interrupted;
- superseded;
- cancelled.

- [ ] Centralize transition validation.
- [ ] Reject illegal terminal-state rewrites.
- [ ] Record timestamps and transition reason.
- [ ] Keep UI state derived from durable records.

## Task 3.2 — Immutable Versions

Each accepted edit creates:

- version ID;
- target reference;
- parent version ID;
- base snapshot hash;
- accepted content snapshot or deterministic reconstruction data;
- proposal/turn ID;
- created timestamp;
- concise change summary.

- [ ] Create the initial version lazily before the first accepted edit.
- [ ] Commit version and canonical draft update in one transaction.
- [ ] Verify parent remains current before commit.
- [ ] Reject stale approval rather than overwriting newer work.

## Task 3.3 — Recovery

- [ ] Recover active session by target.
- [ ] Restore awaiting-approval proposals.
- [ ] Derive stale running turns as interrupted.
- [ ] Resume from the latest safe checkpoint.
- [ ] Never replay completed tool results.
- [ ] Never automatically accept or commit.
- [ ] Explain when a provider/model change requires restart from proposal generation.
- [ ] Test project A/B navigation isolation.

## Task 3.4 — Revise Proposal

- [ ] Accept a follow-up instruction against the same base snapshot.
- [ ] Mark the prior proposal superseded only after the replacement is durable.
- [ ] Compare replacement against canonical content, not the prior speculative preview.
- [ ] Preserve trace lineage between original and revised turns.
- [ ] Prevent simultaneous active proposals for the same target.

## Task 3.5 — Revision Timeline

Display:

- accepted edit summary;
- target;
- timestamp;
- provider/model;
- warnings;
- source scope;
- ability to reopen diff;
- current version marker.

Keep advanced trace details behind disclosure.

## Task 3.6 — Undo

- [ ] Undo creates a new child version containing the selected prior content.
- [ ] Never delete the version being undone.
- [ ] Validate the restored snapshot.
- [ ] Block undo while a commit transaction is active.
- [ ] Make repeated undo behavior explicit.
- [ ] Export immediately reflects the latest undo version.

## Task 3.7 — Retention

Define:

- compact version snapshots versus large artifacts;
- artifact retention count/age;
- manual session deletion;
- project deletion cascade;
- diagnostic export behavior;
- audit metadata retained after artifact cleanup.

## Tests

- Every legal and illegal state transition
- Atomic commit and stale parent rejection
- Reload while running
- Reload awaiting approval
- Reload after acceptance
- No repeated tool/provider side effects
- Revise supersedes safely
- Accept → reload → undo
- Multiple undo versions
- Export after undo
- Project deletion cleanup

## Quality Gates

```powershell
npm run typecheck
npm test
npm run build
```

Manual interruption test:

1. Begin an edit.
2. Reload during generation.
3. Recover or restart at the documented safe boundary.
4. Accept.
5. Reload.
6. Undo.
7. Export and verify prior content.

## Exit Gate

Phase 3 is complete when:

1. Every accepted edit has immutable lineage.
2. Reload does not lose approval state.
3. Interrupted execution does not repeat completed side effects.
4. Revise and supersede preserve history.
5. Undo restores exact prior content through a new version.
6. Export follows latest accepted version.
7. Recovery integration tests pass.

## Handoff to Phase 4

Phase 4 must implement new targets through adapters that use the same session, proposal, version, recovery, and undo contracts.


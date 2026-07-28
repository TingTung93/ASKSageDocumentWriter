# Phase 2 — Template Editing Vertical Slice

> **Phase rule:** Ship one complete template-section edit lifecycle before adding paragraph targets, freeform parity, broad quick actions, or advanced grounding.

**Goal:** Let a user select one drafted template section, enter a custom instruction, generate a validated proposal through any portable provider, preview a diff, and explicitly accept or reject it.

**Depends on:** Phase 0 identity boundary and Phase 1 portable provider contract.

**Produces:** Shared active-target state, template-section adapter, instruction composer, durable proposal turn, deterministic validation, diff preview, and explicit approval.

## Primary Journey

```text
Open template project
  → select drafted section
  → enter instruction
  → confirm target/provider/context
  → generate proposal
  → validate
  → inspect diff
  → accept or reject
  → export accepted content
```

## Scope

### Included

- Template-section selection
- Shared selection across V2 panes
- Custom instructions
- Limited quick-action presets only after custom instruction works
- Portable provider execution
- Prompt-only baseline
- Native read-only tool path when Phase 1 verifies it
- Proposal persistence
- Deterministic validation
- Before/after diff
- Accept/reject
- Minimal reload restoration for awaiting approval
- Export from accepted state

### Excluded

- Paragraph-level targets
- Freeform targets
- Full revision timeline and undo
- Citation-strengthening action
- Multi-section edits
- Document-wide review application
- Automatic commit

## Files

- Create `src/components/v2/drafting/selection.ts`
- Create `src/components/v2/drafting/selection.test.ts`
- Create `src/components/v2/drafting/DraftSelectionContext.tsx`
- Create `src/components/v2/drafting/DraftSelectionContext.test.tsx`
- Create `src/components/v2/drafting/actions.ts`
- Create `src/components/v2/drafting/actions.test.ts`
- Create `src/components/v2/drafting/DraftActionBar.tsx`
- Create `src/components/v2/drafting/DraftActionBar.test.tsx`
- Create `src/components/v2/drafting/InstructionComposer.tsx`
- Create `src/components/v2/drafting/InstructionComposer.test.tsx`
- Create `src/lib/agentic-editing/targets/template-section.ts`
- Create `src/lib/agentic-editing/targets/template-section.test.ts`
- Create `src/components/v2/drafting/useDraftEditingSession.ts`
- Create `src/components/v2/drafting/useDraftEditingSession.test.tsx`
- Create `src/components/v2/drafting/EditSessionPanel.tsx`
- Create `src/components/v2/drafting/EditSessionPanel.test.tsx`
- Create `src/components/v2/drafting/DraftDiffPreview.tsx`
- Create `src/components/v2/drafting/DraftDiffPreview.test.tsx`
- Modify `src/lib/agentic-editing/types.ts`
- Modify `src/lib/agentic-editing/runner.ts`
- Modify `src/components/v2/V2ProjectWorkspace.tsx`
- Modify `src/components/v2/V2DraftPane.tsx`
- Modify `src/components/v2/V2SourcesPane.tsx`
- Modify `src/components/v2/V2ChatPane.tsx`
- Modify `src/v2.css`
- Modify `release/index.html` through the build

## Task 2.1 — Shared Selection

Implement `DraftSelection` for `template_section`.

- [ ] Remove duplicate active-section ownership from workspace and draft pane.
- [ ] Make section headers clickable and keyboard focusable.
- [ ] Separate viewport-observed active section from explicitly pinned selection.
- [ ] Share selection with Sources, Chat, and action UI.
- [ ] Clear synchronously on project navigation.
- [ ] Validate selection against current project, template, and section data.
- [ ] Fail closed when a target disappears.
- [ ] Add an obvious but restrained selected-state treatment.

## Task 2.2 — Instruction Composer

- [ ] Display exact target name and scope.
- [ ] Accept a custom instruction.
- [ ] Show provider, model, and effective execution path.
- [ ] Summarize included project notes and reference context.
- [ ] Disable submission when connection or target is invalid.
- [ ] Prevent duplicate submission.
- [ ] Preserve draft instruction if the composer closes accidentally.
- [ ] Restore focus to the selected section.

Initial optional presets:

- Rewrite for clarity
- Tighten
- Expand
- Change audience

Presets populate or parameterize the same instruction contract.

## Task 2.3 — Immutable Target Snapshot

The template-section adapter must load:

- project and template identity;
- section schema and intent;
- current draft paragraphs and status;
- validation issues;
- project description and notes;
- selected source extracts;
- limited neighboring-section summaries;
- base version or deterministic snapshot hash.

- [ ] Do not expose mutable Dexie records to the runner.
- [ ] Enforce prompt and source-size limits.
- [ ] Record omitted/truncated context.
- [ ] Reject a proposal if the base snapshot no longer matches.

## Task 2.4 — Proposal Generation

- [ ] Define typed draft-paragraph operations.
- [ ] Use prompt-only proposal generation as baseline.
- [ ] Allow verified native read-only tools for context inspection.
- [ ] Validate structured output.
- [ ] Repair malformed output within bounded attempts.
- [ ] Store sanitized prompt/response/proposal artifacts.
- [ ] Keep canonical `db.drafts` unchanged.
- [ ] Surface provider downgrade without failing the approval lifecycle.

## Task 2.5 — Deterministic Validation

Validate:

- correct target identity;
- permitted operations only;
- paragraph role and level validity;
- section size limits;
- placeholder integrity;
- citation-marker syntax;
- no empty destructive replacement;
- base snapshot/version match;
- template slot semantics where applicable.

Block approval for unsafe structural failures. Allow reviewable warnings for style or completeness issues.

## Task 2.6 — Preview and Approval

- [ ] Render paragraph-level before/after diff.
- [ ] Distinguish added, removed, and changed content.
- [ ] Display validation errors and warnings.
- [ ] Display provider/model/context summary.
- [ ] Implement Accept as a transaction.
- [ ] Implement Reject without canonical mutation.
- [ ] Persist awaiting-approval state.
- [ ] Restore the pending proposal after reload.
- [ ] Ensure export sees only accepted state.
- [ ] Add a trace-inspector link for advanced users.

## Tests

- Selection normalization and project switching
- Mouse and keyboard selection
- Invalid/stale target rejection
- Prompt-only proposal
- Verified native-tool proposal
- Native-tool downgrade
- Malformed proposal repair/failure
- Deterministic validation
- Accept transaction
- Reject no-op
- Reload awaiting approval
- Export excludes unaccepted proposal
- Keyless local provider

## Quality Gates

```powershell
npm run typecheck
npm test
npm run build
```

Manual synthetic workflow:

1. Draft a fixture template project.
2. Select one section.
3. Request a rewrite.
4. Verify the draft does not change before acceptance.
5. Accept and export.
6. Open the DOCX and confirm only the selected section changed.

## Exit Gate

Phase 2 is complete when:

1. A user can complete the primary journey without developer tooling.
2. Selection is shared and unambiguous.
3. Proposal generation is provider-neutral.
4. Canonical content changes only on Accept.
5. Reject and reload are safe.
6. Export uses accepted state only.
7. Integrated workflow tests and build pass.

## Handoff to Phase 3

Phase 3 extends the accepted-edit record into full version lineage, interruption recovery, revision history, revise, and undo.


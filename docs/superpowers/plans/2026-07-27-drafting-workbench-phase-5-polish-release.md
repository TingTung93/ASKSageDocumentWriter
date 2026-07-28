# Phase 5 — Product Polish, Consolidation, and Release

> **Phase rule:** Polish unifies and clarifies completed capabilities. It must not conceal missing functionality or create parallel editing paths.

**Goal:** Turn the completed drafting and editing systems into a calm, accessible, cohesive product; unify entry points; harden end-to-end workflows; and decide the future of legacy and standalone surfaces.

**Depends on:** Phases 0–4.

**Produces:** Unified action controller across UI entry points, responsive and accessible V2 experience, complete workflow regression suite, documentation, consolidation decisions, and release artifact.

## Scope

### Included

- Command palette and chat integration
- Keyboard workflow
- Responsive behavior
- Accessibility
- State and visual consistency
- Error/empty/recovery polish
- Performance and artifact retention review
- Complete workflow tests
- Existing Documents alignment
- Legacy route decision
- User documentation and release checklist

### Excluded

- New provider wire formats without a Phase 1 adapter
- New editing targets without a Phase 4 adapter
- Collaboration/backend implementation
- Unreviewed auto-accept

## Files

- Modify `src/components/v2/V2CommandPalette.tsx`
- Modify `src/components/v2/V2ChatPane.tsx`
- Modify shared drafting action components
- Modify `src/components/v2/V2Layout.tsx`
- Modify `src/v2.css`
- Create accessibility and shortcut tests
- Create `src/components/v2/drafting/V2DraftEditingWorkflow.test.tsx`
- Create reusable test fixtures under `src/test/`
- Modify `src/routes/Documents.tsx` to reuse shared components where safe
- Modify `README.md`
- Create/update user documentation
- Update `docs/AUDIT.md`
- Modify `release/index.html` through final build

## Task 5.1 — One Action Controller

- [ ] Command palette consumes shared action availability.
- [ ] Slash commands return only for implemented actions.
- [ ] Chat distinguishes project notes from edit instructions.
- [ ] Direct controls, shortcuts, palette, and chat call the same controller.
- [ ] Accessible labels include target scope.
- [ ] No browser custom event performs editing mutations.

## Task 5.2 — Keyboard and Accessibility

- [ ] Select targets by keyboard.
- [ ] Open/close instruction composer with focus restoration.
- [ ] Navigate proposal and diff without a pointer.
- [ ] Accept/reject shortcuts are scoped and guarded.
- [ ] Announce running, validation, approval, commit, and recovery states.
- [ ] Verify modal/panel focus traps.
- [ ] Verify contrast, non-color state indicators, reduced motion, and 200% zoom.
- [ ] Test screen-reader names for target and source controls.

## Task 5.3 — Responsive Workspace

- [ ] Keep document visually primary.
- [ ] Avoid layout shifts when session panel opens.
- [ ] Keep approval controls visible for long diffs.
- [ ] Collapse Sources and Chat into tabs/drawers at narrow widths.
- [ ] Preserve target and session state across layout changes.
- [ ] Verify common laptop widths and touch targets.

## Task 5.4 — State and Error Polish

Standardize:

- loading skeleton;
- running;
- interrupted;
- warning;
- error;
- awaiting approval;
- accepted;
- rejected;
- empty;
- unavailable capability.

- [ ] Every error has a useful next action.
- [ ] Provider configuration errors link to connection settings.
- [ ] Stale-target errors preserve the user's instruction for rerun.
- [ ] Diagnostics remain opt-in.
- [ ] Trace detail does not dominate normal workflow.

## Task 5.5 — Performance and Retention

- [ ] Measure large-project render behavior.
- [ ] Avoid rerendering every section on unrelated session updates.
- [ ] Virtualize only if measurements justify it.
- [ ] Bound preview and trace artifact memory.
- [ ] Confirm object URLs are revoked.
- [ ] Apply documented retention cleanup.
- [ ] Measure production artifact size and startup time.

## Task 5.6 — Documents and Legacy Consolidation

Evaluate:

- V2 project drafting
- standalone existing-document editing
- legacy project workspace

- [ ] Extract shared proposal, diff, trace, approval, and version components.
- [ ] Keep target-specific logic in adapters.
- [ ] Decide whether Documents becomes a V2 mode or remains specialized.
- [ ] Stop feature development in legacy ProjectDetail.
- [ ] Define legacy parity and data-safety checklist.
- [ ] Remove legacy route only after explicit approval and at least one validated release.
- [ ] Document each remaining surface's purpose.

## Task 5.7 — Complete Workflow Suite

Automate:

1. Template import → project → draft → placeholder resolution → section edit → accept → export.
2. Template edit → reject leaves state unchanged.
3. Accept → reload → undo → export.
4. Freeform draft → block edit → revise → accept.
5. Existing DOCX → targeted edit → preview → accept → export.
6. Grounded edit → provenance review → unsupported proposal rejection → corrected acceptance.
7. Cloud provider path.
8. Keyless local completion path.
9. Verified local native-tool path.
10. Malformed tool output → safe prompt fallback.
11. Interrupted operation → reload → recovery.
12. Product/provider branding separation.

Provider calls are mocked at adapter boundaries; persistence, runner, target adapter, validation, and approval remain real in the tests.

## Task 5.8 — Documentation and Release

- [ ] Update README and screenshots with final identity.
- [ ] Write quick start for cloud and local providers.
- [ ] Document local CORS, TLS, model, and tool probing.
- [ ] Document data classification and provider suitability.
- [ ] Document drafting, editing, revision, undo, provenance, and export.
- [ ] Update audit findings.
- [ ] Prepare migration/release notes.
- [ ] Regenerate the single-file artifact from reviewed source.

## Quality Gates

```powershell
npm run typecheck
npm test
npm run build
```

Manual release matrix:

- `file://` startup and HashRouter navigation
- Existing database compatibility
- All provider connection surfaces
- Template/freeform/existing-document workflows
- Local completion and native-tool paths
- Word or LibreOffice synthetic exports
- Keyboard-only workflow
- 200% zoom and reduced motion
- Sanitized diagnostic export

## Exit Gate

Phase 5 and the program are complete when:

1. Users encounter one coherent editing lifecycle.
2. All UI entry points share one action controller.
3. Critical workflows pass integrated tests.
4. Responsive and accessibility review has no unresolved P0/P1 findings.
5. Provider and product identities are distinct.
6. Existing data remains compatible.
7. Export fidelity is verified.
8. Remaining routes have explicit ownership or an approved retirement plan.
9. Documentation and release artifact are current.
10. The master plan's Definition of Done is satisfied.


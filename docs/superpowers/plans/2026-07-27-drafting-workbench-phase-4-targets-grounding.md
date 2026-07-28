# Phase 4 — Target Expansion, Grounding, and Citation Provenance

> **Phase rule:** New editing targets must reuse the Phase 2–3 lifecycle through adapters. Do not add target-specific approval or versioning implementations.

**Goal:** Extend trustworthy editing to paragraphs and freeform blocks, then make source selection, research grounding, and citation provenance explicit and reviewable.

**Depends on:** Phase 3 durable versions and recovery.

**Produces:** Paragraph and freeform adapters, precise stale-target protection, explicit source scope, semantic context selection, citation validation, and provenance UI.

## Scope

### Included

- Template paragraph targets
- Freeform block and paragraph targets
- Stable target identity
- Explicit source inclusion/exclusion
- Relevant chunk selection
- Provider-specific grounded capabilities behind portable capability checks
- Citation strengthening
- Citation/provenance validation
- Research-pack reuse
- Target parity tests

### Excluded

- Arbitrary OOXML range editing
- Unbounded multi-section edits
- External browser scraping
- Mutating network tools
- Automatic acceptance of research claims

## Files

- Create `src/lib/agentic-editing/targets/draft-paragraph.ts`
- Create `src/lib/agentic-editing/targets/draft-paragraph.test.ts`
- Create `src/lib/agentic-editing/targets/freeform-block.ts`
- Create `src/lib/agentic-editing/targets/freeform-block.test.ts`
- Create `src/lib/agentic-editing/targets/freeform-paragraph.ts`
- Create `src/lib/agentic-editing/targets/freeform-paragraph.test.ts`
- Modify selection contracts and UI
- Create `src/lib/agentic-editing/context/source-scope.ts`
- Create `src/lib/agentic-editing/context/source-scope.test.ts`
- Create `src/lib/agentic-editing/context/relevance.ts`
- Create `src/lib/agentic-editing/context/relevance.test.ts`
- Create `src/lib/agentic-editing/validation/citations.ts`
- Create `src/lib/agentic-editing/validation/citations.test.ts`
- Create `src/components/v2/drafting/SourceScopePicker.tsx`
- Create `src/components/v2/drafting/SourceScopePicker.test.tsx`
- Create `src/components/v2/drafting/CitationProvenance.tsx`
- Create `src/components/v2/drafting/CitationProvenance.test.tsx`
- Modify `V2DraftPane`, `V2SourcesPane`, and editing-session UI
- Modify research/context helpers
- Add parity workflow tests
- Modify `release/index.html` through the build

## Task 4.1 — Stable Paragraph Identity

Array index alone is insufficient after edits.

- [ ] Define paragraph identity using target version plus stable anchor data.
- [ ] Store paragraph index only as a hint.
- [ ] Verify surrounding text/role/anchor before applying a proposal.
- [ ] Rebase only when identity is deterministic.
- [ ] Otherwise reject as stale and ask the user to rerun.
- [ ] Preserve heading/list hierarchy.

## Task 4.2 — Template Paragraph Adapter

- [ ] Load the paragraph, containing section, and bounded neighbors.
- [ ] Permit text and supported role/level edits only.
- [ ] Prevent operations on other paragraphs.
- [ ] Validate placeholder and citation integrity.
- [ ] Reuse proposal, preview, approval, version, and undo UI.

## Task 4.3 — Freeform Block Adapter

- [ ] Use H1-bounded block identity.
- [ ] Preserve block heading boundaries.
- [ ] Include document outline and adjacent-block summaries.
- [ ] Replace only the selected block on acceptance.
- [ ] Reject empty or structurally invalid block proposals.
- [ ] Verify export after accepted and undone edits.

## Task 4.4 — Freeform Paragraph Adapter

- [ ] Reuse stable paragraph identity.
- [ ] Preserve block membership.
- [ ] Detect index drift.
- [ ] Share the same action availability and session UI.

## Task 4.5 — Source Scope

Before execution show:

- project notes;
- attached files;
- selected chunks;
- datasets;
- saved research packs;
- live search where supported;
- estimated/truncated context.

- [ ] Let users include/exclude optional sources.
- [ ] Store source references, not duplicate large content, in the turn.
- [ ] Record the exact resolved source scope artifact.
- [ ] Explain unavailable source modes.

## Task 4.6 — Relevant Context Selection

- [ ] Use embeddings when verified.
- [ ] Use deterministic lexical relevance fallback without embeddings.
- [ ] Bound chunks per source and total context.
- [ ] Include section intent, instruction, and target text in relevance scoring.
- [ ] Record scores and selection reasons.
- [ ] Never silently exclude a user-pinned source.

## Task 4.7 — Citation Strengthening

Enable only when grounded material exists.

- [ ] Request source-linked proposal output.
- [ ] Preserve source/chunk IDs.
- [ ] Validate every citation marker.
- [ ] Warn on unsupported factual additions.
- [ ] Reject invented source IDs.
- [ ] Display citation additions/removals in the diff.
- [ ] Allow user to inspect source excerpt and metadata.

## Task 4.8 — Provider Grounding

- [ ] Use Ask Sage dataset/live-search/file features only through capabilities.
- [ ] Use local extraction for providers without file upload.
- [ ] Use provider embeddings only when conformance verifies them.
- [ ] Keep grounded proposal shape provider-neutral.
- [ ] Degrade to selected local text with a visible limitation.

## Tests

- Template paragraph lifecycle
- Freeform block lifecycle
- Freeform paragraph lifecycle
- Stale target rejection
- Rebase success/failure
- Source include/exclude
- Pinned source preservation
- Embedding and lexical selection
- Citation validation
- Invented citation rejection
- Ask Sage grounded path
- Local extracted-text path
- Completion-only grounded fallback
- Accept/reload/undo/export parity for all targets

## Quality Gates

```powershell
npm run typecheck
npm test
npm run build
```

## Exit Gate

Phase 4 is complete when:

1. Template sections, template paragraphs, freeform blocks, and freeform paragraphs share one lifecycle.
2. Stale targets cannot overwrite newer content.
3. Users control source scope.
4. Context selection is bounded and inspectable.
5. Citation provenance is visible and validated.
6. Provider grounding differences do not change proposal/approval contracts.
7. Target parity and export tests pass.

## Handoff to Phase 5

Phase 5 may expose these capabilities through command palette, chat, responsive layouts, and consolidated surfaces without creating new action implementations.


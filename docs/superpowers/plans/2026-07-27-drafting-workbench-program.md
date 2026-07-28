# Drafting Workbench Implementation Program

**Purpose:** Convert the end-state strategy in `2026-07-27-unified-drafting-workbench-and-rebrand.md` into ordered, executable implementation phases.

**End-State Reference:** `docs/superpowers/plans/2026-07-27-unified-drafting-workbench-and-rebrand.md`

## Program Sequence

| Phase | Plan | Primary outcome | Depends on |
|---|---|---|---|
| 0 | Product identity and architecture boundaries | Provider-neutral product identity and stable compatibility contracts | Current reliability baseline |
| 1 | Portable provider foundation | Canonical provider contract, runtime conformance, local tool-use detection, safe fallback | Phase 0 boundaries |
| 2 | Template editing vertical slice | Select section → instruct → validate → preview → accept/reject | Phases 0–1 |
| 3 | Versions, recovery, and undo | Durable editing sessions, reload recovery, revision history, undo | Phase 2 |
| 4 | Target and grounding expansion | Paragraph/freeform targets, source control, citations, provenance | Phase 3 |
| 5 | Product polish and consolidation | Unified commands, responsive/accessibility polish, workflow tests, legacy decisions, release | Phases 0–4 |

## Execution Rules

- Execute phases in order unless a phase explicitly marks work as parallel-safe.
- Each phase must pass its own exit gate before the next phase becomes the main branch of work.
- Keep commits scoped to one task or one vertical-slice boundary.
- Never merge placeholder UI that claims an unavailable capability.
- Preserve IndexedDB, session-storage, schema, and provider compatibility unless a phase includes an explicit migration.
- Regenerate `release/index.html` only after source and tests for that phase pass.
- The prompt-only editing path is the correctness baseline; native tool use is an optional execution strategy.
- Canonical document state changes only at an explicit approval boundary.

## Cross-Phase Invariants

1. No API key or secret header is written to IndexedDB, logs, traces, or exports.
2. Provider wire formats do not leak into React components or editing-target adapters.
3. Every proposal references an immutable base snapshot or version.
4. Recovery does not replay completed provider or tool side effects.
5. Export reads only accepted canonical state.
6. Ask Sage remains a provider identity, not the product identity.
7. Every visible action is implemented, disabled with a reason, or absent.
8. Every phase leaves `npm run typecheck` and `npm test` passing.

## Program Completion

The program is complete only when all six phase exit gates pass and the master plan's Definition of Done is satisfied. Phase completion is not inferred from file creation; it requires the associated user journey and acceptance tests.


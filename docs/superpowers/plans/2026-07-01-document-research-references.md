# Document Research References Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Ask Sage research-pack generation to the Documents tab and attach generated packs as cleanup reference files.

**Architecture:** Reuse `runAskSageResearch` for live-search research. Add document-specific persistence in `src/lib/document/references.ts`, storing packs on `DocumentRecord.research_packs` and Markdown in `reference_files`; add a UI section inside `CleanupContextPanel`.

**Tech Stack:** React 18, TypeScript, Dexie, Vitest, existing Ask Sage provider abstraction.

---

### Task 1: Document Research Persistence

**Files:**
- Modify: `src/lib/db/schema.ts`
- Modify: `src/lib/document/references.ts`
- Create: `src/lib/document/references.test.ts`

- [ ] Write a failing test that calls `saveDocumentResearchPack('d1', pack)` and expects the pack appended to `research_packs` and a Markdown `reference_files` item with `extracted_text`.
- [ ] Run `npm test -- src/lib/document/references.test.ts` and verify it fails because the helper is missing.
- [ ] Add `research_packs?: import('../research/types').ResearchPack[]` to `DocumentRecord`.
- [ ] Implement `saveDocumentResearchPack(documentId, pack)` in `src/lib/document/references.ts`.
- [ ] Run `npm test -- src/lib/document/references.test.ts` and verify it passes.

### Task 2: Documents Tab UI

**Files:**
- Modify: `src/routes/Documents.tsx`
- Modify: `src/routes/Documents.test.tsx`

- [ ] Write failing tests for exported helpers `documentResearchDefaultObjective` and `documentResearchHasUncitedFindings`.
- [ ] Run `npm test -- src/routes/Documents.test.tsx` and verify the helper tests fail.
- [ ] Add imports for `runAskSageResearch`, `saveDocumentResearchPack`, `validateResearchPack`, and research types.
- [ ] Add a document research handler in `DocumentDetail` that runs Ask Sage live search and saves the pack as a reference file.
- [ ] Add a "Research for this edit" section to `CleanupContextPanel` with objective, focus questions, depth, run button, saved packs, citation links, and uncited warning.
- [ ] Run `npm test -- src/routes/Documents.test.tsx` and verify it passes.

### Task 3: Verification and Release Bundle

**Files:**
- Modify generated bundle: `release/index.html`

- [ ] Run targeted tests: `npm test -- src/lib/document/references.test.ts src/routes/Documents.test.tsx`
- [ ] Run `npm run typecheck`
- [ ] Run full `npm test`
- [ ] Run `npm run build`
- [ ] Inspect `git diff --stat`
- [ ] Commit with `feat: add document research references`
- [ ] Push to `origin/main`

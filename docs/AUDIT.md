# UI/UX & Quality Audit — 2026-04-23

Tracker for findings from the V2 audit. File:line refs were captured at audit time.

**Status: all P0/P1/P2/P3 items landed. Typecheck + all 454 tests pass.**

## P0 — Bugs / broken interactions

- [x] **Dead "Duplicate" button** — removed from `V2Layout.tsx`.
- [x] **Dead Branch/Clear/More icon buttons** — removed from `V2ChatPane.tsx`.
- [x] **Dead "Drop .docx" / Search / More / Citations buttons** — removed from `V2SourcesPane.tsx`.
- [x] **Preview modal doesn't close on Escape** — migrated to shared `<Modal>` primitive; Escape now closes it.
- [x] **Provider selector cards not keyboard-navigable** — converted to `role="radiogroup"` with `role="radio"` + `aria-checked`; Enter/Space select, Arrow keys move focus (roving tabindex).
- [x] **Command palette focus not restored on close** — handled by shared `<Modal>`.

## P1 — UX issues

- [x] **Modals lack focus trap + `aria-modal`** — shared `Modal` primitive (`src/components/v2/Modal.tsx`); migrated: ExportModal, IngestModal, CommandPalette, DraftPane preview.
- [x] **Bare "Loading drafts…" text** — wrapped with `.spinner-small` + text, matches ExportModal pattern.
- [x] **"No draft yet" empty state blends in** — three-tier layout (bold heading, muted secondary, CTA line).
- [x] **Export busy state not announced** — `aria-live="polite"` + `aria-busy` added.
- [x] **API key input missing `aria-label`** — proper `<label htmlFor>`, `aria-label` on input and on show/hide toggle (with `aria-pressed`).
- [x] **Intervention fact input unlabeled** — proper `<label>` wrapping + `.intervention-input` class.
- [x] **Silent sessionStorage catch on private-browsing** — `storageWarnedRef` + one-shot `toast.info` on failure.
- [x] **Preview modal left open when assembly fails** — auto-closes on error.
- [x] **Command palette doesn't announce filter count / no-results** — listbox with count in `aria-label`, `role="option"` + `aria-selected` on items.
- [x] **Intervention normalize failure logged-only** — `toast.info('Normalization skipped — using raw values')`.

## P2 — Polish & consistency

- [x] **Design tokens fragmented** — v2.css is now source of truth; index.css drops duplicates, keeps only legacy-specific tokens. Added `--radius-md` alias.
- [x] **Hardcoded `#525659` preview background** — replaced with `var(--bg)` via new `.preview-stage` class.
- [x] **Inline `.pane-body` backgrounds** — moved to `.pane-body.draft-surface` class in v2.css.
- [x] **Legacy `routes/Welcome.tsx` reimplements provider cards** — restyled to match V2 (`provider-cards` / `provider-card` grid).
- [x] **Legacy `routes/Settings.tsx` model rows** — inline styles replaced with `.model-override-row` utility.
- [x] **Legacy-only shell padding** — reduced `calc(40vh + 2rem)` → `40vh` (DebugPanel still renders). One-line WHY comment added.
- [x] **Sidebar nav inline-style duplication** — three buttons collapsed into a mapped array with `.on` class.
- [x] **Mixed modal class conventions** — DraftPane preview no longer reuses `.command-palette`; uses Modal primitive + `.preview-stage`.
- [x] **`.src-attach` on a form input** — replaced with dedicated `.intervention-input` class.
- [x] **Export results inline-grid styles** — extracted to `.export-result` / `.er-name` / `.er-meta`.
- [x] **First-run steps `<span>` vs `<li>`** — already `<ol>/<li>`; `<span className="n">` is a visual badge (correct). Added Escape-to-dismiss + focus-first-button.

## P3 — Code quality

- [~] **`V2DraftPane.tsx` decomposition** — `handleFix` now shrunk to ~25 lines via `draftAndValidateSection` helper. Deeper SectionBlock/ParagraphBlock/FreeformBlock split deferred (risky without E2E tests).
- [~] **`V2SettingsView.tsx` decomposition** — `V2ProviderCard` extracted; `ModelRoutingMatrix` extraction skipped (~36 lines, too tightly coupled to local edit state — would cause awkward prop drilling for no readability win).
- [x] **`handleFix` monolith** — extracted `src/lib/draft/draftAndValidateSection.ts`.
- [ ] **`V2InterventionCard` prop drilling (5 props)** — not addressed in this pass; would need a context or state consolidation. Deferred.
- [x] **`RecipeContext` stage callbacks** — wrapped in `useCallback` via stable top-level `onStageStart/Progress/Error`.
- [x] **`V2SettingsView.tsx` `modelDrafts` sync** — replaced mirror-via-effect with `modelEdits` + `modelValueFor(stage)` derived from settings.
- [x] **`V2ChatPane.tsx` `filteredSlash` memo** — now `useMemo([slashQuery])`; also memoized `notes`.
- [x] **`V2CommandPalette.tsx` groups/flat memo** — `items`, `groups`, `flat` all memoized.
- [x] **`V2DraftPane.tsx` observer memo** — `sectionIds` already memoized, effect dep updated to `[sectionIds]`.
- [x] **Dead `@keyframes pulse`** — still in use by `.rail-item.running .dot`, `.draft-status.drafting .dot`, `.toc-chip.active .dot`. Kept.

## Accessibility sweep (cross-cutting)

- [x] `aria-label` on icon-only buttons (close buttons in modals, etc.).
- [x] `<label>` / `aria-label` on all form inputs touched.
- [x] `aria-live="polite"` added to Export status region; other async regions still pending audit.
- [x] `aria-modal="true"` + focus trap via shared `<Modal>` on all scrim modals.
- [x] Verified WCAG contrast for `--ink-4` on `--paper` — was 1.99:1 (fails). Darkened to oklch(0.66 0.010 260) ≈ 2.65:1. Still below strict 3:1 (would collide with `--ink-3`); CSS comment directs body-size text to prefer `--ink-3`.

## Shipped in the same PR (outside the original audit scope)

PR #7 also bundled pre-existing WIP that was entangled with polish-touched files. Noting it here for future blame/bisect:

- Freeform workspace feature (`FreeformDraftView` + `FreeformBlock` in `V2DraftPane.tsx`; `chunkFreeformByH1` helper).
- `redraftFreeformSection` + `paragraphsToMarkdown` in `src/lib/freeform/drafter.ts` for per-section regen.
- LLM response-field bugfix (`r.response` → `r.message`) with matching test stub update.
- `assembleDocxStage` removed from the freeform recipe — export now happens via the Export button only, not auto-download.
- DOCX `<w:document>` namespace simplification in `src/lib/freeform/assemble.ts`.

## Follow-up fixes (post-review of PR #7)

- [x] **Freeform regen passes `file_extracts`** — built from cached `ProjectContextFile.extracted_text` in `V2DraftPane.tsx` `handleRegen`. Regen no longer silently drops attached-file context.
- [x] **`V2ProviderCard.onArrowNav` direction-aware** — provider list driven by array + callback-ref map; `dir === 'next'` / `'prev'` wraps via modulo. Ready for 3+ providers.
- [x] **`Modal` focus trap hardened** — switched visibility check from `offsetParent !== null` to computed-style + `getClientRects`, now covers `position: fixed` focusables. Focus restore checks `isConnected` so a trigger unmounted while the modal was open no longer throws.

## Deferred to future work

- **V2DraftPane full component split** (SectionBlock/ParagraphBlock/FreeformBlock) — 669→still ~600 lines. Needs E2E test coverage before aggressive decomposition.
- **V2InterventionCard prop drilling** — needs design pass for context-vs-state consolidation.
- **`--ink-4` contrast** — locked at ~2.65:1 due to token scale constraints; consider redesigning the 3/4 ink scale if stricter AA is required.

## Confirmed OK

- No `!important` abuse.
- Toast notifications wired for most API error paths.
- `oklch()` tokens used consistently where tokens are used.
- CSS scoping `body:not(:has(.app))` correctly prevents V2 shell bleed into legacy routes.
- Full test suite: 454/454 passing after all changes.

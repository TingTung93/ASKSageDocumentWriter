# Changelog

All notable changes to this project are documented here. The format is
loosely based on [Keep a Changelog](https://keepachangelog.com/), and
this project aims to follow [semantic versioning](https://semver.org/)
once the V2 workspace stabilizes.

## [0.3.0] — 2026-04-24

UI/UX audit polish pass plus the Freeform workspace feature shipped.
PRs [#7] and [#8]. Typecheck clean, 454/454 tests pass.

### Added

- **Freeform workspace** — `FreeformDraftView` + per-section
  `FreeformBlock` for projects that don't use template sections.
  `redraftFreeformSection` + `paragraphsToMarkdown` helpers in
  `src/lib/freeform/drafter.ts` for per-block regen with attached-file
  context (`file_extracts` map built from cached
  `ProjectContextFile.extracted_text`).
- **Shared `<Modal>` primitive** (`src/components/v2/Modal.tsx`) with
  focus trap, Escape-to-close, focus restore, `role="dialog"`,
  `aria-modal="true"`. Migrated Export, Ingest, CommandPalette, and
  the DraftPane preview onto it.
- **`V2ProviderCard`** extracted as a reusable component; provider list
  now driven by an array with direction-aware arrow navigation so
  adding a third provider won't require rewiring.
- **`draftAndValidateSection`** helper in `src/lib/draft/` factors the
  client/context/draft/critique/persist flow out of V2DraftPane's
  `handleFix` (shrinks ~79 → ~25 lines).
- **`docs/AUDIT.md`** — in-repo tracker of the UI/UX audit findings and
  their resolutions.

### Fixed

- **Freeform regen** no longer silently drops attached-file context;
  `file_extracts` is threaded through from cached extracts.
- **LLM response field** — drafting pipeline now reads `r.message` (was
  `r.response`, which returned undefined against actual Ask Sage
  responses on some stages).
- **V2DraftPane preview modal** closes on Escape and restores focus
  (was overlay-click only).
- **Provider selector** in V2SettingsView is now a proper radiogroup
  with roving tabindex; Enter/Space select, arrow keys move focus.
- **Model routing drafts** in V2SettingsView no longer clobber
  in-flight edits when Dexie re-emits settings (replaced derived-state
  `useEffect` mirror with pending-edits + `modelValueFor(stage)` that
  reads from persisted settings).
- **`V2ExportModal`** auto-closes on assembly failure instead of
  leaving an empty modal behind the error toast.
- **`sessionStorage` failures** in V2Layout now surface a one-shot
  toast instead of swallowing silently on private browsing.
- **DOCX `<w:document>`** namespace simplification in the freeform
  assembler.

### Removed

- **Dead placeholder buttons** with no handlers: Duplicate
  (V2Layout), Branch/Clear/More (V2ChatPane), Search/More/Citations
  and the "Drop .docx" attach tile (V2SourcesPane).
- **`assembleDocxStage`** removed from the freeform recipe — export
  happens via the Export button only, no more auto-download on run
  completion.

### Accessibility

- Focus traps + focus restore on every scrim modal via the shared
  `<Modal>` primitive.
- Command palette is now a proper listbox with
  `aria-activedescendant`, `role="option"`, `aria-selected`, and
  result count announced via the list's `aria-label`.
- Form labeling: API key input + show/hide toggle (`aria-pressed` +
  dynamic accessible name), intervention fact input wrapped in
  `<label>`.
- Export busy region gains `aria-live="polite"` + `aria-busy`.
- V2FirstRun: Escape dismisses, primary action focused on mount.
- `--ink-4` darkened from 1.99:1 → ~2.65:1 contrast on `--paper`
  (still under strict AA; the CSS comment directs body-size text to
  prefer `--ink-3`).

### Changed / internal

- **Design tokens consolidated.** `src/v2.css` is now the single source
  of truth for radii/shadows/fonts; `src/index.css` drops the
  duplicates and keeps only legacy-specific tokens. `--radius-md`
  aliased for legacy references.
- **Legacy route parity** — `routes/Welcome.tsx` provider selector now
  uses the V2 `provider-card` grid; `routes/Settings.tsx` model rows
  use a new `.model-override-row` utility; App.tsx legacy shell
  padding reduced from `calc(40vh + 2rem)` → `40vh` (DebugPanel still
  renders).
- **Memoization** added to `V2ChatPane` (`notes`, `filteredSlash`),
  `V2CommandPalette` (`items`, `groups`, `flat`), and V2DraftPane's
  IntersectionObserver (`sectionIds`).
- **RecipeContext** stage callbacks wrapped in stable `useCallback`s.
- **`Modal` visibility check** uses computed-style +
  `getClientRects` so `position: fixed` focusables no longer get
  filtered out; focus restore guards with `isConnected`.

[#7]: https://github.com/TingTung93/ASKSageDocumentWriter/pull/7
[#8]: https://github.com/TingTung93/ASKSageDocumentWriter/pull/8

## [0.2.0] — 2026-04-23

First tagged cut on this branch. (An earlier `v0.1.0` tag exists on
`c808de5` from the letterhead-slot work; this release is sequenced after
it.) The V2 three-pane workspace (Sources · Chat · Draft)
is now the primary UI, matching the Claude Design handoff bundle in
`Version2/`. The classic per-route UI (`/projects`, `/templates`,
`/documents`, `/audit`, `/settings`) remains available as an escape
hatch for deep configuration.

### V2 workspace

- Sources, Chat, and Draft panes share citations live — hover `[n]` in
  the draft to see the source excerpt popover; cited sources in the
  Sources pane gain an accent border.
- Command palette (`⌘K` / `Ctrl+K`) with grouped Navigate and Actions
  sections. Dispatches app-bus CustomEvents (`v2:open-export`,
  `v2:open-ingest`, `v2:regen-active`, `v2:accept-findings`) that the
  Layout wires into toasts or modal opens.
- Slash-command menu in the composer (`/regen`, `/expand`, `/tighten`,
  `/cite`, `/rewrite`) with arrow-key navigation.
- Scroll-spy TOC: the active section chip highlights as the reader
  scrolls the draft (IntersectionObserver on the pane body).
- Export modal assembling every ready draft across the project's
  templates; fires a toast per download.
- In-workspace Ingest modal (drag-drop `.docx` → parse locally →
  register template), Library view (tabbed Templates + Datasets),
  Audit view (live-query `db.audit` with search, kind-pill filter,
  status filter, Export JSON), and a compact Settings view (provider
  picker, API key, base URL test, per-stage model routing) that escapes
  to the full `/settings` route for privacy / usage / reset controls.
- First-run onboarding overlay when no API key is configured;
  dismissal persists to sessionStorage.
- Design-system CSS ported wholesale from the fresh Claude Design
  bundle (IBM Plex Sans/Mono, Instrument Serif, oklch neutrals,
  restrained deep-blue accent, refined modal and palette tokens).

### Drafting quality

- **Point Paper** (`point_paper`) tone guidance rewritten with explicit
  must / must-not rules: no throat-clearing openers, one idea per
  bullet, required hard metric, no filler adjectives. Includes a
  DHA-flavored worked example.
- **Award Bullets** (`award_bullets`) — new freeform style for
  PCS/MSM/AAM/commendation write-ups. Bang-bang-bang format, required
  past-tense action verb, required metric, worked contracting-officer
  example.
- Filler reject-and-retry: both styles now scan the model's output for
  banned openers; if the first two bullets offend, or two+ total
  bullets offend, the drafter re-prompts once with an explicit
  constraint quoting the offense. Falls back to the original draft if
  the retry is worse. Token totals aggregate across retries.
- Closes partial of [#5](https://github.com/TingTung93/ASKSageDocumentWriter/issues/5)
  (pending field validation on a real PCS-award draft).

### Tests

- 448 passing (up from ~0 on V2 specifics before this cut).
- New files: `src/lib/freeform/filler.test.ts` (17), `retry.test.ts`
  (5), `styles.test.ts` (8), `drafter.test.ts` (3),
  `src/components/v2/helpers.test.ts` (18).
- Extracted V2 view helpers into `src/components/v2/helpers.ts` so
  kind-inference / time-formatting can be tested without rendering.
- `inferTemplateKind` now normalizes hyphens/underscores to spaces so
  real filenames like `market-research-FY26.docx` resolve correctly.

### Build

- Production artifact: `release/index.html`, 2.50 MB single file, 735
  KB gzipped. Zero `type="module"` scripts, verified via
  `vite-plugin-singlefile` + the in-repo classicify post-processor.
  Runs from `file://` on the DHA workstation as designed.

### Known limitations

- V2 has no component-level render tests yet (helpers are covered; the
  view tree itself is only protected by typecheck). Render smoke tests
  are next on the list.
- The `Tweaks` dev panel from the design bundle is intentionally not
  implemented — it was a prototype affordance for flipping app states,
  not a user-facing surface.
- Audit / Settings consolidation is partial: V2 exposes the common
  controls; deep config (privacy toggles, usage caps, reset) still
  lives on the classic `/settings` route with a link from V2.

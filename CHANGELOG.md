# Changelog

All notable changes to this project are documented here. The format is
loosely based on [Keep a Changelog](https://keepachangelog.com/), and
this project aims to follow [semantic versioning](https://semver.org/)
once the V2 workspace stabilizes.

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

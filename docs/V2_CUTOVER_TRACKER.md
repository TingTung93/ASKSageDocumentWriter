# V2 Cutover Tracker

Status: release candidate, not yet go — see `docs/V2_CUTOVER_EVIDENCE.md`

Canonical implementation: `src/`

Reference-only design bundle: `Version2/`

## Current cutover audit

The default shell and core workflow are implemented and the automated release
gate passes. The detailed checklist below is the original work-package
inventory; current go/no-go status is summarized here and backed by the
evidence document.

Completed and verified in the current release candidate:

- V2 owns `/`, `/v2`, project creation/opening, project drafting, Documents,
  Library, Activity, Settings, editing proposals, and export.
- The auditable edit flow produces an interactive proposal and does not mutate
  the document until Accept.
- Recipe recovery, provider/tool hardening, recursive redaction, partial export
  reporting, the single-file artifact, and deterministic browser lifecycle
  coverage are implemented.
- The full automated gate passes: 109 Vitest files / 797 tests, production
  build, artifact scan, and 8 production browser scenarios.
- The `file://` artifact passed a real Ollama provider smoke test, and generated
  DOCX files opened without repair in Word and LibreOffice.

Still required before changing this tracker to **go**:

- Product, security, and release-owner approval of
  `docs/V2_CUTOVER_POLICIES.md` and `docs/V2_CUTOVER_EVIDENCE.md`.

The previously open technical evidence items are now covered by focused tests:
browser history traversal, immediate DOCX ingestion visibility, v8-to-v9
IndexedDB compatibility, interrupted resume and failed retry semantics, all
documented drafter limits, partial multi-template export, and a distinct
resumed-run DOCX accepted by Word and LibreOffice.

- [x] Technical implementation and evidence complete.
- [x] Source and matching release artifact recorded in commit `6da5ef6`.
- [ ] Product, security, and release owners approve the evidence.

This tracker defines the work and evidence required to complete the V2
cutover without creating parallel implementations or drifting from the
current code. V2 is already the canonical project-drafting route:
`/projects/:id` redirects to `/v2/:id` in `src/App.tsx`. The explicit
`/legacy/projects/:id` route remains a compatibility escape hatch until the
retirement gates in this document are met.

## Anti-drift rules

- Extend the existing V2 editing UI under `src/components/v2/drafting/`.
- Extend the existing editing engine under `src/lib/agentic-editing/`.
- Use the existing provider abstraction under `src/lib/provider/`.
- Use `src/components/v2/useProjectRecipeRun.ts` and
  `src/components/v2/RecipeContext.tsx` for recipe recovery.
- Use the existing DOCX assemblers under `src/lib/export/` and
  `src/lib/freeform/`.
- Do not add another command bus, editing runner, recovery store, provider
  abstraction, or export pipeline.
- Do not add features to `src/routes/ProjectDetail.tsx` except approved
  compatibility or data-recovery fixes.
- Preserve the persisted identifiers listed in
  `src/lib/product/compatibility.ts`.
- Create focused tests for each workstream; do not turn
  `V2SmokeTest.test.tsx` into a catch-all integration suite.
- Regenerate `release/index.html` once, during final integration.

## Cutover definition

The V2 default-route cutover is complete when Phases 0 through 4 pass. Legacy
project-view removal is a later milestone and is governed by Phase 5.

---

## Phase 0: Approve shared contracts

These decisions block final implementation because they define observable
behavior for several parallel workstreams.

### 0.1 Interface ownership

Current code exposes embedded V2 Library, Audit, and Settings views in
`V2Layout.tsx`, while `App.tsx` retains classic routes for Templates,
Datasets, Audit, and Settings. V2 entry points are inconsistent:

- `V2Sidebar.tsx` and `V2CommandPalette.tsx` select embedded views.
- `V2FirstRun.tsx` navigates to classic `/settings`.
- `V2SettingsAdvanced.tsx` navigates to classic `/audit`.
- `drafting/EditSessionPanel.tsx` links to classic `/settings`.

- [ ] Decide whether embedded V2 views or classic routes own each workflow.
- [ ] Document the purpose of Documents as editing an existing DOCX rather
  than drafting a project.
- [ ] Document `/legacy/projects/:id` as temporary compatibility UI.
- [ ] Define browser back/forward behavior for embedded views.

Acceptance criteria:

- Every entry point follows one documented ownership rule.
- Sidebar, command palette, onboarding, editing, and error-recovery links
  agree.
- Retained classic and embedded surfaces cannot silently implement different
  save, reset, or export semantics.

### 0.2 Resume and replay semantics

Recipe recovery currently resumes at the first incomplete stage in
`src/lib/agent/recipe.ts`; an interrupted stage may be re-executed and stages
are expected to be idempotent. Agentic-edit recovery under
`src/lib/agentic-editing/recovery.ts` uses checkpoints to avoid replay.

- [ ] Define when an interrupted recipe stage may be replayed.
- [ ] Define idempotency requirements for recipe stages.
- [ ] Define expected provider and tool-call counts after resume.
- [ ] Define retry behavior separately from resume behavior.

Acceptance criteria:

- One policy governs unit tests, browser tests, and user-facing recovery copy.
- Completed work is not repeated unless the policy explicitly permits it.
- Re-execution cannot duplicate durable artifacts or downloads.

### 0.3 Sensitive-content policy

Audit records intentionally persist prompt and response excerpts through
`src/lib/db/schema.ts` and provider audit plumbing. `V2AuditView.tsx` exports
those records, and `src/lib/export/diagnostic_json.ts` exports project and
draft content.

- [ ] Decide which prompts, responses, references, and draft content may be
  persisted.
- [ ] Decide which content may be included in support and audit exports.
- [ ] Define required user disclosure or confirmation for content-bearing
  exports.
- [ ] Define recursive credential-redaction requirements.

Acceptance criteria:

- API keys and authorization headers are never persisted or exported.
- Users are told when an export contains document or model content.
- Tests and fixtures contain synthetic documents only.

---

## Phase 1: Shared foundations

The four work packages in this phase can run in parallel after Phase 0.

### Agent A: Routing and navigation contract

Owned files:

- `src/App.tsx`
- `src/components/v2/V2Layout.tsx`
- `src/components/v2/V2Sidebar.tsx`
- `src/components/v2/V2CommandPalette.tsx`
- `src/components/v2/V2FirstRun.tsx`
- New focused route and navigation tests

Work:

- [ ] Test `/projects/:id` redirecting to `/v2/:id` with replace semantics.
- [ ] Test direct V2 routes and the compatibility route.
- [ ] Apply the approved interface-ownership decision.
- [ ] Align all V2 navigation entry points.
- [ ] Test missing-project behavior.
- [ ] Test browser history behavior for embedded views.

Acceptance criteria:

- New and existing project links resolve to V2.
- `/legacy/projects/:id` remains directly reachable during observation.
- Missing projects show an actionable terminal state.
- All navigation entry points follow the approved ownership model.

### Agent B: Capability and probe contract

Owned files:

- `src/lib/agentic-editing/capabilities.ts`
- `src/lib/provider/connection.ts`
- Provider conformance probe/store modules
- `src/lib/state/auth.ts`
- Focused capability and invalidation tests

Work:

- [ ] Define one resolved capability snapshot keyed by provider, normalized
  endpoint, selected model, authentication revision, and probe version.
- [ ] Invalidate stale probes when provider, endpoint, credentials, or model
  changes.
- [ ] Make provider capability the upper bound and model metadata a narrowing
  constraint.
- [ ] Make V2 capability explanations consume the same snapshot.
- [ ] Keep agentic editing labelled prompt-only until native editing is wired.

Acceptance criteria:

- Provider `tools: false` always disables tools.
- Model `tool_calling: false` disables tools on an otherwise capable provider.
- A probe for one model or endpoint cannot authorize another.
- JSON-looking assistant text is not accepted as a native tool call.
- UI claims and persisted execution routes use identical capability evidence.

### Agent C: Provider serialization conformance

Owned files:

- `src/lib/provider/openai_compat.ts`
- `src/lib/provider/genai_mil.ts`
- Ask Sage, OpenRouter, Local OpenAI, and GenAI.mil request tests
- Provider conformance tests

Work:

- [ ] Add table-driven request-body tests across all providers.
- [ ] Verify assistant tool calls and tool-result IDs serialize correctly.
- [ ] Verify STARK request allowlisting.
- [ ] Verify Ask Sage receives tools only after shared authorization.
- [ ] Lock provider-specific fields to their supported providers.

Acceptance criteria:

- GenAI.mil never receives tools, tool choice, tool transcripts, datasets,
  live search, or embedding fields.
- OpenRouter and Local OpenAI receive valid OpenAI tool-message envelopes.
- Ask Sage receives no tools when resolved capability disallows them.
- Prompt-only and tool-assisted requests have explicit regression coverage.

### Agent D: Browser and artifact harness

Owned files:

- `package.json`
- `vite.config.ts`
- New browser-test configuration, helpers, and fixtures
- Artifact-shape tests

Work:

- [ ] Add a browser-level test runner.
- [ ] Add deterministic synthetic provider stubs.
- [ ] Add helpers to seed and inspect IndexedDB.
- [ ] Add a production-build test path.
- [ ] Add single-file artifact assertions.
- [ ] Add a target-environment `file://` validation lane.

Acceptance criteria:

- Browser tests run against a production build.
- Tests can seed projects, templates, drafts, and recipe runs.
- Tests can assert provider and tool-call counts.
- `release/index.html` has no external JS/CSS or module entry script.
- Direct `#/v2/<id>` navigation works without real credentials.

---

## Phase 2: Core cutover behavior

### Agent E: Native drafting tool hardening

Start after Agent B establishes the capability contract. One agent must own
the complete tool-control flow in `src/lib/draft/drafter.ts`.

Owned files:

- `src/lib/draft/drafter.ts`
- `src/lib/draft/drafter.test.ts`
- Extracted tool registry, schema, and executor modules if needed

Current risks:

- Tool enablement checks provider capability but not selected-model metadata.
- The tool loop is unbounded.
- The calculator evaluates model input with `new Function`.
- `fetch_url` permits model-selected browser requests.
- Table and formatting tools return Markdown-like strings rather than
  structured draft IR.

Work:

- [ ] Consume the shared provider-and-model capability decision.
- [ ] Replace dynamic evaluation with a constrained arithmetic parser.
- [ ] Remove `fetch_url`, or restrict it to approved HTTPS public hosts with
  private-address denial, timeout, and size limits.
- [ ] Add maximum rounds, calls, result bytes, and conversation bytes.
- [ ] Add cancellation and `AbortSignal` propagation.
- [ ] Runtime-validate every tool argument.
- [ ] Return bounded structured tool errors.
- [ ] Remove or redesign presentation tools to return structured draft IR.

Acceptance criteria:

- No model-supplied value reaches dynamic JavaScript evaluation.
- A looping model terminates at documented limits.
- Malformed, oversized, hostile, unknown, and cancelled calls fail safely.
- Model metadata can suppress tools.
- Tool formatting conforms to the structured DOCX contract.
- Tests cover injection, exhaustion, SSRF targets, abort, invalid JSON,
  oversized results, and multiple calls.

### Agent F: V2 lifecycle and recovery

Owned files:

- `src/components/v2/useProjectRecipeRun.ts`
- `src/components/v2/RecipeContext.tsx`
- `src/components/v2/V2ProjectWorkspace.tsx`
- Focused recovery tests
- Browser lifecycle scenarios

Work:

- [ ] Test newest-run recovery.
- [ ] Test paused, failed, interrupted, and completed runs.
- [ ] Test project switching during asynchronous recovery.
- [ ] Test duplicate-start guards.
- [ ] Implement the approved replay/idempotency policy.
- [ ] Add provider-call-count assertions.
- [ ] Add pause, reload, resume, and export browser coverage.

Acceptance criteria:

- Provider-call counts match the documented resume contract.
- Switching projects never leaks run state.
- Stale `running` rows display as interrupted.
- Resume and retry appear only for valid states.
- A resumed workflow exports successfully.

### Agent G: Library and dataset truthfulness

Owned files:

- `src/components/v2/V2LibraryView.tsx`
- `src/components/v2/V2SourcesPane.tsx`
- Focused dataset and provider-capability tests

Current drift:

- V2 library uses a hard-coded empty dataset collection.
- Sources-pane dataset support is explicitly provisional.
- Some source-library affordances do not implement an action.

Work:

- [ ] Load real datasets through the supported capability path, or disable
  dataset controls.
- [ ] Remove enabled no-op affordances.
- [ ] Display provider limitations.
- [ ] Preserve local template ingestion.

Acceptance criteria:

- No enabled dataset control is a no-op.
- Providers without dataset support do not imply availability.
- Dataset names shown in V2 match those used during drafting.
- Ingested templates persist and become immediately visible.

### Agent H: Privacy, diagnostics, and audit

Owned files:

- `src/lib/debug/log.ts`
- `src/components/v2/V2AuditView.tsx`
- Provider audit plumbing
- `src/lib/export/diagnostic_json.ts`
- Focused redaction and export tests

Work:

- [ ] Apply the approved sensitive-content policy.
- [ ] Add recursive credential redaction.
- [ ] Review persisted prompt and response excerpts.
- [ ] Add disclosure or confirmation to content-bearing exports.
- [ ] Test download URL creation and revocation.
- [ ] Scan diagnostics, audit exports, and release HTML for secrets.

Acceptance criteria:

- API keys and authorization headers never enter IndexedDB or exports.
- Nested credential-like fields are redacted.
- Content-bearing exports are clearly disclosed.
- Production diagnostics remain opt-in and closed by default.
- Audit downloads work reliably in supported browsers.

---

## Phase 3: Export and surface consolidation

### Agent I: Export behavior and status

Owned files:

- `src/components/v2/V2ExportModal.tsx`
- `src/lib/export/downloadAssembled.ts`
- Focused export tests and fixtures

Work:

- [ ] Define the policy for mixed ready, error, failed, and skipped drafts.
- [ ] Surface partial assembly accurately.
- [ ] Test multi-template partial failure.
- [ ] Test export from durable IndexedDB data after reload.
- [ ] Test filenames and object URL revocation.
- [ ] Test export after resume and section revision.

Acceptance criteria:

- The UI never reports complete success for partial failure.
- Export failure is recoverable.
- Eligibility and blocking rules are documented and tested.
- Results identify success and failure per template.
- Export after reload does not depend on persisted blob URLs.

### Agent J: DOCX acceptance fixtures

Owned files:

- Existing tests under `src/lib/export/`
- Existing freeform assembler tests
- Synthetic release fixtures and validation evidence

Work:

- [ ] Produce canonical template-based and freeform outputs.
- [ ] Add resumed-run and revised-section fixtures.
- [ ] Validate ZIP and OOXML structure automatically.
- [ ] Open outputs in Word and LibreOffice.
- [ ] Record application versions and results.

Acceptance criteria:

- Word opens every fixture without a repair warning.
- LibreOffice opens every fixture successfully.
- Headers, footers, styles, drawings, lists, tables, rich runs, and page
  breaks remain intact.
- Differences from approved fixtures are release-blocking.

### Agent K: Settings and audit consolidation

Owned files:

- `src/components/v2/V2SettingsView.tsx`
- `src/components/v2/V2SettingsAdvanced.tsx`
- `src/components/v2/V2AuditView.tsx`
- Focused loaded-settings and interaction tests

Work:

- [ ] Apply the approved interface-ownership decision.
- [ ] Align reset, save, and export behavior with retained classic surfaces.
- [ ] Derive capability messaging from Agent B's resolved snapshot.
- [ ] Test loaded settings and reset propagation.

Acceptance criteria:

- V2 and classic views cannot diverge silently.
- Capability messages describe the selected model and verified evidence.
- Reset scope is documented and tested.
- API keys remain outside general settings persistence.

---

## Phase 4: Integration and cutover gate

### Agent L: Final integration

Owned files:

- Cross-workstream integration points
- Release checklist and CI configuration
- `release/index.html`

Work:

- [ ] Run `npm run typecheck`.
- [ ] Run the complete Vitest suite.
- [ ] Run production-build browser lifecycle tests.
- [ ] Run artifact-shape and secret scans.
- [ ] Run `npm run build` from a clean source state.
- [ ] Validate `file://` navigation, persistence, provider calls, and
  downloads in the target browser.
- [ ] Attach Word and LibreOffice validation evidence.
- [ ] Confirm only intended source and artifact changes remain.
- [ ] Regenerate `release/index.html` exactly once.

Acceptance criteria:

- All automated and manual release gates pass.
- No release-blocking test is skipped without approval.
- The artifact maps to the approved source commit.
- Existing IndexedDB projects open without migration or apparent data loss.
- V2 completes create, draft, pause, reload, resume, revise, and export.
- The compatibility route remains available during observation.

## Go/no-go criteria

V2 cutover is a go when:

- [ ] Interface, recovery, and privacy contracts are approved.
- [ ] All Phase 1 through Phase 4 acceptance criteria pass.
- [ ] No open critical security, data-loss, recovery, or export defect remains.
- [x] The target `file://` environment and at least one supported provider
  pass manual smoke testing.
- [ ] Product, security, and release owners approve the evidence.

---

## Phase 5: Legacy project-view retirement

This phase is not required to make V2 the default. It begins after the
observation period.

- [ ] Define an observation period and privacy-safe fallback metric.
- [ ] Record why users require the compatibility view.
- [ ] Confirm every required legacy project workflow has an approved V2
  disposition.
- [ ] Confirm migration safety for existing IndexedDB data and bookmarks.
- [ ] Remove legacy navigation.
- [ ] Redirect historical `/legacy/projects/:id` links safely to V2.
- [ ] Remove dead legacy project code and duplicated helpers.
- [ ] Rerun the complete cutover gate.

Acceptance criteria:

- The observation period is complete.
- Fallback usage is below the approved threshold.
- No required workflow depends on `ProjectDetail.tsx`.
- Historical links and stored projects open safely in V2.
- Removing the legacy view does not affect Documents, Templates, Datasets,
  Audit, or Settings.

---

## Agent conflict matrix

The following files require a single owner at a time:

| Hot file | Owner |
| --- | --- |
| `src/App.tsx` | Routing/navigation agent |
| `src/components/v2/V2Layout.tsx` | Routing agent, then lifecycle integration |
| `src/components/v2/V2DraftPane.tsx` | Draft/edit integration owner |
| `src/components/v2/RecipeContext.tsx` | Lifecycle agent |
| `src/lib/draft/drafter.ts` | Native-tool runtime agent |
| `src/lib/state/auth.ts` | Capability/probe agent |
| `src/lib/db/schema.ts` | One approved migration owner |
| `package.json` and `vite.config.ts` | Browser/artifact agent |
| `release/index.html` | Final integration agent only |

Additional sequencing constraints:

- Land the capability/probe contract before final drafter integration.
- Do not split drafter capability gating and tool-loop hardening across
  agents.
- Establish the browser harness before lifecycle and `file://` acceptance
  work.
- Stabilize export eligibility before producing desktop-validation fixtures.
- Approve the privacy policy before security signoff.

## Critical path

```text
Interface + recovery + privacy decisions
                 |
                 +-- Capability/probe contract --> Tool hardening
                 |
                 +-- Browser harness -----------> Lifecycle proof
                 |
                 +-- Export policy -------------> DOCX validation
                 |
                 +-- Privacy policy ------------> Security signoff
                                                     |
                                                     v
                                          Final integration build
```

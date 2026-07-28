# SPA Cohesion and Reliability Remediation Plan

> **Implementation rule:** Execute this plan task-by-task. Every task must leave its focused tests, `npm run typecheck`, and the existing test suite passing before the next task begins. Do not combine connection semantics, recipe recovery, command implementation, diagnostics, and legacy consolidation into one change.

**Goal:** Make the V2 workspace honest, recoverable, and consistent across providers while reducing the visible seams between the legacy routes, V2 workspace, and standalone document editor.

**Architecture:** Establish shared provider-connection selectors as the single source of truth, make the route project ID the owner of recipe-run recovery, replace global custom-event placeholders with typed workspace actions, and move production diagnostics behind an explicit opt-in. Preserve the existing document-processing, IndexedDB, recipe, and export implementations; this plan changes their UI integration rather than rewriting the proven domain logic.

**Tech Stack:** React 18, TypeScript 5.6 strict mode, Vite, React Router 6, Zustand, Dexie 4, Vitest, React Testing Library, existing provider and recipe abstractions.

**Source Audit:** Implementation audit completed 2026-07-27. Baseline at plan creation: typecheck passes, 72 test files pass, 630 tests pass, and the single-file production build succeeds.

---

## Product Decisions

These decisions keep the work bounded and prevent another parallel implementation:

1. **V2 is the primary project drafting experience.**
   - `/projects/:id` continues to redirect to `/v2/:id`.
   - `/legacy/projects/:id` remains an explicit escape hatch during this plan.
2. **Provider verification and credential presence are different concepts.**
   - Ask Sage, OpenRouter, and GenAI.mil require a non-blank API key.
   - Local OpenAI may generate without an API key after a successful endpoint/model check.
3. **Visible actions must be functional.**
   - An unavailable action is disabled or omitted with an explanation.
   - No placeholder action may emit a success or progress toast.
4. **Persisted recipe runs are the source of truth after reload.**
   - In-memory React state is only the current view of the persisted run.
5. **The debug console is not part of the default production experience.**
   - Normal errors remain available through toasts, error boundaries, and the audit view.
6. **Legacy consolidation follows reliability fixes.**
   - Do not rewrite `ProjectDetail.tsx` or `Documents.tsx` while repairing V2 recovery and provider behavior.

---

## Delivery Strategy

Deliver in four independently reviewable increments:

1. **Truthful provider and route state**
   - Shared connection selectors, keyless local drafting, correct onboarding/sidebar state, missing-project handling.
2. **Durable V2 workflow**
   - Restore the newest recipe run, expose recovery states, prevent duplicate starts, verify pause/reload/resume.
3. **Honest workspace actions**
   - Remove placeholder event handlers, introduce typed actions, implement the actions supported by existing draft APIs, disable the rest.
4. **Production cohesion**
   - Hide diagnostics by default, add end-to-end workflow coverage, document ownership boundaries, then begin low-risk legacy deduplication.

The first three increments are release-blocking reliability work. The fourth may be split across releases if the route consolidation needs broader product review.

---

## File Structure

### Shared connection state

- Create `src/lib/provider/connection.ts`
- Create `src/lib/provider/connection.test.ts`
- Modify `src/lib/state/auth.ts`
- Modify `src/components/v2/RecipeContext.tsx`
- Modify `src/components/v2/V2Layout.tsx`
- Modify `src/components/v2/V2Sidebar.tsx`
- Modify `src/components/v2/V2SettingsView.tsx`
- Modify `src/components/Shell.tsx`
- Modify `src/routes/Welcome.tsx`
- Modify associated tests

### Project and run recovery

- Create `src/components/v2/useProjectRecipeRun.ts`
- Create `src/components/v2/useProjectRecipeRun.test.tsx`
- Modify `src/components/v2/RecipeContext.tsx`
- Modify `src/components/v2/V2Layout.tsx`
- Modify `src/components/v2/V2ProjectWorkspace.tsx`
- Modify `src/components/v2/V2ChatPane.tsx`
- Modify `src/lib/agent/recipe.ts` only if a narrower latest-run query is needed
- Modify `src/lib/agent/recipe.test.ts`

### Workspace actions

- Create `src/components/v2/workspace-actions.ts`
- Create `src/components/v2/workspace-actions.test.ts`
- Create `src/components/v2/WorkspaceActionContext.tsx`
- Modify `src/components/v2/V2Layout.tsx`
- Modify `src/components/v2/V2CommandPalette.tsx`
- Modify `src/components/v2/V2ChatPane.tsx`
- Modify `src/components/v2/V2DraftPane.tsx`
- Modify `src/components/v2/V2ProjectWorkspace.tsx`
- Modify focused V2 tests

### Diagnostics and workflow coverage

- Modify `src/components/DebugPanel.tsx`
- Modify `src/App.tsx`
- Modify `src/lib/debug/log.ts` if an enablement selector is required
- Create `src/App.test.tsx` or a focused diagnostics integration test
- Create `src/components/v2/V2Workflow.test.tsx`
- Modify `src/components/v2/V2SmokeTest.test.tsx`
- Modify `README.md`
- Update `docs/AUDIT.md`

### Generated artifact

- Modify `release/index.html` only through the final `npm run build`.

---

## Core Contracts

### Provider connection status

All routes and actions must use one derived status contract:

```ts
export type ProviderConnectionState =
  | 'not_configured'
  | 'configured_unverified'
  | 'verified'
  | 'verification_failed';

export interface ProviderConnectionInput {
  provider: ProviderId;
  apiKey: string | null;
  models: ModelInfo[] | null;
  localProbe: LocalEndpointProbeResult | null;
  error: string | null;
}

export interface ProviderConnectionSummary {
  state: ProviderConnectionState;
  requiresApiKey: boolean;
  canValidate: boolean;
  canGenerate: boolean;
  label: string;
}

export function getProviderConnection(
  input: ProviderConnectionInput,
): ProviderConnectionSummary;
```

Rules:

- Remote providers require a non-blank key before validation or generation.
- Local OpenAI does not require a key.
- A successful local probe plus an available model permits generation.
- A stale local probe for a different base URL does not permit generation.
- `models === null` means unknown, not automatically disconnected.
- UI labels come from the summary rather than route-specific conditionals.

### Recovered run state

```ts
export type ProjectRunLoadState =
  | { status: 'loading' }
  | { status: 'none' }
  | { status: 'ready'; run: RecipeRun }
  | { status: 'error'; error: Error };
```

Recovery rules:

- Query by the active project ID.
- Select the newest run with a known registered recipe.
- Restore paused, running, failed, cancelled, and completed runs for visibility.
- Treat a persisted `running` run found after reload as interrupted until the runner proves it is actively executing.
- Do not automatically repeat provider calls or stage side effects during recovery.
- Starting a fresh run while a resumable run exists requires an explicit user choice.

### Workspace action state

```ts
export type WorkspaceActionId =
  | 'regenerate_section'
  | 'expand_section'
  | 'tighten_section'
  | 'strengthen_citations'
  | 'rewrite_section'
  | 'accept_findings';

export interface WorkspaceActionAvailability {
  id: WorkspaceActionId;
  enabled: boolean;
  unavailableReason?: string;
}

export interface WorkspaceActionController {
  availability(id: WorkspaceActionId): WorkspaceActionAvailability;
  execute(id: WorkspaceActionId, input?: unknown): Promise<void>;
}
```

The command palette and slash menu consume this controller. They must not dispatch undocumented global browser events.

---

## Task 1: Centralize Provider Connection Semantics

**Files:**

- Create: `src/lib/provider/connection.ts`
- Create: `src/lib/provider/connection.test.ts`
- Modify: `src/lib/state/auth.ts`
- Modify: `src/components/v2/V2SettingsView.tsx`

- [ ] Write table-driven tests for every provider with blank key, configured key, models loaded, validation failure, and local probe states.
- [ ] Implement `getProviderConnection` as a pure function.
- [ ] Ensure local probe validity includes the active base URL.
- [ ] Replace V2 Settings' local `connectionStatus` calculation with the shared summary.
- [ ] Clarify connection copy: keys are stored only in the browser session and sent only to the configured provider.
- [ ] Keep API keys out of IndexedDB, logs, audit excerpts, and error messages.

**Acceptance criteria:**

- A verified keyless local provider reports connected and can generate.
- A keyless remote provider cannot validate or generate.
- A changed local base URL invalidates the previous probe.
- Connection wording does not claim remote-provider keys never leave the workstation.

---

## Task 2: Apply Connection Semantics Across the App

**Files:**

- Modify: `src/components/v2/RecipeContext.tsx`
- Modify: `src/components/v2/V2Layout.tsx`
- Modify: `src/components/v2/V2Sidebar.tsx`
- Modify: `src/components/Shell.tsx`
- Modify: `src/routes/Welcome.tsx`
- Modify: `src/lib/state/auth.test.ts`
- Modify: `src/routes/Welcome.test.tsx`
- Modify: `src/components/v2/V2SmokeTest.test.tsx`

- [ ] Replace every `!!apiKey` connection check with the shared connection summary.
- [ ] Replace `if (!apiKey)` generation gates with `canGenerate`.
- [ ] Continue passing `apiKey ?? ''` to providers that allow optional authentication.
- [ ] Make first-run onboarding depend on configuration/verification state, not credential presence alone.
- [ ] Make Sidebar and legacy Shell show the same connection label.
- [ ] Add a regression test that a restored, verified keyless local provider can start a V2 recipe.
- [ ] Add a regression test that a remote provider with no key remains blocked.

**Acceptance criteria:**

- Settings, onboarding, Sidebar, Shell, and recipe execution agree about connection state.
- Local OpenAI works from connection through drafting without entering a fake offline state.

---

## Task 3: Handle Project Loading and Missing Routes Explicitly

**Files:**

- Modify: `src/components/v2/V2Layout.tsx`
- Modify: `src/components/v2/V2ProjectWorkspace.tsx`
- Create or modify focused V2 route tests

- [ ] Preserve Dexie's unresolved state separately from a resolved missing record.
- [ ] Render a bounded loading state while the project query is unresolved.
- [ ] Render “Project not found” after a missing record resolves.
- [ ] Provide actions back to Projects and, when appropriate, to create a project.
- [ ] Disable Auto-draft and Export until both project and required template queries resolve.
- [ ] Ensure a project deleted in another tab transitions to the missing state.

**Acceptance criteria:**

- `/v2/:missingId` never remains on “Loading project…” indefinitely.
- No action silently returns because project data is unresolved.

---

## Task 4: Restore Persisted Recipe Runs

**Files:**

- Create: `src/components/v2/useProjectRecipeRun.ts`
- Create: `src/components/v2/useProjectRecipeRun.test.tsx`
- Modify: `src/components/v2/RecipeContext.tsx`
- Modify: `src/components/v2/V2Layout.tsx`
- Modify: `src/components/v2/V2ChatPane.tsx`
- Modify: `src/lib/agent/recipe.ts`
- Modify: `src/lib/agent/recipe.test.ts`

- [ ] Add or reuse a newest-first project-run query.
- [ ] Load the newest relevant run whenever the route project changes.
- [ ] Clear the prior project's in-memory run immediately on project transition.
- [ ] Expose loading, restored, interrupted, paused, failed, cancelled, and completed states.
- [ ] Convert stale persisted `running` state into an interrupted/recoverable presentation without replaying work.
- [ ] Restore placeholder-intervention UI from persisted stage output.
- [ ] Prevent a fresh Auto-draft from silently replacing a resumable run.
- [ ] Ensure resume and retry use the currently selected provider after confirming it can generate.
- [ ] Test project A → project B navigation so runs never bleed between projects.

**Acceptance criteria:**

- Pause → reload → resume works without losing intervention state.
- Failed → reload → retry works.
- Reload never repeats a completed provider call automatically.
- The user can deliberately discard or supersede an old resumable run.

---

## Task 5: Replace Placeholder Commands With Typed Actions

**Files:**

- Create: `src/components/v2/workspace-actions.ts`
- Create: `src/components/v2/workspace-actions.test.ts`
- Create: `src/components/v2/WorkspaceActionContext.tsx`
- Modify: `src/components/v2/V2Layout.tsx`
- Modify: `src/components/v2/V2CommandPalette.tsx`
- Modify: `src/components/v2/V2ChatPane.tsx`
- Modify: `src/components/v2/V2DraftPane.tsx`
- Modify: `src/components/v2/V2ProjectWorkspace.tsx`

- [ ] Inventory existing section edit/regeneration functions in `V2DraftPane`.
- [ ] Move active-section ownership to the smallest shared workspace context.
- [ ] Implement `regenerate_section` through the existing section regeneration path.
- [ ] Implement expand, tighten, citation, and rewrite only where the existing editing contracts can preserve section identity and validation.
- [ ] Disable unsupported actions with a concise reason instead of emitting a toast.
- [ ] Connect “Accept all findings” only if there is a concrete pending-findings collection and apply operation; otherwise remove it.
- [ ] Replace global `window` custom events for workspace edits with the typed controller.
- [ ] Keep global keyboard shortcuts only as input bindings that call the controller.
- [ ] Remove or implement the decorative “Project Context ×” chip.
- [ ] Replace persisted stage-output `any` casts with a runtime type guard.

**Acceptance criteria:**

- Every visible command either changes state as described or is visibly unavailable.
- Success toasts are emitted only after persistence succeeds.
- Commands operate on the active section shown to the user.
- Command palette, slash menu, and direct draft controls share the same implementation.

---

## Task 6: Make Diagnostics Production-Appropriate

**Files:**

- Modify: `src/components/DebugPanel.tsx`
- Modify: `src/App.tsx`
- Modify: `src/lib/debug/log.ts`
- Create: `src/App.test.tsx` or focused diagnostics tests

- [ ] Default the debug panel to hidden in production.
- [ ] Enable it through a documented development flag, query/hash opt-in, or advanced setting.
- [ ] Default the panel closed even when enabled unless a startup crash occurs.
- [ ] Remove unconditional `40vh` content padding.
- [ ] Ensure startup failures still expose a usable recovery/diagnostic path.
- [ ] Confirm captured logs redact credentials and avoid full document/prompt bodies.
- [ ] Test normal production rendering without the panel.
- [ ] Test explicit diagnostics enablement and startup-error visibility.

**Acceptance criteria:**

- The production SPA opens as a product, not as a debugging surface.
- Diagnostics remain available when deliberately requested.
- No route permanently reserves space for a closed or absent panel.

---

## Task 7: Add V2 Workflow Integration Coverage

**Files:**

- Create: `src/components/v2/V2Workflow.test.tsx`
- Modify: `src/components/v2/V2SmokeTest.test.tsx`
- Add focused test fixtures/helpers under `src/test/` if required

- [ ] Build a reusable fake IndexedDB project/template/draft setup.
- [ ] Test create/open project → attach note → start draft → persist output → export.
- [ ] Test keyless local OpenAI from verified connection through recipe start.
- [ ] Test pause → unmount → remount → intervention restore → resume.
- [ ] Test failed run → unmount → remount → retry.
- [ ] Test invalid and deleted project routes.
- [ ] Test each visible command's enabled and disabled state.
- [ ] Assert that no placeholder toast is treated as the action result.
- [ ] Keep provider network calls mocked at the client boundary, not by bypassing recipe state.

**Acceptance criteria:**

- The main three-pane workflow is covered beyond shallow mount tests.
- The regressions identified by the audit fail before their fixes and pass afterward.

---

## Task 8: Define and Begin Legacy/V2 Consolidation

**Files:**

- Modify: `README.md`
- Update: `docs/AUDIT.md`
- Modify shared route files only where low-risk extraction is demonstrated by tests

- [ ] Document V2 as the canonical project drafting workspace.
- [ ] Document the distinct purpose of standalone Documents: editing an existing DOCX rather than drafting a project.
- [ ] Label `/legacy/projects/:id` as temporary compatibility UI.
- [ ] Inventory duplicated provider, connection, model, export, and project-context code.
- [ ] Extract shared pure helpers before shared React components.
- [ ] Stop adding new features to legacy `ProjectDetail.tsx` unless required for compatibility.
- [ ] Define removal criteria for the legacy route: workflow parity, migration safety, and at least one release of telemetry/user validation.
- [ ] Do not merge Documents into V2 without a separate design because its editing target and lifecycle differ from project drafting.

**Acceptance criteria:**

- Each surface has a clear documented purpose.
- Connection semantics and core domain operations are shared.
- Legacy removal is governed by explicit criteria rather than file size alone.

---

## Quality Gates

Run after every task:

```powershell
npm run typecheck
npm test
```

Run after tasks that change production UI or routing:

```powershell
npm run build
```

Final release verification:

- [ ] `npm run typecheck` passes.
- [ ] `npm test` passes with all new regression and workflow tests.
- [ ] `npm run build` succeeds.
- [ ] `release/index.html` is regenerated only by the build.
- [ ] The app opens from `file://` and HashRouter navigation works.
- [ ] Ask Sage connection and drafting smoke test passes.
- [ ] Keyless Local OpenAI connection and drafting smoke test passes.
- [ ] Pause/reload/resume smoke test passes.
- [ ] DOCX export opens successfully in Word or LibreOffice using a synthetic fixture.
- [ ] No API key, document content, or full prompt appears in debug or audit exports unexpectedly.

---

## Rollout and Risk Control

- Land Tasks 1–3 together only if their shared connection contract makes separate review impractical; otherwise keep one task per commit.
- Land Task 4 separately because recovery changes can affect duplicate provider calls.
- Land Task 5 action-by-action. Removing a fake command is safer than shipping a partially wired mutation.
- Keep the legacy route available through the first release containing run recovery.
- Do not migrate IndexedDB data unless a contract actually changes; the current recipe and project rows already contain the required recovery data.
- If stale `running` rows need a new status, prefer a UI-derived `interrupted` state before changing the persisted union and database migration.
- Treat export output differences as release-blocking and compare against synthetic DOCX fixtures.

---

## Definition of Done

This plan is complete when:

1. All providers have consistent, capability-aware connection behavior.
2. A verified keyless local provider can draft, resume, retry, and export.
3. Missing projects produce an actionable terminal state.
4. Paused and failed runs survive reload and project navigation.
5. No visible V2 command pretends to perform work.
6. The debug console is absent from the default production UI.
7. The V2 drafting workflow has integration coverage for its critical lifecycle.
8. V2, legacy project drafting, and standalone document editing have documented ownership boundaries.
9. Typecheck, tests, production build, and synthetic DOCX export verification all pass.

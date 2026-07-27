# Capability-Adaptive Agentic Editing Implementation Plan

> **Implementation rule:** Execute this plan task-by-task. Each task must leave its targeted tests passing before the next task begins. Do not combine the provider-tracing, persistence, graph, tool, and UI milestones into one unreviewable change.

**Goal:** Add a durable, visible, auditable, turn-based editing workflow that uses native tools when the selected provider/model supports them and automatically falls back to prompt-only planning, editing, critique, and repair when it does not.

**Architecture:** Add a browser-side LangGraph workflow over the existing `LLMClient`, edit dispatcher, validation, DOCX, drafting, and Dexie boundaries. Every graph transition emits an append-only execution-journal event. Large prompts, sanitized provider requests, responses, tool data, plans, proposals, critiques, validation reports, and diffs are stored as content-addressed trace artifacts. Editing-target adapters translate the shared workflow into uploaded-document edits, template-draft edits, and freeform-draft edits without allowing graph nodes or tools to mutate canonical state. Tool-capable and prompt-only paths converge on the same typed proposal contract before critique, deterministic validation, preview, and user approval.

**Tech Stack:** React 18, TypeScript 5.6 strict mode, Vite, Dexie 4, Zustand, Vitest, React Testing Library, existing provider clients, `@langchain/langgraph`, `@langchain/core`.

**Design Spec:** `docs/superpowers/specs/2026-07-27-capability-adaptive-agentic-editing-design.md`

---

## Delivery Strategy

Implement in four independently verifiable increments:

1. **Auditable prompt-only vertical slice**
   - Persistence, execution journal, provider tracing, graph skeleton, planner/editor/critic/validator, uploaded-document preview, approval, reload recovery.
   - Works on every current provider, including GenAI.mil.
2. **Tool-assisted execution**
   - Read-only tool registry, tool-capability routing, bounded tool loop, approval interrupts, and runtime downgrade.
3. **Template and freeform targets**
   - Reuse the same graph and journal through target adapters.
4. **Feedback learning and diagnostics**
   - Confirmed preferences, trace exports, retention, deletion, and provenance navigation.

Do not begin native tools until the prompt-only vertical slice is fully visible, resumable, and auditable. This guarantees the least-capable-provider path is the baseline rather than an afterthought.

---

## File Structure

### Dependencies

- Modify `package.json`
- Modify `package-lock.json`

### Agentic editing core

- Create `src/lib/agentic-editing/types.ts`
- Create `src/lib/agentic-editing/types.test.ts`
- Create `src/lib/agentic-editing/capabilities.ts`
- Create `src/lib/agentic-editing/capabilities.test.ts`
- Create `src/lib/agentic-editing/ids.ts`
- Create `src/lib/agentic-editing/limits.ts`
- Create `src/lib/agentic-editing/prompts.ts`
- Create `src/lib/agentic-editing/prompts.test.ts`
- Create `src/lib/agentic-editing/context.ts`
- Create `src/lib/agentic-editing/context.test.ts`
- Create `src/lib/agentic-editing/proposal.ts`
- Create `src/lib/agentic-editing/proposal.test.ts`
- Create `src/lib/agentic-editing/graph.ts`
- Create `src/lib/agentic-editing/graph.test.ts`
- Create `src/lib/agentic-editing/runner.ts`
- Create `src/lib/agentic-editing/runner.test.ts`

### Persistence and audit

- Create `src/lib/agentic-editing/store.ts`
- Create `src/lib/agentic-editing/store.test.ts`
- Create `src/lib/agentic-editing/journal.ts`
- Create `src/lib/agentic-editing/journal.test.ts`
- Create `src/lib/agentic-editing/artifacts.ts`
- Create `src/lib/agentic-editing/artifacts.test.ts`
- Create `src/lib/agentic-editing/checkpointer.ts`
- Create `src/lib/agentic-editing/checkpointer.test.ts`
- Create `src/lib/agentic-editing/trace-client.ts`
- Create `src/lib/agentic-editing/trace-client.test.ts`
- Create `src/lib/agentic-editing/diagnostics.ts`
- Create `src/lib/agentic-editing/diagnostics.test.ts`
- Modify `src/lib/db/schema.ts`

### Graph nodes

- Create `src/lib/agentic-editing/nodes/initialize.ts`
- Create `src/lib/agentic-editing/nodes/criteria.ts`
- Create `src/lib/agentic-editing/nodes/plan.ts`
- Create `src/lib/agentic-editing/nodes/capabilities.ts`
- Create `src/lib/agentic-editing/nodes/fallback-context.ts`
- Create `src/lib/agentic-editing/nodes/prompt-editor.ts`
- Create `src/lib/agentic-editing/nodes/tool-editor.ts`
- Create `src/lib/agentic-editing/nodes/execute-tools.ts`
- Create `src/lib/agentic-editing/nodes/critique.ts`
- Create `src/lib/agentic-editing/nodes/repair.ts`
- Create `src/lib/agentic-editing/nodes/validate.ts`
- Create `src/lib/agentic-editing/nodes/preview.ts`
- Create `src/lib/agentic-editing/nodes/commit.ts`
- Create `src/lib/agentic-editing/nodes/feedback.ts`
- Create focused `.test.ts` files beside each non-trivial node or group closely related nodes in `nodes/*.test.ts`.

### Editing targets and versions

- Create `src/lib/agentic-editing/targets/types.ts`
- Create `src/lib/agentic-editing/targets/document.ts`
- Create `src/lib/agentic-editing/targets/document.test.ts`
- Create `src/lib/agentic-editing/targets/template-draft.ts`
- Create `src/lib/agentic-editing/targets/template-draft.test.ts`
- Create `src/lib/agentic-editing/targets/freeform-draft.ts`
- Create `src/lib/agentic-editing/targets/freeform-draft.test.ts`
- Create `src/lib/agentic-editing/versions.ts`
- Create `src/lib/agentic-editing/versions.test.ts`

### Tools

- Create `src/lib/agentic-editing/tools/types.ts`
- Create `src/lib/agentic-editing/tools/registry.ts`
- Create `src/lib/agentic-editing/tools/registry.test.ts`
- Create `src/lib/agentic-editing/tools/document.ts`
- Create `src/lib/agentic-editing/tools/document.test.ts`
- Create `src/lib/agentic-editing/tools/references.ts`
- Create `src/lib/agentic-editing/tools/references.test.ts`
- Create `src/lib/agentic-editing/tools/consistency.ts`
- Create `src/lib/agentic-editing/tools/consistency.test.ts`
- Create `src/lib/agentic-editing/tools/calculation.ts`
- Create `src/lib/agentic-editing/tools/calculation.test.ts`
- Create `src/lib/agentic-editing/tool-loop.ts`
- Create `src/lib/agentic-editing/tool-loop.test.ts`

### Provider tracing

- Modify `src/lib/provider/types.ts`
- Modify `src/lib/provider/factory.ts`
- Modify `src/lib/asksage/client.ts`
- Modify `src/lib/provider/openrouter.ts`
- Modify `src/lib/provider/local_openai.ts`
- Modify `src/lib/provider/genai_mil.ts`
- Modify associated provider tests.

### UI

- Create `src/components/agentic-editing/EditingSessionPanel.tsx`
- Create `src/components/agentic-editing/EditingSessionPanel.test.tsx`
- Create `src/components/agentic-editing/ExecutionTimeline.tsx`
- Create `src/components/agentic-editing/ExecutionTimeline.test.tsx`
- Create `src/components/agentic-editing/TraceInspector.tsx`
- Create `src/components/agentic-editing/TraceInspector.test.tsx`
- Create `src/components/agentic-editing/EditApprovalPanel.tsx`
- Create `src/components/agentic-editing/EditApprovalPanel.test.tsx`
- Create `src/components/agentic-editing/PreferenceManager.tsx`
- Create `src/components/agentic-editing/PreferenceManager.test.tsx`
- Create `src/components/agentic-editing/DiagnosticExportDialog.tsx`
- Create `src/components/agentic-editing/DiagnosticExportDialog.test.tsx`
- Create `src/components/agentic-editing/useEditingSession.ts`
- Create `src/components/agentic-editing/view-model.ts`
- Create `src/components/agentic-editing/view-model.test.ts`
- Modify `src/routes/Documents.tsx`
- Modify `src/routes/Documents.test.tsx`
- Modify `src/components/v2/V2DraftPane.tsx`
- Modify `src/components/v2/V2SmokeTest.test.tsx`
- Modify `src/v2.css`
- Modify `src/index.css` only if the classic Documents route requires non-v2 styles.

### Generated artifact

- Modify `release/index.html` only through `npm run build`.

---

## Core Contracts

### Editing target

The graph must not depend directly on `DocumentRecord`, `DraftRecord`, or freeform project storage.

```ts
export type EditingTargetKind =
  | 'uploaded_document'
  | 'template_draft'
  | 'freeform_draft';

export interface EditingTargetRef {
  kind: EditingTargetKind;
  targetId: string;
  projectId?: string;
  templateId?: string;
  sectionId?: string;
}

export interface EditingTargetAdapter {
  kind: EditingTargetKind;
  loadSnapshot(target: EditingTargetRef, versionId: string): Promise<EditingTargetSnapshot>;
  buildContext(snapshot: EditingTargetSnapshot, request: ContextRequest): Promise<ContextResult>;
  validateProposal(snapshot: EditingTargetSnapshot, proposal: EditProposal): Promise<EditValidationReport>;
  createPreview(snapshot: EditingTargetSnapshot, proposal: EditProposal): Promise<PreviewArtifact>;
  commitPreview(previewId: string, turnId: string): Promise<DocumentVersionRecord>;
}
```

### Shared proposal operation

Do not force all targets into `SchemaEditOperation`. Use a discriminated union whose members wrap existing operation contracts.

```ts
export type AgentEditOperation =
  | {
      target: 'uploaded_document';
      operation: import('../document/types').DocumentEditOp;
    }
  | {
      target: 'template_schema';
      operation: import('../edit/types').SchemaEditOp;
    }
  | {
      target: 'draft_paragraphs';
      operation: DraftParagraphEditOperation;
    };
```

The target adapter rejects operations that do not match the active target.

### Effective capabilities

```ts
export interface AgentCapabilities {
  nativeTools: boolean;
  jsonSchemaOutput: boolean;
  promptJsonOutput: boolean;
  embeddings: boolean;
  providerDatasets: boolean;
  liveSearch: boolean;
  localReferenceSearch: boolean;
  localDocumentInspection: boolean;
  evidence: CapabilityEvidence[];
}
```

### Trace observer

```ts
export interface ProviderTraceObserver {
  onRequest(event: SanitizedProviderRequest): Promise<void> | void;
  onResponse(event: SanitizedProviderResponse): Promise<void> | void;
}
```

Provider tracing is optional for ordinary clients and required for clients created by an editing-session runner.

---

## Task 1: Install LangGraph and Establish Core Types

**Files:**

- Modify `package.json`
- Modify `package-lock.json`
- Create `src/lib/agentic-editing/types.ts`
- Create `src/lib/agentic-editing/types.test.ts`
- Create `src/lib/agentic-editing/ids.ts`
- Create `src/lib/agentic-editing/limits.ts`

- [ ] **Step 1: Add dependencies**

Run:

```powershell
npm install @langchain/langgraph @langchain/core
```

Expected: `package.json` and `package-lock.json` contain both packages and no unrelated dependency upgrade.

- [ ] **Step 2: Add compile-only LangGraph smoke test**

Create `types.test.ts` that imports `StateGraph`, `START`, and `END`, compiles a two-node graph using a small typed state, invokes it, and expects the terminal state.

- [ ] **Step 3: Add domain contracts**

Define:

- `EditingTargetKind`
- `EditingTargetRef`
- `EditingSessionStatus`
- `EditingTurnStatus`
- `AcceptanceCriterion`
- `EditPlan`
- `ContextManifest`
- `AgentCapabilities`
- `EditProposal`
- `EditCritique`
- `EditValidationReport`
- `AgentTraceEvent`
- `AgentTraceArtifact`
- `WorkflowError`
- `EditingGraphState`
- `EditingWorkflowLimits`

Keep every persisted or graphed value JSON-serializable.

- [ ] **Step 4: Add deterministic ID helpers**

Add helpers for:

- session ID
- turn ID
- version ID
- span ID
- trace event ID
- artifact ID
- checkpoint storage ID

Use `crypto.randomUUID()` with a deterministic injectable fallback for tests.

- [ ] **Step 5: Add default limits**

Use the design defaults:

- 12 model calls
- 8 tool cycles
- 12 tool calls
- 2 repair passes
- 10-minute elapsed limit
- 160,000-character context ceiling

- [ ] **Step 6: Run tests and typecheck**

Run:

```powershell
npm test -- src/lib/agentic-editing/types.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit Task 1**

Suggested commit:

```text
feat: add agentic editing graph contracts
```

---

## Task 2: Add Dexie Tables and Persistence Repositories

**Files:**

- Modify `src/lib/db/schema.ts`
- Create `src/lib/agentic-editing/store.ts`
- Create `src/lib/agentic-editing/store.test.ts`
- Create `src/lib/agentic-editing/artifacts.ts`
- Create `src/lib/agentic-editing/artifacts.test.ts`

- [ ] **Step 1: Write failing schema and repository tests**

Cover:

- Create/read/update editing session.
- Append turns without overwriting prior turns.
- Store document versions and preserve parents.
- Append trace events using monotonic `[turnId+sequence]`.
- Store and load trace artifacts.
- Deduplicate identical artifacts by SHA-256 within a turn.
- Delete trace artifacts without deleting accepted versions.
- Query active sessions by target.

- [ ] **Step 2: Add database version 9**

Add typed tables:

```ts
editing_sessions!: Table<EditingSessionRecord, string>;
editing_turns!: Table<EditingTurnRecord, string>;
document_versions!: Table<DocumentVersionRecord, string>;
agent_trace_events!: Table<AgentTraceEvent, string>;
agent_trace_artifacts!: Table<AgentTraceArtifact, string>;
agent_checkpoints!: Table<StoredAgentCheckpoint, string>;
learned_preferences!: Table<LearnedPreference, string>;
```

Add a `version(9)` store declaration retaining every existing table:

```ts
editing_sessions: 'id, target_kind, target_id, status, updated_at'
editing_turns: 'id, session_id, [session_id+created_at], base_version_id, status'
document_versions: 'id, target_kind, target_id, parent_version_id, status, created_at'
agent_trace_events: 'id, [turn_id+sequence], turn_id, session_id, type, timestamp'
agent_trace_artifacts: 'id, turn_id, session_id, kind, created_at, sha256'
agent_checkpoints: 'id, [thread_id+checkpoint_ns+checkpoint_id], thread_id, updated_at'
learned_preferences: 'id, project_id, document_id, status, created_at'
```

Do not migrate existing documents or drafts into version records eagerly. Create the initial base version lazily when a target begins its first editing session.

- [ ] **Step 3: Implement repository functions**

Implement small functions rather than exposing raw tables to graph nodes:

- `createEditingSession`
- `getEditingSession`
- `findActiveSessionForTarget`
- `updateEditingSessionStatus`
- `appendEditingTurn`
- `updateEditingTurn`
- `putDocumentVersion`
- `getDocumentVersion`
- `appendTraceEvent`
- `putTraceArtifact`
- `getTraceArtifact`
- `listTurnTrace`
- `deleteTurnTraceArtifacts`

- [ ] **Step 4: Make trace appends atomic**

Within a Dexie transaction:

1. Read the greatest sequence for the turn.
2. Add one.
3. Store the event.

Test concurrent append attempts and verify unique ordered sequences.

- [ ] **Step 5: Run targeted tests**

Run:

```powershell
npm test -- src/lib/agentic-editing/store.test.ts src/lib/agentic-editing/artifacts.test.ts
npm run typecheck
```

Expected: PASS and existing DB tests remain green.

- [ ] **Step 6: Commit Task 2**

Suggested commit:

```text
feat: persist editing sessions and trace artifacts
```

---

## Task 3: Implement the Append-Only Execution Journal

**Files:**

- Create `src/lib/agentic-editing/journal.ts`
- Create `src/lib/agentic-editing/journal.test.ts`

- [ ] **Step 1: Write journal lifecycle tests**

Verify:

- `startNode()` appends `node.started`.
- `completeNode()` appends exactly one terminal event.
- Failed, skipped, and cancelled states remain visible.
- A second terminal event for the same span is rejected.
- Route events require a non-empty reason.
- Child model/tool/validation events reference their parent node span.
- Event timestamps and durations are deterministic under an injected clock.
- Reloading the journal preserves order.

- [ ] **Step 2: Implement `ExecutionJournal`**

Expose:

```ts
startTurn()
startNode()
completeNode()
failNode()
cancelNode()
skipNode()
recordRoute()
recordModelRequest()
recordModelResponse()
recordToolEvent()
recordValidation()
recordCheckpoint()
recordUserDecision()
completeTurn()
```

Every function appends; none edits existing events.

- [ ] **Step 3: Add node wrapper**

Implement `withJournaledNode(name, nodeFn)` that:

1. Starts a span.
2. Stores declared material input artifacts.
3. Runs the node.
4. Stores declared output artifacts.
5. Emits a terminal event.
6. Converts thrown errors into typed `WorkflowError`.

Do not swallow errors; return them to LangGraph routing after journaling.

- [ ] **Step 4: Run tests**

Run:

```powershell
npm test -- src/lib/agentic-editing/journal.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

Suggested commit:

```text
feat: add append-only agent execution journal
```

---

## Task 4: Add Exact Sanitized Provider Transport Tracing

**Files:**

- Modify `src/lib/provider/types.ts`
- Modify `src/lib/provider/factory.ts`
- Modify `src/lib/asksage/client.ts`
- Modify `src/lib/provider/openrouter.ts`
- Modify `src/lib/provider/local_openai.ts`
- Modify `src/lib/provider/genai_mil.ts`
- Modify provider tests
- Create `src/lib/agentic-editing/trace-client.ts`
- Create `src/lib/agentic-editing/trace-client.test.ts`

- [ ] **Step 1: Write redaction and transport tests**

For every provider verify:

- Trace observer receives final URL, method, and request body immediately before fetch.
- Trace observer never receives `Authorization`.
- API key substrings do not appear in serialized trace events.
- GenAI.mil trace matches its Swagger allow-listed payload.
- OpenRouter trace includes provider-specific plugins when used.
- Ask Sage trace captures the final `/server/query` body.
- Response trace records status, request IDs, rate-limit headers, and exact body used by the client.
- Ordinary clients work without a trace observer.

- [ ] **Step 2: Extend factory state**

Add optional observer:

```ts
export interface ProviderState {
  provider: ProviderId;
  baseUrl: string;
  apiKey: string;
  traceObserver?: ProviderTraceObserver;
}
```

Pass it into each concrete client. Keep constructor additions optional so current call sites remain source-compatible.

- [ ] **Step 3: Add provider tracing at the fetch boundary**

Immediately before each relevant fetch:

- Create sanitized request event.
- Exclude all credential-bearing headers.
- Include provider, endpoint, model, method, URL, and exact final body.
- Await trace persistence before sending the request so a failed network call is still diagnosable.

Immediately after reading the response:

- Store status and selected headers.
- Store the exact body passed to the parser.
- Link the response to the request span.

Limit this implementation to model listing, chat/query, and embeddings paths used by agentic editing. Existing non-agent endpoints may continue using the current audit mechanism.

- [ ] **Step 4: Implement canonical call wrapper**

`trace-client.ts` records:

- Rendered system prompt.
- Canonical `QueryInput`.
- Model and parameters.
- Offered tools and tool choice.
- Context-manifest ID.
- Prompt-template version.
- Accepted preference IDs.

Then it invokes the provider client, whose observer records the mapped transport.

- [ ] **Step 5: Run provider and trace tests**

Run:

```powershell
npm test -- src/lib/agentic-editing/trace-client.test.ts src/lib/asksage/client.test.ts src/lib/provider/openrouter.test.ts src/lib/provider/local_openai.test.ts src/lib/provider/genai_mil.test.ts src/lib/provider/factory.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit Task 4**

Suggested commit:

```text
feat: trace sanitized provider requests and responses
```

---

## Task 5: Implement Effective Capability Resolution

**Files:**

- Create `src/lib/agentic-editing/capabilities.ts`
- Create `src/lib/agentic-editing/capabilities.test.ts`

- [ ] **Step 1: Write a provider/model/probe matrix**

Test:

- Ask Sage with provider tools enabled.
- OpenRouter model advertising tools.
- OpenRouter model explicitly lacking tools.
- Local model with successful probe.
- Local model with failed probe.
- GenAI.mil with static tools false.
- Unknown model metadata with known provider transport.
- Conflicting signals where explicit false wins.

- [ ] **Step 2: Implement resolver**

Inputs:

- `client.capabilities`
- selected `ModelInfo`
- current endpoint probe
- local tool availability

Output:

- effective booleans
- evidence records
- human-readable route reason

- [ ] **Step 3: Record capability evidence artifacts**

Persist the effective profile and evidence before graph routing. The graph must not call `resolveAgentCapabilities()` inside a silent conditional callback without journaling the result.

- [ ] **Step 4: Run tests**

Run:

```powershell
npm test -- src/lib/agentic-editing/capabilities.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 5**

Suggested commit:

```text
feat: resolve effective agent capabilities
```

---

## Task 6: Implement the Dexie LangGraph Checkpointer

**Files:**

- Create `src/lib/agentic-editing/checkpointer.ts`
- Create `src/lib/agentic-editing/checkpointer.test.ts`

- [ ] **Step 1: Confirm installed checkpoint interfaces**

Inspect the installed `@langchain/langgraph-checkpoint` types re-exported by LangGraph. Implement against the installed version; do not copy an outdated online signature.

Expected interface methods include the installed equivalents of:

- get checkpoint tuple
- list checkpoint tuples
- put checkpoint
- put pending writes
- delete thread

- [ ] **Step 2: Write failing checkpointer tests**

Cover:

- Put/get round trip.
- List newest-first with limit.
- Pending writes.
- Thread and namespace isolation.
- Resume compiled graph from stored checkpoint.
- Completed node actions are not replayed.
- Delete one thread without affecting another.
- JSON serialization rejects functions, blobs, and class instances.

- [ ] **Step 3: Implement `DexieCheckpointSaver`**

Store checkpoint metadata and payload in `agent_checkpoints`. Use a stable compound-derived ID without inventing or parsing LangGraph opaque checkpoint IDs.

- [ ] **Step 4: Link checkpoints to journal events**

After checkpoint persistence, append `checkpoint.saved` with the checkpoint ID and current node span. A checkpoint save failure must fail the node before another externally visible side effect.

- [ ] **Step 5: Run tests**

Run:

```powershell
npm test -- src/lib/agentic-editing/checkpointer.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 6**

Suggested commit:

```text
feat: checkpoint editing graphs in indexeddb
```

---

## Task 7: Add Editing Target Adapters and Immutable Versions

**Files:**

- Create target and version files listed above.
- Modify existing edit helpers only where a pure preview/apply-to-clone boundary is missing.

- [ ] **Step 1: Define target-adapter contract**

Implement registry:

```ts
getEditingTargetAdapter(kind: EditingTargetKind): EditingTargetAdapter
```

- [ ] **Step 2: Implement uploaded-document adapter first**

Responsibilities:

- Lazy-create base version from `DocumentRecord.docx_bytes` plus accepted edits.
- Load paragraph/anchor snapshot.
- Build scoped context.
- Validate `DocumentEditOp` targets.
- Apply proposed operations to a clone.
- Produce diff/preview artifacts.
- Commit accepted operations/version without modifying original `docx_bytes`.

Write tests for invalid targets, protected structure, clone-only preview, immutable accepted versions, stale base rejection, and revert-as-new-version.

- [ ] **Step 3: Implement template-draft adapter**

Support:

- One section or explicit multi-section scope.
- Existing `DraftRecord.paragraphs`.
- Template schema constraints.
- Section paragraph replacement/edit operations.
- Preview without updating `db.drafts`.
- Accepted commit updates drafts and creates version lineage.

- [ ] **Step 4: Implement freeform-draft adapter**

Support:

- H1-bounded block scope.
- Existing `ProjectRecord.freeform_draft`.
- Paragraph-role preservation.
- Preview without updating the project.
- Accepted commit updates project draft and creates version lineage.

- [ ] **Step 5: Implement version service**

Functions:

- `ensureBaseVersion`
- `createPreviewVersion`
- `acceptPreviewVersion`
- `supersedePreviewVersion`
- `revertToVersion`
- `assertCurrentBaseVersion`

- [ ] **Step 6: Run target tests**

Run:

```powershell
npm test -- src/lib/agentic-editing/targets src/lib/agentic-editing/versions.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit Task 7**

Suggested commit:

```text
feat: add versioned agentic editing targets
```

---

## Task 8: Build Context, Prompts, Parsing, and Format Repair

**Files:**

- Create `context.ts`, `prompts.ts`, `proposal.ts`, and tests.

- [ ] **Step 1: Write context-budget tests**

Verify deterministic inclusion order:

1. User-selected target scope.
2. Required template/schema constraints.
3. Accepted preferences.
4. Attached-reference matches.
5. Project history.
6. Surrounding context.

Verify:

- Character ceiling.
- Included and omitted source manifest.
- Stable evidence IDs.
- No tool transcript fields.
- No provider-only fields.

- [ ] **Step 2: Implement context builder**

Reuse:

- Existing local extraction.
- Existing chunks and relevance selection.
- Existing prior-section summaries.
- Target-adapter scoped reads.

The result includes prompt text plus a `ContextManifest` artifact.

- [ ] **Step 3: Version prompt templates**

Create explicit constants:

```ts
CRITERIA_PROMPT_VERSION
PLAN_PROMPT_VERSION
PROMPT_EDITOR_VERSION
TOOL_EDITOR_VERSION
CRITIC_PROMPT_VERSION
REPAIR_PROMPT_VERSION
FORMAT_REPAIR_VERSION
```

Every rendered prompt artifact stores its template ID/version.

- [ ] **Step 4: Implement strict parsers**

Parse and validate:

- acceptance criteria
- edit plan
- edit proposal
- critique

Do not accept unknown target operation kinds.

- [ ] **Step 5: Implement one-shot format repair**

Given invalid model text:

- Store original response artifact.
- Render a format-repair prompt.
- Make one additional model call.
- Store retry attempt distinctly.
- Return typed error after second invalid result.

- [ ] **Step 6: Run tests**

Run:

```powershell
npm test -- src/lib/agentic-editing/context.test.ts src/lib/agentic-editing/prompts.test.ts src/lib/agentic-editing/proposal.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 8**

Suggested commit:

```text
feat: build auditable editing prompts and context
```

---

## Task 9: Implement the Prompt-Only Graph Vertical Slice

**Files:**

- Create graph, runner, and prompt-only node files.
- Create graph and runner tests.

- [ ] **Step 1: Write graph-state transition tests**

Expected path:

```text
initialize
→ criteria
→ plan
→ capabilities
→ fallbackContext
→ promptEditor
→ critique
→ validate
→ preview
→ awaitApproval
```

Verify every node creates start/terminal journal events and every edge creates a route event.

- [ ] **Step 2: Implement nodes as injected promise actors**

Each node receives services rather than importing singleton provider/state objects:

- target adapter
- traced LLM client
- journal
- artifact store
- checkpointer
- clock
- abort signal
- limits

- [ ] **Step 3: Implement criterion and planning nodes**

Planning must identify:

- scope
- required context
- broad-change flag
- risks
- explicit acceptance criteria

Broad plans route to an approval interrupt.

- [ ] **Step 4: Implement prompt-only editor**

Never set `tools` or `tool_choice`. Assert before sending. The provider adapter still applies its own narrower allow-list.

- [ ] **Step 5: Implement critique and bounded repair**

Critique separately. On `repair`:

- Increment repair pass.
- Render only failed criteria and validator feedback.
- Maximum two passes.
- Preserve all attempts in journal and artifacts.

- [ ] **Step 6: Implement deterministic validation and preview**

Use the active target adapter. A failed structural validation cannot be overruled by model output.

- [ ] **Step 7: Implement approval interrupt**

Graph pauses with:

- preview ID
- proposal
- critique
- validation
- diff artifact

Events:

- `ACCEPT`
- `REJECT`
- `REFINE`
- `CANCEL`

- [ ] **Step 8: Implement runner lifecycle**

The runner:

- Creates session/turn.
- Creates traced provider client from current credentials.
- Compiles graph with Dexie checkpointer.
- Supports abort.
- Resumes by thread/session ID.
- Pauses when credentials are absent after reload.

- [ ] **Step 9: Add GenAI.mil integration test**

Using a mocked `GenAIMilClient`, verify:

- Complete path reaches approval.
- No request includes tools, tool choice, tool turns, dataset, live search, or embeddings.
- Exact prompts and sanitized transport are visible in trace artifacts.

- [ ] **Step 10: Run targeted tests**

Run:

```powershell
npm test -- src/lib/agentic-editing/graph.test.ts src/lib/agentic-editing/runner.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 11: Commit Task 9**

Suggested commit:

```text
feat: add prompt-only agentic editing graph
```

---

## Task 10: Add the Live Timeline, Trace Inspector, and Approval UI

**Files:**

- Create agentic-editing React components and hooks.
- Modify `src/routes/Documents.tsx`
- Modify `src/routes/Documents.test.tsx`
- Modify styles.

- [ ] **Step 1: Build pure timeline view model**

Transform append-only events into:

- ordered stages
- status
- attempts
- durations
- child model/tool events
- routing reasons
- latest active stage
- approval state

Test failed, skipped, retried, fallback, cancelled, and resumed timelines.

- [ ] **Step 2: Implement `useEditingSession`**

Responsibilities:

- Subscribe to Dexie session, turn, events, and artifacts.
- Start/cancel/resume runner.
- Send approval/refine events.
- Never derive durable timeline history solely from React component state.

- [ ] **Step 3: Implement execution timeline**

Always show:

- queued
- running
- succeeded
- failed
- skipped
- cancelled
- waiting

Timeline appears immediately after submission.

- [ ] **Step 4: Implement trace inspector**

Default summary:

- stage purpose
- status
- time
- provider/model
- usage
- route reason

Expandable technical details:

- exact rendered prompt
- canonical messages
- sanitized provider request
- exact returned model text
- context manifest
- parsed output
- checkpoint IDs
- error details

Clearly mark artifacts containing document content.

- [ ] **Step 5: Implement approval panel**

Show:

- before/after diff
- scope
- acceptance coverage
- critique
- validator results
- evidence
- assumptions
- execution path
- usage
- warnings

Wire Accept, Reject, Refine, Cancel, and Revert.

- [ ] **Step 6: Integrate Documents route**

Add an "Agentic revision" entry point for an uploaded document. Keep the existing cleanup workflow available during rollout.

- [ ] **Step 7: Write interaction tests**

Test:

- Timeline visible on submit.
- Journal survives rerender.
- Expand prompt/request/response.
- Cancel.
- Accept.
- Reject.
- Refine.
- Reload and resume.
- Trace artifacts remain available after failure.

- [ ] **Step 8: Run UI tests**

Run:

```powershell
npm test -- src/components/agentic-editing src/routes/Documents.test.tsx
npm run typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit Task 10**

Suggested commit:

```text
feat: show auditable editing workflow timeline
```

---

## Task 11: Implement the Read-Only Tool Registry

**Files:**

- Create tool files and tests.

- [ ] **Step 1: Define tool contract and risk classes**

Risk:

- `read_only`
- `external_read`
- `document_write`

First release registers only local `read_only` tools. `preview_edit_operations` remains a proposal helper and cannot commit.

- [ ] **Step 2: Implement argument validation**

Use a small local JSON-schema validator or explicit TypeScript runtime validators. Do not add a broad schema dependency unless it materially simplifies all proposal/tool validation.

- [ ] **Step 3: Implement initial tools**

- `list_document_sections`
- `read_document_section`
- `read_paragraph_range`
- `inspect_template_region`
- `search_attached_references`
- `find_defined_term`
- `search_project_history`
- `check_cross_section_consistency`
- `calculate_value`
- `validate_edit_operation`
- `preview_edit_operations`

Replace the existing `new Function()` math proof-of-concept with a bounded arithmetic parser. Never execute model-authored code.

- [ ] **Step 4: Enforce scope**

Every tool context includes:

- session
- turn
- target
- base version
- approved scope
- abort signal
- result size limit

- [ ] **Step 5: Persist tool artifacts**

Store:

- requested name
- exact validated arguments
- approval state
- start/end/duration
- bounded result
- error

- [ ] **Step 6: Run tests**

Run:

```powershell
npm test -- src/lib/agentic-editing/tools
```

Expected: PASS.

- [ ] **Step 7: Commit Task 11**

Suggested commit:

```text
feat: add scoped agentic document tools
```

---

## Task 12: Add the Native Tool Loop and Runtime Fallback

**Files:**

- Create `tool-loop.ts` and tests.
- Create tool editor/executor nodes.
- Modify graph and graph tests.

- [ ] **Step 1: Write tool-loop tests**

Cover:

- Model requests one tool then returns proposal.
- Multiple tool cycles.
- Unknown tool.
- Invalid arguments.
- Tool failure returned to model.
- Tool approval interrupt.
- Tool rejection.
- Max cycle limit.
- Max call limit.
- Cancellation.

- [ ] **Step 2: Implement capability route**

After capability resolution:

- `nativeTools=true` → tool editor.
- `nativeTools=false` → fallback context.

Always append route reason.

- [ ] **Step 3: Implement canonical tool conversation**

Use existing:

- `OpenAITool`
- `OpenAIToolCall`
- assistant tool-call messages
- tool result messages

Final output is still a text JSON `EditProposal`.

- [ ] **Step 4: Implement recognized downgrade**

On tool transport rejection:

1. Store failure response.
2. Record downgrade route.
3. Remove tool schemas and tool transcript fields.
4. Preserve useful completed local results in fallback context.
5. Run prompt editor.
6. Mark turn `tool_fallback`.

- [ ] **Step 5: Add provider matrix tests**

Verify:

- Ask Sage tool path.
- OpenRouter tool-capable path.
- OpenRouter tool-incapable model prompt path.
- Local successful probe tool path.
- Local failed probe prompt path.
- GenAI direct prompt path.
- Tool-capable provider rejecting tools mid-turn downgrades.

- [ ] **Step 6: Run tests**

Run:

```powershell
npm test -- src/lib/agentic-editing/tool-loop.test.ts src/lib/agentic-editing/graph.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit Task 12**

Suggested commit:

```text
feat: route agent editing through native tools
```

---

## Task 13: Integrate Template and Freeform Drafting Surfaces

**Files:**

- Modify `src/components/v2/V2DraftPane.tsx`
- Modify `src/components/v2/V2SmokeTest.test.tsx`
- Modify agentic UI components only for target-specific labels/diffs.

- [ ] **Step 1: Add section-level entry point**

For template drafts:

- Start from one section by default.
- Allow explicit multi-section scope.
- Pass project/template/section target.
- Preserve existing "Fix" and "Regenerate" controls during rollout.

- [ ] **Step 2: Add freeform-block entry point**

Start from the selected H1-bounded block and current project version.

- [ ] **Step 3: Add target-specific diff adapters**

Display:

- paragraph insertions/deletions/replacements
- role changes
- section scope
- template constraint warnings

- [ ] **Step 4: Test no mutation before approval**

For both targets:

- Run workflow to approval.
- Assert database draft/project unchanged.
- Accept.
- Assert exactly one committed update/version.

- [ ] **Step 5: Test stale base behavior**

Modify a draft between preview and acceptance. Acceptance must fail with a visible rebase/restart message.

- [ ] **Step 6: Run targeted tests**

Run:

```powershell
npm test -- src/lib/agentic-editing/targets src/components/v2/V2SmokeTest.test.tsx
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit Task 13**

Suggested commit:

```text
feat: add agentic revision to draft surfaces
```

---

## Task 14: Add Confirmed Preference Learning

**Files:**

- Create feedback node.
- Create preference service and tests.
- Create `PreferenceManager`.

- [ ] **Step 1: Write preference lifecycle tests**

Cover:

- Refine feedback affects immediate child turn.
- Reusable feedback becomes `proposed`.
- Proposed preference does not enter prompts.
- User confirmation changes to `accepted`.
- Accepted preference enters applicable context.
- Scope hierarchy.
- Conflict detection.
- Edit and retire.
- Turn records influencing preference IDs.

- [ ] **Step 2: Implement preference service**

Functions:

- `proposePreference`
- `acceptPreference`
- `updatePreference`
- `retirePreference`
- `listApplicablePreferences`
- `findPreferenceConflicts`

- [ ] **Step 3: Add confirmation UI**

After Reject/Refine, show reusable preference suggestions separately from the immediate instruction. Require explicit confirmation.

- [ ] **Step 4: Add provenance**

Every plan/model request records accepted preference IDs. Trace inspector links to their source turns.

- [ ] **Step 5: Run tests**

Run:

```powershell
npm test -- src/lib/agentic-editing/feedback.test.ts src/components/agentic-editing/PreferenceManager.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit Task 14**

Suggested commit:

```text
feat: learn confirmed editing preferences
```

---

## Task 15: Add Diagnostic Exports, Retention, and Trace Deletion

**Files:**

- Create diagnostics files and UI dialog.
- Extend persistence repository.

- [ ] **Step 1: Write sanitized export tests**

Verify:

- Includes versions, journal, route reasons, model routing, hashes, usage, timings, checkpoints, error stacks.
- Replaces prompt/document/tool content with hashes and counts.
- Contains no API keys, Authorization, cookies, or one-time tokens.

- [ ] **Step 2: Write full-export tests**

Verify:

- Includes exact local prompts, sanitized provider payloads, returned text, tools, proposal, critique, validation.
- Still excludes credentials.
- Requires explicit `includeSensitiveContent: true`.
- Includes SHA-256 manifest and trace schema version.

- [ ] **Step 3: Implement export dialog**

Explain:

- Sanitized bundle is preferred for support.
- Full bundle may contain CUI or sensitive document content.
- Full export requires confirmation.

- [ ] **Step 4: Implement retention and deletion**

Support:

- Delete large artifacts for a turn.
- Delete all trace data for a session.
- Keep accepted versions and minimal version linkage.
- Optional automatic pruning by configured size/age.

- [ ] **Step 5: Add provenance navigation**

From a diff operation, navigate to:

- proposal item
- generating model call
- evidence/tool result
- critique criterion
- validator event

- [ ] **Step 6: Run tests**

Run:

```powershell
npm test -- src/lib/agentic-editing/diagnostics.test.ts src/components/agentic-editing/DiagnosticExportDialog.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit Task 15**

Suggested commit:

```text
feat: export and manage agent workflow traces
```

---

## Task 16: Full Verification, Build, and Documentation Review

**Files:**

- Modify generated `release/index.html`
- Update README or user help only if the implemented UI needs discoverability documentation.

- [ ] **Step 1: Run agentic editing suite**

Run:

```powershell
npm test -- src/lib/agentic-editing src/components/agentic-editing
```

Expected: PASS.

- [ ] **Step 2: Run provider regression suite**

Run:

```powershell
npm test -- src/lib/asksage/client.test.ts src/lib/provider/openrouter.test.ts src/lib/provider/local_openai.test.ts src/lib/provider/genai_mil.test.ts src/lib/provider/factory.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run editing and UI regression suite**

Run:

```powershell
npm test -- src/lib/edit src/lib/document src/lib/draft src/routes/Documents.test.tsx src/components/v2/V2SmokeTest.test.tsx
```

Expected: PASS.

- [ ] **Step 4: Run strict typecheck**

Run:

```powershell
npm run typecheck
```

Expected: exit 0.

- [ ] **Step 5: Run full suite**

Run:

```powershell
npm test
```

Expected: all Vitest tests pass.

- [ ] **Step 6: Build release artifact**

Run:

```powershell
npm run build
```

Expected:

- TypeScript passes.
- Vite builds the single-file app.
- `release/index.html` is updated.

- [ ] **Step 7: Inspect dependency and bundle impact**

Run:

```powershell
git diff --stat
git diff -- package.json package-lock.json
```

Record the uncompressed and gzip size change for `release/index.html`. If LangGraph causes unacceptable bundle growth, inspect Vite output before considering a smaller local graph implementation. Do not remove auditing or fallback requirements to save bundle size.

- [ ] **Step 8: Inspect final diff hygiene**

Run:

```powershell
git diff --check
git status --short
```

Expected: only planned implementation, tests, documentation, dependency lockfile, and generated release artifact are changed.

- [ ] **Step 9: Final manual smoke test**

In a browser:

1. Start a GenAI.mil prompt-only document revision.
2. Confirm timeline appears immediately.
3. Expand exact prompt, sanitized request, response, critique, and validator details.
4. Reload during critique and resume.
5. Reject and refine.
6. Accept and revert.
7. Start a tool-capable provider revision.
8. Inspect tool arguments/results.
9. Simulate tool rejection and verify visible fallback.
10. Export sanitized trace.
11. Attempt full trace export and verify warning.
12. Clear trace and verify accepted document remains.

- [ ] **Step 10: Commit generated release**

Suggested final commit:

```text
chore: rebuild release artifact
```

---

## Implementation Guardrails

- Never hide a graph stage or conditional route from the execution journal.
- Never store or export credentials.
- Never mutate canonical document/draft state before approval.
- Never let a tool commit a document version.
- Never use provider identity as a proxy for all model capabilities.
- Never require tool use for planning, editing, critique, repair, validation, or approval.
- Never silently retry; retries are separate visible attempts.
- Never silently downgrade; fallback includes the triggering error and route reason.
- Never expose or claim hidden chain-of-thought.
- Never store blobs or functions inside LangGraph state.
- Never replay completed tool side effects during checkpoint recovery.
- Never accept a proposal against a stale base version.
- Never turn user feedback into a durable preference without confirmation.

---

## Definition of Done

- The prompt-only workflow runs end-to-end on GenAI.mil and reaches a validated approval diff.
- Tool-capable Ask Sage, OpenRouter, and successfully probed local models can use bounded native tools.
- A tool transport failure visibly downgrades to prompt-only without restarting the turn.
- Tool and non-tool paths converge on the same typed proposal and approval UI.
- Uploaded documents, template drafts, and freeform drafts remain unchanged until acceptance.
- Every stage, model call, tool action, retry, skip, fallback, validation, checkpoint, and user decision is visible after execution and after reload.
- Exact application-visible prompts, sanitized outbound requests, returned model text, tool data, critiques, and validator results are inspectable locally.
- Each diff operation links to its generating and validating trace artifacts.
- Sessions resume from IndexedDB without replaying completed side effects.
- Accepted versions are immutable and revertible.
- Preferences require explicit confirmation.
- Sanitized and warned full diagnostic exports work without credentials.
- Typecheck, full tests, build, diff hygiene, and manual smoke scenarios pass.

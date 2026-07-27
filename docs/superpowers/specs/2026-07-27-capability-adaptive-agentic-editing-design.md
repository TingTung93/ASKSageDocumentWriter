# Capability-Adaptive Agentic Editing Design

## Purpose

Add a turn-based document editing workflow that can plan, revise, critique, repair, and learn from explicit user feedback while operating across providers with different capabilities.

The workflow must take advantage of native tool calling when the active provider and selected model support it, while preserving the same user-facing editing workflow on completion-only APIs such as the current GenAI.mil STARK gateway. Tool support improves context discovery and efficiency; it is not a prerequisite for drafting, critique, revision, validation, approval, or recovery.

The feature remains a zero-backend browser application. API calls, workflow orchestration, local tools, document versioning, and persistence all execute in the SPA.

## Goals

- Provide a durable, turn-based editing session around an existing document or template draft.
- Convert each user instruction into explicit acceptance criteria and a bounded edit plan.
- Use native tool calls for targeted context discovery when available.
- Fall back to prompt-only calls with preassembled context when tools are unavailable.
- Produce the same typed `EditProposal` contract from both execution paths.
- Critique and repair proposed edits before presenting them to the user.
- Preserve deterministic document validation as the final correctness gate.
- Require user approval before accepted document state changes.
- Learn reusable preferences only from explicit user acceptance or confirmation.
- Persist turns, versions, checkpoints, decisions, and audit metadata in IndexedDB.
- Support cancellation, refresh recovery, retry, rejection, refinement, and revert.

## Non-Goals

- Fully autonomous document publication or export without user review.
- Training, fine-tuning, or modifying provider models.
- Allowing the model to execute arbitrary JavaScript, shell commands, filesystem operations, or unrestricted network requests.
- Letting a model or critic mutate the canonical document directly.
- Replacing the existing `LLMClient`, provider clients, edit dispatcher, DOCX writer, or validation modules.
- Requiring every provider to implement tools, structured-output APIs, embeddings, datasets, or live search.
- Running multiple independent agents concurrently in the first release.
- Cross-user or server-hosted workflow synchronization.

## Dependency Decision

Use:

- `@langchain/langgraph`
- `@langchain/core`

Do not add LangChain provider packages in the first release. Graph nodes will call the repository's existing `LLMClient` interface directly.

LangGraph is responsible for:

- Explicit graph state and conditional routing.
- Bounded cycles.
- Human-in-the-loop interrupts.
- Resuming from checkpoints.
- Consistent node-level error handling.
- Inspectable execution history.

The application remains responsible for:

- Provider selection and authentication.
- Prompt construction.
- Canonical tool schemas and execution.
- Document parsing and typed edits.
- Deterministic validation.
- IndexedDB persistence.
- User approval and version commits.

This boundary avoids replacing working provider adapters and keeps provider-specific request handling out of the workflow graph.

## Existing Code Fit

The repository already contains the primary building blocks:

- `src/lib/provider/types.ts` defines `LLMClient` and provider capabilities.
- `src/lib/asksage/types.ts` defines canonical OpenAI-style tools, tool choices, tool calls, and tool-result messages.
- `src/lib/provider/factory.ts` creates the active provider client.
- `src/lib/draft/drafter.ts` demonstrates a provider-aware tool loop.
- `src/lib/edit/schema-edit.ts` and `src/lib/edit/dispatcher.ts` define and apply structured edits.
- `src/lib/document/edit.ts` and scoped-edit modules coordinate document revisions.
- `src/lib/draft/critique.ts`, cross-section review, and style-consistency modules provide model-based review patterns.
- Deterministic validators already cover template, document, formatting, and drafting invariants.
- `src/lib/db/schema.ts` and existing Dexie state provide local persistence.
- Existing diff components can present proposed changes before acceptance.

The agentic workflow is a coordination layer over these modules, not a parallel editing engine.

## Design Principles

### Capability adaptation

Every workflow begins by resolving an effective capability profile. Graph routing is based on this profile, never on provider id or class identity.

### Equivalent outcomes

Tool and non-tool paths must converge on the same `EditProposal` schema. Downstream critique, validation, diff display, acceptance, and persistence must not care which path generated the proposal.

### Bounded autonomy

Every loop has explicit step, token, time, and retry limits. A workflow stops for user input instead of improvising indefinitely.

### Proposed edits are data

Models return typed operations and rationale. They do not mutate DOCX blobs, IndexedDB records, or accepted document state.

### Deterministic checks outrank model judgment

A critic may recommend an edit, but deterministic validation decides whether an operation is structurally safe to preview or apply.

### Learning requires confirmation

User feedback can influence the active turn immediately. It becomes a durable preference only after explicit acceptance or confirmation.

### Full traceability

Every plan, model call, tool call, proposal, critique, repair, validation result, user decision, and committed version is associated with a workflow turn.

## Capability Model

Provider-level capability flags are necessary but not sufficient. Tool availability may vary by selected model or endpoint probe.

Add a workflow-specific effective profile:

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
}
```

Resolve it from:

1. Static `client.capabilities`.
2. Selected model metadata such as `tool_calling` and `supported_parameters`.
3. Session endpoint probes where applicable.
4. Locally available deterministic tools.

Conservative resolution rules:

- Explicit `false` from provider, model metadata, or a current endpoint probe disables native tools.
- Unknown model metadata does not disable a provider whose tool transport is known to work, but the first native-tool failure triggers fallback.
- `promptJsonOutput` remains true when ordinary chat completion works and the workflow can validate parsed JSON itself.
- Local tools such as document inspection remain available to the application even when the model cannot call them. The fallback context builder invokes them deterministically.

Example profiles:

| Provider/model condition | Native tools | Prompt JSON | Local inspection | Execution path |
| --- | ---: | ---: | ---: | --- |
| Ask Sage with working tool transport | Yes | Yes | Yes | Tool-assisted |
| OpenRouter tool-capable model | Yes | Yes | Yes | Tool-assisted |
| OpenRouter model without tools | No | Yes | Yes | Prompt-only |
| Local OpenAI model with successful tool probe | Yes | Yes | Yes | Tool-assisted |
| Local model with failed tool probe | No | Yes | Yes | Prompt-only |
| GenAI.mil STARK v0.1 | No | Yes | Yes | Prompt-only |

## Workflow Graph

```text
START
  |
  v
initializeTurn
  |
  v
deriveAcceptanceCriteria
  |
  v
planEdits
  |
  v
resolveCapabilities
  |
  +---------------- nativeTools ----------------+
  |                                              |
  v                                              v
toolAssistedEditor                         fallbackContextBuilder
  |       ^                                      |
  |       |                                      v
  +--> executeTools                         promptOnlyEditor
  |                                              |
  +----------------------+-----------------------+
                         |
                         v
                    critiqueProposal
                         |
                         v
                  deterministicValidate
                         |
             +-----------+------------+
             |                        |
        repairable failure           pass
             |                        |
             v                        v
         repairProposal       awaitUserApproval
             |                 /      |       \
             +----------------+   ACCEPT    REJECT/REFINE
                                      |          |
                                      v          v
                                commitVersion  recordFeedback
                                      |          |
                                      v          +--> planEdits
                                     END
```

Terminal states:

- `completed`
- `cancelled`
- `failed`
- `budgetExceeded`
- `unsupported`

Human-interrupt states:

- `awaitingBroadPlanApproval`
- `awaitingToolApproval`
- `awaitingUserApproval`
- `awaitingClarification`

## Graph State

Graph state must remain JSON-serializable and reference large artifacts by ID.

```ts
export interface EditingGraphState {
  sessionId: string;
  turnId: string;
  projectId?: string;
  documentId: string;
  baseVersionId: string;

  instruction: string;
  clarification?: string;
  acceptanceCriteria: AcceptanceCriterion[];
  plan?: EditPlan;

  providerId: ProviderId;
  modelRouting: EditingModelRouting;
  capabilities?: AgentCapabilities;

  contextManifest: ContextManifest;
  messages: AgentMessage[];
  pendingToolCalls: OpenAIToolCall[];
  toolResults: ToolExecutionRecord[];

  proposal?: EditProposal;
  critique?: EditCritique;
  validation?: EditValidationReport;
  previewVersionId?: string;

  repairPass: number;
  modelCallCount: number;
  toolCallCount: number;
  tokensIn: number;
  tokensOut: number;
  startedAt: string;
  deadlineAt: string;

  learnedPreferenceIds: string[];
  warnings: string[];
  error?: WorkflowError;
}
```

Do not place the following directly in graph state:

- DOCX blobs.
- Full extracted reference files.
- Rendered preview images.
- Large OOXML payloads.
- Complete audit response bodies.

Store them in Dexie and reference them by stable IDs.

## Turn and Version Data

Add persisted records:

```ts
export interface EditingSessionRecord {
  id: string;
  documentId: string;
  projectId?: string;
  status: EditingSessionStatus;
  activeTurnId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EditingTurnRecord {
  id: string;
  sessionId: string;
  parentTurnId?: string;
  baseVersionId: string;
  resultVersionId?: string;
  instruction: string;
  acceptanceCriteria: AcceptanceCriterion[];
  plan?: EditPlan;
  proposal?: EditProposal;
  critique?: EditCritique;
  validation?: EditValidationReport;
  providerId: ProviderId;
  modelsUsed: string[];
  executionPath: 'tool_assisted' | 'prompt_only' | 'tool_fallback';
  userDecision?: 'accepted' | 'rejected' | 'refined' | 'cancelled';
  createdAt: string;
  completedAt?: string;
}

export interface DocumentVersionRecord {
  id: string;
  documentId: string;
  parentVersionId?: string;
  sourceTurnId?: string;
  blobId: string;
  label: string;
  status: 'preview' | 'accepted' | 'superseded';
  createdAt: string;
}
```

Accepted versions are immutable. Revert creates a new accepted version whose content is based on an older version; it does not delete intervening history.

## Execution Journal

Auditability is a primary workflow output. Every turn maintains an append-only execution journal that can reconstruct what the application did, what it sent, what it received, why it chose each route, and which artifacts produced the proposed revision.

```ts
export interface AgentTraceEvent {
  id: string;
  sessionId: string;
  turnId: string;
  sequence: number;
  timestamp: string;

  spanId: string;
  parentSpanId?: string;
  node: string;
  attempt: number;
  type:
    | 'turn.started'
    | 'node.queued'
    | 'node.started'
    | 'node.completed'
    | 'node.failed'
    | 'node.cancelled'
    | 'node.skipped'
    | 'route.selected'
    | 'model.request'
    | 'model.response'
    | 'tool.requested'
    | 'tool.approval_requested'
    | 'tool.approved'
    | 'tool.rejected'
    | 'tool.started'
    | 'tool.completed'
    | 'tool.failed'
    | 'validation.completed'
    | 'checkpoint.saved'
    | 'user.decision'
    | 'turn.completed';

  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'skipped';
  summary: string;
  reason?: string;
  inputArtifactIds: string[];
  outputArtifactIds: string[];
  checkpointId?: string;
  durationMs?: number;
  tokensIn?: number;
  tokensOut?: number;
  error?: WorkflowError;
}
```

Sequence numbers are monotonically increasing within a turn. Journal events are never edited in place. Corrections, retries, fallbacks, and user decisions append new events.

Large or sensitive inputs and outputs are stored as separate trace artifacts:

```ts
export interface AgentTraceArtifact {
  id: string;
  sessionId: string;
  turnId: string;
  kind:
    | 'rendered_prompt'
    | 'canonical_query_input'
    | 'provider_request'
    | 'provider_response'
    | 'tool_arguments'
    | 'tool_result'
    | 'context_manifest'
    | 'context_excerpt'
    | 'edit_plan'
    | 'edit_proposal'
    | 'critique'
    | 'validation_report'
    | 'diff_summary'
    | 'error_detail';
  mediaType: 'application/json' | 'text/plain';
  content: string;
  sha256: string;
  createdAt: string;
  containsDocumentContent: boolean;
  truncated: boolean;
  originalCharacterCount?: number;
}
```

Every artifact receives a digest so the trace can prove which exact prompt, context, response, tool result, proposal, and validation report were associated with a node. Trace references are stable even when the UI displays a summarized view.

### Model-call capture

Model calls require capture at two layers:

1. The workflow wrapper records the canonical `QueryInput`, rendered system prompt, messages, model, temperature, tools, and tool policy before calling `LLMClient`.
2. The provider adapter records the final sanitized request URL and body immediately before `fetch`, after provider-specific mapping.

The provider trace must never contain:

- `Authorization` headers.
- API keys.
- Session credentials.
- Browser cookies.
- One-time authentication tokens.

The response artifact stores the returned status, selected response headers, and response body used by the application. Rate-limit headers, request IDs, and provider correlation IDs should be retained when available.

Prompt provenance must include:

- Prompt-template identifier and version.
- Hash of the rendered prompt.
- Context-manifest ID.
- Selected document and version IDs.
- Accepted preference IDs.
- Provider, model, and model-stage routing.
- Temperature and supported generation parameters.
- Tool schemas offered to the model.
- Capability profile and its evidence.

### Routing explanations

Every conditional graph edge appends `route.selected` with a human-readable reason and machine-readable inputs.

Examples:

- "Selected tool-assisted editing because provider tools=true and model tool_calling=true."
- "Selected prompt-only editing because GenAI.mil declares native tools=false."
- "Downgraded to prompt-only after HTTP 400 rejected tool_choice."
- "Entered repair pass 1 because required criterion AC-3 failed."
- "Paused for user approval because plan affects 12 sections."

No silent conditional edge is permitted.

### Node contract

Every graph node must:

1. Append `node.started`.
2. Persist or reference its material inputs.
3. Append model/tool/validation child events as applicable.
4. Persist or reference its material outputs.
5. Append exactly one terminal `node.completed`, `node.failed`, `node.cancelled`, or `node.skipped` event.
6. Save a checkpoint before the next externally visible side effect.

A node is not considered implemented until its trace events and artifacts are covered by tests.

## Shared Output Contracts

### Acceptance criteria

```ts
export interface AcceptanceCriterion {
  id: string;
  description: string;
  kind:
    | 'content'
    | 'grounding'
    | 'style'
    | 'structure'
    | 'formatting'
    | 'consistency';
  required: boolean;
  source: 'user' | 'template' | 'learned_preference' | 'system';
}
```

### Edit plan

```ts
export interface EditPlan {
  summary: string;
  scope: {
    sectionIds: string[];
    paragraphIds: string[];
    broadDocumentChange: boolean;
  };
  steps: EditPlanStep[];
  requiredContext: ContextRequest[];
  risks: string[];
}
```

### Edit proposal

```ts
export interface EditProposal {
  summary: string;
  operations: SchemaEditOperation[];
  criterionCoverage: Array<{
    criterionId: string;
    operationIndexes: number[];
    explanation: string;
  }>;
  evidence: EvidenceReference[];
  assumptions: string[];
  unresolvedQuestions: string[];
}
```

Both tool-assisted and prompt-only editors must return this exact contract.

### Critique

```ts
export interface EditCritique {
  verdict: 'pass' | 'repair' | 'needs_user';
  score: number;
  criteria: Array<{
    criterionId: string;
    satisfied: boolean;
    explanation: string;
    repairInstruction?: string;
  }>;
  unsupportedClaims: string[];
  structuralRisks: string[];
  styleIssues: string[];
  repairInstructions: string[];
}
```

The critic receives the base document slice, acceptance criteria, proposal, evidence excerpts, and deterministic precheck results. It does not receive permission to execute edit tools.

## Tool-Assisted Path

The tool-assisted editor calls `client.query()` with the canonical OpenAI-style tool envelope.

Initial tool policy:

- Use `tool_choice: 'auto'`.
- Maximum eight model/tool cycles.
- Maximum twelve tool calls per turn.
- A final `EditProposal` must be returned as text JSON, not as a mutation tool.

The graph alternates between:

1. `toolAssistedEditor`
2. `executeTools`

until:

- The model returns a valid `EditProposal`.
- A step or budget limit is reached.
- A tool requires user approval.
- Native tool transport fails and the graph routes to fallback.
- The user cancels.

### Initial local tool registry

Read-only tools:

- `list_document_sections`
- `read_document_section`
- `read_paragraph_range`
- `inspect_template_region`
- `search_attached_references`
- `find_defined_term`
- `search_project_history`
- `check_cross_section_consistency`
- `calculate_value`

Proposal helpers:

- `validate_edit_operation`
- `preview_edit_operations`

Tools must return bounded, serializable results with stable source references.

No tool may:

- Commit a document version.
- Overwrite a DOCX blob.
- Write arbitrary IndexedDB records.
- Read files outside user-attached project/document data.
- Execute source code.
- Fetch an arbitrary URL without approval and domain policy checks.

### Tool registry contract

```ts
export interface AgentTool<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  parameters: JsonSchema;
  risk: 'read_only' | 'external_read' | 'document_write';
  requiresApproval: (input: TInput) => boolean;
  execute: (
    input: TInput,
    context: ToolExecutionContext,
    signal: AbortSignal,
  ) => Promise<TOutput>;
}
```

The executor validates arguments against the tool schema before execution. Unknown tools, invalid arguments, stale document IDs, and over-limit calls return structured errors to the graph.

## Prompt-Only Fallback Path

The fallback path is a first-class workflow, not an error mode.

`fallbackContextBuilder` deterministically executes the same read-only capabilities the model might have requested:

1. Include the user-selected document scope.
2. Include target template regions and surrounding paragraphs.
3. Include applicable accepted preferences.
4. Search locally extracted references using the existing lexical/chunk-selection path.
5. Include prior-section summaries and relevant project history.
6. Enforce a context budget and record omitted sources.

`promptOnlyEditor` then calls ordinary `query()` or `queryJson()` without:

- `tools`
- `tool_choice`
- Tool-result messages
- Provider datasets when unsupported
- Live-search fields when unsupported
- Structured-output API parameters when unsupported

The prompt contains:

- User instruction.
- Acceptance criteria.
- Edit plan.
- Bounded context bundle.
- Allowed `SchemaEditOperation` definitions.
- Required `EditProposal` JSON schema.
- Explicit instruction to list assumptions and unresolved questions.

If the provider returns invalid JSON:

1. Run one format-repair call with the invalid output and schema.
2. If parsing still fails, stop with `needs_user` or a clear provider/model compatibility error.

## Runtime Tool Fallback

A workflow that begins on the tool-assisted path may downgrade during the turn.

Fallback triggers:

- HTTP response indicates tools or `tool_choice` are unsupported.
- Response repeatedly omits native tool-call envelopes when the prompt explicitly requested a call.
- Tool-call arguments cannot be parsed in two consecutive model steps.
- Selected model metadata changes or a session probe marks tools unavailable.

On fallback:

1. Record the original failure in the turn audit.
2. Remove tool-call and tool-result envelopes from the next provider request.
3. Preserve useful read-only tool results already obtained.
4. Build a fallback context bundle.
5. Continue through `promptOnlyEditor`.
6. Mark the turn execution path `tool_fallback`.
7. Show a non-blocking warning that the workflow completed without native tools.

Do not automatically switch providers or models. Provider/model changes require explicit user action or preconfigured routing.

## Critique and Repair

Critique does not require native tools. It is a separate completion over a bounded evidence package.

The critic checks:

- Every acceptance criterion.
- Unsupported or invented claims.
- Consistency with supplied references.
- Preservation of unaffected content.
- Template and document structural requirements.
- Defined terms, acronyms, dates, quantities, and cross-section consistency.
- Style and tone requirements.
- Scope creep.

Repair behavior:

- Maximum two repair passes.
- Repairs receive only failed criteria and relevant validator errors.
- Repairs may modify the proposal but do not commit changes.
- Each repair is re-critiqued and revalidated.
- If required criteria still fail after the limit, the workflow pauses for user direction.

The editor and critic may use the same model, but the prompt roles and context must remain separate. Settings may optionally route them to different models.

## Deterministic Validation

Before user preview, validate:

- Operation schema.
- Target IDs exist in the base version.
- Targets remain within the approved plan scope.
- No operation edits protected headers, footers, numbering, styles, or content controls unless explicitly allowed.
- No unresolved placeholders are introduced.
- Paragraph roles and template fill-region constraints remain valid.
- Word-count and section-size constraints.
- Citation/evidence identifiers resolve.
- Applying operations to a clone succeeds.
- Resulting DOCX/IR invariants pass.

Validation output is persisted and included in the preview.

The workflow never asks the model to overrule a deterministic error. It may ask the model to propose a corrected operation.

## User Approval

The workflow interrupts before canonical document mutation.

The approval view shows:

- User instruction.
- Plan and affected scope.
- Before/after diff.
- Acceptance-criteria coverage.
- Critic verdict.
- Deterministic validation status.
- Evidence and assumptions.
- Provider, model, execution path, model calls, tool calls, and token usage.
- Warnings, including tool fallback.

Actions:

- **Accept**: commit preview as a new accepted version.
- **Reject**: retain history, discard preview status, and optionally record feedback.
- **Refine**: create a child turn using the preview or original base version as explicitly selected.
- **Edit instruction**: return to planning without another API call.
- **Cancel**: stop the active turn without committing.
- **Revert**: create a new version from a prior accepted version.

Broad whole-document plans may require an earlier plan-approval interrupt before editing begins.

## Feedback and Self-Improvement

The system improves through a transparent preference ledger, not hidden model training.

```ts
export interface LearnedPreference {
  id: string;
  projectId?: string;
  documentId?: string;
  instruction: string;
  scope: 'global' | 'project' | 'document' | 'section';
  sourceTurnId: string;
  status: 'proposed' | 'accepted' | 'retired';
  createdAt: string;
  acceptedAt?: string;
}
```

Rules:

- `REFINE` feedback affects the immediate child turn.
- A preference is proposed when feedback appears reusable.
- The UI asks the user to confirm the proposed preference.
- Only `accepted` preferences enter future prompts.
- The user can inspect, edit, scope, or retire preferences.
- Every turn records which preference IDs influenced it.
- Conflicting preferences pause for clarification instead of silently choosing one.
- Provider responses never directly create accepted preferences.

Examples:

- "Keep paragraphs under six sentences."
- "Use the organization name rather than 'the Government.'"
- "Do not infer dates that are absent from references."
- "Preserve all template heading text."

## Persistence and Checkpointing

Implement a Dexie-backed LangGraph checkpointer.

Checkpoint requirements:

- Key by `sessionId`, `turnId`, graph namespace, and checkpoint ID.
- Persist after each graph node.
- Support latest-checkpoint lookup and point-in-time resume.
- Store pending writes atomically with checkpoint metadata.
- Serialize graph state as JSON.
- Store large artifacts separately and reference them by ID.
- Version the checkpoint schema.
- Prune superseded intermediate checkpoints after a retention threshold while preserving accepted turn history.

On browser reload:

1. Load the active editing session.
2. Restore the latest compatible graph checkpoint.
3. Recreate the active `LLMClient` from current session credentials.
4. If the credential is unavailable, pause at `awaitingConnection`.
5. Do not replay already completed tool side effects.
6. Restart only the invocation associated with the restored active state.

If a checkpoint is incompatible after an application upgrade, retain the turn audit and offer restart-from-plan rather than discarding history.

## Cancellation and Concurrency

- Every model and tool node receives an `AbortSignal`.
- Cancel aborts the active fetch/tool, persists `cancelled`, and leaves accepted versions unchanged.
- Only one mutating editing turn may target a document at a time.
- Read-only planning sessions may coexist, but acceptance must verify that `baseVersionId` is still current.
- If the base version changed, mark the proposal stale and require rebase or restart.
- Tool and model results arriving after cancellation are ignored.

## Limits

Initial defaults:

```ts
export interface EditingWorkflowLimits {
  maxModelCalls: 12;
  maxToolCycles: 8;
  maxToolCalls: 12;
  maxRepairPasses: 2;
  maxElapsedMs: 10 * 60 * 1000;
  maxContextCharacters: 160_000;
}
```

Provider/model context limits may reduce `maxContextCharacters`.

When a limit is reached:

- Persist current state and partial artifacts.
- Stop additional calls.
- Show which limit was reached.
- Allow the user to accept a valid partial proposal, refine scope, or start a continuation turn.

## Provider Behavior

### Ask Sage

- Use canonical tools when the server/model supports them.
- Retain Ask Sage dataset and live-search features only in nodes that explicitly request them.
- Ask Sage-only data operations remain behind capability checks.

### OpenRouter

- Use native tools only when selected-model metadata or successful behavior indicates support.
- Do not assume every OpenRouter model supports tools or structured output.
- Preserve current provider-specific web-search behavior only for approved research nodes.

### Local OpenAI-compatible

- Use the current endpoint probe and model metadata.
- Tool-probe failure routes to prompt-only behavior without blocking editing.
- Local endpoint and privacy warnings remain visible.

### GenAI.mil

- Route directly to prompt-only execution for the current STARK v0.1 schema.
- Never send `tools`, `tool_choice`, tool transcript fields, datasets, live-search fields, embeddings, or unsupported structured-output parameters.
- Continue planning, editing, critique, repair, validation, approval, feedback learning, and checkpointing normally.

## Security

- Treat attached-document content and model output as untrusted data.
- Tool names come only from the local registry.
- Validate tool arguments before execution.
- Bind every tool execution to the active project, document, base version, and user-selected scope.
- Require approval for external network reads and all proposed document writes.
- Do not place API keys in graph state, checkpoints, turn records, prompts, trace artifacts, or audit excerpts.
- Store full workflow prompts and responses locally for auditability, but sanitize credentials and authentication material before persistence.
- Mark traces that contain document or reference content and treat them with the same handling restrictions as the source document.
- Require an explicit warning and user action before exporting a diagnostic bundle that contains document content.
- Provide per-turn and per-session trace deletion without deleting accepted document versions.
- Redact secrets and enforce explicit size limits when creating shareable diagnostic bundles.
- Prevent model-authored text from changing tool permissions or workflow limits.
- Escape tool results when embedding them into subsequent prompts.
- Maintain the existing CUI/provider labeling; this feature does not grant a provider new data-handling authorization.

## UI

Add an editing-session panel to the document and project drafting surfaces.

Primary areas:

- Instruction composer.
- Current phase and progress.
- Cancel control.
- Plan summary and scope.
- Always-visible execution timeline showing queued, running, completed, skipped, failed, cancelled, and waiting stages.
- Expandable step inspector for every graph node.
- Tool activity timeline when tools are used.
- Prompt-only/fallback indicator.
- Critique and validation summary.
- Before/after diff.
- Accept, Reject, Refine, and Revert controls.
- Turn history.
- Accepted preference manager.

Progress labels:

- Understanding request
- Planning edits
- Gathering context
- Drafting revision
- Critiquing
- Repairing
- Validating
- Waiting for approval

The timeline is visible as soon as the user submits the instruction. It updates from persisted journal events rather than ephemeral component state, so a reload shows the same history.

Each node inspector shows:

- Start/end time and duration.
- Status and attempt number.
- Why the node ran or was skipped.
- Provider and model.
- Prompt template/version.
- Exact rendered prompt and canonical messages stored locally.
- Sanitized provider URL and request body.
- Response status, request/correlation ID, rate-limit metadata, and exact returned model text.
- Context manifest with included and omitted sources.
- Tools offered, requested, approved, executed, rejected, and failed.
- Validated tool arguments and bounded tool results.
- Token usage and workflow-budget impact.
- Parsed structured output and any format-repair attempt.
- Critique findings and criterion coverage.
- Deterministic validator inputs, results, and errors.
- Checkpoint before and after the node.
- Route selected for the next step and the reason.

The default view presents concise summaries. "Technical details" expands exact local artifacts. Document-bearing artifacts are clearly marked.

The UI also provides:

- Copy individual trace artifact.
- Export sanitized diagnostic bundle.
- Export full local diagnostic bundle after a content warning.
- Download turn journal as JSON.
- Clear trace data for a turn or session.
- Jump from an edit operation or diff item to the model call, tool result, evidence, and validator event that produced it.

Do not expose or claim access to hidden model chain-of-thought. Auditability means showing application state, exact application-visible prompts and responses, tool activity, routing decisions, validation evidence, and concise model-supplied rationales—not private internal reasoning tokens.

## Error Handling

Classify errors:

```ts
export type WorkflowErrorCode =
  | 'connection'
  | 'authentication'
  | 'rate_limit'
  | 'provider_unsupported'
  | 'tool_transport'
  | 'tool_execution'
  | 'invalid_model_output'
  | 'validation'
  | 'stale_base_version'
  | 'budget_exceeded'
  | 'cancelled'
  | 'checkpoint'
  | 'unknown';
```

Recovery rules:

- Tool transport error: downgrade to prompt-only when safe.
- Rate limit: persist and offer retry after the provider-supplied interval.
- Authentication: pause for reconnection.
- Invalid JSON: one format-repair attempt.
- Validation error: targeted repair within remaining repair budget.
- Stale base version: require rebase/restart.
- Checkpoint write failure: stop before further side effects and preserve in-memory state for manual retry.
- Unknown failure: stop without committing and retain diagnostic context.

## Observability and Diagnostic Export

The execution journal is the source of truth for workflow observability. Console logging is optional developer convenience and must never be the only record.

Provide two export modes:

### Sanitized diagnostic bundle

Contains:

- Graph and prompt-template versions.
- Journal events.
- Provider/model routing.
- Capability decisions.
- Request shapes with content replaced by hashes and character counts.
- Tool names and statuses with sensitive arguments removed.
- Validation codes.
- Error stacks.
- Timing, usage, and checkpoints.

This is the default support artifact.

### Full local diagnostic bundle

Contains exact locally persisted prompts, provider-visible request bodies, returned model text, tool arguments/results, context excerpts, proposals, critiques, and validation reports. Export requires an explicit warning because it may contain CUI, sensitive document text, or attached-reference content.

Both bundles include:

- Application version and build identifier.
- Trace schema version.
- Session, turn, document, and base-version IDs.
- SHA-256 manifest of included artifacts.
- No credentials or authorization headers.

Retention defaults:

- Keep journal events for the lifetime of the editing session.
- Keep full artifacts for accepted, rejected, failed, and cancelled turns until the user clears them.
- Allow configurable automatic pruning of large intermediate artifacts.
- Never prune the minimal journal, final proposal, critique, validation report, user decision, or accepted-version linkage while the session remains.

## Testing

### Graph tests

- Tool-capable profile routes through tool-assisted editor.
- Tool-incapable profile routes directly through fallback context builder.
- Tool transport failure downgrades to prompt-only and completes.
- Both paths produce the same `EditProposal` contract.
- Critique pass reaches approval.
- Repair verdict loops no more than two times.
- Failed required criteria pause for user input.
- Cancellation aborts active actors.
- Model, tool, time, and repair limits terminate correctly.
- Broad edits interrupt for plan approval.
- Accept commits exactly one new version.
- Reject commits no accepted version.
- Refine creates a child turn.

### Tool tests

- Unknown tools are rejected.
- Arguments are schema-validated.
- Document scope and base-version binding are enforced.
- Read tools return bounded results with evidence IDs.
- External reads require approval.
- No tool can commit canonical document state.
- Abort signals stop tool work.

### Fallback tests

- No `tools` or `tool_choice` fields reach a completion-only provider.
- Tool transcript fields are removed after downgrade.
- Context builder includes selected scope, preferences, and relevant references.
- Context builder respects budget and records omissions.
- Invalid JSON receives one format-repair attempt.
- GenAI.mil completes plan, edit, critique, and approval without tools.

### Persistence tests

- Checkpoint round-trip through Dexie.
- Resume from planning, tool execution, critique, repair, and approval.
- Completed tool effects are not replayed after restore.
- Missing credentials pause the workflow.
- Incompatible checkpoints offer restart without deleting turn history.
- Large blobs remain outside checkpoint state.
- Journal sequence remains ordered and append-only after resume.
- Every node has one start event and one terminal event.
- Exact rendered prompt and sanitized provider request survive reload.
- Completed model and tool calls link to their input/output artifacts.
- Artifact hashes remain stable across persistence round-trips.

### Audit tests

- Every conditional edge records a routing reason.
- Tool fallback records the original failure and downgrade reason.
- Skipped stages are visible with reasons.
- Retry and repair attempts are distinguishable.
- Provider tracing excludes Authorization and API keys.
- Model request traces include exact application-visible messages and generation parameters.
- Model response traces include request IDs and rate-limit headers when returned.
- Sanitized export excludes document content and sensitive tool arguments.
- Full export requires explicit confirmation and still excludes credentials.
- Trace deletion does not delete accepted document versions.
- Diff operations link back to proposal, evidence, model-call, and validation events.

### Editing tests

- Proposal operations use existing schema-edit contracts.
- Protected document structures remain unchanged unless explicitly scoped.
- Preview applies to a clone.
- Accepted versions are immutable.
- Revert creates a new version.
- Stale base versions cannot be accepted.

### UI tests

- Progress accurately reflects graph state.
- Tool activity appears only on tool-assisted turns.
- Prompt-only and tool-fallback warnings are visible.
- Accept, Reject, Refine, Cancel, and Revert send correct events.
- Learned preferences require confirmation.
- Reload restores an interrupted session.
- Timeline appears immediately after submission and updates from journal events.
- Every stage can be expanded to inspect inputs, outputs, timing, usage, and routing.
- Failed and skipped steps remain visible after the workflow continues.
- Technical details show exact local prompts and sanitized provider payloads.
- Diagnostic exports and trace clearing display the required content warnings.

Verification commands:

- `npm run typecheck`
- `npm test`
- `npm run build`

## Rollout Plan

### Phase 1: Durable prompt-only workflow

- Add LangGraph dependencies.
- Add graph state and Dexie checkpoint adapter.
- Implement plan, prompt-only edit, critique, repair, deterministic validation, and approval.
- Add turn/version persistence and diff UI.
- Support every current provider through ordinary completions.

### Phase 2: Read-only native tools

- Add the typed tool registry.
- Implement document and reference inspection tools.
- Add tool-assisted routing and execution loop.
- Add runtime downgrade to prompt-only.
- Enable on Ask Sage, supported OpenRouter models, and successfully probed local models.

### Phase 3: Feedback learning

- Add proposed/accepted/retired preferences.
- Add preference confirmation and management UI.
- Include accepted preferences in planning and critique.

### Phase 4: Broader document intelligence

- Add cross-section consistency tools.
- Add optional approved research tools.
- Add rebase support for stale proposals.
- Add configurable model routing and workflow budgets.

## Acceptance Criteria

- A user can start a revision turn from a document instruction and receive a validated diff before any canonical document mutation.
- Ask Sage and tool-capable OpenRouter/local models can use native read-only tools inside a bounded agent loop.
- GenAI.mil and other completion-only models can complete the same editing workflow through preassembled context without receiving unsupported fields.
- A tool-capable workflow automatically downgrades to prompt-only after a recognized tool-transport failure without losing useful context.
- Tool-assisted and prompt-only paths return the same typed proposal contract.
- Critique and deterministic validation run regardless of tool availability.
- No workflow exceeds configured model-call, tool-call, repair, time, or context limits.
- User approval is required before a preview becomes an accepted document version.
- Every accepted version can be reverted without deleting history.
- Explicit user feedback can be confirmed as a visible, editable preference; unconfirmed feedback does not silently become permanent behavior.
- An interrupted workflow can resume from IndexedDB after reload without replaying completed side effects.
- Every stage and conditional route is visible in an append-only execution journal with timestamps, attempts, status, inputs, outputs, and reasons.
- A user can inspect the exact application-visible prompt, sanitized outbound provider request, returned model text, tool activity, critique, and validator results for every model-driven turn.
- Failed, skipped, retried, downgraded, and cancelled steps remain visible after the workflow advances or reloads.
- Each proposed edit can be traced back to its plan, evidence, model call, tool results, critique, and validation events.
- A sanitized diagnostic bundle can be exported without document content, and a full local bundle can be exported only after an explicit sensitive-content warning.
- No trace or diagnostic export contains API keys, Authorization headers, cookies, or one-time authentication tokens.
- Existing provider behavior, document edit semantics, template preservation, and release build remain intact.

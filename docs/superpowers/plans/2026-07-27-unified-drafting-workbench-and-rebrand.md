# Unified Drafting Workbench and Product Rebrand Plan

> **Implementation rule:** Execute this plan as a sequence of independently reviewable vertical slices. Do not begin with a broad rename or a V2 component rewrite. First establish product identity boundaries, then ship one complete select → instruct → preview → accept → undo workflow before adding more actions or targets.

**Goal:** Turn the SPA from a capable generator with several editing surfaces into a cohesive, provider-neutral drafting workbench where users can iteratively improve selected content, inspect grounded proposals, approve changes safely, recover after reload, and export trustworthy Word documents across a broad range of cloud and local LLM APIs.

**Product Direction:** The application should have its own provider-neutral identity. Ask Sage remains a supported provider and the CUI-authorized option for the configured DHA environment; it should no longer be the name of the overall product.

**Architecture:** Add a shared active-target model to the V2 workspace, adapt template sections and freeform blocks to the existing agentic-editing target contracts, and route every AI edit through a durable proposal lifecycle. Provider adapters converge on a canonical completion, structured-output, embedding, and tool-use contract. Runtime conformance probes determine actual endpoint/model capabilities, including local tool calling, and the editing runner downgrades safely to prompt-only execution when native tools are missing or malformed. The editing workflow never mutates canonical content until user approval. Brand strings and metadata move behind a small product-identity module so a final name can be selected without renaming provider code, storage keys, or historical schemas.

**Tech Stack:** React 18, TypeScript 5.6 strict mode, Vite, React Router, Zustand, Dexie, Vitest, React Testing Library, existing provider adapters, document operations, agentic-editing records, trace journal, validation, and DOCX assembly.

**Related Work:**

- `docs/superpowers/plans/2026-07-27-capability-adaptive-agentic-editing.md`
- `docs/superpowers/specs/2026-07-27-capability-adaptive-agentic-editing-design.md`
- `docs/superpowers/plans/2026-07-27-spa-cohesion-reliability.md`

The capability-adaptive editing design remains the technical foundation. This plan defines the product-facing V2 integration and the brand migration required to make that foundation usable.

---

## End Goals

### Product end state

The finished product is a local-first, provider-neutral professional drafting workbench—not a thin chat interface and not a single-provider document generator.

It should help users move through the entire document lifecycle:

```text
Intent
  → source collection
  → template or style selection
  → structured first draft
  → targeted revision
  → evidence and citation review
  → consistency and quality review
  → explicit approval
  → versioned Word export
```

The product should feel like one coherent workspace even though drafting, research, editing, validation, provider execution, persistence, and DOCX assembly remain separate technical systems.

### Primary user end state

A professional user should be able to produce and revise a substantial document without understanding prompts, model APIs, token limits, JSON schemas, tool calls, or OOXML.

The user should always be able to answer:

- What document or section am I changing?
- What instruction will the model follow?
- Which provider and model will receive the request?
- Which notes, files, datasets, or research sources will be used?
- What did the model propose?
- What validation or provenance concerns remain?
- Has the proposal changed my document yet?
- Can I reject or undo it?
- Will the exported Word document preserve the required structure and formatting?

### Audience end state

The product should serve:

- government and defense users drafting structured professional documents;
- users working with CUI through an appropriately configured and authorized provider;
- non-CUI professional users working through commercial APIs;
- privacy-conscious users working with local models;
- teams that need repeatable templates, source grounding, review history, and defensible exports.

The product must not imply that every provider or deployment is suitable for every data classification. Provider and environment suitability remains explicit.

### Drafting end state

Users can:

- create template-driven and freeform projects;
- describe intent, audience, constraints, tone, and desired outcome;
- attach notes and supported source documents;
- reuse project defaults and drafting profiles;
- generate a complete first draft;
- see progress by stage and recover interrupted work;
- regenerate only the necessary target instead of the entire document;
- preserve document structure, formatting roles, placeholders, and template semantics.

First-draft generation remains valuable, but it is the beginning of the workflow rather than the product's terminal action.

### Editing end state

Users can select a section, paragraph, table, slot, or freeform block and:

- rewrite it;
- tighten or expand it;
- change tone, audience, tense, or reading level;
- incorporate selected source material;
- strengthen citation support;
- repair validation findings;
- enter an unrestricted custom instruction within safety and size limits.

Every edit follows the same lifecycle:

```text
Select
  → instruct
  → generate proposal
  → validate
  → preview diff
  → accept, reject, or revise
  → version
  → undo if needed
```

No AI-generated edit silently changes canonical content.

### Research and grounding end state

Users can understand and control grounding:

- attach local reference files;
- use provider datasets or live search when supported;
- select or exclude sources for a particular draft or edit;
- see which chunks influenced a proposal;
- inspect citation provenance;
- receive warnings for unsupported or unverifiable claims;
- preserve a research pack as reusable project context.

Grounding capabilities degrade honestly. A provider without file upload, embeddings, datasets, or live search still supports drafting from locally extracted text when possible.

### Provider end state

The same user workflow operates across many API providers and local inference servers.

The application:

- supports first-party and generic provider adapters;
- treats completion as the universal baseline;
- discovers structured output, tools, embeddings, file, dataset, and search capabilities separately;
- verifies actual endpoint/model behavior through runtime conformance probes;
- uses native tool calling when verified;
- falls back to prompt-only proposal generation when tools are absent or malformed;
- never loses approval, validation, trace, or recovery behavior during fallback;
- exposes enough diagnostic information to configure unusual local endpoints without exposing secrets.

Changing providers may change speed, cost, context limits, grounding options, and execution strategy. It must not change the fundamental editing lifecycle or the shape of an approved proposal.

### Local-model end state

A user running a compatible local server can:

- configure a preset or custom OpenAI-compatible endpoint;
- use an optional local API key;
- discover available models;
- probe completion, JSON, native tools, tool-result continuation, context, and embeddings;
- see whether limitations come from the server or selected model;
- enable verified native tool use;
- disable unreliable tool use manually;
- continue through prompt-only fallback when native tools fail;
- keep document content on the local machine/network path they configured.

Local support is not a second-class UI. Capability differences are visible without assuming all local models are equally capable.

### Document fidelity end state

The exported DOCX is a trustworthy deliverable:

- template-defined structure is preserved;
- headers, footers, sections, numbering, lists, tables, content controls, slots, and paragraph roles remain valid where supported;
- only accepted content appears;
- unresolved placeholders and validation failures are surfaced before export;
- citations and references remain traceable;
- output passes structural validation;
- synthetic regression fixtures open successfully in Word or LibreOffice;
- preview and final export are generated from the same accepted state.

### Trust and control end state

Users remain in control:

- credentials are session-scoped and redacted from logs and artifacts;
- the configured provider and data path are visible;
- CUI/non-CUI warnings are explicit;
- provider calls, tool calls, fallbacks, proposals, validation, approvals, and commits are auditable;
- interrupted work recovers without repeating completed side effects;
- edits are versioned;
- undo creates history rather than deleting it;
- diagnostic exports are sanitized;
- tools are allow-listed and read-only before approval.

The system explains uncertainty and limitations instead of presenting an unverified action as successful.

### Experience and polish end state

The workspace should feel calm, focused, and professional:

- the document is visually primary;
- the active target is obvious;
- actions appear in context;
- loading and recovery states are stable and informative;
- errors are actionable;
- empty states teach the next step;
- keyboard and screen-reader workflows are complete;
- narrower laptop layouts remain usable;
- advanced traces and provider diagnostics are available without dominating normal use;
- product branding is distinct from every provider brand.

Polish is measured primarily by clarity and predictability, not decoration.

### Technical end state

The implementation has:

- one product identity boundary;
- one provider-neutral execution contract;
- one capability/conformance system;
- one active-target model;
- one proposal and approval lifecycle;
- one version lineage model;
- target adapters for specialized content;
- durable recovery for long-running work;
- shared conformance tests for provider adapters;
- integrated lifecycle tests for critical user journeys;
- clear ownership boundaries between V2, standalone document editing, and any remaining legacy routes.

Large route components no longer own provider transport, persistence, proposal parsing, validation, and rendering simultaneously.

### Commercial and organizational optionality

Without requiring a backend, the architecture should leave room for:

- organization-specific branding;
- approved provider profiles;
- reusable drafting and review profiles;
- import/export of non-secret configuration;
- additional document types and target adapters;
- optional centrally managed policy in a future deployment;
- a future collaboration or backend layer that does not replace the local-first core.

These are architectural options, not commitments in the initial release.

### End-goal success criteria

The end state is achieved when representative users can complete these journeys:

1. **Template drafting**
   - Import a DOCX template, create a project, attach references, generate a draft, resolve placeholders, revise a section, and export a structurally valid DOCX.
2. **Freeform drafting**
   - Choose a style, draft from intent and sources, revise a block, undo the edit, and export.
3. **Existing-document revision**
   - Import an existing DOCX, select content, request an edit, review the diff, accept it, and export without unintended formatting loss.
4. **Grounded revision**
   - Select sources, strengthen a claim, inspect provenance, reject an unsupported proposal, and accept a corrected one.
5. **Provider portability**
   - Run the same edit through a cloud provider, a completion-only provider, and a tool-capable local model while receiving the same proposal and approval experience.
6. **Recovery**
   - Reload during a paused or interrupted operation, recover without replaying completed work, and continue to export.
7. **Trust**
   - Inspect an audit trail, identify the provider/model/sources/tools used, and verify that no credential appears in the trace.

Quantitative release targets:

- 100% of AI edits require explicit approval before canonical mutation.
- 100% of accepted edits create a recoverable version record.
- 100% of provider adapters pass the shared completion conformance suite.
- Tool-capable adapters pass tool-call and tool-result continuation conformance.
- Completion-only providers pass the prompt-only proposal contract suite.
- Critical lifecycle integration tests pass for template, freeform, and existing-document targets.
- No known credential leakage in logs, traces, audit exports, or IndexedDB.
- No unresolved P0/P1 accessibility defects in the primary workflow.
- Synthetic export fixtures open successfully and pass structural validation.

---

## Outcome

The milestone is complete when a user can:

1. Open a template-based or freeform project.
2. Select a section, paragraph, or freeform block.
3. Choose a quick action or enter a custom instruction.
4. See which context and sources will be used.
5. Run the edit through any compatible configured provider.
6. Review a structured proposal and visual diff.
7. Accept, reject, or revise it.
8. Undo an accepted change.
9. Reload at any point without losing the session.
10. Export a DOCX containing only accepted content.
11. Change providers or local models without changing the editing workflow.
12. Use native tool calling when it works and receive the same approval workflow through prompt-only fallback when it does not.

The experience should use the product's own identity while describing Ask Sage, GenAI.mil, OpenRouter, and Local OpenAI as providers.

---

## Non-Goals

- Do not rename the `asksage` provider ID, `AskSageClient`, provider-specific API routes, or provider capability descriptions.
- Do not rename the IndexedDB database in the initial rebrand. Renaming `asksage-doc-writer` would strand existing browser data without a migration.
- Do not rename existing session-storage keys until a compatibility read/write migration exists.
- Do not rewrite `Documents.tsx`, `ProjectDetail.tsx`, the DOCX parser, or the export assembler as part of the first editing slice.
- Do not allow background AI edits to commit automatically.
- Do not add collaborative cloud storage or a backend.
- Do not promise that every provider supports every action. Availability remains capability- and model-aware.
- Do not equate an OpenAI-compatible `/v1` surface with verified tool compatibility; local and hosted implementations vary.
- Do not send provider-specific request fields from shared drafting or editing code.
- Do not require native tool use for correctness. Prompt-only proposal generation remains the universal baseline.
- Do not perform a repository-wide replacement of “Ask Sage”; provider-specific references must remain.

---

## Product and Brand Principles

### Positioning

The product is a local-first, provider-flexible drafting and document-revision workbench. Its identity should emphasize:

- trustworthy drafting rather than chat;
- structured Word-document fidelity;
- local control and explicit approval;
- traceable use of sources;
- provider choice;
- suitability for professional and regulated workflows without claiming universal certification.

### Brand architecture

Use three distinct naming layers:

1. **Product brand**
   - The application name, window title, navigation brand, welcome heading, export metadata, and documentation title.
2. **Provider brand**
   - Ask Sage, GenAI.mil, OpenRouter, and Local OpenAI names and capability descriptions.
3. **Technical compatibility identifiers**
   - Existing package name, IndexedDB name, storage keys, provider IDs, schema URLs, and historical file/module names.

Only layer 1 changes in the initial rebrand.

### Working identity

Until a final name is approved, code should use a neutral internal identity:

```ts
export interface ProductIdentity {
  name: string;
  shortName: string;
  descriptor: string;
  mark: string;
  supportUrl?: string;
}

export const PRODUCT_IDENTITY: ProductIdentity = {
  name: 'Draft Workspace',
  shortName: 'Draft',
  descriptor: 'Local-first document drafting and revision',
  mark: 'D',
};
```

“Draft Workspace” is a temporary implementation label, not the final recommended brand.

### Naming decision gate

Before shipping a permanent public name:

- define the primary audience and whether government-specific positioning belongs in the brand or only in provider/security copy;
- shortlist three to five names;
- check obvious trademark conflicts;
- check domain and package-name availability;
- test pronunciation, spelling, and acronym collisions;
- verify the name does not imply Ask Sage affiliation;
- verify it still fits non-CUI local and commercial-provider workflows;
- select the name and record the decision in an ADR or product note.

Candidate exploration may include concepts such as craft, structure, provenance, revision, or document workbench. Candidate names must not be committed to product UI until the checks above are completed.

---

## Interaction Model

### Active target

The workspace owns exactly one active editing target:

```ts
export type DraftSelection =
  | {
      kind: 'template_section';
      projectId: string;
      templateId: string;
      sectionId: string;
    }
  | {
      kind: 'draft_paragraph';
      projectId: string;
      templateId: string;
      sectionId: string;
      paragraphIndex: number;
    }
  | {
      kind: 'freeform_block';
      projectId: string;
      blockId: string;
    }
  | {
      kind: 'freeform_paragraph';
      projectId: string;
      blockId: string;
      paragraphIndex: number;
    };
```

Selection rules:

- Scrolling may update the active section only when the user has not pinned a more specific target.
- Clicking content pins that target.
- Escape clears a paragraph-level selection back to its containing section/block.
- Project navigation clears the selection synchronously.
- Chat, command palette, action bar, sources pane, and draft pane consume the same selection.
- Hidden, stale, or deleted targets fail closed and ask the user to select again.

### Edit lifecycle

```text
Select target
  → choose action / write instruction
  → review context and provider capability
  → create durable editing turn
  → build proposal
  → deterministic validation
  → preview diff
  → accept / reject / revise
  → commit new version
  → optional undo
  → export accepted state
```

### Quick actions

Initial actions:

- Rewrite
- Tighten
- Expand
- Change audience
- Improve clarity
- Strengthen source support
- Custom instruction

Actions are presets that produce explicit instructions. They do not bypass the shared editing runner.

### Approval states

The UI must distinguish:

- preparing;
- running;
- validating;
- awaiting approval;
- accepted;
- rejected;
- failed;
- interrupted;
- superseded.

No toast alone should represent an edit state. Toasts may summarize a durable state transition but are not the source of truth.

---

## Provider Portability and Tool-Use Strategy

### Compatibility tiers

Support providers through explicit tiers rather than a binary supported/unsupported flag:

| Tier | Minimum contract | Editing behavior |
|---|---|---|
| Completion | Text chat/completion | Prompt-only proposal with deterministic parsing and repair |
| Structured output | Completion plus reliable JSON/object output | Typed proposal without a repair round when valid |
| Native tools | Canonical function tools and tool results | Bounded tool-assisted editing loop |
| Grounded | File upload, datasets, live search, or local extraction | Source-aware drafting and citation support |
| Embeddings | Embedding endpoint | Semantic source selection |

Every configured endpoint must support at least the Completion tier. Higher tiers are discovered per provider, endpoint, and selected model.

### Provider families

The architecture should accommodate:

- Ask Sage through its existing first-party adapter;
- GenAI.mil through its existing completion adapter;
- OpenRouter through its existing OpenAI-compatible adapter and model metadata;
- local OpenAI-compatible servers:
  - Ollama;
  - llama.cpp;
  - LM Studio;
  - vLLM;
  - LocalAI;
  - other user-supplied `/v1` endpoints;
- direct OpenAI-compatible hosted endpoints;
- future non-OpenAI wire formats, such as Anthropic-style or Gemini-style APIs, through isolated adapters.

Named providers are examples and conformance targets, not permission to hard-code shared workflow logic around them.

### Canonical provider contract

Shared drafting and editing code consumes one contract:

```ts
export interface PortableLLMClient {
  readonly providerId: ProviderId;
  readonly endpointId: string;
  getModels(): Promise<ModelInfo[]>;
  complete(input: CanonicalCompletionInput): Promise<CanonicalCompletionResult>;
  completeStructured<T>(
    input: CanonicalStructuredInput<T>,
  ): Promise<CanonicalStructuredResult<T>>;
  runToolTurn(
    input: CanonicalToolTurnInput,
  ): Promise<CanonicalToolTurnResult>;
  embed?(input: CanonicalEmbeddingInput): Promise<CanonicalEmbeddingResult>;
  probe(model: string): Promise<ModelConformanceReport>;
}
```

Adapters translate canonical messages and tools to the provider wire format and translate responses back. Provider response shapes must not leak into recipe stages, graph nodes, target adapters, or React components.

### Canonical tool envelope

```ts
export interface CanonicalToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchema;
}

export interface CanonicalToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

export interface CanonicalToolResult {
  toolCallId: string;
  name: string;
  content: string;
  isError?: boolean;
}
```

Requirements:

- Preserve tool-call IDs across assistant and tool-result turns.
- Validate tool arguments before execution.
- Reject unknown tools and extra privileged operations.
- Never execute tools directly from unvalidated text.
- Bound tool rounds, tool calls per round, argument size, output size, and elapsed time.
- Keep tools read-only until the proposal approval boundary.
- Record sanitized tool calls/results in the durable execution journal.

### Runtime conformance probing

Provider and model marketing metadata is advisory. A probe should verify:

- model listing;
- basic chat completion;
- JSON or structured output;
- single tool call;
- multiple tool calls where claimed;
- tool-result continuation;
- malformed-argument behavior;
- streaming compatibility if used;
- embeddings;
- context-window/model metadata when available.

Probe results are cached by provider, normalized base URL, and model ID with a timestamp and probe version. Changing the endpoint, model, authentication configuration, or probe version invalidates the result.

### Local tool-use behavior

Local endpoints frequently expose OpenAI-compatible routes but differ in model templates and tool-call output. Therefore:

- tool use is enabled only after a successful live probe for the selected model;
- the UI distinguishes server support from selected-model support;
- users see probe warnings and the detected fallback path;
- malformed native tool output triggers one bounded normalization attempt, then downgrades to prompt-only execution;
- a downgrade never repeats completed tool side effects;
- tool capability can be disabled manually for a problematic model;
- endpoint presets are conveniences, not capability assertions.

### Browser-only constraint

Because this remains a zero-backend SPA:

- endpoints must be reachable from the browser;
- endpoints must allow the app origin or `file://` use through appropriate CORS configuration;
- HTTPS pages cannot call insecure HTTP endpoints because of mixed-content rules;
- provider keys remain session-only and are sent directly to the configured endpoint;
- providers that prohibit browser-origin requests require a user-managed local gateway or a future separately designed backend;
- custom headers must be allow-listed and must never be persisted with credential values in IndexedDB or diagnostics.

The connection UI must test reachability and explain CORS, TLS, authentication, and model/tool failures separately.

---

## Delivery Strategy

Deliver in six increments:

1. **Identity boundary and naming decision**
   - Centralized product strings, temporary neutral identity, provider/product distinction, compatibility constraints.
2. **Template-section editing vertical slice**
   - Shared selection, custom instruction, durable proposal, validation, preview, accept/reject, reload recovery.
3. **Undo and revision history**
   - Version lineage, latest accepted state, undo, superseded proposal handling.
4. **Freeform and paragraph targeting**
   - Reuse the same controller and lifecycle for freeform blocks and narrower paragraph selections.
5. **Grounding and provenance**
   - Explicit source scope, citation strengthening, provenance display, capability-aware availability.
6. **Polish, accessibility, and consolidation**
   - Keyboard workflow, responsive layout, command palette integration, Documents alignment, legacy retirement criteria.

Do not add all quick actions before the custom-instruction vertical slice is complete and recoverable.

### Executable phase plans

The detailed implementation sequence is maintained in:

1. `2026-07-27-drafting-workbench-phase-0-identity-boundaries.md`
2. `2026-07-27-drafting-workbench-phase-1-provider-portability.md`
3. `2026-07-27-drafting-workbench-phase-2-template-editing-slice.md`
4. `2026-07-27-drafting-workbench-phase-3-versioning-recovery.md`
5. `2026-07-27-drafting-workbench-phase-4-targets-grounding.md`
6. `2026-07-27-drafting-workbench-phase-5-polish-release.md`

Program ordering, cross-phase invariants, and exit-gate rules are in
`2026-07-27-drafting-workbench-program.md`.

---

## Proposed File Structure

### Product identity

- Create `src/lib/product/identity.ts`
- Create `src/lib/product/identity.test.ts`
- Create `src/lib/product/compatibility.ts`
- Modify `src/App.tsx`
- Modify `src/components/Shell.tsx`
- Modify `src/components/v2/V2Sidebar.tsx`
- Modify `src/components/v2/V2Layout.tsx`
- Modify `src/components/v2/V2FirstRun.tsx`
- Modify `src/routes/Welcome.tsx`
- Modify `index.html`
- Modify `README.md`
- Modify `package.json` description only in the first pass
- Modify visible tests

### Portable provider layer

- Create `src/lib/provider/conformance/types.ts`
- Create `src/lib/provider/conformance/probe.ts`
- Create `src/lib/provider/conformance/probe.test.ts`
- Create `src/lib/provider/conformance/store.ts`
- Create `src/lib/provider/conformance/store.test.ts`
- Create `src/lib/provider/conformance/tool-probe.ts`
- Create `src/lib/provider/conformance/tool-probe.test.ts`
- Create `src/lib/provider/portable-types.ts`
- Create `src/lib/provider/portable-client.ts`
- Create `src/lib/provider/portable-client.test.ts`
- Create `src/lib/provider/adapters/openai-compatible.ts`
- Create `src/lib/provider/adapters/openai-compatible.test.ts`
- Create `src/lib/provider/adapters/asksage.ts`
- Create `src/lib/provider/adapters/asksage.test.ts`
- Create `src/lib/provider/adapters/genai-mil.ts`
- Create `src/lib/provider/adapters/genai-mil.test.ts`
- Create `src/lib/provider/adapters/openrouter.ts`
- Create `src/lib/provider/adapters/openrouter.test.ts`
- Modify `src/lib/provider/factory.ts`
- Modify `src/lib/provider/types.ts`
- Modify `src/lib/provider/capabilities.ts`
- Modify `src/lib/provider/openai_compat.ts`
- Modify provider client tests
- Modify `src/lib/state/auth.ts`
- Modify `src/components/v2/V2SettingsView.tsx`
- Modify `src/components/v2/V2SettingsAdvanced.tsx`

### Selection and action state

- Create `src/components/v2/drafting/DraftSelectionContext.tsx`
- Create `src/components/v2/drafting/DraftSelectionContext.test.tsx`
- Create `src/components/v2/drafting/selection.ts`
- Create `src/components/v2/drafting/selection.test.ts`
- Create `src/components/v2/drafting/actions.ts`
- Create `src/components/v2/drafting/actions.test.ts`
- Create `src/components/v2/drafting/DraftActionBar.tsx`
- Create `src/components/v2/drafting/DraftActionBar.test.tsx`
- Create `src/components/v2/drafting/InstructionComposer.tsx`
- Create `src/components/v2/drafting/InstructionComposer.test.tsx`
- Modify `src/components/v2/V2ProjectWorkspace.tsx`
- Modify `src/components/v2/V2DraftPane.tsx`
- Modify `src/components/v2/V2SourcesPane.tsx`
- Modify `src/components/v2/V2ChatPane.tsx`
- Modify `src/components/v2/V2CommandPalette.tsx`

### Editing target adapters

- Create `src/lib/agentic-editing/targets/template-section.ts`
- Create `src/lib/agentic-editing/targets/template-section.test.ts`
- Create `src/lib/agentic-editing/targets/draft-paragraph.ts`
- Create `src/lib/agentic-editing/targets/draft-paragraph.test.ts`
- Create `src/lib/agentic-editing/targets/freeform-block.ts`
- Create `src/lib/agentic-editing/targets/freeform-block.test.ts`
- Create `src/lib/agentic-editing/targets/freeform-paragraph.ts`
- Create `src/lib/agentic-editing/targets/freeform-paragraph.test.ts`
- Modify `src/lib/agentic-editing/types.ts`
- Modify `src/lib/agentic-editing/runner.ts`
- Modify focused agentic-editing tests

### Proposal and approval UI

- Create `src/components/v2/drafting/EditSessionPanel.tsx`
- Create `src/components/v2/drafting/EditSessionPanel.test.tsx`
- Create `src/components/v2/drafting/EditProposalCard.tsx`
- Create `src/components/v2/drafting/EditProposalCard.test.tsx`
- Create `src/components/v2/drafting/DraftDiffPreview.tsx`
- Create `src/components/v2/drafting/DraftDiffPreview.test.tsx`
- Create `src/components/v2/drafting/RevisionTimeline.tsx`
- Create `src/components/v2/drafting/RevisionTimeline.test.tsx`
- Create `src/components/v2/drafting/useDraftEditingSession.ts`
- Create `src/components/v2/drafting/useDraftEditingSession.test.tsx`
- Reuse or adapt `src/components/AgentTraceInspector.tsx`
- Reuse diff logic from `src/lib/document/diffRender.ts`

### Versions and undo

- Create `src/lib/agentic-editing/versions.ts` if not already supplied by the related agentic plan
- Create `src/lib/agentic-editing/versions.test.ts`
- Modify `src/lib/agentic-editing/store.ts`
- Modify `src/lib/agentic-editing/store.test.ts`
- Modify `src/lib/db/schema.ts` only if existing version records cannot represent draft targets

### Workflow tests and styling

- Create `src/components/v2/drafting/V2DraftEditingWorkflow.test.tsx`
- Modify `src/components/v2/V2SmokeTest.test.tsx`
- Modify `src/v2.css`
- Modify `src/index.css` only for shared classic-route components
- Modify `release/index.html` only through `npm run build`

---

## Task 0: Product Naming and Compatibility Decision

**Deliverables:**

- Create a short product-positioning note under `docs/`.
- Create a naming scorecard.
- Record the selected public name or approve the temporary neutral identity for an internal release.

- [ ] Define primary and secondary user groups.
- [ ] Decide whether the initial distribution is internal-only or publicly discoverable.
- [ ] Define five required brand attributes and five prohibited implications.
- [ ] Generate a shortlist without using provider names.
- [ ] Perform trademark, domain, repository, and package-name checks outside the codebase.
- [ ] Review names with at least one representative user.
- [ ] Record the decision and effective release.
- [ ] Preserve “Ask Sage” only as a provider name and capability label.

**Naming scorecard:**

| Criterion | Weight |
|---|---:|
| Clear professional drafting association | 20% |
| Provider neutrality | 20% |
| Distinctiveness and searchability | 15% |
| Easy spelling and pronunciation | 10% |
| Appropriate for regulated environments | 15% |
| Room for editing, research, and export features | 10% |
| Domain/package availability | 10% |

**Gate:** Implementation may proceed with `Draft Workspace` as a temporary identity. A permanent public release requires a completed naming decision.

---

## Task 1: Centralize Product Identity

**Files:**

- Create `src/lib/product/identity.ts`
- Create `src/lib/product/identity.test.ts`
- Modify visible product-brand surfaces

- [ ] Add `PRODUCT_IDENTITY` as the source of truth for product-facing strings.
- [ ] Replace “Ask Sage Document Writer” in the shell, welcome heading, V2 sidebar, document title, and metadata.
- [ ] Keep provider-card and provider-help references to Ask Sage unchanged.
- [ ] Change the V2 rail mark through identity configuration.
- [ ] Update the HTML title and meta description.
- [ ] Update README positioning and affiliation disclaimer.
- [ ] Add a compatibility comment identifying names that must not be renamed yet:
  - IndexedDB database;
  - session-storage keys;
  - provider ID;
  - schema URLs;
  - `lib/asksage`;
  - historical plans/specifications.
- [ ] Add tests that product identity never equals a provider label.

**Acceptance criteria:**

- A normal user sees a provider-neutral product name.
- Ask Sage remains accurately represented as a provider.
- Existing browser data and saved projects remain available.

---

## Task 2: Establish One Shared Active Target

**Files:**

- Create selection context and tests.
- Modify V2 workspace panes.

- [ ] Move active-section ownership out of duplicate observers in `V2ProjectWorkspace` and `V2DraftPane`.
- [ ] Implement the `DraftSelection` discriminated union.
- [ ] Add selection normalization against current project data.
- [ ] Make section headings and paragraph containers selectable with visible focus/selection treatment.
- [ ] Make freeform blocks selectable.
- [ ] Update Sources pane from the shared selection.
- [ ] Expose selection to Chat and command palette.
- [ ] Clear selection on project navigation.
- [ ] Add keyboard focus semantics without interfering with native text selection.
- [ ] Persist only a safe target reference, not DOM nodes or ranges.

**Acceptance criteria:**

- Every pane agrees about the active target.
- A stale target never edits a different section.
- Selection works with mouse and keyboard.

---

## Task 2A: Establish Portable Provider and Tool-Use Conformance

This task must land before the editing vertical slice begins. The edit runner may not depend directly on a concrete provider client.

**Files:**

- Create portable provider contracts, adapters, conformance probes, storage, and tests.
- Modify provider factory, capabilities, auth state, and V2 connection settings.

- [ ] Inventory every method currently consumed through `LLMClient`.
- [ ] Separate canonical app types from Ask Sage response types without breaking compatibility imports in one step.
- [ ] Define canonical completion, structured-output, tool-call, tool-result, usage, finish-reason, and embedding types.
- [ ] Wrap existing Ask Sage, GenAI.mil, OpenRouter, and Local OpenAI clients with adapters.
- [ ] Keep existing clients operational while migrating callers incrementally.
- [ ] Add a generic OpenAI-compatible provider profile with:
  - display name;
  - base URL;
  - optional API key;
  - optional organization/project headers;
  - model ID;
  - safe, allow-listed non-secret headers;
  - local/remote privacy classification.
- [ ] Add presets for common local servers without assuming capabilities.
- [ ] Implement versioned runtime probes for completion, JSON, tool calls, tool results, and embeddings.
- [ ] Persist non-secret conformance reports in IndexedDB.
- [ ] Keep API keys and secret custom headers in session memory/storage only.
- [ ] Add manual capability overrides with a visible “user override” status.
- [ ] Make provider/model selection show:
  - reachable/unreachable;
  - completion support;
  - structured-output support;
  - native tool support;
  - embeddings support;
  - active editing path;
  - warnings and last probe time.
- [ ] Implement native-tool → prompt-only runtime downgrade.
- [ ] Ensure downgrade resumes from the last durable checkpoint and does not replay completed tools.
- [ ] Add sanitized trace events for capability choice, probe results, downgrade reason, and fallback completion.
- [ ] Add conformance fixtures for:
  - standard OpenAI tool calls;
  - Ollama-style compatible responses;
  - llama.cpp/LM Studio-style responses;
  - missing tool IDs;
  - stringified and object arguments;
  - malformed JSON;
  - text-only “tool call” imitations;
  - parallel calls;
  - rejected tool-result continuation.

**Acceptance criteria:**

- The same editing request can run through Ask Sage, OpenRouter, a keyless local endpoint, and a completion-only provider without UI branching.
- Native tool use is enabled per model only after conformance succeeds or a user explicitly overrides it.
- Failure of native tools produces a visible, durable downgrade rather than a lost edit.
- Shared editing code imports only canonical provider contracts.

---

## Task 3: Add the Contextual Action Bar and Instruction Composer

**Files:**

- Create action metadata, action bar, composer, and tests.
- Modify V2 draft and chat panes.

- [ ] Show the action bar only when a valid editable target exists.
- [ ] Implement Custom instruction first.
- [ ] Implement quick actions as instruction presets.
- [ ] Show target name and scope in the composer.
- [ ] Show active provider and model.
- [ ] Show whether sources, project notes, datasets, or live search will be included.
- [ ] Allow the user to deselect optional sources before running.
- [ ] Disable unavailable actions with an inline reason.
- [ ] Prevent duplicate submission while a target has an active turn.
- [ ] Support Escape to close and restore focus to the selected content.

**Acceptance criteria:**

- Users always know what will change.
- No visible action is a placeholder.
- Capability limitations are explained before submission.

---

## Task 4: Implement the Template-Section Editing Adapter

**Files:**

- Create `template-section.ts` and tests.
- Modify agentic runner contracts only as necessary.

- [ ] Load an immutable snapshot of the selected draft section.
- [ ] Include template schema, section intent, existing paragraphs, validation issues, project description, selected sources, and relevant neighboring-section summaries.
- [ ] Map model proposals to typed draft-paragraph operations.
- [ ] Reject operations targeting another project, template, or section.
- [ ] Preserve paragraph roles, levels, slot semantics, and citation markers.
- [ ] Run deterministic validation before preview.
- [ ] Store proposal and validation artifacts durably.
- [ ] Do not update `db.drafts` during proposal generation.
- [ ] Add token, size, and operation-count limits.

**Acceptance criteria:**

- The same input snapshot and proposal produce a deterministic preview.
- Invalid operations never reach canonical drafts.
- Provider failures leave the original draft untouched.

---

## Task 5: Build Preview, Accept, Reject, and Revise

**Files:**

- Create session panel, proposal card, draft diff, hook, and tests.

- [ ] Display before/after paragraph diffs.
- [ ] Distinguish content edits, structural changes, formatting-role changes, and citation changes.
- [ ] Display deterministic warnings before approval.
- [ ] Provide Accept, Reject, and Revise instruction controls.
- [ ] Make Accept an explicit persistence transaction.
- [ ] Mark prior pending proposals superseded when a revision succeeds.
- [ ] Persist rejection reason only when the user chooses to provide one.
- [ ] Restore awaiting-approval state after reload.
- [ ] Display provider/model, time, source scope, and validation summary.
- [ ] Provide a link to the detailed agent trace without exposing credentials.

**Acceptance criteria:**

- Canonical draft content changes only after Accept.
- Reloading during generation or approval produces an understandable recoverable state.
- Reject never mutates the draft.

---

## Task 6: Add Versioning and Undo

**Files:**

- Add or complete version helpers and timeline UI.

- [ ] Save a parent-linked version for every accepted edit.
- [ ] Store enough information to reconstruct the accepted draft state without replaying provider calls.
- [ ] Add Undo last accepted edit.
- [ ] Implement undo as a new version, preserving history.
- [ ] Prevent undo while another proposal is being committed.
- [ ] Display concise revision summaries.
- [ ] Allow reopening the diff for a historical revision.
- [ ] Define retention and deletion behavior for artifacts.

**Acceptance criteria:**

- Accept → reload → undo restores the exact prior content.
- Undo does not erase audit history.
- Export always uses the latest accepted version.

---

## Task 7: Add Freeform and Paragraph Targets

**Files:**

- Create freeform and paragraph adapters with tests.
- Modify selection rendering and shared session UI.

- [ ] Adapt freeform H1 blocks without changing unrelated blocks.
- [ ] Preserve heading boundaries and paragraph roles.
- [ ] Add paragraph-level editing for template drafts.
- [ ] Add paragraph-level editing for freeform drafts.
- [ ] Define neighboring context for paragraph edits.
- [ ] Prevent paragraph index drift by snapshot/version checks.
- [ ] Rebase only when deterministic identity checks succeed; otherwise ask the user to rerun.
- [ ] Reuse the same preview, approval, version, and undo components.

**Acceptance criteria:**

- Target-specific code lives in adapters rather than branching throughout UI components.
- A stale paragraph proposal cannot overwrite newer content.

---

## Task 8: Add Grounding and Citation Provenance

**Files:**

- Extend context builders, source pane, proposal metadata, and citation UI.

- [ ] Show the source scope before execution.
- [ ] Select relevant chunks for the active target.
- [ ] Preserve source IDs through proposal and preview.
- [ ] Make Strengthen source support available only when grounded context exists.
- [ ] Validate citation markers against attached source chunks.
- [ ] Warn when the model introduces unsupported citations or factual claims.
- [ ] Render citation provenance in the diff and accepted draft.
- [ ] Keep Ask Sage dataset/live-search features behind provider capabilities.
- [ ] Provide local-file grounding for providers without Ask Sage file APIs.

**Acceptance criteria:**

- Users can tell why a source was included and where it influenced the edit.
- Missing or invalid provenance is visible before acceptance.

---

## Task 9: Integrate Command Palette, Chat, and Keyboard Workflow

**Files:**

- Modify V2 command palette and chat.
- Add shortcut and accessibility tests.

- [ ] Make the command palette consume action availability from the shared controller.
- [ ] Reintroduce slash commands only for implemented actions.
- [ ] Route chat instructions to the active target when explicitly requested.
- [ ] Keep ordinary chat notes distinct from edit instructions.
- [ ] Add a shortcut to open the instruction composer.
- [ ] Add shortcuts for accept, reject, and preview only when safe and discoverable.
- [ ] Announce running and approval states through `aria-live`.
- [ ] Preserve focus across modal/panel transitions.
- [ ] Ensure commands include target scope in accessible labels.

**Acceptance criteria:**

- Direct controls, keyboard shortcuts, chat, and command palette invoke the same action implementation.
- A user cannot accidentally treat a project note as an approved edit.

---

## Task 10: Visual Polish and Responsive Behavior

**Files:**

- Modify `src/v2.css` and focused components.

- [ ] Add a clear but restrained active-target treatment.
- [ ] Keep the document surface visually primary.
- [ ] Use one consistent pattern for pending, warning, error, and accepted states.
- [ ] Add skeletons for proposal and diff loading.
- [ ] Avoid layout jumps when the action/session panel opens.
- [ ] Support narrower screens by collapsing Sources and Chat into tabs or drawers.
- [ ] Keep approval controls visible while reviewing long diffs.
- [ ] Add empty states for no selection, no draft, no sources, and no revisions.
- [ ] Verify contrast, focus indicators, reduced motion, and zoom at 200%.
- [ ] Remove obsolete styles for deleted placeholder commands.

**Acceptance criteria:**

- The editing lifecycle is readable without relying on color alone.
- The interface remains usable at common laptop widths and keyboard-only.

---

## Task 11: Workflow Tests and Release Hardening

**Files:**

- Create `V2DraftEditingWorkflow.test.tsx`.
- Add synthetic project/draft fixtures.
- Update audit and user documentation.

- [ ] Test template section select → instruct → proposal → accept → export.
- [ ] Test proposal → reject leaves the draft unchanged.
- [ ] Test accept → reload → undo.
- [ ] Test interrupted generation recovery.
- [ ] Test project navigation while a turn is pending.
- [ ] Test freeform block edit parity.
- [ ] Test stale paragraph proposal rejection.
- [ ] Test keyless Local OpenAI path.
- [ ] Test a completion-only provider fallback path.
- [ ] Test source-supported citation strengthening.
- [ ] Test provider capability-disabled actions.
- [ ] Run the same edit contract suite against every adapter.
- [ ] Test local native tool use through a conforming OpenAI-compatible fixture.
- [ ] Test malformed local tool output downgrades without replay.
- [ ] Test completion-only prompt fallback produces the same proposal contract.
- [ ] Test endpoint/model changes invalidate cached conformance.
- [ ] Test CORS, mixed-content, authentication, timeout, and unknown-model errors produce distinct guidance.
- [ ] Test secret custom headers never enter IndexedDB, logs, traces, exports, or error copy.
- [ ] Test product branding separately from provider branding.
- [ ] Open exported synthetic DOCX files in Word or LibreOffice.

**Acceptance criteria:**

- The critical editing lifecycle is covered at the integrated component level.
- Provider calls remain mocked at the client boundary.
- Tests exercise persistence rather than replacing the editing runner with a success stub.

---

## Task 12: Consolidate Surfaces After the Vertical Slice

This task begins only after the V2 edit lifecycle is stable.

- [ ] Compare V2 with the standalone Documents editing workflow.
- [ ] Extract shared proposal, trace, approval, and diff components.
- [ ] Keep target-specific rendering in adapters.
- [ ] Determine whether standalone Documents becomes a V2 library/workspace mode or remains a specialized route.
- [ ] Stop adding new editing UX to legacy `ProjectDetail.tsx`.
- [ ] Define legacy removal criteria and a data-safety checklist.
- [ ] Remove legacy UI only after workflow parity and at least one release of validation.

**Acceptance criteria:**

- Users learn one editing lifecycle.
- Shared behavior has one implementation.
- Different document targets retain the specialized logic they actually need.

---

## Persistence and Migration Rules

- Keep the existing IndexedDB database name during the product rebrand.
- Add schema versions only for new stores or indexes, not for product strings.
- Never store DOM selection objects.
- Every proposal references a base version.
- Every accepted edit creates a new immutable version.
- Recovery uses persisted artifacts and checkpoints; it does not repeat completed provider calls.
- Historical provider and model metadata remains attached to each turn.
- Product renaming must not rewrite old audit records merely for display consistency.
- If storage keys are renamed later, read old and new keys for at least one release and write the new key after successful migration.

---

## Security and Trust Requirements

- Never include API keys in prompts, traces, artifacts, errors, or diagnostic exports.
- Show the configured provider before sending an edit.
- Preserve existing CUI/non-CUI provider warnings.
- Do not imply that the rebranded product itself grants CUI authorization.
- Label Ask Sage as the configured CUI-authorized option only where that claim is currently supported.
- Keep all approval and version state local unless a future backend is explicitly designed.
- Truncate or content-address large trace artifacts according to the existing retention design.
- Make source provenance inspectable without exposing unrelated document content.
- Treat all model-produced tool calls and arguments as untrusted input.
- Keep the tool registry allow-listed and read-only before approval.
- Require a separate product design and approval policy before adding mutating or network-capable tools.
- Do not allow arbitrary user-supplied JavaScript, shell commands, URLs, or filesystem paths as tool implementations.
- Redact authorization headers and secret custom headers at the adapter boundary.

---

## Quality Gates

After each task:

```powershell
npm run typecheck
npm test
```

After each UI vertical slice:

```powershell
npm run build
```

Before release:

- [ ] All tests pass.
- [ ] Production build succeeds.
- [ ] `release/index.html` is regenerated from the reviewed source state.
- [ ] Existing IndexedDB projects remain readable.
- [ ] Existing session credentials remain readable.
- [ ] Ask Sage, GenAI.mil, OpenRouter, and Local OpenAI connection surfaces display correctly.
- [ ] Generic OpenAI-compatible cloud and local profiles pass their supported conformance tiers.
- [ ] Native-tool and prompt-only paths converge on the same validated proposal contract.
- [ ] Runtime tool downgrade does not duplicate completed actions.
- [ ] Browser reachability failures distinguish CORS, TLS/mixed content, authentication, and endpoint errors where observable.
- [ ] No product-facing screen implies the app is Ask Sage itself.
- [ ] No provider-specific technical reference was incorrectly generalized.
- [ ] Accept/reject/undo behavior is verified with synthetic template and freeform projects.
- [ ] Export contains only accepted content.
- [ ] File-based `HashRouter` operation remains functional.

---

## Rollout Plan

### Internal alpha

- Temporary neutral identity allowed.
- Template-section custom instruction only.
- Preview, accept, reject, reload recovery required.
- Feature flag or advanced opt-in acceptable.

### Internal beta

- Final product name selected.
- Undo and freeform block support required.
- Quick actions and source scope visible.
- Keyboard and accessibility review complete.

### General release

- Paragraph targeting and provenance complete.
- Full workflow integration tests pass.
- Legacy route is clearly labeled or retired.
- User documentation and screenshots use the final identity.
- Trademark/domain review recorded.

---

## Success Measures

Track locally or through user studies without adding telemetry by default:

- time from opening a draft to accepting the first edit;
- percentage of proposals accepted, revised, or rejected;
- recovery success after reload/interruption;
- number of edits completed before export;
- frequency of undo;
- citation warnings caught before acceptance;
- user ability to identify the active target and provider;
- exported-document formatting defects;
- support requests caused by provider/product branding confusion.

Initial qualitative targets:

- A first-time user can select and revise a section without instruction.
- A user can explain what will change before running an edit.
- A user can recover an interrupted edit without repeating earlier work.
- A user can distinguish the product from the Ask Sage provider.

---

## Definition of Done

This plan is complete when:

1. The product has an approved provider-neutral identity.
2. Product branding is centralized and compatibility identifiers remain stable.
3. V2 has one shared active-target model.
4. Template sections, paragraphs, and freeform blocks use one edit lifecycle.
5. Every AI edit is previewed and explicitly accepted before commit.
6. Accepted changes are versioned and undoable.
7. Pending sessions survive reload without replaying completed work.
8. Source scope and citation provenance are visible.
9. Chat, command palette, keyboard shortcuts, and direct controls share one action controller.
10. The critical select → instruct → preview → accept/reject → reload → undo → export workflows are covered by integration tests.
11. Exported DOCX files contain only accepted, validated content.
12. The production build, strict typecheck, complete test suite, accessibility checks, and compatibility checks pass.
13. Provider adapters pass a shared conformance suite.
14. Local models with verified tool use can execute the bounded read-only tool loop.
15. Completion-only and malformed-tool providers fall back safely to the same approval workflow.

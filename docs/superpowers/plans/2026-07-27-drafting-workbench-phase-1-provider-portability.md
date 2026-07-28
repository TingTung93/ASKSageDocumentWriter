# Phase 1 — Portable Provider and Local Tool-Use Foundation

> **Phase rule:** Completion is the universal correctness baseline. Native tool use is enabled only after endpoint/model conformance succeeds and must downgrade without losing work.

**Goal:** Make drafting and editing execution portable across first-party, hosted, and local APIs through one canonical contract, with runtime capability probing and safe native-tool fallback.

**Depends on:** Phase 0 provider/product boundary decisions.

**Produces:** Portable provider types, adapters, conformance reports, local and generic OpenAI-compatible profiles, bounded tool transport, and a shared adapter test suite.

## Scope

### Included

- Canonical completion, structured-output, tool, embedding, usage, and error types
- Adapters for existing providers
- Generic OpenAI-compatible provider profiles
- Local-server presets
- Runtime endpoint/model conformance
- Conformance persistence
- Manual overrides
- Tool-use normalization and safe downgrade
- Connection diagnostics

### Excluded

- Editing-target tools
- Draft selection and approval UI
- Mutating tools
- Arbitrary user-authored tools
- Backend proxy or hosted credential service
- Guaranteed direct-browser support for providers that reject CORS

## Files

- Create `src/lib/provider/portable-types.ts`
- Create `src/lib/provider/portable-client.ts`
- Create `src/lib/provider/portable-client.test.ts`
- Create `src/lib/provider/conformance/types.ts`
- Create `src/lib/provider/conformance/probe.ts`
- Create `src/lib/provider/conformance/probe.test.ts`
- Create `src/lib/provider/conformance/tool-probe.ts`
- Create `src/lib/provider/conformance/tool-probe.test.ts`
- Create `src/lib/provider/conformance/store.ts`
- Create `src/lib/provider/conformance/store.test.ts`
- Create `src/lib/provider/adapters/openai-compatible.ts`
- Create `src/lib/provider/adapters/openai-compatible.test.ts`
- Create adapters/tests for Ask Sage, GenAI.mil, and OpenRouter
- Modify `src/lib/provider/factory.ts`
- Modify `src/lib/provider/types.ts`
- Modify `src/lib/provider/capabilities.ts`
- Modify `src/lib/provider/openai_compat.ts`
- Modify `src/lib/state/auth.ts`
- Modify V2 connection/settings components
- Modify `src/lib/db/schema.ts` only for non-secret conformance storage
- Modify `release/index.html` through the build

## Task 1.1 — Canonical Contract

Define canonical:

- messages and roles;
- completion input/result;
- structured-output input/result;
- finish reasons;
- usage;
- normalized errors;
- tool definitions, calls, and results;
- embeddings;
- provider/model/endpoint identity;
- effective capability report.

- [ ] Ensure shared contracts import no provider response types.
- [ ] Preserve compatibility shims while callers migrate.
- [ ] Document unsupported versus unknown capabilities.
- [ ] Represent capability source: declared, probed, or overridden.

## Task 1.2 — Existing Provider Adapters

- [ ] Wrap Ask Sage without changing provider-specific dataset/search/file behavior.
- [ ] Wrap GenAI.mil as completion-first.
- [ ] Wrap OpenRouter while preserving model metadata, pricing, and attribution requirements.
- [ ] Wrap Local OpenAI through the generic OpenAI-compatible adapter.
- [ ] Route factory construction through the portable interface.
- [ ] Migrate one low-risk caller and one recipe test before broad migration.

## Task 1.3 — Generic OpenAI-Compatible Profiles

Support:

- display name;
- normalized base URL;
- optional API key;
- explicit model;
- safe custom header names;
- session-only secret header values;
- local/remote classification;
- timeout;
- context override;
- manual capability override.

Provide presets for Ollama, llama.cpp, LM Studio, vLLM, and LocalAI. Presets configure URLs only; they do not assert tool capability.

## Task 1.4 — Runtime Conformance

Probe independently:

1. endpoint reachability;
2. model listing;
3. basic completion;
4. JSON/structured output;
5. single tool call;
6. tool-result continuation;
7. multiple calls where claimed;
8. embeddings;
9. streaming only if production uses it.

- [ ] Cache by provider, normalized URL, model, auth configuration fingerprint, and probe version.
- [ ] Never persist secret values or reversible secret fingerprints.
- [ ] Invalidate on endpoint/model/configuration/probe-version change.
- [ ] Distinguish CORS, mixed content, authentication, timeout, unknown model, malformed response, and unsupported feature where observable.

## Task 1.5 — Tool Transport and Fallback

- [ ] Validate tool names and JSON arguments.
- [ ] Preserve tool-call IDs.
- [ ] Reject unknown tools.
- [ ] Bound rounds, calls, payload size, output size, and elapsed time.
- [ ] Add one normalization attempt for malformed compatible output.
- [ ] Downgrade to prompt-only after normalization failure.
- [ ] Persist a checkpoint before executing each tool round.
- [ ] Never replay completed tool results during downgrade or reload.
- [ ] Journal capability choice and downgrade reason.

## Task 1.6 — Settings and Diagnostics

Show:

- endpoint reachability;
- server and model identity;
- completion, structured-output, tools, tool continuation, and embeddings;
- declared versus verified status;
- last probe time/version;
- active execution path;
- warnings;
- manual override state.

## Shared Conformance Suite

Every adapter must pass:

- normal completion;
- system and multi-turn messages;
- usage normalization;
- timeout and abort;
- HTTP and malformed-response errors;
- structured output or declared fallback;
- tool calls or declared fallback;
- secret redaction.

Fixtures must cover standard OpenAI, missing IDs, string/object arguments, parallel calls, text-only tool imitations, rejected continuations, and malformed JSON.

## Quality Gates

```powershell
npm run typecheck
npm test
npm run build
```

Manual matrix:

- Ask Sage completion
- GenAI.mil completion
- OpenRouter completion
- Keyless local completion
- One verified local tool-capable model
- One local completion-only model
- Generic hosted OpenAI-compatible endpoint where browser CORS permits

## Exit Gate

Phase 1 is complete when:

1. Shared workflow code can depend on one portable client.
2. Existing providers pass shared completion conformance.
3. Generic local/hosted OpenAI-compatible profiles work.
4. Native tool support is verified per model.
5. Tool failure downgrades without duplicate side effects.
6. Secrets remain out of durable and diagnostic storage.
7. Tests and production build pass.

## Handoff to Phase 2

Phase 2 receives a portable client and effective capability report. It must not branch on concrete provider IDs except for explicitly provider-specific grounding features.


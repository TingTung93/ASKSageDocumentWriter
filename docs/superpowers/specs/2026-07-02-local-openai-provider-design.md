# Local OpenAI-Compatible Provider Design

## Purpose

Add a local LLM provider so the app can use user-managed OpenAI-compatible endpoints from Ollama, llama.cpp server, LM Studio, vLLM, SGLang, or similar backends. The feature keeps the app zero-backend: it connects from the browser to a configured `/v1` endpoint and does not install, launch, or manage local model servers.

This provider is for non-certified local workflows unless the user has separately approved the endpoint and model for their environment. Ask Sage remains the only provider labeled for DHA health.mil tenant work.

## Scope

The first branch adds a third provider, `local_openai`, beside `asksage` and `openrouter`.

In scope:

- OpenAI-compatible chat completions through `/v1/chat/completions`.
- Model listing through `/v1/models`.
- Optional embeddings through `/v1/embeddings` when the backend supports it.
- Optional OpenAI-style `tools` and `tool_choice` passthrough.
- Probe-based detection for chat, JSON parsing behavior, tool calls, and embeddings.
- Backend presets for Ollama, llama.cpp, LM Studio, and custom endpoints.
- Local model recommendations and warnings in Settings.

Out of scope:

- Installing Ollama, llama.cpp, or model files.
- Starting or stopping local backend processes.
- Streaming responses.
- Multi-modal upload workflows.
- Local RAG server management.
- Treating local endpoints as CUI-authorized by default.

## Current Code Fit

The existing provider boundary is already suitable for this feature.

- `src/lib/provider/types.ts` defines `ProviderId`, `ProviderCapabilities`, `LLMClient`, and optional embedding support.
- `src/lib/provider/factory.ts` chooses a concrete provider from auth state.
- `src/lib/provider/openrouter.ts` already maps the app's `QueryInput` shape to OpenAI-compatible chat completions and maps OpenAI responses back to `QueryResponse`.
- `src/lib/asksage/types.ts` already includes OpenAI-style tools, tool choices, and tool calls.
- `src/routes/Settings.tsx`, `src/routes/Welcome.tsx`, and `src/components/v2/V2SettingsView.tsx` are the main connection and model-selection surfaces.

The local provider should reuse these contracts rather than introducing a separate local drafting path.

## Provider Architecture

Create `src/lib/provider/local_openai.ts` with a `LocalOpenAIClient` that implements `LLMClient`.

Constructor inputs:

- `baseUrl`: required, defaulted by UI presets.
- `apiKey`: optional. When blank, no `Authorization` header is sent.
- `fetchImpl`: optional test injection.
- `timeoutMs`: same five-minute default used by current providers.

Capabilities:

- `fileUpload: false`
- `dataset: false`
- `liveSearch: false`

The provider may implement `embed()` when the endpoint responds successfully to `/v1/embeddings`. Because local backend support changes with server and model configuration, embeddings should be detected by a probe instead of assumed from provider id.

Refactor the reusable OpenAI mapping from `OpenRouterClient` into a shared module:

- `src/lib/provider/openai_compat.ts`

Responsibilities:

- Convert `QueryInput` to OpenAI chat messages.
- Preserve `temperature`, `tools`, and `tool_choice`.
- Convert OpenAI chat completion responses to `QueryResponse`.
- Parse `message.tool_calls`.
- Strip Markdown JSON fences for `queryJson`.
- Map `/v1/models` rows to `ModelInfo`.
- Map `/v1/embeddings` responses to ordered embedding vectors.

`OpenRouterClient` keeps OpenRouter-specific behavior in its own file:

- Required bearer token.
- Optional attribution headers.
- Web search plugin mapping from `QueryInput.live`.
- Pricing and capability extraction from OpenRouter model metadata.

`LocalOpenAIClient` keeps local-specific behavior in its own file:

- Optional bearer token.
- No web search plugin mapping.
- Local audit endpoint names.
- Local model capability enrichment from known presets.

## Canonical Tool Format

The app should use the OpenAI tool-calling envelope as the canonical internal representation for LLM tools across every provider:

- Request tools: `tools: OpenAITool[]`
- Request tool policy: `tool_choice: 'none' | 'auto' | 'required' | OpenAIToolChoice`
- Response tool calls: `tool_calls: OpenAIToolCall[]`
- Tool result turns: conversation messages with `user: 'tool'`, `tool_call_id`, `name`, and `message`

Provider adapters are responsible for converting this canonical shape at the edge:

- OpenAI-compatible providers, including OpenRouter and Local OpenAI, pass the canonical shape through directly.
- Ask Sage receives the same canonical fields through `QueryInput` when the server supports tool calls.
- Providers that do not support tools leave the request unchanged only when the call site does not require tools; tool-required workflows must fail fast with a clear unsupported-capability error.

This keeps future agent workflows independent of backend-specific tool schemas. The rest of the app should not introduce provider-specific tool envelopes.

## Connection UX

Add Local OpenAI as a provider option in the connection views.

Backend presets:

- Ollama: `http://localhost:11434/v1`
- llama.cpp: `http://localhost:8080/v1`
- LM Studio: `http://localhost:1234/v1`
- Custom OpenAI-compatible endpoint: user-entered URL

The API key field is optional for this provider. The UI should say that most local backends do not require a key, but remote or protected endpoints may.

Add a "Test local endpoint" flow for Local OpenAI:

1. `GET /models`
2. One tiny `POST /chat/completions` call
3. One tool-call probe using a harmless fake function
4. One optional `/embeddings` probe

Display probe results as capability facts:

- Models reachable
- Chat completion works
- Tool calls observed
- JSON output parseable
- Embeddings available

Warn when the configured base URL is not localhost, `127.0.0.1`, or `[::1]` because prompts may leave the machine or cross the LAN.

## Model Capabilities

Extend `ModelCapabilities` only where the app has a call site that needs the information. The initial local extension should support display and filtering without breaking current providers.

Recommended additions:

- `tool_calling?: boolean`
- `json_output?: boolean`
- `recommended_vram_gb?: 8 | 16 | 24`
- `backend_notes?: string`

Local model metadata is best-effort. `/v1/models` responses from local backends are often sparse, so the app should merge known presets by normalized model id and keep unknown models selectable with warnings.

Stage compatibility remains based on current minimum context floors:

- Synthesis: 16K
- Drafting: 32K
- Critic: 16K
- Cleanup: 8K
- Schema edit: 8K

For local models, the UI must distinguish advertised context from practical context. Full 128K or 256K context may require lower quantization, more VRAM, smaller batch sizes, or CPU offload. The picker should warn that context fit depends on backend flags and KV cache memory.

## Tool Calling

The branch should validate tool-call transport but should not introduce user-facing agent tools yet.

All tool probes and future local-agent workflows should use the canonical OpenAI tool format described above. Local backend differences are adapter concerns, not workflow concerns.

Tool probe:

- Function name: `lookup_policy`
- Parameters: `{ "document_type": "PWS" }`
- Prompt: ask the model to call the function for a PWS policy lookup.

Expected success:

- The response contains OpenAI-style `message.tool_calls` with `lookup_policy`.

Tolerated local variants:

- Empty assistant content plus `tool_calls`.
- Assistant prose plus `tool_calls`.
- JSON-looking tool-call text in `message.content`, shown as "tool calls not natively parsed" rather than treated as full success.

The main drafting pipeline can continue to use `queryJson` for structured output. Tool calling support is a provider capability for future workflows, not a requirement for current drafting calls.

## Recommended Local Models

Model fit estimates assume common 4-bit quantized local deployments and leave room for runtime overhead. They are guidance, not hard validation.

| VRAM | Primary recommendations | Use case |
| ---: | --- | --- |
| 8 GB | `qwen3:4b`, `qwen3:8b`, `llama3.1:8b`, `gemma3:4b` | Cleanup, schema edits, smaller drafting runs, first local setup |
| 16 GB | `qwen3:14b`, `mistral-nemo`, `gemma3:12b` | Balanced document drafting, better review quality, larger prompts |
| 24 GB | `mistral-small3.1:24b`, `qwen3:30b`, `qwen3:32b`, `gemma3:27b` | Highest-quality local drafting and review with practical latency |

Model notes:

- Qwen3 is the best first recommendation for local tool-call experiments because its model documentation emphasizes tool-call capabilities and OpenAI-compatible endpoints.
- Mistral NeMo is a strong 12B/128K local option and is exposed in Ollama as a tools-capable model.
- Mistral Small 3.1 24B is the preferred 24GB-tier recommendation where quality matters and the user can fit the model.
- Llama 3.1 8B remains a useful 8GB baseline with tool-use positioning, but tool-call quality should be validated per backend.
- Gemma 3 models are useful long-context local options, but tool behavior should be proven by the probe rather than assumed.

Primary references checked during design:

- Ollama OpenAI compatibility documentation: `https://docs.ollama.com/openai`
- Ollama tools documentation: `https://docs.ollama.com/capabilities/tools`
- llama.cpp server README: `https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md`
- Qwen3 model documentation: `https://huggingface.co/Qwen/Qwen3-8B`
- Ollama model library pages for Qwen3, Llama 3.1, Mistral NeMo, Mistral Small 3.1, and Gemma 3

## Data And State

Provider selection continues to live in session storage through `src/lib/state/auth.ts`.

Persisted app settings continue to store per-stage model overrides. No backend capability probe results should be persisted in IndexedDB in the first branch because local server behavior can change outside the app.

Session-only local capability state will live in `src/lib/state/auth.ts` beside the current provider, base URL, API key, and model catalog state:

- `localProbe?: LocalEndpointProbeResult`
- `lastCheckedAt`
- `baseUrl`
- `model`
- `chatOk`
- `toolCallsOk`
- `jsonOk`
- `embeddingsOk`
- `warnings`

## Error Handling

Connection errors should mention the common local causes:

- Endpoint not running.
- Wrong base URL or missing `/v1`.
- Browser CORS rejection.
- Model not loaded or misspelled.
- Backend does not support the requested field.

For CORS failures, the browser usually exposes only a generic network error. The message should tell the user to check backend CORS settings rather than implying bad credentials.

For tool-call failures, do not block normal use. Show the model as usable for drafting if chat completions and `queryJson` work, but mark tool calls as unavailable or unverified.

For embeddings failures, fall back to existing non-embedding local extraction/chunk selection behavior where possible.

## Testing

Add unit tests for:

- `ProviderId` accepts `local_openai`.
- `defaultBaseUrlFor('local_openai')` returns the Ollama preset.
- `createLLMClient()` returns `LocalOpenAIClient`.
- Blank local API key omits the `Authorization` header.
- Non-blank local API key sends `Authorization: Bearer <key>`.
- `/v1/models` maps sparse rows to `ModelInfo`.
- Chat completions map content and usage to `QueryResponse`.
- OpenAI tool calls map to `QueryResponse.tool_calls`.
- `queryJson` strips code fences and parses JSON.
- Local network errors include endpoint and likely CORS guidance.
- Embeddings are ordered by response `index`.

Add UI tests for:

- Local OpenAI appears in the connection provider choices.
- Ollama, llama.cpp, and LM Studio presets fill expected base URLs.
- API key is optional for Local OpenAI.
- Settings model rows show local capability warnings.
- Non-localhost base URLs show a privacy warning.

Verification commands:

- `npm run typecheck`
- `npm test`
- `npm run build`

## Rollout Plan

Commit sequence for the implementation branch:

1. `feat: add local openai provider client`
2. `feat: share openai-compatible provider mapping`
3. `feat: add local provider connection presets`
4. `feat: add local endpoint capability probes`
5. `feat: show local model recommendations`
6. `docs: add local llm setup guide`
7. `chore: rebuild release artifact`

## Acceptance Criteria

- A user running Ollama at `http://localhost:11434/v1` can connect without an API key, refresh models, select a model, and run existing drafting/cleanup flows that depend only on `LLMClient`.
- A user running llama.cpp server at `http://localhost:8080/v1` can connect through the same provider.
- The app does not attempt Ask Sage-only dataset, file upload, training, or live-search features while Local OpenAI is active.
- Tool-call support is tested and displayed as a capability, but normal drafting is not blocked when tool calls are unavailable.
- Local provider warnings make privacy, CORS, sparse model metadata, and practical VRAM limits explicit.
- Existing Ask Sage and OpenRouter behavior remains unchanged.

# Local LLM Setup

The Local OpenAI provider connects this app to user-managed OpenAI-compatible `/v1`
endpoints. The app does not install, start, stop, manage, validate, accredit, or
certify local model servers. You are responsible for running the model backend,
choosing models, securing the endpoint, and confirming the data path is approved
for your use case.

## Supported Endpoint Shapes

Use a base URL that points at the OpenAI-compatible `/v1` API root:

- Ollama: `http://localhost:11434/v1`
- llama.cpp server: `http://localhost:8080/v1`
- LM Studio: `http://localhost:1234/v1`
- Custom OpenAI-compatible endpoint ending at `/v1`

Most local endpoints do not require an API key. If your endpoint is protected,
enter the key in the app; requests will include `Authorization: Bearer <key>`.

## CUI And Privacy

Ask Sage remains the only provider in this app labeled for DHA `health.mil`
tenant work. The Local OpenAI provider is non-CUI by default unless your
organization separately approves the workstation, model, backend, storage,
network path, and data flow for the intended data.

Treat non-localhost endpoints as higher risk. If the base URL host is not
`localhost`, `127.0.0.1`, or `[::1]`, confirm where prompts, documents, generated
content, logs, telemetry, and model outputs can travel before using the provider.

## Recommended Model Tiers

These tiers are practical starting points for common workstation memory sizes.
Actual fit depends on model architecture, quantization, context length, batch
size, GPU/CPU split, and backend settings.

| Memory | Models |
| --- | --- |
| 8 GB | `qwen3:4b`, `qwen3:8b`, `llama3.1:8b`, `gemma3:4b` |
| 16 GB | `qwen3:14b`, `mistral-nemo`, `gemma3:12b` |
| 24 GB | `mistral-small3.1:24b`, `qwen3:30b`, `qwen3:32b`, `gemma3:27b` |

Advertised context windows are not the same as a practical VRAM fit. Running the
full 128K or 256K context advertised by some models may require lower
quantization, smaller batch sizes, CPU offload, reduced concurrency, or KV cache
tuning. If the backend becomes slow, fails to load, or runs out of memory, lower
the context length first.

## Tool Calls

The app uses OpenAI-format tools internally, including `tools`, `tool_choice`,
assistant `tool_calls`, and tool result messages. Run the endpoint check before
relying on workflows that need tools.

Some local backends generate JSON-looking text that resembles a tool request but
do not return native OpenAI `tool_calls`. Those responses are not equivalent to
OpenAI-format tool calls and may not work with app workflows that expect
structured tool call messages.

## Troubleshooting

- Endpoint is not running: start the local model server and confirm it is
  listening on the configured port.
- Wrong base URL: make sure the configured URL includes `/v1`.
- CORS error: configure the local backend to allow browser requests from the app
  origin.
- Model missing: pull, download, or select the model in the local backend before
  using it in the app.
- Tool probe failed: choose a backend and model that return native OpenAI
  `tool_calls`, or avoid workflows that require tool support.

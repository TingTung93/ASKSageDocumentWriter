# Draft Workspace

Provider-neutral, zero-backend single-page application that parses DOCX templates, drafts structured Word content, and edits finished DOCX files with the user's chosen AI provider. Current adapters include [Ask Sage](https://asksage.ai/), GenAI.mil, [OpenRouter](https://openrouter.ai/), and OpenAI-compatible local services.

> **Brand and affiliation:** Draft Workspace is an independent product working name. Ask Sage is one supported provider and retains its own name wherever provider-specific capabilities are described. This project is not affiliated with, endorsed by, or sponsored by Ask Sage or the Defense Health Agency. No proprietary or sensitive information is included in this repository.

## Quick start

```bash
npm install
npm run dev          # Vite dev server at localhost:5173
npm run build        # Produces release/index.html (single-file SPA)
npm test             # Vitest suite
```

The production artifact is **`release/index.html`** — a single self-contained HTML file (~2.5 MB, ~745 KB gzipped) that runs from `file://`, an internal share, or any static server. No backend required; all state lives in the browser's IndexedDB.

## What it does

1. **Template ingestion** — Drop a DOCX template. The parser extracts structural headings, placeholders, and body regions into a `TemplateSchema`.
2. **Semantic synthesis** — An LLM call enriches the structural schema with per-section intent, instructions, shared input fields, and dependencies.
3. **Project creation** — Pick templates, fill shared inputs (office symbol, POC, dates, etc.), attach reference files.
4. **Drafting** — The orchestrator walks sections in dependency order. Each section gets a tailored prompt with prior-section summaries, relevant reference chunks (selected via embedding-based cosine similarity or Jaccard fallback), and template example text. The prompt contract emits semantic roles, rich runs, tables, lists, and page breaks rather than raw OOXML.
5. **Validation + review** — Deterministic validators repair safe structure issues before export, while LLM review checks assembled drafts for contradictions, terminology drift, and missing cross-references.
6. **Assembly + export** — Drafts are spliced back into the original DOCX skeleton preserving formatting, headers, footers, tables, and page breaks. Finished-document cleanup uses typed edit operations so accepted edits preserve surrounding Word structure.
7. **Approval-gated revision** — Select a drafted section or supported paragraph/block target, enter an instruction, inspect the proposal and provenance, then explicitly accept or reject it. Accepted changes create immutable versions; Undo creates another version rather than erasing history.

## Architecture

```
src/
  components/     UI primitives (Shell, DropZone, Spinner, ErrorBoundary, ...)
  routes/         Page-level components (Welcome, Templates, Projects, Documents, Settings, ...)
  lib/
    agent/        Agentic recipe orchestration (multi-stage pipeline runner)
    asksage/      Ask Sage API client + types
    db/           Dexie (IndexedDB) schema -- all state lives here
    debug/        In-page log buffer (circular, 500 entries)
    document/     DOCX editing pipeline (writer, edit ops, diff overlay, prepass)
    docx/         Shared structured block IR, validation, formatting inventory, OOXML builders
    draft/        Section drafting (drafter, critic loop, cross-section review)
    edit/         Schema-level edit operations
    export/       DOCX assembly + download
    project/      Project context, chunking, reference selection
    provider/     Portable provider contract, adapters, capability probes, local presets
    settings/     Persistent settings store (IndexedDB)
    share/        Bundle import/export (.asdbundle.json)
    state/        Zustand stores (auth, toast)
    template/     DOCX parsing (structural) + synthesis (semantic via LLM)
    usage.ts      Token tracking + cost rollup
  test/           Synthetic test fixtures + setup
```

## Provider support

| Provider | Auth | Features |
|----------|------|----------|
| **Ask Sage** | API key | Tenant-dependent completion, datasets, file extraction, RAG, web search |
| **GenAI.mil** | API key | Completion-first STARK gateway |
| **OpenRouter** | Bearer token | Commercial model routing, embeddings, optional web search |
| **OpenAI-compatible** | Optional | Hosted or local completion; structured output/tools enabled only after verification |

You bring your own credentials. Secret values are held only in browser session
storage and are sent only to the configured provider. Non-secret model and
capability results may be retained locally. Provider suitability depends on
your organization's data-classification and authorization rules.

See [User Guide](docs/user-guide.md), [Local LLM Setup](docs/local-llm-setup.md),
and [Route Ownership](docs/route-ownership.md).

## Testing

```bash
npm test             # Run the full suite
npm run test:watch   # Watch mode
npm run typecheck    # tsc --noEmit
```

Tests use synthetic DOCX fixtures (generated by `src/test/fixtures/generate-fixtures.ts`) to exercise the parser, synthesis, drafter, structured DOCX backbone, document editor, chunking, cost tracking, and export pipelines. UI components are tested for basic render and interaction.

## License

[MIT](LICENSE)

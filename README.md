# ASKSageDocumentWriter

Zero-backend single-page application that parses DOCX templates into JSON schemas and generates long-form government contracting documents (PWS, market research, J&A) via the user's own Ask Sage API key.

## Quick start

```bash
npm install
npm run dev          # Vite dev server at localhost:5173
npm run build        # Produces release/index.html (single-file SPA)
npm test             # Vitest suite
```

The production artifact is **`release/index.html`** — a single self-contained HTML file (~2.3 MB, ~688 KB gzipped) that runs from `file://`, an internal share, or any static server. No backend required.

## Architecture

```
src/
  components/     UI primitives (Shell, DropZone, Spinner, ErrorBoundary, …)
  routes/         Page-level components (Welcome, Templates, Projects, Documents, Settings, …)
  lib/
    agent/        Agentic recipe orchestration (multi-stage pipeline runner)
    asksage/      Ask Sage API client + types
    db/           Dexie (IndexedDB) schema — all state lives here
    debug/        In-page log buffer (circular, 500 entries)
    document/     DOCX editing pipeline (writer, edit ops, diff overlay, prepass)
    draft/        Section drafting (drafter, critic loop, cross-section review)
    edit/         Schema-level edit operations
    export/       DOCX assembly + download
    project/      Project context, chunking, reference selection
    provider/     LLM client abstraction (Ask Sage + OpenRouter)
    settings/     Persistent settings store (IndexedDB)
    share/        Bundle import/export (.asdbundle.json)
    state/        Zustand stores (auth, toast)
    template/     DOCX parsing (structural) + synthesis (semantic via LLM)
    usage.ts      Token tracking + cost rollup
  test/           Test fixtures (DOCX templates, JSON fixtures)
```

## Pipeline overview

1. **Template ingestion** — Drop a DOCX. The parser extracts structural headings, placeholders, and body regions into a `TemplateSchema`.
2. **Semantic synthesis** — One LLM call enriches the structural schema with per-section intent, instructions, shared input fields, and dependencies.
3. **Project creation** — User picks templates, fills shared inputs (office symbol, POC, etc.), attaches reference files.
4. **Drafting** — The orchestrator walks sections in dependency order. Each section gets a tailored prompt with prior-section summaries, reference chunks (Jaccard-selected), and template example text. Optional critic loop re-drafts until quality converges.
5. **Cross-section review** — One LLM call checks the assembled draft for contradictions, terminology drift, and missing cross-references.
6. **Style consistency** — Final formatting normalization pass (role usage, table structure, heading hierarchy).
7. **Assembly + export** — Drafts are spliced back into the original DOCX preserving all formatting, headers, footers, and page breaks.

## Provider support

| Provider | Auth | Features |
|----------|------|----------|
| **Ask Sage** (health.mil tenant) | API key in `x-access-tokens` | Full: datasets, file extraction, RAG, web search |
| **OpenRouter** | Bearer token | Completion only: query, queryJson, web search via plugins |

## Deployment constraints

- Target: DHA workstations where `file://` is the only viable origin
- Module scripts on `file://` get CORS-rejected by Ask Sage — build emits IIFE, strips `type="module"`
- No hosted alternatives — network policy blocks gov-tenant traffic from external HTTPS origins

## Testing

```bash
npm test             # Run all 341+ tests
npm run test:watch   # Watch mode
npm run typecheck    # tsc --noEmit
```

Tests cover the data/logic layers (parser, synthesis, drafter, critic, chunking, cost, export) with real DHA template fixtures. UI components are tested for basic render and interaction.

## License

Internal use — DHA Medical Treatment Facility contracting support tool.

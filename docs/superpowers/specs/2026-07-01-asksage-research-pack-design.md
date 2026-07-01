# Ask Sage Research Pack Design

## Purpose

Improve project research without adding MCP, a backend bridge, browser scraping, or third-party search keys. The app will make better use of Ask Sage's existing `live` web search by creating a structured research pack, extracting citations, and attaching the generated pack as project context for later drafting and editing.

## Scope

This feature is Ask Sage-first. It is enabled only when the active provider supports `liveSearch`. OpenRouter and other providers keep the current drafting behavior and see a disabled state explaining that research packs require Ask Sage live search.

The feature does not fetch pages directly from the browser. Citations come from Ask Sage response references, model-cited URLs in the response body, and structured citation fields returned by the research prompt.

## User Flow

On the project detail page, a Research panel appears above drafting. The user enters a research objective, optional focus questions, and a depth:

- Quick: one live-search pass.
- Standard: broader prompt with more findings.
- Deep: asks for follow-up gaps and a larger citation table, still within one controlled Ask Sage call for the first release.

When the user runs research, the app calls Ask Sage with `live: 2`, `dataset: 'none'`, and the selected drafting model override if present. The prompt requests JSON containing a query plan, findings, citations, gaps, and Markdown reference-pack text.

## Data Model

Add optional project storage:

- `research_packs?: ResearchPack[]`

Each `ResearchPack` contains an id, objective, depth, generated timestamp, findings, citations, gaps, raw references, and Markdown text. A generated Markdown file is also attached to `context_items` as a `ProjectContextFile` with cached `extracted_text`, so current drafting/extraction code can consume it without a `/server/file` round trip.

## Components

- `src/lib/research/types.ts`: shared research types.
- `src/lib/research/citations.ts`: URL extraction, citation normalization, dedupe, and pack validation.
- `src/lib/research/asksage.ts`: prompt builder and Ask Sage live-search runner through the existing `LLMClient`.
- `src/lib/research/context.ts`: save a research pack and attach its Markdown to project context.
- `src/routes/ProjectDetail.tsx`: Research panel UI and result rendering.

## Error Handling

If the provider lacks live search, disable the action. If Ask Sage returns malformed JSON, surface a concise error. If findings have no citations, preserve the pack but show a warning in the UI. If attaching the generated reference file fails, keep the saved pack and show the attach error.

## Testing

Use TDD for:

- citation URL extraction and dedupe,
- research pack validation,
- generated Markdown context-file creation,
- Ask Sage research prompt request shape,
- basic Project Detail Research panel rendering.

Verification commands: targeted Vitest runs, `npm run typecheck`, full `npm test`, and `npm run build`.

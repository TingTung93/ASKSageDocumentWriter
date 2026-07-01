# Shared DOCX Formatting Backbone Design

## Overview

The LLM co-writing tools should share one formatting and structure backbone instead of handling template drafting, finished-document editing, and freeform DOCX writing as separate systems. The backbone will normalize DOCX style information, validate structured draft/edit output, and provide reusable OOXML construction and mutation helpers. Each workflow can then improve independently while relying on the same guarantees for styles, lists, tables, runs, page breaks, headers, footers, and export safety.

## Current Context

The repository already has three uneven DOCX paths:

- Template-based export in `src/lib/export/assemble.ts` preserves the source DOCX skeleton, supports role-tagged paragraphs, rich runs, list levels, real tables, and header/footer slot rewrites.
- Finished-document editing in `src/lib/document/edit.ts` and `src/lib/document/writer.ts` uses typed `DocumentEditOp` operations, chunked LLM review, paragraph anchors, and surgical OOXML mutation.
- Freeform writing in `src/lib/freeform/assemble.ts` builds a clean DOCX from scratch, but it uses simpler string-based XML builders and supports fewer formatting features than template export.

The desired direction is to make the LLM better at writing and editing formatted, structured DOCX files across all three paths without multiplying separate formatting implementations.

## Goals

1. Give the LLM a clear, validated document structure contract.
2. Preserve existing DOCX formatting whenever a template or uploaded document provides it.
3. Make generated DOCX structure richer: nested lists, styled headings, callouts, tables, inline runs, page breaks, and header/footer-safe edits.
4. Improve finished-document editing from text cleanup toward safe structural and formatting edits.
5. Bring freeform DOCX output up to the same formatting quality as template-based export.
6. Add deterministic validation before export so malformed LLM output is caught and repaired before it becomes a broken DOCX.

## Non-Goals

- Do not replace the existing Ask Sage/OpenRouter provider abstraction.
- Do not introduce a backend service.
- Do not attempt full Word layout fidelity or pixel-perfect pagination.
- Do not let the LLM emit raw OOXML. The model should emit typed JSON only.

## Architecture

### 1. Formatting Inventory

Create a shared formatting inventory module, likely under `src/lib/docx/formatting/`, that parses and normalizes reusable style signals from DOCX files:

- paragraph styles and inherited properties
- run styles, font families, sizes, color, bold/italic/underline defaults
- numbering definitions and usable list templates
- table templates, borders, cell margins, header-row examples, column counts
- page setup, margins, section properties
- header/footer parts and editable text slots
- content controls and bookmark-like structural anchors

The parser already extracts much of this in `src/lib/template/parser/`. The new layer should wrap the existing parser output into a workflow-neutral inventory that both assemblers and editing code can consume.

### 2. Structured Document IR

Define a stricter intermediate representation for LLM output, building on `DraftParagraph` and `DocumentEditOp`.

For drafting and freeform writing, keep paragraph roles but validate them as a `StructuredBlock[]` shape:

- `heading`
- `body`
- `bullet`
- `step`
- `quote`
- `note`
- `caution`
- `warning`
- `definition`
- `table`
- `page_break`

Tables should become first-class blocks instead of only consecutive `table_row` paragraphs. The current `table_row` format can remain as a compatibility input and be normalized into table blocks.

For editing, retain narrow operations but add higher-level safe structural ops:

- insert or replace a structured block range
- normalize list levels in a paragraph range
- convert paragraphs to a table
- apply a known style role instead of arbitrary style ids
- move a paragraph range only when anchors resolve uniquely

The IR must not expose raw OOXML to the LLM. It should expose semantic roles, levels, runs, table cells, and layout hints that are mapped through the formatting inventory.

### 3. Validation and Repair

Add a deterministic validator before assembly or edit application. It should produce actionable diagnostics and a repaired IR where safe.

Validation checks:

- role is allowed for the target section or workflow
- heading/list levels are integer and within supported bounds
- tables have consistent column counts after normalization
- cell shading, widths, and spans align with cell counts
- run text is non-empty when formatting is present
- page breaks are used only at structural boundaries
- style ids requested by the model exist in the inventory
- edit anchors resolve uniquely before mutation
- document-part edits skip drawing or complex-content paragraphs

Repair rules:

- clamp excessive levels
- pad short table rows
- drop invalid style overrides
- convert unsupported roles to `body`
- remove empty runs
- split unsafe table runs around intervening non-table blocks
- reject destructive structural edits when anchors are ambiguous

The UI should surface validator warnings near export/edit review instead of silently dropping important structure.

### 4. Shared OOXML Builders and Mutators

Extract reusable OOXML helpers from `src/lib/export/assemble.ts`, `src/lib/document/writer.ts`, and `src/lib/freeform/assemble.ts` into focused modules:

- paragraph construction
- run construction and run-property toggles
- table construction and table row cloning
- numbering/list selection
- style resolution
- header/footer text-slot mutation
- relationship and content-type updates for future image support
- XML parse/serialize helpers

Template export should continue clone-and-mutate behavior. Finished-document editing should continue surgical mutation. Freeform writing should move away from hand-built XML strings and use the same builders to create valid DOCX parts.

### 5. LLM Prompt and Tool Contract

Update drafting and editing prompts to describe capabilities in terms of the validated IR:

- The model chooses structure and semantic roles, not Word internals.
- The model can request formatting only through supported fields.
- The model sees a compact description of available styles, list templates, table examples, and header/footer slots.
- The model gets explicit examples for tables, nested lists, callouts, and inline runs.
- Finished-document editing prompts should separate “content edits,” “formatting edits,” and “structural edits” so the narrowest safe op is chosen.

Tooling should support a “plan then draft” loop for complex sections:

1. LLM proposes a section outline/structure plan.
2. Deterministic code validates whether the structure is supported.
3. LLM drafts final structured content against that approved structure.

This should be optional for simple sections to avoid unnecessary calls.

## Workflow Integration

### Template-Based Drafting and Export

Use the inventory derived from the uploaded template to tell the LLM what structures are available. Normalize LLM output into the structured IR, validate it, then map roles to template styles and list/table templates. Preserve the current section splice and header/footer slot rewrite approach.

Initial improvements:

- first-class table blocks normalized from existing `table_row` output
- better list-level validation
- explicit support for callout roles
- validator warnings shown before export
- structure-planning pass for complex sections only

### Finished-Document Editing

Keep typed `DocumentEditOp` as the application surface, but add a planning and validation layer before applying edits. The model should be able to propose richer structural fixes, but deterministic code must lower those proposals into narrow safe ops only when anchors and ranges resolve cleanly.

Initial improvements:

- role-based style changes instead of arbitrary style ids
- paragraph range anchors for multi-paragraph edits
- table normalization suggestions
- list normalization suggestions
- pre-apply validation report in the edit review UI

### Freeform DOCX Writing

Rebuild freeform assembly on shared OOXML builders. Freeform documents will use a default formatting inventory generated from built-in styles, then pass through the same structured IR validator as template drafts.

Initial improvements:

- real list numbering for bullets and steps
- rich run formatting parity with template export
- real table block support with header rows, widths, shading, and spans
- callout paragraph styles
- safer generated `styles.xml`, `numbering.xml`, and document relationships

## Error Handling

The backbone should fail closed:

- invalid LLM JSON still throws a clear parsing error
- invalid structure returns diagnostics and either repairs or blocks export
- ambiguous edit anchors block only the affected operation
- missing template styles fall back to `Normal` or the nearest known role style
- unsupported complex header/footer paragraphs are preserved untouched
- DOCX parse errors report the part name and parser failure

## Testing Strategy

Add tests at three levels:

1. Pure validator tests for malformed IR, repaired IR, and warnings.
2. OOXML unit tests that unzip generated DOCX output and assert paragraph, run, table, numbering, style, and relationship XML.
3. Workflow fixture tests using existing synthetic DOCX files under `src/test/fixtures/`.

Important test cases:

- nested bullets and numbered steps export with valid numbering
- mixed-format runs preserve expected toggles
- inconsistent table rows are padded or rejected deterministically
- freeform tables generate valid `word/document.xml`
- template export preserves headers, footers, styles, numbering, and page setup
- editing rejects ambiguous range moves
- no-op export remains byte-stable where the current contract requires it

## Rollout Plan

### Phase 1: Inventory and Validator

Create the shared formatting inventory and structured IR validator. Wire it into tests first, then use it in template export without changing visible behavior.

### Phase 2: Shared Builders

Extract paragraph, run, table, style, and list helpers from existing code. Keep public APIs stable and verify existing tests still pass.

### Phase 3: Template Drafting Upgrade

Normalize drafted paragraphs into structured blocks, add validator diagnostics, and improve prompts to use available formatting capabilities.

### Phase 4: Editing Upgrade

Add higher-level edit planning, lower safe proposals into existing `DocumentEditOp` operations, and show validation results in the review flow.

### Phase 5: Freeform Upgrade

Move freeform DOCX generation onto the shared builders and default inventory. Add richer style and numbering parts.

### Phase 6: Optional Advanced Content

After the shared builder handles relationships and content types consistently, add image/chart/diagram insertion from the existing tool-suite expansion concept.

## Acceptance Criteria

- Existing template export, document editing, and freeform tests continue to pass.
- New validator tests cover repairable and blocking structure errors.
- Freeform DOCX output supports the same core paragraph/run/table/list features as template export.
- LLM prompts describe one consistent structured output contract.
- DOCX export never relies on raw OOXML from the model.
- Unsupported formatting degrades visibly and safely instead of corrupting the document.

# Letterhead slot rewrite + semantic style notes

**Date:** 2026-04-14
**Status:** Approved — ready for implementation plan

## Context

Commit `109ca2f` disabled drafting into DOCX header/footer parts entirely to stop the assembler from destroying `<w:drawing>` seals, cascading tiny-font banner formatting onto body runs, and dropping `word/media/` + `word/_rels/*.rels` entries. That fix is a net win for template fidelity but it means letterhead text (unit name, office symbol, address, memorandum-for, subject line) can no longer be customized by the drafter.

This spec restores letterhead text drafting with a per-slot rewrite model that is structurally incapable of destroying drawings, and adds semantic style notes to the synthesizer so the drafter can match the template's visual conventions.

## Goals

1. Letterhead text paragraphs are draftable; drawing-bearing paragraphs are physically impossible to alter.
2. Drafter has access to per-section style notes (textual conventions) and a structured visual-style summary, both produced by the semantic synthesizer.
3. Assembler uses the structured visual-style as a trustworthy fallback when the template's own `pPr`/`rPr` looks degenerate (the Arial-7pt banner-line cascade bug that motivated this work).
4. Existing templates in user Dexie continue to work without re-synthesis; benefits of the new fields unlock on re-synthesis.

## Non-goals

- Changing how body sections' range detection works.
- Rewriting the semantic synthesis LLM choice or its caching strategy.
- UI work beyond a "re-synthesize for full support" indicator on the template card.
- Table / SDT / bookmark fill region kinds.

## Architecture

Four subsystems change. Boundaries:

- **Parser** (`src/lib/template/parser/`) — emits per-paragraph classification and formatting for header/footer parts.
- **Synthesizer** (`src/lib/template/synthesis/`) — emits `style_notes` + `visual_style` per body section, plus a new `document_parts[]` array with per-slot intent/style guidance.
- **Assembler** (`src/lib/export/assemble.ts`) — rewrites document_part content per-slot (replace text runs inside existing paragraphs, never remove the paragraph itself); uses `visual_style` as a narrow fallback for body section formatting.
- **Drafter** (`src/lib/draft/`) — consumes `style_notes` in body prompts; new per-slot prompt path for document_part sections; new `DocumentPartDraft` union variant.

### Data flow

```
DOCX upload
  └─► Parser
        ├─ word/document.xml        → body paragraph_range + pPr/rPr
        └─ word/header*.xml / footer*.xml
               └─ paragraph_details[] (text, alignment, font, size, has_drawing, has_complex_content)
  └─► Synthesizer (LLM, one call)
        ├─ sections[]         with style_notes + visual_style
        └─ document_parts[]   with slots[] (text-only paragraphs only, drawings skipped)
  └─► Merger → TemplateSchema persisted in Dexie

Drafting
  └─ body section     → existing path + style_notes/visual_style in prompt
  └─ document_part    → new path, per-slot prompt, returns DocumentPartDraft

Assembly
  └─ body section     → existing splice + visual_style fallback for degenerate rPr/pPr
  └─ document_part    → per-slot text replacement inside existing <w:p>; drawings untouched
```

### Boundary invariants

- Parser does NOT modify `docx_bytes`.
- Assembler mutates `word/document.xml` and `word/header*.xml` / `word/footer*.xml` only. Media, rels, styles, numbering, theme pass through untouched.
- Synthesizer runs once per template; its output is cached in `TemplateSchema`.
- Drafter reads `TemplateSchema` and context; does not touch `docx_bytes`.

## Type changes

### Synthesizer output (`src/lib/template/synthesis/types.ts`)

```typescript
export interface LLMVisualStyle {
  font_family: string | null;                    // e.g. "Times New Roman"
  font_size_pt: number | null;                   // e.g. 12
  alignment: 'left' | 'center' | 'right' | 'justify' | null;
  numbering_convention: 'none' | 'manual_numeric' | 'manual_lettered' | 'ooxml_list' | null;
}

export interface LLMSemanticSection {
  // ...existing fields unchanged...
  style_notes: string;      // NEW: free-form textual conventions for drafter
  visual_style: LLMVisualStyle;  // NEW: structured style for assembler fallback
}

export interface LLMSemanticDocumentPartSlot {
  slot_index: number;
  source_text: string;     // echoed; merger rejects synthesis on mismatch
  intent: string;
  style_notes: string;
  visual_style: LLMVisualStyle;
}

export interface LLMSemanticDocumentPart {
  part_path: string;              // "word/header1.xml"
  placement: 'header' | 'footer';
  slots: LLMSemanticDocumentPartSlot[];  // text-only source paragraphs
}

export interface LLMSemanticOutput {
  style: LLMSemanticStyle;
  sections: LLMSemanticSection[];
  document_parts: LLMSemanticDocumentPart[];   // NEW
}
```

### TemplateSchema-side (`src/lib/template/types.ts`)

- `BodyFillRegion` (heading_bounded variant) gains optional `style_notes?: string` and `visual_style?: VisualStyle`.
- The `document_part` variant gains:
  - `paragraph_details: ParagraphDetail[]` — produced by parser, always present.
  - `slots?: DocumentPartSlot[]` — from synthesizer, optional (absent on old schemas).

```typescript
export interface ParagraphDetail {
  slot_index: number;
  text: string;
  has_drawing: boolean;
  has_complex_content: boolean;
  alignment: 'left' | 'center' | 'right' | 'justify' | null;
  font_family: string | null;
  font_size_pt: number | null;
}

export interface DocumentPartSlot {
  slot_index: number;
  intent: string;
  style_notes: string;
  visual_style: VisualStyle;
}

export interface VisualStyle { /* same shape as LLMVisualStyle */ }
```

### Draft records (`src/lib/draft/types.ts`)

```typescript
export type SlotDraftEntry = { slot_index: number; text: string };
export type DocumentPartDraft = { kind: 'document_part'; slots: SlotDraftEntry[] };
export type BodyDraft = { kind: 'body'; paragraphs: DraftParagraph[] };
export type SectionDraft = BodyDraft | DocumentPartDraft;
```

Dexie `DraftRecord.paragraphs` is replaced by `DraftRecord.draft: SectionDraft`. On read, records lacking the `kind` discriminant are coerced to `{ kind: 'body', paragraphs: <legacy array> }` in memory.

## Parser changes

### `classifyParagraph(p: Element)` in `parser/document.ts`

Returns `{ has_drawing, has_complex_content }`:

- `has_drawing`: descendant `<w:drawing>`, `<w:pict>`, or `<w:object>`.
- `has_complex_content`: descendant `<w:sdt>`, `<w:footnoteReference>`, `<w:endnoteReference>`, or `<w:fldChar>`.

Paragraphs matching either are non-draftable and preserved intact.

### `document_part` fill region

`loadPartContents` extended to build `paragraph_details` from the `ParagraphInfo` array already extracted by `parseHeaderFooterXml`. Each detail row carries `slot_index` (0-based position among direct `<w:p>` children of the part root), `text`, the classification flags, and the pPr/rPr-derived alignment/font/size (already resolved via `resolveInheritedFormatting`).

`original_text_lines` stays — it's consumed by the schema viewer preview and removing it is churn for no gain.

### Tests

- Synthetic part with a `<w:drawing>` paragraph: `has_drawing === true` for that row, `false` for others.
- Alignment/font/size round-trip from `<w:jc>`/`<w:rFonts>`/`<w:sz>` → `paragraph_details`.

## Synthesizer changes

### Prompt input

`document_parts` block added to the prompt, derived deterministically from parser output:

```
DOCUMENT_PARTS:
  header1 (word/header1.xml):
    [0] text="DEPARTMENT OF THE ARMY"  align=center  font=Arial  sz=14  has_drawing=false
    [1] text=""                         align=center                 has_drawing=true
    [2] text="[UNIT NAME]"              align=center  font=Arial  sz=14
    ...
```

Drawing rows shown for spatial context; LLM forbidden from emitting slots for them.

### Prompt output schema

Per body section: add `style_notes` (≤ 1 paragraph, plain prose) and `visual_style` (nullable fields).

`document_parts[]`: one entry per header/footer part. `slots[]` contains text-only paragraphs. Each slot echoes `source_text` — the merger rejects the synthesis on mismatch and retries once.

### Validation

- Existing subject-leakage scanner extended to `style_notes` and slot `intent`/`style_notes`.
- New: verify each `document_parts[].slots[].source_text` matches the parser's extracted text for that paragraph verbatim.

### Token budget

~150 extra output tokens per body section (style_notes + visual_style), ~80 per letterhead slot. Typical MFR: ~8 slots; typical PWS: ~15 body sections. Ballpark 2–3k extra output tokens per synthesis call. Acceptable — synthesis runs once per template.

### Tests

- `prompt.test.ts`: new output fields appear in the schema sent to the LLM.
- `merge.test.ts`: synthesizer output → `TemplateSchema` folds `style_notes` onto body sections and `slots[]` onto document_part regions.
- `leakage.test.ts`: style_notes with baked-in proper nouns is flagged.
- `synthesize.test.ts`: source_text mismatch triggers a retry; missing `document_parts` on the first attempt triggers a retry; second failure surfaces as an error.

## Assembler changes

### `processDocumentPartSlots` (replaces the removed `processDocumentPartSection`)

```
Inputs: zip, section (with paragraph_details), draft (kind: 'document_part', slots[])

1. Load word/header*.xml or word/footer*.xml into a DOM.
2. Collect direct <w:p> children of <w:hdr>/<w:ftr> in document order.
3. For each paragraph at index i:
     if paragraph_details[i].has_drawing || has_complex_content:
       leave untouched
     else if draft.slots has an entry with slot_index === i:
       // in-place text replacement
       preserve paragraph's pPr
       preserve first <w:r>'s rPr
       remove all <w:r> children
       append one new <w:r> with cloned rPr and <w:t xml:space="preserve"> containing drafted text
     else:
       leave untouched (partial drafts allowed)
4. Serialize back, write to zip.
```

Never adds or removes `<w:p>` elements. Never touches non-paragraph children (tables, sdt, drawing anchors). Media and rels stay consistent because the paragraphs that reference them are structurally preserved.

### Body section — `visual_style` fallback

In `buildParagraph` / `collectFormatTemplates`, after cloning the source `pPr`/`rPr`, consult `section.visual_style` when the cloned values look degenerate:

- `rPr.sz < 16` (half-points, i.e. under 8pt) AND `visual_style.font_size_pt >= 9` → override font size from synthesized value.
- `pPr` missing `<w:jc>` AND `visual_style.alignment` non-null → set `jc`.
- `rPr.rFonts` missing AND `visual_style.font_family` non-null → set `rFonts.ascii`.

Narrow heuristic: templates with coherent `pPr`/`rPr` are still primary. Only triggers when the template itself looks broken for this section.

### Manual numbering

When `visual_style.numbering_convention === 'manual_numeric'` AND the drafter emits consecutive `role: 'body'` paragraphs AND the drafted text does NOT already start with a number-and-period prefix, prepend `1. `, `2. `, … This fixes the "missing numbering" symptom on MFR paragraphs.

### `AssembleSectionStatus` for document_part

```typescript
{ kind: 'assembled_slots';
  slots_replaced: number;       // slots the draft supplied
  slots_preserved: number;      // text paragraphs with no draft entry
  slots_skipped_drawing: number; // paragraphs with a drawing or complex content
}
```

The previous `skipped_unsupported_region` return for document_part is retired.

### Tests

- Real `MFR Template.docx` fixture (local only — not committed per public-release policy): drafting slot 2 to "MEDICAL READINESS COMMAND, PACIFIC" preserves the seal's `<w:drawing>`, `word/media/image1.png`, and `word/_rels/header1.xml.rels`; slot 2's `pPr` unchanged; new text lands in slot 2's `<w:r>`.
- Drafter supplies `slot_index` pointing at a drawing paragraph → that entry is ignored, status reports `slots_skipped_drawing += 1`.
- Body section with `visual_style.font_size_pt = 12` and template rPr `sz=14` (7pt) → assembled runs carry `sz=24`.
- Numbering: `numbering_convention = 'manual_numeric'`, drafter returns three body paragraphs without prefixes → output text starts with "1. ", "2. ", "3. ".

## Drafter changes

### Body section prompt

Per-section block gains:

```
STYLE NOTES:
  {section.style_notes}

VISUAL STYLE:
  font: {font_family} {font_size_pt}pt
  alignment: {alignment}
  numbering: {numbering_convention}
```

Null fields omitted.

### `draftDocumentPart` (new)

Reads `section.paragraph_details` + `section.slots[]`. Builds a per-slot prompt:

```
SECTION: Page Header (header1)

SLOT 0  (source="DEPARTMENT OF THE ARMY", center, Arial 14pt)
  intent: ...
  style_notes: ...

[FIXED] SLOT 1  (source="", contains seal image — do not emit)

SLOT 2  (source="[UNIT NAME]", center, Arial 14pt)
  intent: organization's unit name
  style_notes: ALL CAPS, no abbreviations
...
```

Expected response: `{ slots: [{ slot_index: number, text: string }, ...] }`. Missing slots → "keep original text." Returns `DocumentPartDraft`.

### `draftSection` dispatch

```
switch (section.fill_region.kind) {
  case 'heading_bounded': return draftBodySection(...);
  case 'document_part':   return draftDocumentPart(...);
  default: return unsupported;
}
```

### Preflight

`src/lib/agent/preflight.ts` branches on `kind` for token estimation:

- Body section: existing formula (`target_words * 1.4` out tokens).
- Document_part: `~150 tokens per draftable slot` for input context and output combined.

### Tests

- Body drafter prompt includes style_notes/visual_style when present, omits when null.
- Letterhead drafter prompt flags drawing rows with `[FIXED]`, parses `{ slots: [...] }`, treats missing slots as "keep original", returns `DocumentPartDraft`.
- Dispatch routes heading_bounded → body path, document_part → slot path.
- Preflight: letterhead costs don't inflate using body formula.

## Dexie migration

`src/lib/db/schema.ts` Dexie version bumps. Additive-only; no upgrade callback needed.

Reader-side coercion:

```typescript
function hydrateDraftRecord(r: DraftRecord): DraftRecord {
  if ('kind' in r.draft) return r;
  return { ...r, draft: { kind: 'body', paragraphs: r.paragraphs ?? [] } };
}
```

Coercion lives in the Dexie access layer so downstream code always sees the union shape. Delete the coercion after one major release when all active user DBs have been touched.

## UI

Template card in `Templates.tsx` route shows a small "Re-synthesize for full letterhead support" pill when:

- `schema_json` is missing `style_notes` on any body section, OR
- `schema_json` is missing `document_parts`, OR
- a `document_part` section lacks `slots`.

Clicking the pill runs `onSynthesize(record)` — the existing button handler. No auto-trigger.

## Bundle format

`src/lib/share/bundle.ts` v1 already embeds `schema_json` verbatim. Old bundles lack the new fields → handled by the same fallback path as old Dexie records. New bundles carry full new shape. Bundle version stays at 1 — it's a superset, not a breaking change.

## Rollout order

Each step is independently shippable. If we stop after step 4, letterhead stays preserved (no regression), body gets the Arial-8 fix, and `style_notes` is unused but harmless.

1. Parser: `classifyParagraph`, `paragraph_details` on document_part fill regions.
2. Schema type additions (all optional).
3. Synthesizer prompt + merger + leakage scanner + source_text validation.
4. Assembler: `processDocumentPartSlots`, `visual_style` fallback, manual numbering.
5. Drafter: `draftDocumentPart`, dispatch, preflight branch.
6. UI re-synthesize pill.
7. Manual end-to-end on local MFR fixture.

## Open risks

- **Source_text mismatch retry loop.** If the parser and synthesizer disagree on whitespace/encoding of source_text, the retry always fails. Mitigation: normalize both sides (`.trim()`, collapse internal whitespace) before comparing. Cap at one retry; on second failure, drop the offending slots and emit a warning — the assembler's "no draft for this slot" path leaves source text intact.
- **Slot drift if the template is edited after synthesis.** `paragraph_details` is parser-produced fresh each assembly; `slots[]` is synthesizer-produced once. A user who edits the template's header text after synthesis will see stale slot intent. Mitigation: re-parse detects a paragraph count change and surfaces a "template changed — re-synthesize" warning. Mild risk; not addressing in v1 because users upload-then-use, not upload-edit-in-place.
- **`visual_style` fallback over-reach.** If the heuristic thresholds are too loose, we override legitimate small-font template choices. Mitigation: thresholds are conservative (under-8pt only), tests cover both trigger and no-trigger cases.

## Success criteria

- Given the local `MFR Template.docx` fixture and a drafter that emits unit name / address / office symbol / memorandum-for / subject as slot text:
  - `word/media/image1.png` and `word/_rels/header1.xml.rels` survive the assembly round trip (unchanged).
  - The seal `<w:drawing>` is present in the output `word/header1.xml`.
  - Drafted slot text replaces the `<w:r>` content of the correct paragraph.
  - The paragraph's `pPr` is identical to the template.
  - Body text in a drafted section renders in a non-degenerate font (no Arial-7pt cascade).
- 371+ tests pass (current count after commit `109ca2f` — new tests added for each subsystem change).
- Typecheck clean.
- Existing templates without re-synthesis still work (letterhead preserved as-is, body unchanged).

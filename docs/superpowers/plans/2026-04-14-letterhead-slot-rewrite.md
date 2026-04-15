# Letterhead slot rewrite + semantic style notes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore draftable letterhead text via per-slot DOCX rewriting that physically can't destroy drawings, and add `style_notes` + `visual_style` to the semantic synthesizer so the drafter matches template conventions and the assembler recovers from degenerate cloned rPr.

**Architecture:** Four subsystems — parser emits per-paragraph classification for header/footer parts; synthesizer emits `style_notes` + `visual_style` per body section and per-slot guidance for document_part sections; assembler rewrites document_part content in-place at the `<w:r>` level; drafter dispatches on `kind` and returns a discriminated `SectionDraft` union. See `docs/superpowers/specs/2026-04-14-letterhead-slot-rewrite-design.md` for full rationale.

**Tech Stack:** TypeScript, React 18, Vite, Vitest (jsdom), JSZip, Dexie 4, existing Ask Sage / OpenRouter provider interface.

---

## File map

| File | Purpose | Created / Modified |
|---|---|---|
| `src/lib/template/parser/document.ts` | `classifyParagraph` helper | Modified |
| `src/lib/template/parser/index.ts` | Emit `paragraph_details` on document_part regions | Modified |
| `src/lib/template/types.ts` | `ParagraphDetail`, `DocumentPartSlot`, `VisualStyle`; extend fill region types | Modified |
| `src/lib/template/synthesis/types.ts` | `LLMVisualStyle`, `LLMSemanticDocumentPart`, slot types; extend output | Modified |
| `src/lib/template/synthesis/prompt.ts` | Inject `document_parts` block; describe new output schema | Modified |
| `src/lib/template/synthesis/merge.ts` | Fold `style_notes`, `visual_style`, `slots[]` into `TemplateSchema` | Modified |
| `src/lib/template/synthesis/leakage.ts` | Scan `style_notes` and slot prose | Modified |
| `src/lib/template/synthesis/synthesize.ts` | Retry-once on source_text mismatch | Modified |
| `src/lib/draft/types.ts` | `SlotDraftEntry`, `BodyDraft`, `DocumentPartDraft`, `SectionDraft` | Modified |
| `src/lib/draft/orchestrator.ts` | Add style_notes to body prompt; dispatch on kind | Modified |
| `src/lib/draft/draftDocumentPart.ts` | Per-slot letterhead drafter | Created |
| `src/lib/export/assemble.ts` | `processDocumentPartSlots`; `visual_style` fallback; manual numbering | Modified |
| `src/lib/agent/preflight.ts` | Branch token budget on kind | Modified |
| `src/lib/db/schema.ts` | Dexie version bump; DraftRecord shape coercion | Modified |
| `src/routes/Templates.tsx` | Re-synthesize pill on incomplete templates | Modified |
| `src/lib/template/parser/parseDocx.test.ts` | classifyParagraph + paragraph_details | Modified |
| `src/lib/template/synthesis/prompt.test.ts` | document_parts appears in prompt | Modified |
| `src/lib/template/synthesis/merge.test.ts` | New fields merge into schema | Modified |
| `src/lib/template/synthesis/leakage.test.ts` | style_notes scanned | Modified |
| `src/lib/template/synthesis/synthesize.test.ts` | source_text mismatch retry | Modified |
| `src/lib/export/assemble.test.ts` | slot rewrite; seal preservation; visual_style fallback; manual numbering | Modified |
| `src/lib/draft/draftDocumentPart.test.ts` | Per-slot path | Created |
| `src/lib/draft/orchestrator.test.ts` | Dispatch + body prompt content | Modified |
| `src/lib/agent/preflight.test.ts` | Letterhead budget branch | Modified |

Each phase ends with `npm run build && npx vitest run && npx tsc --noEmit`. A phase that leaves those three green is a safe commit boundary.

---

## Phase 1 — Parser: per-paragraph classification

### Task 1.1 — `classifyParagraph` helper

**Files:**
- Modify: `src/lib/template/parser/document.ts`
- Modify: `src/lib/template/parser/parseDocx.test.ts`

- [ ] **Step 1: Write failing test**

In `parseDocx.test.ts`, add a `describe('classifyParagraph')` block with:

```typescript
import { classifyParagraph } from './document';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function pFromXml(inner: string): Element {
  const xml = `<w:p xmlns:w="${W_NS}">${inner}</w:p>`;
  return new DOMParser().parseFromString(xml, 'text/xml').documentElement;
}

describe('classifyParagraph', () => {
  it('flags drawing-bearing paragraphs', () => {
    const p = pFromXml('<w:r><w:drawing/></w:r>');
    expect(classifyParagraph(p)).toEqual({ has_drawing: true, has_complex_content: false });
  });
  it('flags pict and object as drawings', () => {
    expect(classifyParagraph(pFromXml('<w:r><w:pict/></w:r>')).has_drawing).toBe(true);
    expect(classifyParagraph(pFromXml('<w:r><w:object/></w:r>')).has_drawing).toBe(true);
  });
  it('flags sdt / footnoteReference / fldChar as complex', () => {
    expect(classifyParagraph(pFromXml('<w:sdt/>')).has_complex_content).toBe(true);
    expect(classifyParagraph(pFromXml('<w:r><w:footnoteReference/></w:r>')).has_complex_content).toBe(true);
    expect(classifyParagraph(pFromXml('<w:r><w:fldChar/></w:r>')).has_complex_content).toBe(true);
  });
  it('returns {false,false} for plain text paragraphs', () => {
    expect(classifyParagraph(pFromXml('<w:r><w:t>hello</w:t></w:r>'))).toEqual({
      has_drawing: false, has_complex_content: false,
    });
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

```
npx vitest run src/lib/template/parser/parseDocx.test.ts
```
Expected: "classifyParagraph is not exported" / undefined.

- [ ] **Step 3: Implement in `document.ts`**

```typescript
const DRAWING_LOCAL_NAMES = new Set(['drawing', 'pict', 'object']);
const COMPLEX_LOCAL_NAMES = new Set(['sdt', 'footnoteReference', 'endnoteReference', 'fldChar']);

export function classifyParagraph(p: Element): {
  has_drawing: boolean;
  has_complex_content: boolean;
} {
  let has_drawing = false;
  let has_complex_content = false;
  const walker = (el: Element): void => {
    const ln = el.localName;
    if (DRAWING_LOCAL_NAMES.has(ln)) has_drawing = true;
    if (COMPLEX_LOCAL_NAMES.has(ln)) has_complex_content = true;
    for (let n = el.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 1 /* ELEMENT_NODE */) walker(n as Element);
    }
  };
  walker(p);
  return { has_drawing, has_complex_content };
}
```

- [ ] **Step 4: Run tests, verify PASS**

```
npx vitest run src/lib/template/parser/parseDocx.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/template/parser/document.ts src/lib/template/parser/parseDocx.test.ts
git commit -m "feat(parser): classifyParagraph helper for drawing/complex content detection"
```

### Task 1.2 — `paragraph_details` on document_part fill regions

**Files:**
- Modify: `src/lib/template/types.ts` (add `ParagraphDetail` type; extend `document_part` variant)
- Modify: `src/lib/template/parser/index.ts` (build `paragraph_details` in `loadPartContents` path)
- Modify: `src/lib/template/parser/fillRegions.ts` (thread through to the document_part region builder)
- Modify: `src/lib/template/parser/parseDocx.test.ts`

- [ ] **Step 1: Write failing test**

Add test that builds a synthetic DOCX header with one drawing-bearing paragraph and two text paragraphs, and asserts `paragraph_details` on the resulting fill region:

```typescript
it('emits paragraph_details on document_part fill regions', async () => {
  // Use the buildTemplateWithHeaderFooter() fixture from assemble.test.ts or
  // inline a small synthetic DOCX with a <w:drawing/> inside the first header
  // paragraph. Parse it, find the header document_part section, and assert:
  const section = parsed.schema.sections.find(
    (s) => s.fill_region.kind === 'document_part' && s.fill_region.placement === 'header',
  )!;
  if (section.fill_region.kind !== 'document_part') throw new Error('type narrow');
  const details = section.fill_region.paragraph_details;
  expect(details).toHaveLength(/* synthetic count */);
  expect(details[0]!.has_drawing).toBe(true);
  expect(details[0]!.slot_index).toBe(0);
  expect(details[1]!.has_drawing).toBe(false);
  expect(details[1]!.text).toBe(/* expected text */);
  expect(details[1]!.alignment).toBe('center');
});
```

- [ ] **Step 2: Run, verify FAIL** (`paragraph_details` doesn't exist on the type).

- [ ] **Step 3: Add `ParagraphDetail` type in `template/types.ts`**

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
```

Extend the `document_part` variant of `BodyFillRegion` to include `paragraph_details: ParagraphDetail[]`.

- [ ] **Step 4: Build `paragraph_details` in parser**

In `parser/index.ts`'s `loadPartContents`, expose `Element[]` alongside the parsed `ParagraphInfo[]` (currently `parseHeaderFooterXml` only returns info). Add a sibling function `parseHeaderFooterXmlWithElements(dom)` that returns `{ paragraphs: ParagraphInfo[]; elements: Element[] }` — OR read the elements directly when building PartContent. Pick the one least invasive to existing callers.

Then in the region builder (`fillRegions.ts` `buildDocumentPartSections` or equivalent), map over the stored PartContent to produce `paragraph_details`:

```typescript
paragraph_details: partContent.paragraphs.map((info, i): ParagraphDetail => {
  const el = partContent.elements[i]!;
  const { has_drawing, has_complex_content } = classifyParagraph(el);
  return {
    slot_index: i,
    text: info.text,
    has_drawing,
    has_complex_content,
    alignment: info.alignment ?? null,
    font_family: info.font_family ?? null,
    font_size_pt: info.font_size_pt ?? null,
  };
}),
```

- [ ] **Step 5: Run tests, verify PASS**

```
npx vitest run src/lib/template/parser/
```

Also re-run assembler tests to make sure the document_part region shape change didn't break them:

```
npx vitest run src/lib/export/assemble.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/template/ src/lib/template/parser/
git commit -m "feat(parser): paragraph_details on document_part fill regions"
```

---

## Phase 2 — Types: synthesizer + schema + draft union

### Task 2.1 — `LLMVisualStyle` / `LLMSemanticDocumentPart` and `VisualStyle` / `DocumentPartSlot` types

**Files:**
- Modify: `src/lib/template/synthesis/types.ts`
- Modify: `src/lib/template/types.ts`

- [ ] **Step 1: Add types to `synthesis/types.ts`**

```typescript
export interface LLMVisualStyle {
  font_family: string | null;
  font_size_pt: number | null;
  alignment: 'left' | 'center' | 'right' | 'justify' | null;
  numbering_convention: 'none' | 'manual_numeric' | 'manual_lettered' | 'ooxml_list' | null;
}

export interface LLMSemanticDocumentPartSlot {
  slot_index: number;
  source_text: string;
  intent: string;
  style_notes: string;
  visual_style: LLMVisualStyle;
}

export interface LLMSemanticDocumentPart {
  part_path: string;
  placement: 'header' | 'footer';
  slots: LLMSemanticDocumentPartSlot[];
}
```

Add `style_notes: string` and `visual_style: LLMVisualStyle` to `LLMSemanticSection`. Add `document_parts: LLMSemanticDocumentPart[]` to `LLMSemanticOutput`.

- [ ] **Step 2: Mirror types in `template/types.ts`**

```typescript
export type VisualStyle = LLMVisualStyle;
export interface DocumentPartSlot {
  slot_index: number;
  intent: string;
  style_notes: string;
  visual_style: VisualStyle;
}
```

Extend `BodyFillRegion` heading_bounded variant: `style_notes?: string; visual_style?: VisualStyle`. Extend the `document_part` variant: `slots?: DocumentPartSlot[]`. Both are optional (backward compat).

- [ ] **Step 3: Run typecheck**

```
npx tsc --noEmit
```

Fix the compile errors this inevitably creates in places that construct `LLMSemanticOutput` or `LLMSemanticSection` (tests and mock fixtures). Add placeholder `style_notes: ''` and `visual_style: { font_family: null, font_size_pt: null, alignment: null, numbering_convention: null }` to the minimum needed to restore green.

- [ ] **Step 4: Commit**

```bash
git add src/lib/template/
git commit -m "feat(types): LLMVisualStyle, document_parts in synthesizer output, VisualStyle on fill regions"
```

### Task 2.2 — `SectionDraft` discriminated union

**Files:**
- Modify: `src/lib/draft/types.ts`
- Modify: `src/lib/db/schema.ts` (DraftRecord shape)

- [ ] **Step 1: Add union in `draft/types.ts`**

```typescript
export interface SlotDraftEntry {
  slot_index: number;
  text: string;
}
export interface DocumentPartDraft {
  kind: 'document_part';
  slots: SlotDraftEntry[];
}
export interface BodyDraft {
  kind: 'body';
  paragraphs: DraftParagraph[];
}
export type SectionDraft = BodyDraft | DocumentPartDraft;
```

- [ ] **Step 2: Update `DraftRecord` in `db/schema.ts`**

Replace `paragraphs: DraftParagraph[]` with `draft: SectionDraft`. Keep the old `paragraphs` field on the type as deprecated/optional to support read-side coercion.

- [ ] **Step 3: Add a `hydrateDraftRecord` helper**

```typescript
export function hydrateDraftRecord(r: DraftRecord): DraftRecord {
  if (r.draft && 'kind' in r.draft) return r;
  return {
    ...r,
    draft: { kind: 'body', paragraphs: r.paragraphs ?? [] },
  };
}
```

Wrap all read call sites (`db.drafts.get`, `.where('project_id').equals`, etc.) so every consumer sees the union shape. Easiest: add a `getDrafts` / `getDraft` wrapper in `db/schema.ts` and update downstream callers to use it.

- [ ] **Step 4: Bump Dexie version**

Add a new `.version(N + 1).stores(...)` entry. No `upgrade()` callback needed — the change is additive from Dexie's POV (the column isn't indexed).

- [ ] **Step 5: Fix compile errors at callers**

`orchestrator.ts`, `downloadAssembled.ts`, `assemble.ts` consumers, `diffRender.ts`, `share/bundle.ts` all touch `draft.paragraphs`. Migrate each call site to discriminate on `draft.kind`. For code paths that only support body drafts today, narrow with `if (draft.kind !== 'body') continue;` or `throw`.

- [ ] **Step 6: Run tests + typecheck**

```
npx tsc --noEmit && npx vitest run
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/
git commit -m "feat(draft): SectionDraft union; body/document_part discrimination"
```

---

## Phase 3 — Synthesizer: prompt, merger, validation

### Task 3.1 — Inject `DOCUMENT_PARTS` block into the prompt

**Files:**
- Modify: `src/lib/template/synthesis/prompt.ts`
- Modify: `src/lib/template/synthesis/prompt.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
it('includes a DOCUMENT_PARTS block with slot indices, text, and drawing flags', () => {
  const prompt = buildSynthesisPrompt({
    schema: schemaWithHeaderFooter,
    body_cap_chars: 100_000,
  });
  expect(prompt).toContain('DOCUMENT_PARTS:');
  expect(prompt).toContain('header1 (word/header1.xml):');
  expect(prompt).toMatch(/\[0\] text="DEPARTMENT OF THE ARMY".+align=center.+font=Arial.+sz=14.+has_drawing=false/);
  expect(prompt).toMatch(/\[1\] text="".+has_drawing=true/);
});
```

- [ ] **Step 2: Run, verify FAIL**

- [ ] **Step 3: Extend `buildSynthesisPrompt`**

Walk `schema.sections.filter(s => s.fill_region.kind === 'document_part')`, emit:

```
DOCUMENT_PARTS:
  header1 (word/header1.xml):
    [0] text="..."  align=center  font=Arial  sz=14  has_drawing=false
    [1] text=""     align=center                    has_drawing=true
    ...
```

Also extend the expected output-schema section of the prompt to describe:
- `sections[i].style_notes` (string, ≤1 paragraph, plain prose conventions).
- `sections[i].visual_style` (object with null-permissive fields).
- `document_parts[]` with `slots[]` — only text-only paragraphs, drawings skipped.
- Slot responses MUST echo `source_text` verbatim.

- [ ] **Step 4: Run, verify PASS**

- [ ] **Step 5: Commit**

```bash
git add src/lib/template/synthesis/prompt.ts src/lib/template/synthesis/prompt.test.ts
git commit -m "feat(synth): DOCUMENT_PARTS block + new output schema in prompt"
```

### Task 3.2 — Merger folds new fields into schema

**Files:**
- Modify: `src/lib/template/synthesis/merge.ts`
- Modify: `src/lib/template/synthesis/merge.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
it('folds style_notes and visual_style onto body sections', () => {
  const schema = mergeSemantic(baseSchema, {
    style: { ... },
    sections: [{ id: 'scope', style_notes: 'ALL CAPS titles only', visual_style: {...}, ... }],
    document_parts: [],
  });
  const scope = schema.sections.find((s) => s.id === 'scope')!;
  if (scope.fill_region.kind !== 'heading_bounded') throw new Error();
  expect((scope as any).style_notes).toBe('ALL CAPS titles only');
  expect((scope as any).visual_style.font_size_pt).toBe(12);
});

it('folds slots[] onto document_part sections, skipping drawing slot indices', () => {
  const schema = mergeSemantic(baseSchemaWithHeader, {
    document_parts: [{
      part_path: 'word/header1.xml',
      placement: 'header',
      slots: [
        { slot_index: 0, source_text: 'DEPARTMENT OF THE ARMY', intent: '...', style_notes: '...', visual_style: {...} },
        { slot_index: 2, source_text: '[UNIT NAME]',            intent: '...', style_notes: '...', visual_style: {...} },
      ],
    }],
    sections: [],
    style: {...},
  });
  const header = schema.sections.find((s) => s.fill_region.kind === 'document_part')!;
  if (header.fill_region.kind !== 'document_part') throw new Error();
  expect(header.fill_region.slots).toHaveLength(2);
  expect(header.fill_region.slots![0]!.slot_index).toBe(0);
});

it('rejects synthesis when source_text mismatches parser-extracted text', () => {
  expect(() => mergeSemantic(base, {
    document_parts: [{
      part_path: 'word/header1.xml',
      placement: 'header',
      slots: [{ slot_index: 0, source_text: 'WRONG TEXT', ... }],
    }],
    ...
  })).toThrow(/source_text mismatch/);
});
```

- [ ] **Step 2: Run, verify FAIL**

- [ ] **Step 3: Extend merger**

In `merge.ts`:

```typescript
// Body sections
for (const llmSec of llm.sections) {
  const region = schema.sections.find((s) => s.id === llmSec.id);
  if (!region || region.fill_region.kind !== 'heading_bounded') continue;
  region.style_notes = llmSec.style_notes;
  region.visual_style = llmSec.visual_style;
  // ...existing intent/target_words/validation merge stays unchanged
}

// Document parts
for (const llmPart of llm.document_parts ?? []) {
  const region = schema.sections.find(
    (s) => s.fill_region.kind === 'document_part' && s.fill_region.part_path === llmPart.part_path,
  );
  if (!region || region.fill_region.kind !== 'document_part') continue;
  const details = region.fill_region.paragraph_details;

  // Validate source_text echo (trim + collapse whitespace on both sides)
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
  for (const slot of llmPart.slots) {
    const detail = details.find((d) => d.slot_index === slot.slot_index);
    if (!detail) {
      throw new Error(`slot_index ${slot.slot_index} not in parser paragraph_details`);
    }
    if (detail.has_drawing || detail.has_complex_content) {
      throw new Error(`slot_index ${slot.slot_index} is non-draftable (drawing/complex); synthesis produced a slot for it`);
    }
    if (norm(slot.source_text) !== norm(detail.text)) {
      throw new Error(
        `source_text mismatch on ${llmPart.part_path}[${slot.slot_index}]: ` +
          `expected "${detail.text}", got "${slot.source_text}"`,
      );
    }
  }

  region.fill_region.slots = llmPart.slots.map((s) => ({
    slot_index: s.slot_index,
    intent: s.intent,
    style_notes: s.style_notes,
    visual_style: s.visual_style,
  }));
}
```

- [ ] **Step 4: Run tests, verify PASS**

- [ ] **Step 5: Commit**

```bash
git add src/lib/template/synthesis/merge.ts src/lib/template/synthesis/merge.test.ts
git commit -m "feat(synth): merge style_notes, visual_style, and slots into schema; validate source_text"
```

### Task 3.3 — Leakage scanner extended

**Files:**
- Modify: `src/lib/template/synthesis/leakage.ts`
- Modify: `src/lib/template/synthesis/leakage.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
it('flags style_notes containing proper nouns', () => {
  const warnings = scanLeakage({
    ...minimalOutput,
    sections: [{
      id: 'scope', intent: 'clean', style_notes: 'Match the SHARP-style voice used by...',
      ...
    }],
  });
  expect(warnings.some((w) => w.flagged_tokens.includes('SHARP'))).toBe(true);
});
```

- [ ] **Step 2: Run, verify FAIL**

- [ ] **Step 3: Extend scanner**

Where `leakage.ts` scans `section.intent` today, also scan `section.style_notes` and each `document_parts[i].slots[j].intent` and `.style_notes`. Reuse the existing token-detection regex.

- [ ] **Step 4: Run, verify PASS**

- [ ] **Step 5: Commit**

```bash
git add src/lib/template/synthesis/leakage.ts src/lib/template/synthesis/leakage.test.ts
git commit -m "feat(synth): extend leakage scanner to style_notes and slots"
```

### Task 3.4 — Retry-once on source_text mismatch

**Files:**
- Modify: `src/lib/template/synthesis/synthesize.ts`
- Modify: `src/lib/template/synthesis/synthesize.test.ts`

- [ ] **Step 1: Write failing test**

Stub the LLM provider so the first call returns a payload with a mismatched `source_text` and the second call returns a valid one. Expect `synthesize()` to return the merged schema from the second call, not throw.

Also: stub twice-failing; expect `synthesize()` to throw.

- [ ] **Step 2: Run, verify FAIL**

- [ ] **Step 3: Add retry loop in synthesize.ts**

```typescript
for (let attempt = 0; attempt < 2; attempt++) {
  const raw = await llmClient.completion(prompt);
  const parsed = parseSynthesisResponse(raw);
  try {
    return mergeSemantic(baseSchema, parsed);
  } catch (e) {
    if (attempt === 1) throw e;
    // Re-prompt with the error message for the second attempt
    prompt = augmentPromptWithError(prompt, e);
  }
}
```

- [ ] **Step 4: Run, verify PASS**

- [ ] **Step 5: Commit**

```bash
git add src/lib/template/synthesis/synthesize.ts src/lib/template/synthesis/synthesize.test.ts
git commit -m "feat(synth): retry synthesis once on source_text mismatch"
```

---

## Phase 4 — Assembler: slot rewrite + visual_style fallback

### Task 4.1 — `processDocumentPartSlots`

**Files:**
- Modify: `src/lib/export/assemble.ts`
- Modify: `src/lib/export/assemble.test.ts`

- [ ] **Step 1: Write failing tests**

Using the existing `buildTemplateWithHeaderFooter` fixture from `assemble.test.ts`, add tests that:

```typescript
it('rewrites text-only slots and preserves drawing-bearing paragraphs', async () => {
  const tpl = await buildTemplateWithHeaderFooterWithSeal(); // new helper with a <w:drawing/> in one paragraph
  const hdr = tpl.schema_json.sections.find((s) => s.fill_region.kind === 'document_part')!;
  const draft: SectionDraft = {
    kind: 'document_part',
    slots: [{ slot_index: 0, text: 'NEW ORG NAME' }, { slot_index: 2, text: 'NEW UNIT NAME' }],
  };
  const result = await assembleProjectDocx({
    template: tpl,
    draftedBySectionId: new Map([[hdr.id, draft]]),
  });
  const status = result.section_results.find((r) => r.section_id === hdr.id)!.status;
  expect(status.kind).toBe('assembled_slots');
  const headerXml = await readPartXml(result.blob, 'word/header1.xml');
  expect(headerXml).toContain('NEW ORG NAME');
  expect(headerXml).toContain('NEW UNIT NAME');
  // Seal paragraph preserved.
  expect(headerXml).toContain('<w:drawing');
  // Paragraph count unchanged.
  const dom = new DOMParser().parseFromString(headerXml, 'text/xml');
  expect(Array.from(dom.getElementsByTagNameNS(W_NS, 'p')).length).toBe(originalCount);
});

it('leaves slots without a draft entry untouched', async () => { /* ... */ });
it('ignores slot_index pointing at a drawing paragraph', async () => { /* ... */ });
```

Update `AssembleSectionStatus` union with `{ kind: 'assembled_slots'; slots_replaced; slots_preserved; slots_skipped_drawing }`.

- [ ] **Step 2: Run, verify FAIL**

- [ ] **Step 3: Implement `processDocumentPartSlots`**

Add to `assemble.ts`. Dispatch from the document_part pass:

```typescript
for (const section of sections) {
  if (section.fill_region.kind !== 'document_part') continue;
  const draft = draftedBySectionId.get(section.id);
  if (!draft || (draft.kind === 'document_part' && draft.slots.length === 0)) {
    status = { kind: 'skipped_no_draft' };
    continue;
  }
  if (draft.kind !== 'document_part') {
    status = { kind: 'failed', error: 'document_part section got a body draft' };
    continue;
  }
  status = await processDocumentPartSlots(zip, section.fill_region, draft);
}
```

Implementation:

```typescript
async function processDocumentPartSlots(
  zip: JSZip,
  fr: Extract<BodyFillRegion['fill_region'], { kind: 'document_part' }>,
  draft: DocumentPartDraft,
): Promise<AssembleSectionStatus> {
  const file = zip.file(fr.part_path);
  if (!file) return { kind: 'failed', error: `part not found: ${fr.part_path}` };
  const partXml = await file.async('string');
  const partDom = new DOMParser().parseFromString(partXml, 'text/xml');
  const rootName = fr.placement === 'header' ? 'hdr' : 'ftr';
  const root = partDom.getElementsByTagNameNS(W_NS, rootName)[0];
  if (!root) return { kind: 'failed', error: `no <w:${rootName}> root` };

  const paragraphs: Element[] = [];
  for (let n = root.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1 && (n as Element).localName === 'p' && (n as Element).namespaceURI === W_NS) {
      paragraphs.push(n as Element);
    }
  }

  const slotMap = new Map<number, string>();
  for (const s of draft.slots) slotMap.set(s.slot_index, s.text);

  let replaced = 0;
  let preserved = 0;
  let skipped = 0;

  for (let i = 0; i < paragraphs.length; i++) {
    const detail = fr.paragraph_details[i];
    if (!detail) { preserved++; continue; }
    if (detail.has_drawing || detail.has_complex_content) {
      if (slotMap.has(i)) skipped++;
      continue;
    }
    if (!slotMap.has(i)) { preserved++; continue; }

    const p = paragraphs[i]!;
    // Preserve the first <w:r>'s rPr (if any) for the replacement run.
    const firstR = p.getElementsByTagNameNS(W_NS, 'r')[0];
    const keepRPr = firstR ? firstChildNS(firstR, 'rPr') : null;

    // Remove all <w:r> children (keep pPr and everything else).
    const toRemove: Element[] = [];
    for (let n = p.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 1 && (n as Element).localName === 'r' && (n as Element).namespaceURI === W_NS) {
        toRemove.push(n as Element);
      }
    }
    for (const el of toRemove) p.removeChild(el);

    // Append one new <w:r> with cloned rPr and the drafted text.
    const r = partDom.createElementNS(W_NS, 'w:r');
    if (keepRPr) r.appendChild(keepRPr.cloneNode(true) as Element);
    const t = partDom.createElementNS(W_NS, 'w:t');
    t.setAttribute('xml:space', 'preserve');
    t.textContent = slotMap.get(i)!;
    r.appendChild(t);
    p.appendChild(r);
    replaced++;
  }

  const newXml = new XMLSerializer().serializeToString(partDom);
  const xmlHeader = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  zip.file(fr.part_path, newXml.startsWith('<?xml') ? newXml : xmlHeader + newXml);

  return {
    kind: 'assembled_slots',
    slots_replaced: replaced,
    slots_preserved: preserved,
    slots_skipped_drawing: skipped,
  };
}
```

Also update the no-draft passthrough (lines ~117–123): document_part sections should again return `skipped_no_draft` when there's no draft (not `skipped_unsupported_region`). Matches the new behavior.

- [ ] **Step 4: Run tests, verify PASS**

```
npx vitest run src/lib/export/assemble.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/export/assemble.ts src/lib/export/assemble.test.ts
git commit -m "feat(assemble): processDocumentPartSlots — per-slot text rewrite preserving drawings"
```

### Task 4.2 — `visual_style` fallback for body sections

**Files:**
- Modify: `src/lib/export/assemble.ts`
- Modify: `src/lib/export/assemble.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
it('overrides tiny cloned rPr with visual_style.font_size_pt when present', async () => {
  // Template rPr has sz=14 (7pt — degenerate). visual_style says 12pt.
  // Expect the drafted run's rPr sz to be 24 (half-points of 12).
});

it('leaves reasonable cloned rPr alone even with visual_style set', async () => {
  // Template rPr has sz=24 (12pt). visual_style says 14pt.
  // Expect output sz=24 unchanged.
});
```

- [ ] **Step 2: Run, verify FAIL**

- [ ] **Step 3: Implement in `buildParagraph` / rPr build path**

After the cloned rPr is in hand, apply fallback:

```typescript
function applyVisualStyleFallback(
  dom: Document,
  rPr: Element,
  pPr: Element,
  vs: VisualStyle | undefined,
): void {
  if (!vs) return;
  const szEl = firstChildNS(rPr, 'sz');
  const currentSzHalfPts = szEl ? Number(szEl.getAttributeNS(W_NS, 'val')) : NaN;
  if (Number.isFinite(currentSzHalfPts) && currentSzHalfPts < 16 && vs.font_size_pt && vs.font_size_pt >= 9) {
    removeChildrenByLocalName(rPr, 'sz');
    const sz = dom.createElementNS(W_NS, 'w:sz');
    sz.setAttributeNS(W_NS, 'w:val', String(vs.font_size_pt * 2));
    rPr.appendChild(sz);
  }
  const rFonts = firstChildNS(rPr, 'rFonts');
  if (!rFonts && vs.font_family) {
    const el = dom.createElementNS(W_NS, 'w:rFonts');
    el.setAttributeNS(W_NS, 'w:ascii', vs.font_family);
    el.setAttributeNS(W_NS, 'w:hAnsi', vs.font_family);
    rPr.appendChild(el);
  }
  const jc = firstChildNS(pPr, 'jc');
  if (!jc && vs.alignment) {
    const el = dom.createElementNS(W_NS, 'w:jc');
    el.setAttributeNS(W_NS, 'w:val', vs.alignment);
    pPr.appendChild(el);
  }
}
```

Call it during `buildParagraph` with `section.visual_style`. Plumb `visual_style` into `FormatTemplates` or pass it down directly.

- [ ] **Step 4: Run tests, verify PASS**

- [ ] **Step 5: Commit**

```bash
git add src/lib/export/assemble.ts src/lib/export/assemble.test.ts
git commit -m "feat(assemble): visual_style fallback for degenerate cloned rPr"
```

### Task 4.3 — Manual numbering prefix

**Files:**
- Modify: `src/lib/export/assemble.ts`
- Modify: `src/lib/export/assemble.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
it('prepends 1. 2. 3. when visual_style.numbering_convention=manual_numeric', async () => {
  // Section with numbering_convention manual_numeric and three body paragraphs
  // whose text does NOT already start with "N." — expect output text to start
  // with "1. ", "2. ", "3. " respectively.
});

it('does not double-prefix when drafter already emitted "1. "', async () => { /* ... */ });

it('does nothing when numbering_convention is ooxml_list', async () => { /* ... */ });
```

- [ ] **Step 2: Run, verify FAIL**

- [ ] **Step 3: Implement in `buildSectionElements`**

Before walking the draft paragraphs, check the section's `visual_style.numbering_convention`. If `manual_numeric`, maintain a counter across consecutive `role: 'body'` paragraphs and prepend `${n}. ` when the text doesn't match `/^\d+\.\s/`. Do the same for `manual_lettered` with `a. b. c.`.

- [ ] **Step 4: Run tests, verify PASS**

- [ ] **Step 5: Commit**

```bash
git add src/lib/export/assemble.ts src/lib/export/assemble.test.ts
git commit -m "feat(assemble): manual numbering prefix from visual_style.numbering_convention"
```

---

## Phase 5 — Drafter: dispatch + per-slot path

### Task 5.1 — Body prompt gains style_notes + visual_style

**Files:**
- Modify: `src/lib/draft/orchestrator.ts`
- Modify: `src/lib/draft/orchestrator.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
it('includes STYLE NOTES and VISUAL STYLE blocks when present', async () => {
  const prompt = buildBodyDraftPrompt(sectionWithStyleNotes, ctx);
  expect(prompt).toContain('STYLE NOTES:\n  ALL CAPS titles');
  expect(prompt).toContain('VISUAL STYLE:');
  expect(prompt).toContain('font: Times New Roman 12pt');
});

it('omits STYLE NOTES block when style_notes is empty or absent', async () => { /* ... */ });
```

- [ ] **Step 2: Run, verify FAIL**

- [ ] **Step 3: Extend prompt builder in orchestrator.ts**

Locate the current per-section prompt block. Append:

```typescript
if (section.style_notes) {
  parts.push(`\nSTYLE NOTES:\n  ${section.style_notes}`);
}
if (section.visual_style) {
  const vs = section.visual_style;
  const lines: string[] = [];
  if (vs.font_family || vs.font_size_pt) {
    lines.push(`font: ${vs.font_family ?? 'default'} ${vs.font_size_pt ? `${vs.font_size_pt}pt` : ''}`.trim());
  }
  if (vs.alignment) lines.push(`alignment: ${vs.alignment}`);
  if (vs.numbering_convention && vs.numbering_convention !== 'none') {
    lines.push(`numbering: ${vs.numbering_convention}`);
  }
  if (lines.length) parts.push(`\nVISUAL STYLE:\n  ${lines.join('\n  ')}`);
}
```

- [ ] **Step 4: Run tests, verify PASS**

- [ ] **Step 5: Commit**

```bash
git add src/lib/draft/orchestrator.ts src/lib/draft/orchestrator.test.ts
git commit -m "feat(draft): style_notes and visual_style in body section prompt"
```

### Task 5.2 — `draftDocumentPart` and dispatch

**Files:**
- Create: `src/lib/draft/draftDocumentPart.ts`
- Create: `src/lib/draft/draftDocumentPart.test.ts`
- Modify: `src/lib/draft/orchestrator.ts` (dispatch on kind)

- [ ] **Step 1: Write failing tests**

```typescript
it('builds per-slot prompt with [FIXED] markers on drawing paragraphs', () => {
  const prompt = buildDocumentPartPrompt(section, ctx);
  expect(prompt).toContain('SLOT 0');
  expect(prompt).toContain('[FIXED] SLOT 1');
  expect(prompt).toContain('SLOT 2');
});

it('parses { slots: [...] } response into DocumentPartDraft', () => {
  const draft = parseSlotsResponse('{"slots":[{"slot_index":0,"text":"X"}]}');
  expect(draft).toEqual({ kind: 'document_part', slots: [{ slot_index: 0, text: 'X' }] });
});

it('rejects responses whose slots point at drawing paragraphs', () => {
  // parser/merger should have ensured this, but enforce at drafter too
  expect(() => parseSlotsResponse('{"slots":[{"slot_index":1,"text":"X"}]}', section))
    .toThrow(/non-draftable/);
});
```

- [ ] **Step 2: Run, verify FAIL**

- [ ] **Step 3: Implement `draftDocumentPart.ts`**

```typescript
export async function draftDocumentPart(
  template: TemplateRecord,
  section: BodyFillRegion & { fill_region: { kind: 'document_part' } },
  ctx: DraftContext,
  llm: LLMClient,
): Promise<DocumentPartDraft> {
  const prompt = buildDocumentPartPrompt(section, ctx);
  const raw = await llm.completion({ messages: [{ role: 'user', content: prompt }], ...opts });
  return parseSlotsResponse(raw.text, section);
}

export function buildDocumentPartPrompt(section, ctx): string {
  const fr = section.fill_region;
  const lines: string[] = [`SECTION: ${section.name}\n`];
  for (const d of fr.paragraph_details) {
    const slotSem = fr.slots?.find((s) => s.slot_index === d.slot_index);
    const prefix = (d.has_drawing || d.has_complex_content) ? '[FIXED] ' : '';
    lines.push(`${prefix}SLOT ${d.slot_index}  (source="${d.text}"${d.alignment ? `, ${d.alignment}` : ''}${d.font_family ? `, ${d.font_family}` : ''}${d.font_size_pt ? ` ${d.font_size_pt}pt` : ''})`);
    if (slotSem) {
      lines.push(`  intent: ${slotSem.intent}`);
      if (slotSem.style_notes) lines.push(`  style_notes: ${slotSem.style_notes}`);
    }
  }
  lines.push('\nRespond with JSON: { "slots": [{ "slot_index": N, "text": "..." }, ...] }');
  lines.push('Only include slots you want to change. Skip [FIXED] slots.');
  return lines.join('\n');
}

export function parseSlotsResponse(raw: string, section?: ...): DocumentPartDraft {
  const json = JSON.parse(extractJsonFromResponse(raw));
  const slots: SlotDraftEntry[] = [];
  for (const s of json.slots ?? []) {
    if (typeof s.slot_index !== 'number' || typeof s.text !== 'string') {
      throw new Error('invalid slot entry');
    }
    if (section) {
      const d = section.fill_region.paragraph_details.find((x) => x.slot_index === s.slot_index);
      if (d && (d.has_drawing || d.has_complex_content)) {
        throw new Error(`slot_index ${s.slot_index} is non-draftable`);
      }
    }
    slots.push({ slot_index: s.slot_index, text: s.text });
  }
  return { kind: 'document_part', slots };
}
```

- [ ] **Step 4: Dispatch in orchestrator.ts**

Find the section-drafting entry point and branch on `section.fill_region.kind`:

```typescript
if (section.fill_region.kind === 'document_part') {
  return draftDocumentPart(template, section as any, ctx, llm);
}
// existing body path
```

- [ ] **Step 5: Run tests, verify PASS**

- [ ] **Step 6: Commit**

```bash
git add src/lib/draft/
git commit -m "feat(draft): per-slot letterhead drafter + dispatch on fill_region.kind"
```

### Task 5.3 — Preflight budget branches on kind

**Files:**
- Modify: `src/lib/agent/preflight.ts`
- Modify: `src/lib/agent/preflight.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
it('estimates document_part budget based on draftable slot count, not target_words', () => {
  const est = estimateSectionTokens(documentPartSectionWith3DraftableSlots);
  expect(est.output_tokens).toBeLessThan(600);  // ~150 per slot
  expect(est.output_tokens).toBeGreaterThan(300);
});
```

- [ ] **Step 2: Run, verify FAIL**

- [ ] **Step 3: Implement branch**

```typescript
export function estimateSectionTokens(section: BodyFillRegion): { input_tokens: number; output_tokens: number } {
  if (section.fill_region.kind === 'document_part') {
    const draftable = section.fill_region.paragraph_details.filter(
      (d) => !d.has_drawing && !d.has_complex_content,
    ).length;
    return { input_tokens: 200 + draftable * 80, output_tokens: draftable * 150 };
  }
  // existing body formula
}
```

- [ ] **Step 4: Run tests, verify PASS**

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent/preflight.ts src/lib/agent/preflight.test.ts
git commit -m "feat(preflight): kind-based token budget for document_part sections"
```

---

## Phase 6 — UI: re-synthesize indicator

### Task 6.1 — "Re-synthesize" pill on templates missing new fields

**Files:**
- Modify: `src/routes/Templates.tsx`

- [ ] **Step 1: Add helper**

```typescript
function needsResynthesisForLetterhead(schema: TemplateSchema): boolean {
  const hasBodyWithStyleNotes = schema.sections.some(
    (s) => s.fill_region.kind === 'heading_bounded' && s.style_notes != null,
  );
  const hasDocumentPartSlots = schema.sections.some(
    (s) => s.fill_region.kind === 'document_part' && s.fill_region.slots != null,
  );
  const anyDocumentPart = schema.sections.some((s) => s.fill_region.kind === 'document_part');
  return !hasBodyWithStyleNotes || (anyDocumentPart && !hasDocumentPartSlots);
}
```

- [ ] **Step 2: Render pill on each template card**

Where each template card renders its controls, add:

```tsx
{needsResynthesisForLetterhead(tpl.schema_json) && (
  <button className="pill-warning" onClick={() => onSynthesize(tpl)}>
    Re-synthesize for full letterhead support
  </button>
)}
```

Reuse the existing onSynthesize handler.

- [ ] **Step 3: Manual smoke test**

```bash
npm run dev
```

Open `/templates`, confirm the pill shows on old templates and disappears after re-synthesizing.

- [ ] **Step 4: Commit**

```bash
git add src/routes/Templates.tsx
git commit -m "feat(ui): re-synthesize pill on templates missing style_notes or slots"
```

---

## Phase 7 — Integration verification

### Task 7.1 — End-to-end on real MFR fixture (local-only)

- [ ] **Step 1: Build release bundle**

```
npm run build
```

Expected: `release/index.html` produced with the new code path.

- [ ] **Step 2: Run full test suite**

```
npx vitest run && npx tsc --noEmit
```

All green.

- [ ] **Step 3: Manual verification script**

Run a Node script analogous to the `verify.mjs` used during diagnosis (see conversation in `2026-04-14-letterhead-slot-rewrite-design.md` Section 7f):

1. Parse the local `src/test/fixtures/MFR Template.docx` (not committed).
2. Synthesize (or mock the synthesis with hardcoded slots + style_notes).
3. Draft: emit a `DocumentPartDraft` with slot rewrites for the unit-name and address slots.
4. Assemble.
5. Inspect output zip:
   - `word/media/image1.png` present.
   - `word/_rels/header1.xml.rels` present.
   - `word/header1.xml` contains `<w:drawing`.
   - Drafted slot text appears in the right paragraph.
   - Original paragraph count in `<w:hdr>` unchanged.

- [ ] **Step 4: Commit release bundle**

```bash
git add release/index.html
git commit -m "chore: rebuild release bundle after letterhead slot rewrite"
```

---

## Self-review findings

- **Spec coverage:** every subsystem in the spec (parser, synthesizer, assembler, drafter, UI, Dexie migration) has at least one task. `visual_style` fallback, manual numbering, source_text validation, leakage, retry loop, re-synthesize pill all covered.
- **Placeholder scan:** all code blocks contain actual code. Test stubs that say `/* ... */` are for cases that are variants of an adjacent test already spelled out in full — if the engineer copies the adjacent pattern, they'll be fine. No `TODO`/`TBD` tokens.
- **Type consistency:** `VisualStyle` (template/types.ts) and `LLMVisualStyle` (synthesis/types.ts) are structurally identical and `export type VisualStyle = LLMVisualStyle;` makes the alias explicit. `SectionDraft`, `DocumentPartDraft`, `BodyDraft`, `SlotDraftEntry` consistent between types.ts and call sites. `processDocumentPartSlots` signature stable across tasks 4.1 and references.
- **Ordering:** phases are linear. Phase 2 (types) must precede the consumers in phases 3–5. Phase 4 can in principle run before phase 3 but the merger validation in 3.2 depends on the parser's `paragraph_details` from phase 1.

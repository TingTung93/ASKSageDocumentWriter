# DOCX Formatting Backbone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a shared DOCX structure and formatting backbone that improves template drafting, finished-document editing, and freeform DOCX writing without allowing raw OOXML from the LLM.

**Architecture:** Add a workflow-neutral `src/lib/docx/` layer for structured blocks, validation/repair, formatting inventory, and reusable OOXML builders. Wire the layer into template export first as a compatibility-preserving normalization pass, then use the same builders to improve freeform DOCX output and add a conservative high-level editing planner that lowers safe proposals into existing `DocumentEditOp` operations.

**Tech Stack:** TypeScript, React, Vite, Vitest, jsdom, JSZip, existing DOCX parser/export/edit modules.

---

## File Structure

- Create `src/lib/docx/ir.ts`: typed structured document blocks plus conversion helpers to and from existing `DraftParagraph[]`.
- Create `src/lib/docx/ir.test.ts`: unit tests for table-row normalization, page-break normalization, and compatibility flattening.
- Create `src/lib/docx/validate.ts`: deterministic validator and safe repair rules for structured blocks.
- Create `src/lib/docx/validate.test.ts`: unit tests for level clamping, invalid roles, empty runs, table padding, and diagnostics.
- Create `src/lib/docx/formatting.ts`: workflow-neutral formatting inventory derived from `TemplateSchema` or built-in freeform defaults.
- Create `src/lib/docx/formatting.test.ts`: unit tests for style/list/table/header-footer inventory extraction.
- Create `src/lib/docx/ooxml.ts`: reusable DOM-based paragraph, run, table, and XML helpers.
- Create `src/lib/docx/ooxml.test.ts`: unit tests against serialized OOXML.
- Modify `src/lib/export/assemble.ts`: normalize and validate section drafts before existing section assembly.
- Modify `src/lib/export/assemble.test.ts`: assert repaired table rows and invalid role degradation.
- Modify `src/lib/freeform/assemble.ts`: normalize/validate freeform paragraphs and use shared OOXML builders for body content.
- Create `src/lib/freeform/assemble.test.ts`: verify richer freeform tables, runs, lists, and valid DOCX parts.
- Create `src/lib/document/plan.ts`: high-level edit-plan proposal types and lowering into existing `DocumentEditOp` operations.
- Create `src/lib/document/plan.test.ts`: verify safe lowering and rejection of ambiguous or unsupported operations.
- Modify `src/lib/draft/prompt.ts`: update LLM contract text to describe the unified structured output rules.
- Modify `src/lib/document/edit.ts`: update finished-document editing prompt to separate content, formatting, and structural operations.

## Scope Notes

This plan implements the first complete shared-backbone slice. It does not add image/chart insertion, visual screenshots, or a full edit-review UI redesign. It does add diagnostics in returned assembly statuses so UI surfacing can be built incrementally without changing the whole export flow.

### Task 1: Structured IR and Compatibility Normalization

**Files:**
- Create: `src/lib/docx/ir.ts`
- Create: `src/lib/docx/ir.test.ts`

- [ ] **Step 1: Write failing IR tests**

Create `src/lib/docx/ir.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { DraftParagraph } from '../draft/types';
import {
  normalizeDraftParagraphs,
  structuredBlocksToDraftParagraphs,
} from './ir';

describe('normalizeDraftParagraphs', () => {
  it('collapses consecutive table_row paragraphs into a table block', () => {
    const input: DraftParagraph[] = [
      { role: 'body', text: 'Intro.' },
      { role: 'table_row', text: '', is_header: true, cells: ['Role', 'Duty'] },
      { role: 'table_row', text: '', cells: ['CO', 'Award'] },
      { role: 'body', text: 'Outro.' },
    ];

    const blocks = normalizeDraftParagraphs(input);

    expect(blocks).toHaveLength(3);
    expect(blocks[1]).toMatchObject({
      kind: 'table',
      rows: [
        { is_header: true, cells: [{ text: 'Role' }, { text: 'Duty' }] },
        { is_header: false, cells: [{ text: 'CO' }, { text: 'Award' }] },
      ],
    });
  });

  it('converts page_break_before into an explicit page_break block', () => {
    const blocks = normalizeDraftParagraphs([
      { role: 'heading', text: 'Appendix', page_break_before: true },
    ]);

    expect(blocks.map((b) => b.kind)).toEqual(['page_break', 'paragraph']);
    expect(blocks[1]).toMatchObject({ kind: 'paragraph', role: 'heading', text: 'Appendix' });
  });

  it('round-trips normalized tables back to legacy DraftParagraph rows', () => {
    const input: DraftParagraph[] = [
      { role: 'table_row', text: '', is_header: true, cells: ['A', 'B'] },
      { role: 'table_row', text: '', cells: ['1', '2'] },
    ];

    const flattened = structuredBlocksToDraftParagraphs(normalizeDraftParagraphs(input));

    expect(flattened).toEqual(input);
  });
});
```

- [ ] **Step 2: Run the failing IR tests**

Run: `npm test -- src/lib/docx/ir.test.ts`

Expected: FAIL with an import error for `./ir`.

- [ ] **Step 3: Implement the IR module**

Create `src/lib/docx/ir.ts`:

```ts
import type { DraftParagraph, DraftRun, ParagraphRole } from '../draft/types';

export type StructuredBlock =
  | StructuredParagraphBlock
  | StructuredTableBlock
  | StructuredPageBreakBlock;

export interface StructuredParagraphBlock {
  kind: 'paragraph';
  role: Exclude<ParagraphRole, 'table_row'>;
  text: string;
  runs?: DraftRun[];
  level?: number;
  page_break_before?: boolean;
  alignment?: DraftParagraph['alignment'];
  indent_left_pt?: number;
  spacing_before_pt?: number;
  spacing_after_pt?: number;
}

export interface StructuredTableCell {
  text: string;
  shading?: string | null;
  colspan?: number;
  width_pct?: number;
  runs?: DraftRun[];
}

export interface StructuredTableRow {
  is_header: boolean;
  cells: StructuredTableCell[];
}

export interface StructuredTableBlock {
  kind: 'table';
  rows: StructuredTableRow[];
}

export interface StructuredPageBreakBlock {
  kind: 'page_break';
}

const PARAGRAPH_ROLES = new Set<ParagraphRole>([
  'heading',
  'body',
  'step',
  'bullet',
  'note',
  'caution',
  'warning',
  'definition',
  'quote',
]);

export function isParagraphRole(role: string): role is StructuredParagraphBlock['role'] {
  return PARAGRAPH_ROLES.has(role as ParagraphRole);
}

export function normalizeDraftParagraphs(paragraphs: DraftParagraph[]): StructuredBlock[] {
  const blocks: StructuredBlock[] = [];
  let i = 0;

  while (i < paragraphs.length) {
    const p = paragraphs[i]!;

    if (p.role === 'table_row') {
      const rows: StructuredTableRow[] = [];
      while (i < paragraphs.length && paragraphs[i]!.role === 'table_row') {
        const row = paragraphs[i]!;
        const cells = (row.cells && row.cells.length > 0 ? row.cells : [row.text]).map(
          (text, cellIndex): StructuredTableCell => ({
            text,
            shading: row.cell_shading?.[cellIndex],
            colspan: row.cell_colspans?.[cellIndex],
            width_pct: row.cell_widths_pct?.[cellIndex],
          }),
        );
        rows.push({ is_header: row.is_header === true, cells });
        i += 1;
      }
      blocks.push({ kind: 'table', rows });
      continue;
    }

    if (p.page_break_before) {
      blocks.push({ kind: 'page_break' });
    }

    blocks.push({
      kind: 'paragraph',
      role: isParagraphRole(p.role) ? p.role : 'body',
      text: p.text ?? '',
      runs: p.runs,
      level: p.level,
      alignment: p.alignment,
      indent_left_pt: p.indent_left_pt,
      spacing_before_pt: p.spacing_before_pt,
      spacing_after_pt: p.spacing_after_pt,
    });
    i += 1;
  }

  return blocks;
}

export function structuredBlocksToDraftParagraphs(blocks: StructuredBlock[]): DraftParagraph[] {
  const out: DraftParagraph[] = [];
  let pendingPageBreak = false;

  for (const block of blocks) {
    if (block.kind === 'page_break') {
      pendingPageBreak = true;
      continue;
    }

    if (block.kind === 'table') {
      for (const row of block.rows) {
        const draftRow: DraftParagraph = {
          role: 'table_row',
          text: '',
          is_header: row.is_header,
          cells: row.cells.map((c) => c.text),
          page_break_before: pendingPageBreak || undefined,
        };
        const shading = row.cells.map((c) => c.shading ?? '');
        if (shading.some((v) => v.length > 0)) draftRow.cell_shading = shading;
        const colspans = row.cells.map((c) => c.colspan ?? 1);
        if (colspans.some((v) => v !== 1)) draftRow.cell_colspans = colspans;
        const widths = row.cells.map((c) => c.width_pct ?? 0);
        if (widths.some((v) => v > 0)) draftRow.cell_widths_pct = widths;
        out.push(draftRow);
        pendingPageBreak = false;
      }
      continue;
    }

    out.push({
      role: block.role,
      text: block.text,
      runs: block.runs,
      level: block.level,
      alignment: block.alignment,
      indent_left_pt: block.indent_left_pt,
      spacing_before_pt: block.spacing_before_pt,
      spacing_after_pt: block.spacing_after_pt,
      page_break_before: pendingPageBreak || undefined,
    });
    pendingPageBreak = false;
  }

  return out;
}
```

- [ ] **Step 4: Run the IR tests**

Run: `npm test -- src/lib/docx/ir.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add src/lib/docx/ir.ts src/lib/docx/ir.test.ts
git commit -m "feat: add structured DOCX block IR"
```

### Task 2: Deterministic Structured Block Validator

**Files:**
- Create: `src/lib/docx/validate.ts`
- Create: `src/lib/docx/validate.test.ts`

- [ ] **Step 1: Write failing validator tests**

Create `src/lib/docx/validate.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { StructuredBlock } from './ir';
import { validateStructuredBlocks } from './validate';

describe('validateStructuredBlocks', () => {
  it('clamps excessive paragraph levels and reports a warning', () => {
    const blocks: StructuredBlock[] = [
      { kind: 'paragraph', role: 'bullet', text: 'Deep item', level: 99 },
    ];

    const result = validateStructuredBlocks(blocks, { repair: true });

    expect(result.ok).toBe(true);
    expect(result.blocks[0]).toMatchObject({ kind: 'paragraph', level: 8 });
    expect(result.diagnostics[0]).toMatchObject({
      severity: 'warning',
      code: 'level_clamped',
    });
  });

  it('converts roles outside the permitted set to body when repair is enabled', () => {
    const blocks: StructuredBlock[] = [
      { kind: 'paragraph', role: 'warning', text: 'Unsafe role' },
    ];

    const result = validateStructuredBlocks(blocks, {
      repair: true,
      permittedRoles: new Set(['body']),
    });

    expect(result.blocks[0]).toMatchObject({ kind: 'paragraph', role: 'body' });
    expect(result.diagnostics[0]).toMatchObject({ code: 'role_repaired' });
  });

  it('removes empty runs from rich paragraphs', () => {
    const blocks: StructuredBlock[] = [
      {
        kind: 'paragraph',
        role: 'body',
        text: '',
        runs: [{ text: '' }, { text: 'Keep me', bold: true }],
      },
    ];

    const result = validateStructuredBlocks(blocks, { repair: true });

    expect(result.blocks[0]).toMatchObject({
      kind: 'paragraph',
      runs: [{ text: 'Keep me', bold: true }],
    });
    expect(result.diagnostics.map((d) => d.code)).toContain('empty_run_removed');
  });

  it('pads short table rows to the widest row', () => {
    const blocks: StructuredBlock[] = [
      {
        kind: 'table',
        rows: [
          { is_header: true, cells: [{ text: 'A' }, { text: 'B' }] },
          { is_header: false, cells: [{ text: '1' }] },
        ],
      },
    ];

    const result = validateStructuredBlocks(blocks, { repair: true });

    expect(result.blocks[0]).toMatchObject({
      kind: 'table',
      rows: [
        { cells: [{ text: 'A' }, { text: 'B' }] },
        { cells: [{ text: '1' }, { text: '' }] },
      ],
    });
  });

  it('blocks invalid roles when repair is disabled', () => {
    const blocks: StructuredBlock[] = [
      { kind: 'paragraph', role: 'warning', text: 'Unsafe role' },
    ];

    const result = validateStructuredBlocks(blocks, {
      repair: false,
      permittedRoles: new Set(['body']),
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]).toMatchObject({
      severity: 'error',
      code: 'role_not_permitted',
    });
  });
});
```

- [ ] **Step 2: Run validator tests and verify failure**

Run: `npm test -- src/lib/docx/validate.test.ts`

Expected: FAIL with an import error for `./validate`.

- [ ] **Step 3: Implement validator**

Create `src/lib/docx/validate.ts`:

```ts
import type { ParagraphRole } from '../draft/types';
import type {
  StructuredBlock,
  StructuredParagraphBlock,
  StructuredTableBlock,
} from './ir';

export type DiagnosticSeverity = 'warning' | 'error';

export interface StructureDiagnostic {
  severity: DiagnosticSeverity;
  code:
    | 'level_clamped'
    | 'role_not_permitted'
    | 'role_repaired'
    | 'empty_run_removed'
    | 'table_row_padded'
    | 'empty_table_removed';
  message: string;
  path: string;
}

export interface ValidateStructuredBlocksOptions {
  repair?: boolean;
  maxLevel?: number;
  permittedRoles?: Set<ParagraphRole | StructuredParagraphBlock['role']>;
}

export interface ValidateStructuredBlocksResult {
  ok: boolean;
  blocks: StructuredBlock[];
  diagnostics: StructureDiagnostic[];
}

export function validateStructuredBlocks(
  input: StructuredBlock[],
  options: ValidateStructuredBlocksOptions = {},
): ValidateStructuredBlocksResult {
  const repair = options.repair === true;
  const maxLevel = options.maxLevel ?? 8;
  const diagnostics: StructureDiagnostic[] = [];
  const blocks: StructuredBlock[] = [];

  for (let blockIndex = 0; blockIndex < input.length; blockIndex++) {
    const block = cloneBlock(input[blockIndex]!);

    if (block.kind === 'paragraph') {
      validateParagraph(block, blockIndex, options, diagnostics);
      if (options.permittedRoles && !options.permittedRoles.has(block.role)) {
        if (repair) {
          diagnostics.push({
            severity: 'warning',
            code: 'role_repaired',
            path: `blocks[${blockIndex}].role`,
            message: `Role "${block.role}" is not permitted here; converted to "body".`,
          });
          block.role = 'body';
        } else {
          diagnostics.push({
            severity: 'error',
            code: 'role_not_permitted',
            path: `blocks[${blockIndex}].role`,
            message: `Role "${block.role}" is not permitted here.`,
          });
        }
      }

      if (typeof block.level === 'number') {
        const clamped = Math.max(0, Math.min(maxLevel, Math.floor(block.level)));
        if (clamped !== block.level) {
          diagnostics.push({
            severity: 'warning',
            code: 'level_clamped',
            path: `blocks[${blockIndex}].level`,
            message: `Level ${block.level} was clamped to ${clamped}.`,
          });
          if (repair) block.level = clamped;
        }
      }

      if (block.runs) {
        const before = block.runs.length;
        block.runs = block.runs.filter((r) => r.text.length > 0);
        if (block.runs.length !== before) {
          diagnostics.push({
            severity: 'warning',
            code: 'empty_run_removed',
            path: `blocks[${blockIndex}].runs`,
            message: 'Empty rich-text runs were removed.',
          });
        }
        if (block.runs.length === 0) delete block.runs;
      }

      blocks.push(block);
      continue;
    }

    if (block.kind === 'table') {
      const repaired = validateTable(block, blockIndex, repair, diagnostics);
      if (repaired.rows.length > 0) {
        blocks.push(repaired);
      } else {
        diagnostics.push({
          severity: repair ? 'warning' : 'error',
          code: 'empty_table_removed',
          path: `blocks[${blockIndex}]`,
          message: 'Table contains no rows.',
        });
      }
      continue;
    }

    blocks.push(block);
  }

  return {
    ok: diagnostics.every((d) => d.severity !== 'error'),
    blocks,
    diagnostics,
  };
}

function validateParagraph(
  block: StructuredParagraphBlock,
  blockIndex: number,
  _options: ValidateStructuredBlocksOptions,
  diagnostics: StructureDiagnostic[],
): void {
  if (block.text.length === 0 && (!block.runs || block.runs.length === 0)) {
    diagnostics.push({
      severity: 'warning',
      code: 'empty_run_removed',
      path: `blocks[${blockIndex}]`,
      message: 'Paragraph has no visible text.',
    });
  }
}

function validateTable(
  table: StructuredTableBlock,
  blockIndex: number,
  repair: boolean,
  diagnostics: StructureDiagnostic[],
): StructuredTableBlock {
  const widest = Math.max(0, ...table.rows.map((r) => r.cells.length));
  if (widest === 0) return table;

  const rows = table.rows.map((row, rowIndex) => {
    const cells = [...row.cells];
    while (repair && cells.length < widest) {
      cells.push({ text: '' });
      diagnostics.push({
        severity: 'warning',
        code: 'table_row_padded',
        path: `blocks[${blockIndex}].rows[${rowIndex}].cells`,
        message: `Table row ${rowIndex} was padded to ${widest} cells.`,
      });
    }
    return { ...row, cells };
  });

  return { ...table, rows };
}

function cloneBlock(block: StructuredBlock): StructuredBlock {
  return JSON.parse(JSON.stringify(block)) as StructuredBlock;
}
```

- [ ] **Step 4: Run validator tests**

Run: `npm test -- src/lib/docx/validate.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add src/lib/docx/validate.ts src/lib/docx/validate.test.ts
git commit -m "feat: validate structured DOCX blocks"
```

### Task 3: Formatting Inventory Adapter

**Files:**
- Create: `src/lib/docx/formatting.ts`
- Create: `src/lib/docx/formatting.test.ts`

- [ ] **Step 1: Write failing inventory tests**

Create `src/lib/docx/formatting.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { TemplateSchema } from '../template/types';
import { buildDefaultFormattingInventory, buildFormattingInventory } from './formatting';

function schema(): TemplateSchema {
  return {
    $schema: 'asksage-document-template/v1',
    id: 'tpl',
    name: 'Template',
    version: 1,
    source: {
      filename: 'template.docx',
      ingested_at: '2026-07-01T00:00:00.000Z',
      structural_parser_version: 'test',
      semantic_synthesizer: null,
      docx_blob_id: 'blob',
    },
    formatting: {
      page_setup: {
        paper: 'letter',
        orientation: 'portrait',
        margins_twips: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
        header_distance: 720,
        footer_distance: 720,
      },
      default_font: { family: 'Calibri', size_pt: 11 },
      theme: null,
      named_styles: [
        { id: 'Normal', name: 'Normal', type: 'paragraph', based_on: null, outline_level: null, numbering_id: null, alignment: null, indent_left_twips: null, indent_first_line_twips: null, indent_hanging_twips: null },
        { id: 'Heading1', name: 'heading 1', type: 'paragraph', based_on: 'Normal', outline_level: 0, numbering_id: null, alignment: null, indent_left_twips: null, indent_first_line_twips: null, indent_hanging_twips: null },
        { id: 'TableGrid', name: 'Table Grid', type: 'table', based_on: null, outline_level: null, numbering_id: null, alignment: null, indent_left_twips: null, indent_first_line_twips: null, indent_hanging_twips: null },
      ],
      numbering_definitions: [
        { id: 1, abstract_id: 10, levels: [{ level: 0, format: 'bullet', text: '\u2022', indent_twips: 720 }] },
      ],
      headers: [{ type: 'default', part: 'word/header1.xml' }],
      footers: [{ type: 'default', part: 'word/footer1.xml' }],
    },
    metadata_fill_regions: [],
    sections: [],
    style: { voice: null, tense: null, register: null, jargon_policy: null, banned_phrases: [] },
  };
}

describe('buildFormattingInventory', () => {
  it('collects style ids, list templates, table styles, and document parts', () => {
    const inventory = buildFormattingInventory(schema());

    expect(inventory.paragraphStyleIds).toEqual(new Set(['Normal', 'Heading1']));
    expect(inventory.tableStyleIds).toEqual(new Set(['TableGrid']));
    expect(inventory.listTemplates).toEqual([{ num_id: 1, levels: [0] }]);
    expect(inventory.headerFooterParts).toEqual(['word/header1.xml', 'word/footer1.xml']);
    expect(inventory.defaultFont).toEqual({ family: 'Calibri', size_pt: 11 });
  });
});

describe('buildDefaultFormattingInventory', () => {
  it('returns a usable freeform default inventory', () => {
    const inventory = buildDefaultFormattingInventory();

    expect(inventory.paragraphStyleIds.has('Normal')).toBe(true);
    expect(inventory.paragraphStyleIds.has('Heading1')).toBe(true);
    expect(inventory.tableStyleIds.has('TableGrid')).toBe(true);
    expect(inventory.listTemplates.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run inventory tests and verify failure**

Run: `npm test -- src/lib/docx/formatting.test.ts`

Expected: FAIL with an import error for `./formatting`.

- [ ] **Step 3: Implement formatting inventory**

Create `src/lib/docx/formatting.ts`:

```ts
import type { TemplateSchema } from '../template/types';

export interface FormattingInventory {
  paragraphStyleIds: Set<string>;
  tableStyleIds: Set<string>;
  characterStyleIds: Set<string>;
  listTemplates: Array<{ num_id: number; levels: number[] }>;
  headerFooterParts: string[];
  defaultFont: { family: string | null; size_pt: number | null };
}

export function buildFormattingInventory(schema: TemplateSchema): FormattingInventory {
  const paragraphStyleIds = new Set<string>();
  const tableStyleIds = new Set<string>();
  const characterStyleIds = new Set<string>();

  for (const style of schema.formatting.named_styles) {
    if (style.type === 'paragraph') paragraphStyleIds.add(style.id);
    if (style.type === 'table') tableStyleIds.add(style.id);
    if (style.type === 'character') characterStyleIds.add(style.id);
  }

  return {
    paragraphStyleIds,
    tableStyleIds,
    characterStyleIds,
    listTemplates: schema.formatting.numbering_definitions.map((n) => ({
      num_id: n.id,
      levels: n.levels.map((l) => l.level),
    })),
    headerFooterParts: [
      ...schema.formatting.headers.map((h) => h.part),
      ...schema.formatting.footers.map((f) => f.part),
    ],
    defaultFont: schema.formatting.default_font,
  };
}

export function buildDefaultFormattingInventory(): FormattingInventory {
  return {
    paragraphStyleIds: new Set([
      'Normal',
      'Heading1',
      'Heading2',
      'Heading3',
      'Heading4',
      'ListBullet',
      'ListNumber',
      'Quote',
    ]),
    tableStyleIds: new Set(['TableGrid']),
    characterStyleIds: new Set(),
    listTemplates: [
      { num_id: 1, levels: [0, 1, 2, 3, 4, 5, 6, 7, 8] },
      { num_id: 2, levels: [0, 1, 2, 3, 4, 5, 6, 7, 8] },
    ],
    headerFooterParts: [],
    defaultFont: { family: 'Calibri', size_pt: 11 },
  };
}
```

- [ ] **Step 4: Run inventory tests**

Run: `npm test -- src/lib/docx/formatting.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

```bash
git add src/lib/docx/formatting.ts src/lib/docx/formatting.test.ts
git commit -m "feat: add DOCX formatting inventory"
```

### Task 4: Shared OOXML Builders

**Files:**
- Create: `src/lib/docx/ooxml.ts`
- Create: `src/lib/docx/ooxml.test.ts`

- [ ] **Step 1: Write failing OOXML builder tests**

Create `src/lib/docx/ooxml.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { StructuredTableBlock } from './ir';
import {
  W_NS,
  appendTextRun,
  buildParagraphElement,
  buildTableElement,
  createWordDocument,
  serializeXml,
} from './ooxml';

describe('OOXML builders', () => {
  it('builds rich paragraph runs with toggles', () => {
    const dom = createWordDocument();
    const p = buildParagraphElement(dom, {
      kind: 'paragraph',
      role: 'body',
      text: '',
      runs: [
        { text: 'The ' },
        { text: 'term', bold: true, italic: true },
      ],
    });

    const xml = serializeXml(p);

    expect(xml).toContain('<w:b');
    expect(xml).toContain('<w:i');
    expect(xml).toContain('term');
  });

  it('adds pageBreakBefore when requested', () => {
    const dom = createWordDocument();
    const p = buildParagraphElement(dom, {
      kind: 'paragraph',
      role: 'heading',
      text: 'Appendix',
      page_break_before: true,
    } as never);

    expect(serializeXml(p)).toContain('<w:pageBreakBefore');
  });

  it('builds a table with header rows and padded cells', () => {
    const dom = createWordDocument();
    const table: StructuredTableBlock = {
      kind: 'table',
      rows: [
        { is_header: true, cells: [{ text: 'Role' }, { text: 'Duty' }] },
        { is_header: false, cells: [{ text: 'CO' }, { text: 'Award' }] },
      ],
    };

    const tbl = buildTableElement(dom, table);
    const xml = serializeXml(tbl);

    expect(tbl.namespaceURI).toBe(W_NS);
    expect(xml).toContain('<w:tblHeader');
    expect(xml).toContain('Role');
    expect(xml).toContain('Award');
  });

  it('appends a run with preserved whitespace', () => {
    const dom = createWordDocument();
    const p = dom.createElementNS(W_NS, 'w:p');
    appendTextRun(dom, p, '  spaced  ');

    expect(serializeXml(p)).toContain('xml:space="preserve"');
  });
});
```

- [ ] **Step 2: Run OOXML tests and verify failure**

Run: `npm test -- src/lib/docx/ooxml.test.ts`

Expected: FAIL with an import error for `./ooxml`.

- [ ] **Step 3: Implement shared OOXML builders**

Create `src/lib/docx/ooxml.ts`:

```ts
import type { DraftRun } from '../draft/types';
import type { StructuredParagraphBlock, StructuredTableBlock } from './ir';

export const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

export function createWordDocument(): Document {
  return new DOMParser().parseFromString(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W_NS}"><w:body/></w:document>`,
    'text/xml',
  );
}

export function serializeXml(node: Node): string {
  return new XMLSerializer().serializeToString(node);
}

export function firstChildNS(parent: Element, localName: string): Element | null {
  for (let n = parent.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1 && (n as Element).namespaceURI === W_NS && (n as Element).localName === localName) {
      return n as Element;
    }
  }
  return null;
}

export function appendTextRun(dom: Document, parent: Element, text: string, run?: DraftRun): Element {
  const r = dom.createElementNS(W_NS, 'w:r');
  const rPr = buildRunProperties(dom, run);
  if (rPr) r.appendChild(rPr);

  const t = dom.createElementNS(W_NS, 'w:t');
  t.setAttribute('xml:space', 'preserve');
  t.textContent = text;
  r.appendChild(t);
  parent.appendChild(r);
  return r;
}

export function buildParagraphElement(
  dom: Document,
  block: StructuredParagraphBlock & { page_break_before?: boolean },
): Element {
  const p = dom.createElementNS(W_NS, 'w:p');
  const pPr = dom.createElementNS(W_NS, 'w:pPr');
  p.appendChild(pPr);

  const style = styleIdForRole(block.role, block.level ?? 0);
  const pStyle = dom.createElementNS(W_NS, 'w:pStyle');
  pStyle.setAttributeNS(W_NS, 'w:val', style);
  pPr.appendChild(pStyle);

  if (block.page_break_before) {
    pPr.appendChild(dom.createElementNS(W_NS, 'w:pageBreakBefore'));
  }

  if (block.alignment) {
    const jc = dom.createElementNS(W_NS, 'w:jc');
    jc.setAttributeNS(W_NS, 'w:val', block.alignment);
    pPr.appendChild(jc);
  }

  if (typeof block.level === 'number' && block.level > 0 && block.role !== 'heading') {
    const ind = dom.createElementNS(W_NS, 'w:ind');
    ind.setAttributeNS(W_NS, 'w:left', String(block.level * 720));
    pPr.appendChild(ind);
  }

  if (block.runs && block.runs.length > 0) {
    for (const run of block.runs) appendTextRun(dom, p, run.text, run);
  } else {
    appendTextRun(dom, p, block.text);
  }

  return p;
}

export function buildTableElement(dom: Document, table: StructuredTableBlock): Element {
  const tbl = dom.createElementNS(W_NS, 'w:tbl');
  const tblPr = dom.createElementNS(W_NS, 'w:tblPr');
  const tblStyle = dom.createElementNS(W_NS, 'w:tblStyle');
  tblStyle.setAttributeNS(W_NS, 'w:val', 'TableGrid');
  tblPr.appendChild(tblStyle);
  tbl.appendChild(tblPr);

  for (const row of table.rows) {
    const tr = dom.createElementNS(W_NS, 'w:tr');
    if (row.is_header) {
      const trPr = dom.createElementNS(W_NS, 'w:trPr');
      trPr.appendChild(dom.createElementNS(W_NS, 'w:tblHeader'));
      tr.appendChild(trPr);
    }

    for (const cell of row.cells) {
      const tc = dom.createElementNS(W_NS, 'w:tc');
      const tcPr = dom.createElementNS(W_NS, 'w:tcPr');
      if (cell.shading) {
        const shd = dom.createElementNS(W_NS, 'w:shd');
        shd.setAttributeNS(W_NS, 'w:fill', cell.shading);
        tcPr.appendChild(shd);
      }
      if (cell.colspan && cell.colspan > 1) {
        const gridSpan = dom.createElementNS(W_NS, 'w:gridSpan');
        gridSpan.setAttributeNS(W_NS, 'w:val', String(cell.colspan));
        tcPr.appendChild(gridSpan);
      }
      tc.appendChild(tcPr);
      const p = dom.createElementNS(W_NS, 'w:p');
      appendTextRun(dom, p, cell.text, row.is_header ? { text: cell.text, bold: true } : undefined);
      tc.appendChild(p);
      tr.appendChild(tc);
    }

    tbl.appendChild(tr);
  }

  return tbl;
}

function buildRunProperties(dom: Document, run: DraftRun | undefined): Element | null {
  if (!run) return null;
  const rPr = dom.createElementNS(W_NS, 'w:rPr');
  if (run.bold !== undefined) appendToggle(dom, rPr, 'b', run.bold);
  if (run.italic !== undefined) appendToggle(dom, rPr, 'i', run.italic);
  if (run.underline !== undefined) appendToggle(dom, rPr, 'u', run.underline, 'single');
  if (run.strike !== undefined) appendToggle(dom, rPr, 'strike', run.strike);
  if (run.color) {
    const color = dom.createElementNS(W_NS, 'w:color');
    color.setAttributeNS(W_NS, 'w:val', run.color.replace(/^#/, ''));
    rPr.appendChild(color);
  }
  if (run.highlight) {
    const highlight = dom.createElementNS(W_NS, 'w:highlight');
    highlight.setAttributeNS(W_NS, 'w:val', run.highlight);
    rPr.appendChild(highlight);
  }
  return rPr.firstChild ? rPr : null;
}

function appendToggle(
  dom: Document,
  rPr: Element,
  tag: 'b' | 'i' | 'u' | 'strike',
  value: boolean,
  valWhenTrue?: string,
): void {
  const el = dom.createElementNS(W_NS, `w:${tag}`);
  if (!value) el.setAttributeNS(W_NS, 'w:val', 'false');
  if (value && valWhenTrue) el.setAttributeNS(W_NS, 'w:val', valWhenTrue);
  rPr.appendChild(el);
}

function styleIdForRole(role: StructuredParagraphBlock['role'], level: number): string {
  if (role === 'heading') return `Heading${Math.min(level + 1, 4)}`;
  if (role === 'bullet') return 'ListBullet';
  if (role === 'step') return 'ListNumber';
  if (role === 'quote') return 'Quote';
  return 'Normal';
}
```

- [ ] **Step 4: Run OOXML tests**

Run: `npm test -- src/lib/docx/ooxml.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit Task 4**

```bash
git add src/lib/docx/ooxml.ts src/lib/docx/ooxml.test.ts
git commit -m "feat: add shared OOXML builders"
```

### Task 5: Wire Validation Into Template Export

**Files:**
- Modify: `src/lib/export/assemble.ts`
- Modify: `src/lib/export/assemble.test.ts`

- [ ] **Step 1: Add failing template-export validation tests**

Append to `src/lib/export/assemble.test.ts`:

```ts
describe('assembleProjectDocx structured validation', () => {
  it('repairs short table rows before assembly', async () => {
    const template = await loadAsTemplate(PUBLICATION);
    const section = template.schema_json.sections[0]!;
    const drafted = new Map([
      [
        section.id,
        [
          { role: 'table_row' as const, text: '', is_header: true, cells: ['A', 'B'] },
          { role: 'table_row' as const, text: '', cells: ['1'] },
        ],
      ],
    ]);

    const result = await assembleProjectDocx({ template, draftedBySectionId: drafted });

    expect(result.section_results[0]!.status.kind).toBe('assembled');
    expect(JSON.stringify(result.section_results[0]!.status)).toContain('table_row_padded');
  });
});
```

- [ ] **Step 2: Run the focused export test and verify failure**

Run: `npm test -- src/lib/export/assemble.test.ts`

Expected: FAIL because `AssembleSectionStatus` does not expose validation diagnostics.

- [ ] **Step 3: Add diagnostics to assembled statuses**

In `src/lib/export/assemble.ts`, import the new helpers:

```ts
import { normalizeDraftParagraphs, structuredBlocksToDraftParagraphs } from '../docx/ir';
import { validateStructuredBlocks, type StructureDiagnostic } from '../docx/validate';
```

Update the assembled status type:

```ts
export type AssembleSectionStatus =
  | {
      kind: 'assembled';
      paragraphs_replaced: number;
      paragraphs_inserted: number;
      validation_diagnostics?: StructureDiagnostic[];
    }
  | {
      kind: 'assembled_slots';
      slots_replaced: number;
      slots_preserved: number;
      slots_skipped_drawing: number;
    }
  | { kind: 'skipped_no_draft' }
  | { kind: 'skipped_unsupported_region'; reason: string }
  | { kind: 'failed'; error: string };
```

Inside `processSection`, replace:

```ts
  const draft = draftUnion.paragraphs;
```

with:

```ts
  const validation = validateStructuredBlocks(
    normalizeDraftParagraphs(draftUnion.paragraphs),
    {
      repair: true,
      permittedRoles: new Set(fr.permitted_roles ?? ['body']),
    },
  );
  const draft = structuredBlocksToDraftParagraphs(validation.blocks);
```

Then add `validation_diagnostics` to both `assembled` return objects in `processSection`:

```ts
      return {
        kind: 'assembled',
        paragraphs_replaced: group.paragraphs.length,
        paragraphs_inserted: newEls.length,
        validation_diagnostics: validation.diagnostics,
      };
```

and:

```ts
    return {
      kind: 'assembled',
      paragraphs_replaced: totalReplaced,
      paragraphs_inserted: totalInserted,
      validation_diagnostics: validation.diagnostics,
    };
```

- [ ] **Step 4: Run export tests**

Run: `npm test -- src/lib/export/assemble.test.ts`

Expected: PASS.

- [ ] **Step 5: Run related DOCX tests**

Run: `npm test -- src/lib/docx src/lib/export/assemble.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit Task 5**

```bash
git add src/lib/export/assemble.ts src/lib/export/assemble.test.ts
git commit -m "feat: validate template DOCX drafts before export"
```

### Task 6: Upgrade Freeform Assembly Through Shared Blocks

**Files:**
- Modify: `src/lib/freeform/assemble.ts`
- Create: `src/lib/freeform/assemble.test.ts`

- [ ] **Step 1: Write failing freeform assembly tests**

Create `src/lib/freeform/assemble.test.ts`:

```ts
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { assembleFreeformDocx } from './assemble';

async function documentXml(blob: Blob): Promise<string> {
  const zip = await JSZip.loadAsync(blob);
  const xml = await zip.file('word/document.xml')?.async('string');
  if (!xml) throw new Error('missing document.xml');
  return xml;
}

describe('assembleFreeformDocx', () => {
  it('builds rich runs through shared OOXML helpers', async () => {
    const result = await assembleFreeformDocx([
      {
        role: 'body',
        text: '',
        runs: [
          { text: 'Plain ' },
          { text: 'underlined', underline: true },
        ],
      },
    ]);

    const xml = await documentXml(result.blob);

    expect(xml).toContain('<w:u');
    expect(xml).toContain('underlined');
  });

  it('writes table cell shading through shared table builders', async () => {
    const result = await assembleFreeformDocx([
      { role: 'table_row', text: '', is_header: true, cells: ['A', 'B'], cell_shading: ['D9EAF7', 'D9EAF7'] },
      { role: 'table_row', text: '', cells: ['1', '2'] },
    ]);

    const xml = await documentXml(result.blob);

    expect(xml).toContain('D9EAF7');
  });
});
```

- [ ] **Step 2: Run freeform tests and verify failure or current gap**

Run: `npm test -- src/lib/freeform/assemble.test.ts`

Expected: FAIL because current freeform assembly does not use shared structured validation and may not pad rows through the shared path.

- [ ] **Step 3: Refactor body XML generation to use shared IR and builders**

In `src/lib/freeform/assemble.ts`, import the shared helpers:

```ts
import {
  normalizeDraftParagraphs,
} from '../docx/ir';
import { validateStructuredBlocks } from '../docx/validate';
import {
  buildParagraphElement,
  buildTableElement,
  createWordDocument,
  serializeXml,
  W_NS,
} from '../docx/ooxml';
```

Replace the existing `buildDocumentXml` implementation with:

```ts
function buildDocumentXml(paragraphs: DraftParagraph[]): string {
  const dom = createWordDocument();
  const body = dom.getElementsByTagNameNS(W_NS, 'body')[0];
  if (!body) throw new Error('internal error: created Word document has no body');

  const validation = validateStructuredBlocks(
    normalizeDraftParagraphs(paragraphs),
    { repair: true },
  );

  let nextParagraphGetsPageBreak = false;
  for (const block of validation.blocks) {
    if (block.kind === 'page_break') {
      nextParagraphGetsPageBreak = true;
      continue;
    }
    if (block.kind === 'table') {
      body.appendChild(buildTableElement(dom, block));
      nextParagraphGetsPageBreak = false;
      continue;
    }
    body.appendChild(
      buildParagraphElement(dom, {
        ...block,
        page_break_before: nextParagraphGetsPageBreak,
      }),
    );
    nextParagraphGetsPageBreak = false;
  }

  const sectPr = dom.createElementNS(W_NS, 'w:sectPr');
  const pgSz = dom.createElementNS(W_NS, 'w:pgSz');
  pgSz.setAttributeNS(W_NS, 'w:w', '12240');
  pgSz.setAttributeNS(W_NS, 'w:h', '15840');
  sectPr.appendChild(pgSz);
  const pgMar = dom.createElementNS(W_NS, 'w:pgMar');
  pgMar.setAttributeNS(W_NS, 'w:top', '1440');
  pgMar.setAttributeNS(W_NS, 'w:right', '1440');
  pgMar.setAttributeNS(W_NS, 'w:bottom', '1440');
  pgMar.setAttributeNS(W_NS, 'w:left', '1440');
  pgMar.setAttributeNS(W_NS, 'w:header', '720');
  pgMar.setAttributeNS(W_NS, 'w:footer', '720');
  pgMar.setAttributeNS(W_NS, 'w:gutter', '0');
  sectPr.appendChild(pgMar);
  body.appendChild(sectPr);

  return serializeXml(dom);
}
```

Keep `buildStylesXml`, `CONTENT_TYPES`, `ROOT_RELS`, `WORD_RELS`, and `assembleFreeformDocx` in place.

- [ ] **Step 4: Run freeform tests**

Run: `npm test -- src/lib/freeform/assemble.test.ts`

Expected: PASS.

- [ ] **Step 5: Run related tests**

Run: `npm test -- src/lib/freeform src/lib/docx`

Expected: PASS.

- [ ] **Step 6: Commit Task 6**

```bash
git add src/lib/freeform/assemble.ts src/lib/freeform/assemble.test.ts
git commit -m "feat: use shared DOCX builders for freeform export"
```

### Task 7: Conservative High-Level Edit Planner

**Files:**
- Create: `src/lib/document/plan.ts`
- Create: `src/lib/document/plan.test.ts`

- [ ] **Step 1: Write failing edit-planner tests**

Create `src/lib/document/plan.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { ParagraphInfo } from '../template/parser';
import { lowerEditPlan } from './plan';

const paragraphs: ParagraphInfo[] = [
  {
    index: 0,
    text: 'Old paragraph',
    runs: [{ index: 0, text: 'Old paragraph', bold: false, italic: false, underline: false, strike: false, color: null, highlight: null, font_family: null, font_size_pt: null, superscript: false, subscript: false, el: null as never }],
    style_id: 'Normal',
    outline_level: null,
    alignment: null,
    indent_left_twips: null,
    indent_first_line_twips: null,
    indent_hanging_twips: null,
    bold: false,
    italic: false,
    numbering_id: null,
    numbering_level: null,
    bookmark_starts: [],
    bookmark_ends: [],
    in_table: false,
    content_control_tag: null,
    el: null as never,
  },
];

describe('lowerEditPlan', () => {
  it('lowers role_style changes into set_paragraph_style ops', () => {
    const result = lowerEditPlan(
      [{ kind: 'apply_role_style', paragraph_index: 0, role: 'heading' }],
      paragraphs,
      new Set(['Normal', 'Heading1']),
    );

    expect(result.ops).toEqual([
      { op: 'set_paragraph_style', index: 0, style_id: 'Heading1', rationale: 'Apply heading style.' },
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  it('rejects style changes when the target paragraph does not exist', () => {
    const result = lowerEditPlan(
      [{ kind: 'apply_role_style', paragraph_index: 99, role: 'heading' }],
      paragraphs,
      new Set(['Normal', 'Heading1']),
    );

    expect(result.ops).toEqual([]);
    expect(result.diagnostics[0]).toMatchObject({ severity: 'error', code: 'paragraph_not_found' });
  });

  it('rejects heading style when no heading style exists', () => {
    const result = lowerEditPlan(
      [{ kind: 'apply_role_style', paragraph_index: 0, role: 'heading' }],
      paragraphs,
      new Set(['Normal']),
    );

    expect(result.ops).toEqual([]);
    expect(result.diagnostics[0]).toMatchObject({ severity: 'error', code: 'style_not_available' });
  });
});
```

- [ ] **Step 2: Run edit-planner tests and verify failure**

Run: `npm test -- src/lib/document/plan.test.ts`

Expected: FAIL with an import error for `./plan`.

- [ ] **Step 3: Implement conservative edit-plan lowering**

Create `src/lib/document/plan.ts`:

```ts
import type { ParagraphInfo } from '../template/parser';
import type { DocumentEditOp } from './types';

export type HighLevelEditPlan =
  | {
      kind: 'apply_role_style';
      paragraph_index: number;
      role: 'heading' | 'body' | 'quote' | 'bullet' | 'step';
      rationale?: string;
    };

type RoleStyle = Extract<HighLevelEditPlan, { kind: 'apply_role_style' }>['role'];

export interface EditPlanDiagnostic {
  severity: 'warning' | 'error';
  code: 'paragraph_not_found' | 'style_not_available';
  message: string;
}

export interface LowerEditPlanResult {
  ops: DocumentEditOp[];
  diagnostics: EditPlanDiagnostic[];
}

export function lowerEditPlan(
  plans: HighLevelEditPlan[],
  paragraphs: ParagraphInfo[],
  availableParagraphStyleIds: Set<string>,
): LowerEditPlanResult {
  const ops: DocumentEditOp[] = [];
  const diagnostics: EditPlanDiagnostic[] = [];
  const paragraphByIndex = new Map(paragraphs.map((p) => [p.index, p]));

  for (const plan of plans) {
    if (plan.kind === 'apply_role_style') {
      const paragraph = paragraphByIndex.get(plan.paragraph_index);
      if (!paragraph) {
        diagnostics.push({
          severity: 'error',
          code: 'paragraph_not_found',
          message: `Paragraph ${plan.paragraph_index} does not exist.`,
        });
        continue;
      }

      const styleId = styleForRole(plan.role, availableParagraphStyleIds);
      if (!styleId) {
        diagnostics.push({
          severity: 'error',
          code: 'style_not_available',
          message: `No paragraph style is available for role "${plan.role}".`,
        });
        continue;
      }

      ops.push({
        op: 'set_paragraph_style',
        index: paragraph.index,
        style_id: styleId,
        rationale: plan.rationale ?? `Apply ${plan.role} style.`,
      });
    }
  }

  return { ops, diagnostics };
}

function styleForRole(
  role: RoleStyle,
  available: Set<string>,
): string | null {
  const candidates: Record<string, string[]> = {
    heading: ['Heading1', 'Heading 1'],
    body: ['BodyText', 'Body Text', 'Normal'],
    quote: ['Quote', 'IntenseQuote', 'Normal'],
    bullet: ['ListBullet', 'List Bullet', 'ListParagraph', 'Normal'],
    step: ['ListNumber', 'List Number', 'ListParagraph', 'Normal'],
  };
  for (const id of candidates[String(role)] ?? []) {
    if (available.has(id)) return id;
  }
  return null;
}
```

- [ ] **Step 4: Run edit-planner tests**

Run: `npm test -- src/lib/document/plan.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit Task 7**

```bash
git add src/lib/document/plan.ts src/lib/document/plan.test.ts
git commit -m "feat: add safe DOCX edit plan lowering"
```

### Task 8: Prompt Contract Updates

**Files:**
- Modify: `src/lib/draft/prompt.ts`
- Modify: `src/lib/draft/prompt.test.ts`
- Modify: `src/lib/document/edit.ts`

- [ ] **Step 1: Add prompt tests for the unified contract**

In `src/lib/draft/prompt.test.ts`, add:

```ts
it('describes the unified structured DOCX contract', () => {
  const built = buildDraftingPrompt({
    template: makeTemplate(),
    section: makeSection(),
    project_description: 'A PWS for document automation.',
    shared_inputs: {},
    prior_summaries: [],
  });

  expect(built.system_prompt).toContain('STRUCTURED DOCX CONTRACT');
  expect(built.system_prompt).toContain('Use semantic roles and fields only');
  expect(built.system_prompt).toContain('Do not emit raw OOXML');
});
```

- [ ] **Step 2: Run prompt tests and verify failure**

Run: `npm test -- src/lib/draft/prompt.test.ts`

Expected: FAIL because the system prompt does not contain `STRUCTURED DOCX CONTRACT`.

- [ ] **Step 3: Update the drafting system prompt**

In `src/lib/draft/prompt.ts`, add this block after the output schema section in `SYSTEM_PROMPT`:

```ts
STRUCTURED DOCX CONTRACT:

Use semantic roles and fields only. Do not emit raw OOXML, HTML, Markdown tables, Markdown bullets, or prose instructions about formatting. The application validates and maps your JSON into Word paragraphs, runs, lists, tables, and page breaks.

When a section needs structure, express it with:
- role and level for headings, bullets, numbered steps, quotes, notes, cautions, warnings, and definitions
- runs for mixed inline formatting inside one paragraph
- consecutive table_row entries for tables
- page_break_before only at major structural boundaries

Invalid or unsupported structure may be repaired or dropped before export, so choose the simplest structure that satisfies the document requirement.
```

- [ ] **Step 4: Run prompt tests**

Run: `npm test -- src/lib/draft/prompt.test.ts`

Expected: PASS.

- [ ] **Step 5: Update the finished-document editing prompt**

In `src/lib/document/edit.ts`, add this text inside `SYSTEM_PROMPT` after the typed op catalog introduction:

```ts
EDITING MODES:

Classify every proposed change before choosing an op:
- Content edits change wording while preserving the paragraph's existing layout.
- Formatting edits change style, alignment, indentation, spacing, or run properties without rewriting clean prose.
- Structural edits insert, delete, split, merge, or reshape paragraphs and tables.

Always choose the narrowest safe op. Do not emit raw OOXML. Do not use markdown to imply formatting. If a structural edit depends on a paragraph or table not shown in the chunk, skip it for this chunk.
```

- [ ] **Step 6: Run document edit tests**

Run: `npm test -- src/lib/document`

Expected: PASS.

- [ ] **Step 7: Commit Task 8**

```bash
git add src/lib/draft/prompt.ts src/lib/draft/prompt.test.ts src/lib/document/edit.ts
git commit -m "feat: clarify structured DOCX prompt contract"
```

### Task 9: Final Integration Verification

**Files:**
- No planned source edits unless a test reveals a regression.

- [ ] **Step 1: Run the DOCX-focused test set**

Run:

```bash
npm test -- src/lib/docx src/lib/export src/lib/freeform src/lib/document src/lib/draft/prompt.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 3: Run full test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 4: Build release artifact**

Run:

```bash
npm run build
```

Expected: PASS and `release/index.html` is regenerated by Vite.

- [ ] **Step 5: Inspect changed files**

Run:

```bash
git status --short
git diff --stat
```

Expected: only files touched by this plan plus the generated `release/index.html` if the build changes it.

- [ ] **Step 6: Commit verification/build updates**

If `release/index.html` changed during `npm run build`, commit it with the final integration changes:

```bash
git add release/index.html
git commit -m "chore: rebuild single-file release"
```

If `release/index.html` did not change, do not create an empty commit.

## Self-Review Checklist

- Spec coverage: inventory is Task 3; structured IR is Task 1; validation and repair are Task 2; shared builders are Task 4; template export is Task 5; freeform writing is Task 6; finished-document editing bridge is Task 7; prompt/tool contract is Task 8; verification is Task 9.
- Type consistency: all structured block types live in `src/lib/docx/ir.ts`; validator imports those types; export/freeform integrations call `normalizeDraftParagraphs` and `validateStructuredBlocks`; edit planning lowers only to existing `DocumentEditOp` shapes.
- Scope control: image/chart insertion remains outside this plan because it depends on relationship/content-type work beyond the first shared-backbone slice.

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
  // Legacy DraftParagraph can only carry row-level runs, so compatibility
  // flattening preserves cell runs only for single-cell table rows.
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
      if (p.page_break_before) {
        blocks.push({ kind: 'page_break' });
      }

      const rows: StructuredTableRow[] = [];
      while (i < paragraphs.length && paragraphs[i]!.role === 'table_row') {
        const row = paragraphs[i]!;
        if (rows.length > 0 && row.page_break_before) {
          break;
        }

        const cellTexts = row.cells && row.cells.length > 0 ? row.cells : [row.text];
        const cells = cellTexts.map((text, cellIndex): StructuredTableCell => {
          const cell: StructuredTableCell = {
            text,
            shading: row.cell_shading?.[cellIndex],
            colspan: row.cell_colspans?.[cellIndex],
            width_pct: row.cell_widths_pct?.[cellIndex],
          };
          if (row.runs && cellTexts.length === 1) cell.runs = row.runs;
          return cell;
        });
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
          cells: row.cells.map((c) => c.text),
        };
        if (row.is_header) draftRow.is_header = true;
        if (pendingPageBreak) draftRow.page_break_before = true;
        if (row.cells.length === 1 && row.cells[0]!.runs) draftRow.runs = row.cells[0]!.runs;
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

    const draftParagraph: DraftParagraph = {
      role: block.role,
      text: block.text,
    };
    if (block.runs) draftParagraph.runs = block.runs;
    if (block.level !== undefined) draftParagraph.level = block.level;
    if (block.alignment) draftParagraph.alignment = block.alignment;
    if (block.indent_left_pt !== undefined) draftParagraph.indent_left_pt = block.indent_left_pt;
    if (block.spacing_before_pt !== undefined) draftParagraph.spacing_before_pt = block.spacing_before_pt;
    if (block.spacing_after_pt !== undefined) draftParagraph.spacing_after_pt = block.spacing_after_pt;
    if (pendingPageBreak || block.page_break_before) draftParagraph.page_break_before = true;
    out.push(draftParagraph);
    pendingPageBreak = false;
  }

  return out;
}

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
        const hasEmptyRuns = block.runs.some((r) => r.text.length === 0);
        if (hasEmptyRuns) {
          diagnostics.push({
            severity: 'warning',
            code: 'empty_run_removed',
            path: `blocks[${blockIndex}].runs`,
            message: 'Empty rich-text runs were removed.',
          });
        }
        if (repair) {
          block.runs = block.runs.filter((r) => r.text.length > 0);
          if (block.runs.length === 0) delete block.runs;
        }
      }

      validateParagraph(block, blockIndex, options, diagnostics);
      blocks.push(block);
      continue;
    }

    if (block.kind === 'table') {
      const repaired = validateTable(block, blockIndex, repair, diagnostics);
      if (repaired.rows.length === 0) {
        diagnostics.push({
          severity: repair ? 'warning' : 'error',
          code: 'empty_table_removed',
          path: `blocks[${blockIndex}]`,
          message: 'Table contains no rows.',
        });
        if (!repair) blocks.push(repaired);
      } else {
        blocks.push(repaired);
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
  const hasVisibleRuns = block.runs?.some((r) => r.text.length > 0) === true;
  if (block.text.length === 0 && !hasVisibleRuns) {
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

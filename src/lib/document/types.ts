// "Document" = a finished DOCX the user uploaded for cleanup. Distinct
// from "Template" (which gets parsed into a schema and drafted against)
// and "Project" (which generates new content from templates). The
// document workflow is: upload → propose edits via LLM → preview diff
// → accept/reject → export to a new DOCX.

import type { ParagraphInfo } from '../template/parser';

export interface ParagraphEdit {
  /** Original paragraph index in the source DOCX */
  index: number;
  /** The original text from the parser, for diff display */
  original_text: string;
  /** The proposed or accepted replacement text */
  new_text: string;
  /** Optional one-line explanation from the LLM */
  rationale?: string;
  /** Lifecycle */
  status: 'proposed' | 'accepted' | 'rejected';
}

/**
 * The discriminated union of edit operations the LLM can emit and the
 * writer can apply to a finished DOCX. Each op is intentionally narrow
 * and addresses a single OOXML element by index, so the writer can
 * mutate exactly that element while leaving every other formatting
 * node untouched.
 *
 * Op categories:
 *   - paragraph_*  : whole-paragraph text or structural changes
 *   - run_*        : per-run text or property changes (preserves
 *                    other runs in the same paragraph)
 *   - cell_*       : table cell mutations (Phase C)
 *   - sdt_*        : Word content control (sdt) value mutations
 *                    (Phase D)
 */
export type DocumentEditOp =
  // ── Phase B (paragraph + run) ──
  | {
      op: 'replace_paragraph_text';
      index: number;
      new_text: string;
      rationale?: string;
    }
  | {
      op: 'replace_run_text';
      paragraph_index: number;
      run_index: number;
      new_text: string;
      rationale?: string;
    }
  | {
      op: 'set_run_property';
      paragraph_index: number;
      run_index: number;
      property: 'bold' | 'italic' | 'underline' | 'strike';
      value: boolean;
      rationale?: string;
    }
  // ── Phase C (tables) ──
  | {
      op: 'set_cell_text';
      table_index: number;
      row_index: number;
      cell_index: number;
      new_text: string;
      rationale?: string;
    }
  | {
      op: 'insert_table_row';
      table_index: number;
      after_row_index: number;
      cells: string[];
      rationale?: string;
    }
  | {
      op: 'delete_table_row';
      table_index: number;
      row_index: number;
      rationale?: string;
    }
  // ── Phase D (content controls + structural) ──
  | {
      op: 'set_content_control_value';
      tag: string;
      value: string;
      rationale?: string;
    }
  | {
      op: 'set_paragraph_style';
      index: number;
      style_id: string;
      rationale?: string;
    }
  | {
      op: 'set_paragraph_alignment';
      index: number;
      alignment: 'left' | 'center' | 'right' | 'justify' | 'both';
      rationale?: string;
    }
  | {
      op: 'delete_paragraph';
      index: number;
      rationale?: string;
    };

export interface DocumentEditOutput {
  edits: DocumentEditOp[];
  /** Optional global rationale for the whole edit pass */
  rationale?: string;
}

export interface ParsedDocumentSnapshot {
  paragraphs: ParagraphInfo[];
}

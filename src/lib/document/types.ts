// "Document" = a finished DOCX the user uploaded for cleanup. Distinct
// from "Template" (which gets parsed into a schema and drafted against)
// and "Project" (which generates new content from templates). The
// document workflow is: upload → propose edits via LLM → preview diff
// → accept/reject → export to a new DOCX.

import type { ParagraphInfo } from '../template/parser';

/**
 * Lifecycle wrapper around a DocumentEditOp. The op carries the
 * surgical instruction; the wrapper carries the user-facing metadata
 * needed to display, accept, or reject the edit.
 */
export interface StoredEdit {
  /** Stable identifier within the document */
  id: string;
  op: DocumentEditOp;
  status: 'proposed' | 'accepted' | 'rejected';
  /**
   * For text-replacement ops (paragraph_text, run_text, cell_text,
   * sdt_value), the original text BEFORE the edit, captured at
   * proposal time. Used for diff display.
   */
  before_text?: string;
  /**
   * For run_property ops, the original property value before the
   * edit (so the user can see what the toggle is changing).
   */
  before_value?: boolean;
  /** Explanation surfaced from the LLM (mirrors op.rationale for convenience) */
  rationale?: string;
  /** When this edit was proposed */
  created_at: string;
}

/**
 * Legacy paragraph-text edit shape. Kept for the Dexie v2 → v3
 * migration: existing DocumentRecord.edits arrays may contain these
 * objects, and we convert them to StoredEdit on read.
 */
export interface ParagraphEdit {
  index: number;
  original_text: string;
  new_text: string;
  rationale?: string;
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

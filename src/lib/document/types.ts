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
 * The set of LLM-proposed edits we can apply to a finished DOCX. We
 * intentionally start narrow: text replacement only. Insert/delete
 * paragraphs and style changes can come later — replacing text within
 * an existing paragraph is the safest mutation because we preserve
 * every formatting node in the original OOXML.
 */
export type DocumentEditOp = {
  op: 'replace_paragraph_text';
  index: number;
  new_text: string;
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

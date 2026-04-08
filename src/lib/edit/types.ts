// Edit operations the LLM can emit instead of re-generating an entire
// schema or draft. The dispatcher applies them to a target object and
// returns a new (immutable) version. Saves output tokens dramatically
// for localized changes — "tool call" semantics without depending on
// Ask Sage's model-dependent `tools` parameter.

import type { DraftParagraph, ParagraphRole } from '../draft/types';

// ─── Schema edit operations ────────────────────────────────────────

export type SchemaEditOp =
  | { op: 'set_section_field'; section_id: string; field: 'name' | 'intent'; value: string }
  | { op: 'set_section_target_words'; section_id: string; value: [number, number] }
  | { op: 'set_section_depends_on'; section_id: string; value: string[] }
  | {
      op: 'set_section_validation';
      section_id: string;
      rule: 'must_mention' | 'must_not_mention' | 'must_not_exceed_words' | 'must_be_at_least_words';
      value: string[] | number;
    }
  | { op: 'remove_section'; section_id: string }
  | { op: 'reorder_sections'; new_order: string[] }
  | {
      op: 'set_style_field';
      field: 'voice' | 'tense' | 'register' | 'jargon_policy';
      value: string;
    }
  | { op: 'add_banned_phrase'; phrase: string }
  | { op: 'remove_banned_phrase'; phrase: string };

export interface SchemaEditOutput {
  edits: SchemaEditOp[];
  /** Optional one-line explanation the LLM provides about its changes */
  rationale?: string;
}

// ─── Draft edit operations ─────────────────────────────────────────

export type DraftEditOp =
  | {
      op: 'replace_paragraph';
      template_id: string;
      section_id: string;
      index: number;
      text: string;
      role?: ParagraphRole;
    }
  | {
      op: 'insert_paragraph';
      template_id: string;
      section_id: string;
      after_index: number;
      role: ParagraphRole;
      text: string;
    }
  | {
      op: 'delete_paragraph';
      template_id: string;
      section_id: string;
      index: number;
    }
  | {
      op: 'replace_text_in_section';
      template_id: string;
      section_id: string;
      find: string;
      replace: string;
    };

export interface DraftEditOutput {
  edits: DraftEditOp[];
  rationale?: string;
}

// ─── Common application result ────────────────────────────────────

export interface ApplyResult<T> {
  /** New, immutable target with edits applied */
  result: T;
  /** Per-edit application status; mirrors the input edit list order */
  applied: Array<{
    op: string;
    success: boolean;
    error?: string;
  }>;
}

// Re-export DraftParagraph to keep barrels small for callers
export type { DraftParagraph };

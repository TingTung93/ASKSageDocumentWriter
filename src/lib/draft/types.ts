// Wire types for Phase 2 drafting. The LLM emits paragraphs with role
// tags rather than raw markdown so the export pipeline can resolve each
// role to a template-defined paragraph style at assembly time.

export type ParagraphRole =
  | 'heading'
  | 'body'
  | 'step'
  | 'bullet'
  | 'note'
  | 'caution'
  | 'warning'
  | 'definition'
  | 'table_row'
  | 'quote';

export interface DraftParagraph {
  role: ParagraphRole;
  text: string;
  /** For table_row: cells indexed by column. Empty for non-table roles. */
  cells?: string[];
}

export interface LLMDraftOutput {
  paragraphs: DraftParagraph[];
  /**
   * Optional one-sentence summary the LLM produces of its own draft so
   * we can feed it forward to dependent sections without re-sending the
   * full body.
   */
  self_summary?: string;
}

export interface DraftingOptions {
  /** Defaults to google-claude-46-sonnet */
  model?: string;
  temperature?: number;
  /** RAG: Ask Sage dataset name(s). Defaults to project's first dataset. */
  dataset?: string;
  /** RAG: how many references to inject. Defaults to 6. */
  limit_references?: number;
  /**
   * Web search mode passed through to Ask Sage as the `live` parameter:
   *   0 — disabled
   *   1 — Google results injected as reference material
   *   2 — Google + crawl: full web search + page fetching, used for
   *       autonomous market research and live reference lookups
   */
  live?: 0 | 1 | 2;
}

export interface PriorSectionSummary {
  section_id: string;
  name: string;
  summary: string;
}

export interface DraftingResult {
  paragraphs: DraftParagraph[];
  references: string;
  usage: unknown;
  prompt_sent: string;
  model: string;
  tokens_in: number;
  tokens_out: number;
}

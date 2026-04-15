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

/**
 * Inline run with optional character formatting. When a paragraph
 * supplies `runs[]`, the assembler builds one <w:r> per run with the
 * cloned source rPr augmented by these toggles. The plain `text`
 * field is ignored in that case.
 *
 * Toggles are STRICTLY additive over the source rPr — passing
 * `bold: false` removes any inherited bold; omitting the field leaves
 * inherited bold alone. This matches OOXML's <w:b w:val="false"/>
 * semantics, so the LLM can both add and clear formatting.
 */
export interface DraftRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
}

export interface DraftParagraph {
  role: ParagraphRole;
  text: string;
  /**
   * Optional inline runs. When supplied, `text` is IGNORED and the
   * assembler builds one <w:r> per run with per-run bold/italic/
   * underline/strike toggles layered onto the cloned source rPr.
   * Use this whenever a paragraph needs mixed formatting.
   */
  runs?: DraftRun[];
  /** For table_row: cells indexed by column. Empty for non-table roles. */
  cells?: string[];
  /**
   * For table_row: marks this row as a header row. Header rows get
   * a bold rPr applied to all cells and an OOXML <w:tblHeader/>
   * row property so the row repeats across page breaks. Defaults
   * to false.
   */
  is_header?: boolean;
  /**
   * When true, the assembler adds <w:pageBreakBefore/> to the
   * paragraph's pPr. This forces Word to start a new page at this
   * paragraph. Use sparingly — only when the section explicitly
   * needs a hard page break (cover page, signature page, etc.).
   */
  page_break_before?: boolean;
  /**
   * Optional nesting / indent level. 0 (the default) means top-level
   * with no extra indent. Higher values mean deeper nesting; the
   * interpretation depends on the role:
   *
   *   - bullet / step: OOXML list nesting (`<w:ilvl w:val="N"/>`).
   *     level 0 is the outer bullet, 1 is a sub-bullet, etc.
   *
   *   - body / note / caution / warning / definition / quote:
   *     left-indent in 0.5"-per-level steps (`<w:ind w:left="720*N"/>`).
   *     Use this for inset / quoted-style paragraphs that aren't
   *     bullets.
   *
   *   - heading: heading hierarchy. level 0 → Heading1, level 1 →
   *     Heading2, etc. Capped at the highest Heading style the
   *     template defines.
   *
   *   - table_row: ignored.
   *
   * Drafters that don't care can omit the field entirely. The
   * assembler clamps to a reasonable range (0..8) so a runaway
   * level can't produce invalid OOXML.
   */
  level?: number;
}

// ─── SectionDraft discriminated union ─────────────────────────────
//
// Two drafting shapes now: body sections still produce DraftParagraph[]
// (wrapped as { kind: 'body', paragraphs }), while document_part sections
// (page headers / footers) produce a per-slot rewrite as { kind:
// 'document_part', slots[] }. The assembler dispatches on `kind` to
// decide whether to splice paragraphs or to rewrite specific slot_index
// runs in place inside an existing <w:p>.

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

/**
 * Normalize a drafter's output (either a bare DraftParagraph[] from
 * legacy call sites, or an explicit SectionDraft) into the discriminated
 * union form. Used at the assembler entry point so the rest of the
 * pipeline can dispatch on `kind` without caring about legacy shapes.
 */
export function toSectionDraft(input: SectionDraft | DraftParagraph[]): SectionDraft {
  if (Array.isArray(input)) return { kind: 'body', paragraphs: input };
  return input;
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
  /**
   * Number of OpenRouter web-search results requested by THIS call.
   * Set when live > 0 and the active provider routed through the
   * OpenRouter `web` plugin. Used by the cost rollup to add the
   * platform's per-result surcharge on top of token cost. Always
   * undefined for Ask Sage and for OpenRouter calls without live.
   */
  web_search_results?: number;
}

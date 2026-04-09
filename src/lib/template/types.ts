// TemplateSchema — the structural half is populated deterministically by
// the OOXML parser (Phase 1a, this file's primary target). The semantic
// half (intent, target_words, depends_on, validation, voice) is added by
// the Gemini Flash pass in Phase 1b.
//
// The split is intentional: structural fields are ground truth from the
// binary; semantic fields are LLM-derived and editable. Re-running the
// semantic pass never overwrites the structural half.
//
// See PRD §6 for the complete specification including the worked SOP
// example.

export const PARSER_VERSION = '0.1.0';
export const SCHEMA_VERSION = 'https://asksage-doc-writer.local/schemas/template/v2';

// ─── Structural half ─────────────────────────────────────────────────

export interface PageMargins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface PageSetup {
  paper: 'letter' | 'a4' | 'legal' | 'unknown';
  orientation: 'portrait' | 'landscape';
  margins_twips: PageMargins;
  header_distance: number;
  footer_distance: number;
}

export interface DefaultFont {
  family: string | null;
  size_pt: number | null;
}

export interface NamedStyle {
  /** w:styleId — the machine identifier */
  id: string;
  /** w:name/@w:val — the human-readable name */
  name: string;
  /** Style category: paragraph | character | table | numbering */
  type: 'paragraph' | 'character' | 'table' | 'numbering' | 'unknown';
  /** Inherited style id (basedOn) */
  based_on: string | null;
  /** outlineLvl in pPr — present for heading-like styles */
  outline_level: number | null;
  /** Numbering id this style references, if any */
  numbering_id: number | null;
  /** w:pPr/w:jc — paragraph alignment defined by this style (NOT yet resolved through basedOn) */
  alignment: 'left' | 'center' | 'right' | 'justify' | 'both' | null;
  /** w:pPr/w:ind/@w:left in twips */
  indent_left_twips: number | null;
  /** w:pPr/w:ind/@w:firstLine in twips */
  indent_first_line_twips: number | null;
  /** w:pPr/w:ind/@w:hanging in twips */
  indent_hanging_twips: number | null;
}

export interface NumberingLevel {
  /** 0-indexed level number */
  level: number;
  /** numFmt: decimal, bullet, lowerLetter, upperRoman, etc. */
  format: string;
  /** lvlText pattern, e.g. "%1." or "%1.%2." */
  text: string;
  /** Indent in twips, if specified */
  indent_twips: number | null;
}

export interface NumberingDefinition {
  /** numId from numbering.xml */
  id: number;
  /** abstractNumId backing this numId */
  abstract_id: number;
  levels: NumberingLevel[];
}

export interface HeaderFooterPart {
  /** "default" | "first" | "even" */
  type: string;
  /** Path inside the zip, e.g. word/header1.xml */
  part: string;
}

export interface FormattingHalf {
  page_setup: PageSetup;
  default_font: DefaultFont;
  theme: string | null;
  named_styles: NamedStyle[];
  numbering_definitions: NumberingDefinition[];
  headers: HeaderFooterPart[];
  footers: HeaderFooterPart[];
}

// ─── Fill regions ────────────────────────────────────────────────────

export type FillRegionKind =
  | 'content_control'
  | 'bookmark'
  | 'placeholder'
  | 'heading_bounded';

export type ContentControlType =
  | 'plain_text'
  | 'rich_text'
  | 'dropdown'
  | 'combo_box'
  | 'date'
  | 'checkbox'
  | 'picture'
  | 'unknown';

export interface MetadataFillRegion {
  /** Stable id derived from sdt tag, bookmark name, or auto-generated */
  id: string;
  kind: FillRegionKind;
  /** w:sdt @w:tag */
  sdt_tag?: string;
  /** w:bookmarkStart @w:name */
  bookmark_name?: string;
  control_type: ContentControlType;
  allowed_values?: string[];
  /** Suggested project input field name (snake_case) */
  project_input_field: string;
  required: boolean;
}

export interface BodyFillRegion {
  /** Stable id, snake_case */
  id: string;
  /** Display name (often the heading text) */
  name: string;
  order: number;
  required: boolean;
  fill_region: BodyFillRegionDescriptor;
  // Semantic fields filled by Phase 1b — left empty by the parser
  intent?: string;
  target_words?: [number, number];
  depends_on?: string[];
  validation?: Record<string, unknown>;
}

export type BodyFillRegionDescriptor =
  | {
      kind: 'content_control';
      sdt_tag: string;
      heading_style_id: string | null;
      body_style_id: string | null;
      numbering_id: number | null;
      permitted_roles: string[];
    }
  | {
      kind: 'bookmark';
      bookmark_name: string;
      heading_style_id: string | null;
      body_style_id: string | null;
      permitted_roles: string[];
    }
  | {
      kind: 'placeholder';
      placeholder: string;
      heading_style_id: string | null;
      body_style_id: string | null;
      permitted_roles: string[];
    }
  | {
      kind: 'heading_bounded';
      heading_text: string;
      heading_style_id: string | null;
      body_style_id: string | null;
      anchor_paragraph_index: number;
      end_anchor_paragraph_index: number;
      permitted_roles: string[];
    }
  | {
      /**
       * A whole-part fill region targeting an XML part OUTSIDE
       * `word/document.xml` — typically `word/header1.xml` or
       * `word/footer1.xml`. Used so page headers and footers (Army
       * memo letterheads, CUI banners, distribution lines) can be
       * regenerated by the drafter and assembled back into the right
       * file in the zip. The parser emits these deterministically
       * from the discovered header/footer parts; synthesis NEVER
       * authors them and the merge step preserves them as-is.
       */
      kind: 'document_part';
      /** Path inside the zip, e.g. "word/header1.xml". */
      part_path: string;
      /** Whether this part is rendered as a page header or footer. */
      placement: 'header' | 'footer';
      /**
       * The original paragraph text lines from the part, captured by
       * the parser. Used as the drafting "template example" so the
       * model sees what the existing letterhead looks like, and as
       * the synthesis sample so document_part sections aren't
       * sampled from the body by mistake.
       */
      original_text_lines: string[];
      permitted_roles: string[];
    };

// ─── Semantic half (Phase 1b will populate these) ────────────────────

export interface StyleHalf {
  voice: string | null;
  tense: string | null;
  register: string | null;
  jargon_policy: string | null;
  banned_phrases: string[];
}

// ─── Top-level schema ────────────────────────────────────────────────

export interface TemplateSchemaSource {
  filename: string;
  ingested_at: string;
  structural_parser_version: string;
  semantic_synthesizer: string | null;
  /** IndexedDB key the original DOCX bytes are stored under */
  docx_blob_id: string;
}

export interface TemplateSchema {
  $schema: string;
  id: string;
  name: string;
  version: number;
  source: TemplateSchemaSource;
  formatting: FormattingHalf;
  metadata_fill_regions: MetadataFillRegion[];
  sections: BodyFillRegion[];
  style: StyleHalf;
}

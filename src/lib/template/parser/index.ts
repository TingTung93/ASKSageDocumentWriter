// parseDocx — main entry point for the OOXML template parser.
//
// Takes the raw bytes of a DOCX file and returns the structural half of
// a TemplateSchema (formatting, fill_regions, named styles, numbering).
// Performs zero LLM calls; everything here is deterministic OOXML
// extraction. The semantic half (intent, target_words, validation) is
// added by Phase 1b's Gemini Flash pass.

import JSZip from 'jszip';
import {
  PARSER_VERSION,
  SCHEMA_VERSION,
  type FormattingHalf,
  type HeaderFooterPart,
  type NamedStyle,
  type TemplateSchema,
} from '../types';
import { parseDocumentXml, parseHeaderFooterXml, type ParagraphInfo } from './document';
import { parseStylesXml } from './styles';
import { parseNumberingXml } from './numbering';
import { findContentControls } from './contentControls';
import { detectFillRegions } from './fillRegions';

export type { ParagraphInfo, RunInfo, TableInfo, TableRowInfo, TableCellInfo } from './document';

export interface PartContent {
  /** Path inside the zip, e.g. "word/header1.xml" */
  part: string;
  /** Display label inferred from the part name (e.g. "header1") */
  label: string;
  paragraphs: ParagraphInfo[];
}

export interface ParseDocxOptions {
  filename: string;
  /** IndexedDB key under which the original DOCX bytes are stored */
  docx_blob_id: string;
  /** Stable id for this template */
  id?: string;
  /** Display name; defaults to filename without extension */
  name?: string;
}

export interface ParseDocxResult {
  schema: TemplateSchema;
  /** The DOCX bytes wrapped as a Blob, ready to persist alongside the schema */
  docx_blob: Blob;
  /**
   * Flat paragraph sequence from word/document.xml. Not persisted with
   * the schema (it would bloat IndexedDB), but exposed here so callers
   * can extract sample text per section for the Phase 1b semantic
   * synthesizer without re-parsing the DOCX.
   */
  paragraphs: ParagraphInfo[];
  /**
   * Tables from word/document.xml with row/cell/paragraph structure.
   * Cells reference paragraphs by their index in the flat
   * paragraphs[] array, so LLM tools can address table content
   * either by paragraph index or by table/row/cell coordinates.
   */
  tables: import('./document').TableInfo[];
  /**
   * Parsed paragraph contents of every word/header*.xml part the DOCX
   * contains. Indices restart from 0 within each part. Headers
   * commonly hold CUI banners, document numbers, dates, and
   * distribution lines on DHA templates.
   */
  header_parts: PartContent[];
  /** Same shape, for word/footer*.xml parts. */
  footer_parts: PartContent[];
}

export async function parseDocx(
  bytes: ArrayBuffer | Uint8Array | Blob,
  opts: ParseDocxOptions,
): Promise<ParseDocxResult> {
  // JSZip accepts ArrayBuffer, Uint8Array, and Blob directly. Don't
  // round-trip through Blob.arrayBuffer() because jsdom (used by vitest)
  // doesn't implement that method on its Blob shim.
  let zipInput: ArrayBuffer | Uint8Array | Blob;
  let blob: Blob;
  if (bytes instanceof Blob) {
    blob = bytes;
    // In jsdom we can't convert Blob → ArrayBuffer, but JSZip can take
    // the Blob directly.
    zipInput = bytes;
  } else if (bytes instanceof Uint8Array) {
    zipInput = bytes;
    blob = makeBlob(bytes);
  } else {
    zipInput = bytes;
    blob = makeBlob(new Uint8Array(bytes));
  }
  const zip = await JSZip.loadAsync(zipInput);

  const documentXml = await zip.file('word/document.xml')?.async('string');
  if (!documentXml) {
    throw new Error('Not a valid DOCX: word/document.xml is missing');
  }

  const stylesXml = await zip.file('word/styles.xml')?.async('string');
  const numberingXml = await zip.file('word/numbering.xml')?.async('string');

  const docDom = parseXml(documentXml);
  const stylesDom = stylesXml ? parseXml(stylesXml) : null;
  const numberingDom = numberingXml ? parseXml(numberingXml) : null;

  const styles = stylesDom
    ? parseStylesXml(stylesDom)
    : { default_font: { family: null, size_pt: null }, named_styles: [] };
  const numbering = numberingDom ? parseNumberingXml(numberingDom) : [];
  const document = parseDocumentXml(docDom);
  // Resolve style-inherited alignment / indent into each paragraph that
  // didn't override the value at the pPr level. Without this pass,
  // headings and titles that derive their centering / indent from a
  // paragraph style end up looking left-aligned with no indent in the
  // preview and to the LLM.
  resolveInheritedFormatting(document.paragraphs, styles.named_styles);
  // Resolve header / footer parts the same way once we've loaded them.
  const contentControls = findContentControls(docDom);

  const fillRegions = detectFillRegions({
    paragraphs: document.paragraphs,
    contentControls,
    namedStyles: styles.named_styles,
  });

  const headers = listHeaderFooterParts(zip, 'header');
  const footers = listHeaderFooterParts(zip, 'footer');

  const formatting: FormattingHalf = {
    page_setup: document.page_setup,
    default_font: styles.default_font,
    theme: null,
    named_styles: styles.named_styles,
    numbering_definitions: numbering,
    headers,
    footers,
  };

  const schema: TemplateSchema = {
    $schema: SCHEMA_VERSION,
    id: opts.id ?? cryptoRandomId(),
    name: opts.name ?? stripExtension(opts.filename),
    version: 1,
    source: {
      filename: opts.filename,
      ingested_at: new Date().toISOString(),
      structural_parser_version: PARSER_VERSION,
      semantic_synthesizer: null,
      docx_blob_id: opts.docx_blob_id,
    },
    formatting,
    metadata_fill_regions: fillRegions.metadata,
    sections: fillRegions.body,
    style: {
      voice: null,
      tense: null,
      register: null,
      jargon_policy: null,
      banned_phrases: [],
    },
  };

  // Parse the contents of every header and footer part. The DOCX may
  // have several of each (default / first / even). Each part is a
  // self-contained XML document rooted at <w:hdr> or <w:ftr>.
  const header_parts = await loadPartContents(zip, headers.map((h) => h.part));
  const footer_parts = await loadPartContents(zip, footers.map((f) => f.part));
  for (const hp of header_parts) resolveInheritedFormatting(hp.paragraphs, styles.named_styles);
  for (const fp of footer_parts) resolveInheritedFormatting(fp.paragraphs, styles.named_styles);

  return {
    schema,
    docx_blob: blob,
    paragraphs: document.paragraphs,
    tables: document.tables,
    header_parts,
    footer_parts,
  };
}

async function loadPartContents(zip: JSZip, partNames: string[]): Promise<PartContent[]> {
  const out: PartContent[] = [];
  for (const part of partNames) {
    const file = zip.file(part);
    if (!file) continue;
    try {
      const xml = await file.async('string');
      const dom = parseXml(xml);
      const paragraphs = parseHeaderFooterXml(dom);
      const labelMatch = part.match(/word\/(.*?)\.xml$/);
      const label = labelMatch ? labelMatch[1]! : part;
      out.push({ part, label, paragraphs });
    } catch {
      // Skip parts we can't parse — preview is best-effort.
    }
  }
  return out;
}

/**
 * Re-parse a stored DOCX Blob to recover the paragraph sequence. Used by
 * the synthesis pipeline when we need sample text per section but only
 * have the persisted (schema, blob) pair.
 */
export async function extractParagraphs(
  bytes: ArrayBuffer | Uint8Array | Blob,
): Promise<ParagraphInfo[]> {
  const result = await parseDocx(bytes, {
    filename: '__re-parse__',
    docx_blob_id: '__re-parse__',
  });
  return result.paragraphs;
}

// Re-export so other modules can build their own header/footer rendering
// against parsed parts.
export type { PartContent as HeaderFooterPartContent };

/**
 * Walk the basedOn chain for a given style id and return the first
 * non-null value of `pick(style)` encountered. Cycles are guarded by a
 * visited set; depth is bounded by the number of styles.
 */
function inheritedStyleValue<T>(
  styleId: string | null,
  styleMap: Map<string, NamedStyle>,
  pick: (s: NamedStyle) => T | null,
): T | null {
  let current = styleId;
  const visited = new Set<string>();
  while (current && !visited.has(current)) {
    visited.add(current);
    const style = styleMap.get(current);
    if (!style) return null;
    const value = pick(style);
    if (value !== null && value !== undefined) return value;
    current = style.based_on;
  }
  return null;
}

/**
 * Mutate `paragraphs` in place: for any paragraph whose pPr did NOT
 * specify alignment / indent, walk its style chain and fill in the
 * inherited value. This is what makes "centered title", "right-aligned
 * date", and indented heading styles render correctly in the preview
 * and show up to the LLM during cleanup.
 */
function resolveInheritedFormatting(
  paragraphs: ParagraphInfo[],
  namedStyles: NamedStyle[],
): void {
  if (namedStyles.length === 0) return;
  const styleMap = new Map(namedStyles.map((s) => [s.id, s]));
  for (const p of paragraphs) {
    if (!p.style_id) continue;
    if (p.alignment === null) {
      p.alignment = inheritedStyleValue(p.style_id, styleMap, (s) => s.alignment);
    }
    if (p.indent_left_twips === null) {
      p.indent_left_twips = inheritedStyleValue(p.style_id, styleMap, (s) => s.indent_left_twips);
    }
    if (p.indent_first_line_twips === null) {
      p.indent_first_line_twips = inheritedStyleValue(
        p.style_id,
        styleMap,
        (s) => s.indent_first_line_twips,
      );
    }
    if (p.indent_hanging_twips === null) {
      p.indent_hanging_twips = inheritedStyleValue(
        p.style_id,
        styleMap,
        (s) => s.indent_hanging_twips,
      );
    }
  }
}

function parseXml(xml: string): Document {
  const dom = new DOMParser().parseFromString(xml, 'text/xml');
  // DOMParser doesn't throw on malformed XML; it embeds an error element.
  const errs = dom.getElementsByTagName('parsererror');
  if (errs.length > 0) {
    throw new Error(`XML parse error: ${errs[0]!.textContent ?? 'unknown'}`);
  }
  return dom;
}

function listHeaderFooterParts(zip: JSZip, kind: 'header' | 'footer'): HeaderFooterPart[] {
  const parts: HeaderFooterPart[] = [];
  zip.forEach((relativePath) => {
    if (relativePath.match(new RegExp(`^word/${kind}\\d+\\.xml$`))) {
      parts.push({ type: 'default', part: relativePath });
    }
  });
  return parts;
}

function stripExtension(filename: string): string {
  return filename.replace(/\.[^.]+$/, '');
}

function cryptoRandomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `tpl_${Date.now()}_${Math.floor(Math.random() * 1e9)}`;
}

function makeBlob(u8: Uint8Array): Blob {
  // Wrap in a fresh ArrayBuffer copy so the Blob is detached from any
  // upstream Buffer (Node) backing memory.
  const copy = new Uint8Array(u8.byteLength);
  copy.set(u8);
  try {
    return new Blob([copy]);
  } catch {
    // jsdom's Blob constructor sometimes objects to typed arrays; fall
    // back to a stub that's "good enough" for tests (the schema viewer
    // path uses real browser Blobs at runtime).
    return { size: copy.byteLength } as unknown as Blob;
  }
}

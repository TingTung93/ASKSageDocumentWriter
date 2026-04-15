// Parses word/document.xml — the body of the DOCX. Extracts:
//   - section properties (margins, paper size, orientation)
//   - the flat paragraph sequence with style references and text
//
// The fill region detector runs over this output to find content
// controls, bookmarks, headings, etc.

import type { PageSetup } from '../types';
import { wAll, wAttr, wAttrInt, wFirst, W_NS } from './ns';

export type Alignment = 'left' | 'center' | 'right' | 'justify' | 'both' | null;

/**
 * One <w:r> run inside a paragraph. Runs are the unit of inline
 * formatting in OOXML — each run has its own rPr (run properties)
 * controlling bold/italic/underline/color/font, and contains the
 * actual text in <w:t> children. A paragraph can contain many runs;
 * mixed formatting (e.g. one bold span inside a sentence) shows up as
 * adjacent runs with different rPr.
 *
 * The run index is sequential within the paragraph (0..N-1) following
 * document order, recursing into containers (w:sdt, w:hyperlink, etc.).
 */
export interface RunInfo {
  /** 0-based index within the parent paragraph */
  index: number;
  /** Concatenated text of all w:t/w:tab/w:br children */
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  /** Hex color from rPr/color @w:val, or null if not set */
  color: string | null;
  /** Highlight name from rPr/highlight @w:val, or null */
  highlight: string | null;
  /** Font family from rPr/rFonts @w:ascii, or null */
  font_family: string | null;
  /** Font size in points (rPr/sz is in half-points; we divide by 2) */
  font_size_pt: number | null;
  superscript: boolean;
  subscript: boolean;
  /** Reference to the underlying <w:r> element for the writer */
  el: Element;
}

export interface ParagraphInfo {
  /** Document-order index */
  index: number;
  /** w:pStyle @w:val — references a styles.xml entry */
  style_id: string | null;
  /** Concatenated text of all w:t descendants */
  text: string;
  /** w:numPr/w:numId @w:val — null if not in a numbered list */
  numbering_id: number | null;
  /** w:numPr/w:ilvl @w:val — list level if in a list */
  numbering_level: number | null;
  /** w:outlineLvl @w:val — heading level if specified inline */
  outline_level: number | null;
  /** w:jc @w:val — paragraph alignment override, null if inherits from style */
  alignment: Alignment;
  /** w:ind @w:left in twips — left indent override, null if inherits */
  indent_left_twips: number | null;
  /** w:ind @w:firstLine in twips — first-line indent, null if inherits */
  indent_first_line_twips: number | null;
  /** w:ind @w:hanging in twips — hanging indent, null if inherits */
  indent_hanging_twips: number | null;
  /** Paragraph-level run properties: pPr/rPr/b — bold default for the paragraph */
  bold: boolean;
  /** Paragraph-level run properties: pPr/rPr/i — italic default for the paragraph */
  italic: boolean;
  /** Set of bookmark names that START at this paragraph */
  bookmark_starts: string[];
  /** Set of bookmark names that END at this paragraph */
  bookmark_ends: string[];
  /**
   * Tag of the nearest enclosing w:sdt (Word content control) ancestor,
   * or null if this paragraph is not inside any content control.
   * Critical signal for understanding paragraph PURPOSE — DHA templates
   * use content controls for CUI banners, document numbers, classification
   * markings, and other metadata that the LLM should not mistake for body
   * content.
   */
  content_control_tag: string | null;
  /** True if this paragraph is inside a table cell (w:tc ancestor). */
  in_table: boolean;
  /**
   * Sequential list of <w:r> runs in this paragraph, in document order.
   * Each carries its own rPr-derived formatting and the index needed
   * to address it from a writer edit.
   */
  runs: RunInfo[];
  /** Reference to the underlying element for fill region detection */
  el: Element;
}

export interface TableCellInfo {
  index: number;
  /** Indices into the parent ParsedDocument.paragraphs[] array */
  paragraph_indices: number[];
}

export interface TableRowInfo {
  index: number;
  cells: TableCellInfo[];
}

export interface TableInfo {
  /** 0-based table index in document order */
  index: number;
  rows: TableRowInfo[];
}

export interface ParsedDocument {
  page_setup: PageSetup;
  paragraphs: ParagraphInfo[];
  tables: TableInfo[];
}

const DEFAULT_PAGE_SETUP: PageSetup = {
  paper: 'letter',
  orientation: 'portrait',
  margins_twips: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
  header_distance: 720,
  footer_distance: 720,
};

export function parseDocumentXml(dom: Document): ParsedDocument {
  const sectPr = dom.getElementsByTagNameNS(W_NS, 'sectPr')[0] ?? null;
  const page_setup = sectPr ? extractPageSetup(sectPr) : { ...DEFAULT_PAGE_SETUP };

  const body = dom.getElementsByTagNameNS(W_NS, 'body')[0];
  const paragraphs: ParagraphInfo[] = [];

  if (body) {
    let index = 0;
    walkParagraphs(body, (p) => {
      paragraphs.push(parseParagraph(p, index++));
    });
  }

  const tables = body ? parseTables(body, paragraphs) : [];

  return { page_setup, paragraphs, tables };
}

/**
 * Walk the body for <w:tbl> elements and produce a TableInfo[] with
 * row/cell structure. Each cell records the indices of its contained
 * paragraphs (which are also present in the flat paragraphs[] list,
 * so the LLM can address them either by paragraph index or by
 * table/row/cell coordinates).
 */
function parseTables(body: Element, paragraphs: ParagraphInfo[]): TableInfo[] {
  // Build a fast lookup: <w:p> element → flat paragraph index
  const elToIndex = new Map<Element, number>();
  for (const p of paragraphs) elToIndex.set(p.el, p.index);

  const tables: TableInfo[] = [];
  const tblEls = Array.from(body.getElementsByTagNameNS(W_NS, 'tbl'));
  let tblIdx = 0;
  for (const tbl of tblEls) {
    const rowEls = Array.from(tbl.getElementsByTagNameNS(W_NS, 'tr'));
    const rows: TableRowInfo[] = [];
    let rowIdx = 0;
    for (const tr of rowEls) {
      const tcEls = Array.from(tr.getElementsByTagNameNS(W_NS, 'tc'));
      const cells: TableCellInfo[] = [];
      let cellIdx = 0;
      for (const tc of tcEls) {
        const cellPs = Array.from(tc.getElementsByTagNameNS(W_NS, 'p'));
        const paragraph_indices = cellPs
          .map((p) => elToIndex.get(p))
          .filter((i): i is number => i !== undefined);
        cells.push({ index: cellIdx++, paragraph_indices });
      }
      rows.push({ index: rowIdx++, cells });
    }
    tables.push({ index: tblIdx++, rows });
  }
  return tables;
}

function walkParagraphs(scope: Element, visit: (p: Element) => void): void {
  // Visit only direct-or-table-descendant w:p elements in document order.
  // We do NOT use getElementsByTagNameNS here because that returns
  // descendants in tree order regardless of structural intent — but for
  // a flat paragraph list that's exactly what we want, so it's fine.
  Array.from(scope.getElementsByTagNameNS(W_NS, 'p')).forEach(visit);
}

/**
 * Parse a header/footer XML document into a flat ParagraphInfo[] using
 * the same paragraph parser as the body. Headers/footers don't have
 * sectPr, so we skip page-setup extraction. Indices restart from 0
 * within each part.
 */
export function parseHeaderFooterXml(dom: Document): ParagraphInfo[] {
  const paragraphs: ParagraphInfo[] = [];
  let index = 0;
  Array.from(dom.getElementsByTagNameNS(W_NS, 'p')).forEach((p) => {
    paragraphs.push(parseParagraph(p, index++));
  });
  return paragraphs;
}

function parseParagraph(p: Element, index: number): ParagraphInfo {
  const pPr = p.getElementsByTagNameNS(W_NS, 'pPr')[0] ?? null;

  // pStyle
  const pStyle = pPr ? pPr.getElementsByTagNameNS(W_NS, 'pStyle')[0] : null;
  const style_id = pStyle ? wAttr(pStyle, 'val') : null;

  // numPr
  let numbering_id: number | null = null;
  let numbering_level: number | null = null;
  if (pPr) {
    const numPr = pPr.getElementsByTagNameNS(W_NS, 'numPr')[0] ?? null;
    if (numPr) {
      const numId = numPr.getElementsByTagNameNS(W_NS, 'numId')[0] ?? null;
      const ilvl = numPr.getElementsByTagNameNS(W_NS, 'ilvl')[0] ?? null;
      numbering_id = wAttrInt(numId, 'val');
      numbering_level = wAttrInt(ilvl, 'val');
    }
  }

  // outlineLvl (rare in body, common in inherited style)
  let outline_level: number | null = null;
  if (pPr) {
    const ol = pPr.getElementsByTagNameNS(W_NS, 'outlineLvl')[0] ?? null;
    outline_level = wAttrInt(ol, 'val');
  }

  // Alignment (w:jc @w:val)
  let alignment: Alignment = null;
  if (pPr) {
    const jc = pPr.getElementsByTagNameNS(W_NS, 'jc')[0] ?? null;
    const v = wAttr(jc, 'val');
    if (v === 'left' || v === 'center' || v === 'right' || v === 'justify' || v === 'both') {
      alignment = v;
    }
  }

  // Indent properties (w:ind @w:left, @w:firstLine, @w:hanging) in twips
  let indent_left_twips: number | null = null;
  let indent_first_line_twips: number | null = null;
  let indent_hanging_twips: number | null = null;
  if (pPr) {
    const ind = pPr.getElementsByTagNameNS(W_NS, 'ind')[0] ?? null;
    indent_left_twips = wAttrInt(ind, 'left') ?? wAttrInt(ind, 'start');
    indent_first_line_twips = wAttrInt(ind, 'firstLine');
    indent_hanging_twips = wAttrInt(ind, 'hanging');
  }

  // Paragraph-level run defaults: pPr/rPr/b and pPr/rPr/i. These set the
  // default bold/italic state for runs in the paragraph that don't
  // override at the run level. A toggle element with no @w:val or
  // @w:val="1"/"true" means on; @w:val="0"/"false" means off.
  let bold = false;
  let italic = false;
  if (pPr) {
    const pPr_rPr = pPr.getElementsByTagNameNS(W_NS, 'rPr')[0] ?? null;
    if (pPr_rPr) {
      bold = isToggleOn(pPr_rPr.getElementsByTagNameNS(W_NS, 'b')[0]);
      italic = isToggleOn(pPr_rPr.getElementsByTagNameNS(W_NS, 'i')[0]);
    }
  }

  // Walk paragraph descendants in document order, translating each
  // text-bearing element. <w:t> contributes its textContent (which
  // already preserves spaces because XML preserves whitespace inside
  // text nodes), <w:tab/> becomes '\t', <w:br/> becomes '\n'. Without
  // this walk, paragraphs that contain tabs (e.g. "Subject:\tTitle")
  // get parsed as "Subject:Title" with no separator.
  const text = extractRunText(p);

  // Bookmarks: w:bookmarkStart and w:bookmarkEnd are siblings of paragraphs
  // OR can appear inside a paragraph. For Phase 1a we only track those
  // that appear inside the paragraph itself.
  const bookmark_starts = Array.from(p.getElementsByTagNameNS(W_NS, 'bookmarkStart'))
    .map((b) => wAttr(b, 'name'))
    .filter((n): n is string => !!n && !n.startsWith('_'));
  const bookmark_ends = Array.from(p.getElementsByTagNameNS(W_NS, 'bookmarkEnd'))
    .map((b) => wAttr(b, 'id'))
    .filter((n): n is string => !!n);

  // Walk parent chain to find enclosing content control / table cell.
  // Both signals matter: content controls mark metadata regions, tables
  // mark structured layouts (responsibility matrices, etc.).
  const ancestors = scanAncestors(p);

  // Sequential runs within the paragraph
  const runs = parseRuns(p);

  return {
    index,
    style_id,
    text,
    numbering_id,
    numbering_level,
    outline_level,
    alignment,
    indent_left_twips,
    indent_first_line_twips,
    indent_hanging_twips,
    bold,
    italic,
    bookmark_starts,
    bookmark_ends,
    content_control_tag: ancestors.content_control_tag,
    in_table: ancestors.in_table,
    runs,
    el: p,
  };
}

/**
 * Walk a paragraph and return its <w:r> children in document order,
 * recursing into containers (w:sdt, w:sdtContent, w:hyperlink,
 * w:smartTag) so runs nested inside content controls and links are
 * still surfaced. Run indices are assigned sequentially within the
 * paragraph regardless of nesting depth.
 */
function parseRuns(p: Element): RunInfo[] {
  const runs: RunInfo[] = [];
  let runIdx = 0;
  function walk(node: Element) {
    for (let i = 0; i < node.childNodes.length; i++) {
      const child = node.childNodes[i]!;
      if (child.nodeType !== 1) continue;
      const el = child as Element;
      if (el.namespaceURI !== W_NS) continue;
      if (el.localName === 'r') {
        runs.push(parseRun(el, runIdx++));
      } else if (
        el.localName === 'sdt' ||
        el.localName === 'sdtContent' ||
        el.localName === 'hyperlink' ||
        el.localName === 'smartTag' ||
        el.localName === 'ins' ||
        el.localName === 'del'
      ) {
        walk(el);
      }
    }
  }
  walk(p);
  return runs;
}

function parseRun(r: Element, index: number): RunInfo {
  const rPr = wFirst(r, 'rPr');
  const text = extractRunText(r);

  const bold = rPr ? isToggleOn(wFirst(rPr, 'b') ?? undefined) : false;
  const italic = rPr ? isToggleOn(wFirst(rPr, 'i') ?? undefined) : false;
  const underline = rPr ? wFirst(rPr, 'u') !== null : false;
  const strike = rPr ? isToggleOn(wFirst(rPr, 'strike') ?? undefined) : false;

  const colorEl = rPr ? wFirst(rPr, 'color') : null;
  const colorVal = wAttr(colorEl, 'val');
  const color = colorVal && colorVal !== 'auto' ? `#${colorVal}` : null;

  const highlightEl = rPr ? wFirst(rPr, 'highlight') : null;
  const highlight = wAttr(highlightEl, 'val');

  const rFonts = rPr ? wFirst(rPr, 'rFonts') : null;
  const font_family = wAttr(rFonts, 'ascii') ?? wAttr(rFonts, 'hAnsi') ?? null;

  const szEl = rPr ? wFirst(rPr, 'sz') : null;
  const halfPoints = wAttrInt(szEl, 'val');
  const font_size_pt = halfPoints !== null ? halfPoints / 2 : null;

  const vertAlign = rPr ? wFirst(rPr, 'vertAlign') : null;
  const vertAlignVal = wAttr(vertAlign, 'val');
  const superscript = vertAlignVal === 'superscript';
  const subscript = vertAlignVal === 'subscript';

  return {
    index,
    text,
    bold,
    italic,
    underline,
    strike,
    color,
    highlight,
    font_family,
    font_size_pt,
    superscript,
    subscript,
    el: r,
  };
}

/**
 * Recursively walk paragraph (or run) descendants in document order
 * and produce a text representation that preserves tabs and line
 * breaks. We collect text from <w:t>, '\t' from <w:tab/>, '\n' from
 * <w:br/>, and recurse into containers (runs, sdt content, etc.).
 */
function extractRunText(scope: Element): string {
  const parts: string[] = [];
  collect(scope, parts);
  return parts.join('');
}

function collect(node: Element, out: string[]): void {
  for (let i = 0; i < node.childNodes.length; i++) {
    const child = node.childNodes[i]!;
    if (child.nodeType !== 1) continue; // ELEMENT_NODE only
    const el = child as Element;
    if (el.namespaceURI !== W_NS) {
      // Recurse into non-W elements just in case (rare)
      collect(el, out);
      continue;
    }
    const local = el.localName;
    if (local === 't') {
      out.push(el.textContent ?? '');
    } else if (local === 'tab') {
      out.push('\t');
    } else if (local === 'br') {
      out.push('\n');
    } else if (local === 'cr') {
      out.push('\n');
    } else if (local === 'noBreakHyphen') {
      out.push('\u2011');
    } else if (local === 'softHyphen') {
      // soft hyphens are invisible unless line breaks; skip
    } else {
      // Containers: w:r, w:sdt, w:sdtContent, w:smartTag, w:hyperlink, etc.
      collect(el, out);
    }
  }
}

function isToggleOn(el: Element | undefined): boolean {
  if (!el) return false;
  const v = wAttr(el, 'val');
  // Toggle elements default to ON when present with no val attribute
  if (v === null) return true;
  return v === '1' || v === 'true' || v === 'on';
}

interface AncestorScan {
  content_control_tag: string | null;
  in_table: boolean;
}

function scanAncestors(p: Element): AncestorScan {
  let content_control_tag: string | null = null;
  let in_table = false;
  let node: Element | null = p.parentElement;
  while (node) {
    if (node.namespaceURI === W_NS) {
      const local = node.localName;
      if (local === 'sdt' && content_control_tag === null) {
        // Look for w:sdtPr/w:tag @w:val on this sdt
        const sdtPr = wFirst(node, 'sdtPr');
        const tagEl = sdtPr ? wFirst(sdtPr, 'tag') : null;
        const val = wAttr(tagEl, 'val');
        if (val) content_control_tag = val;
      } else if (local === 'tc') {
        in_table = true;
      }
    }
    node = node.parentElement;
  }
  return { content_control_tag, in_table };
}

function extractPageSetup(sectPr: Element): PageSetup {
  const pgSz = wFirst(sectPr, 'pgSz');
  const pgMar = wFirst(sectPr, 'pgMar');

  const orientation = (wAttr(pgSz, 'orient') ?? 'portrait') as 'portrait' | 'landscape';
  const widthTwips = wAttrInt(pgSz, 'w');
  const heightTwips = wAttrInt(pgSz, 'h');
  const paper = classifyPaper(widthTwips, heightTwips);

  const margins_twips = {
    top: wAttrInt(pgMar, 'top') ?? DEFAULT_PAGE_SETUP.margins_twips.top,
    right: wAttrInt(pgMar, 'right') ?? DEFAULT_PAGE_SETUP.margins_twips.right,
    bottom: wAttrInt(pgMar, 'bottom') ?? DEFAULT_PAGE_SETUP.margins_twips.bottom,
    left: wAttrInt(pgMar, 'left') ?? DEFAULT_PAGE_SETUP.margins_twips.left,
  };
  const header_distance = wAttrInt(pgMar, 'header') ?? DEFAULT_PAGE_SETUP.header_distance;
  const footer_distance = wAttrInt(pgMar, 'footer') ?? DEFAULT_PAGE_SETUP.footer_distance;

  return { paper, orientation, margins_twips, header_distance, footer_distance };
}

function classifyPaper(w: number | null, h: number | null): PageSetup['paper'] {
  if (w === null || h === null) return 'unknown';
  // Letter: 8.5 x 11 in = 12240 x 15840 twips
  // A4:     8.27 x 11.69 in = 11906 x 16838 twips
  // Legal:  8.5 x 14 in = 12240 x 20160 twips
  const close = (a: number, b: number) => Math.abs(a - b) < 100;
  if ((close(w, 12240) && close(h, 15840)) || (close(h, 12240) && close(w, 15840))) return 'letter';
  if ((close(w, 11906) && close(h, 16838)) || (close(h, 11906) && close(w, 16838))) return 'a4';
  if ((close(w, 12240) && close(h, 20160)) || (close(h, 12240) && close(w, 20160))) return 'legal';
  return 'unknown';
}

// Re-export wAll for tests that want to inspect raw elements
export { wAll };

// ─── Paragraph classification ─────────────────────────────────────
//
// Used by the header/footer slot-rewrite path in the assembler and
// by the synthesizer's document_parts prompt builder. A paragraph that
// contains a drawing, picture, OLE object, SDT, or field reference is
// treated as non-draftable: the assembler leaves it byte-stable and
// the synthesizer omits it from the slot list sent to the LLM.
//
// We walk the whole paragraph tree rather than just direct children
// because drawings are nested inside <w:r>, SDT boundaries can wrap
// runs, and field characters live inside runs too.

const DRAWING_LOCAL_NAMES = new Set(['drawing', 'pict', 'object']);
const COMPLEX_LOCAL_NAMES = new Set([
  'sdt',
  'footnoteReference',
  'endnoteReference',
  'fldChar',
]);

export function classifyParagraph(p: Element): {
  has_drawing: boolean;
  has_complex_content: boolean;
} {
  let has_drawing = false;
  let has_complex_content = false;
  const walker = (el: Element): void => {
    const ln = el.localName;
    if (DRAWING_LOCAL_NAMES.has(ln)) has_drawing = true;
    if (COMPLEX_LOCAL_NAMES.has(ln)) has_complex_content = true;
    for (let n = el.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 1 /* ELEMENT_NODE */) walker(n as Element);
    }
  };
  walker(p);
  return { has_drawing, has_complex_content };
}

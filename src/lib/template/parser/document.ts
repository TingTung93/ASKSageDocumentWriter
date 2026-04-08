// Parses word/document.xml — the body of the DOCX. Extracts:
//   - section properties (margins, paper size, orientation)
//   - the flat paragraph sequence with style references and text
//
// The fill region detector runs over this output to find content
// controls, bookmarks, headings, etc.

import type { PageSetup } from '../types';
import { wAll, wAttr, wAttrInt, wFirst, W_NS } from './ns';

export type Alignment = 'left' | 'center' | 'right' | 'justify' | 'both' | null;

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
  /** Reference to the underlying element for fill region detection */
  el: Element;
}

export interface ParsedDocument {
  page_setup: PageSetup;
  paragraphs: ParagraphInfo[];
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

  return { page_setup, paragraphs };
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
    el: p,
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

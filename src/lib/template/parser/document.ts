// Parses word/document.xml — the body of the DOCX. Extracts:
//   - section properties (margins, paper size, orientation)
//   - the flat paragraph sequence with style references and text
//
// The fill region detector runs over this output to find content
// controls, bookmarks, headings, etc.

import type { PageSetup } from '../types';
import { wAll, wAttr, wAttrInt, wFirst, W_NS } from './ns';

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

  // Concatenate all w:t text content under this paragraph.
  const text = Array.from(p.getElementsByTagNameNS(W_NS, 't'))
    .map((t) => t.textContent ?? '')
    .join('');

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
    bookmark_starts,
    bookmark_ends,
    content_control_tag: ancestors.content_control_tag,
    in_table: ancestors.in_table,
    el: p,
  };
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

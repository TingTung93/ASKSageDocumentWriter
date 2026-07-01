import type { DraftRun } from '../draft/types';
import type { StructuredParagraphBlock, StructuredTableBlock } from './ir';

export const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

export function createWordDocument(): Document {
  return new DOMParser().parseFromString(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W_NS}"><w:body/></w:document>`,
    'text/xml',
  );
}

export function serializeXml(node: Node): string {
  return new XMLSerializer().serializeToString(node);
}

export function firstChildNS(parent: Element, localName: string): Element | null {
  for (let n = parent.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1 && (n as Element).namespaceURI === W_NS && (n as Element).localName === localName) {
      return n as Element;
    }
  }
  return null;
}

export function appendTextRun(dom: Document, parent: Element, text: string, run?: DraftRun): Element {
  const r = dom.createElementNS(W_NS, 'w:r');
  const rPr = buildRunProperties(dom, run);
  if (rPr) r.appendChild(rPr);

  const parts = text.split('\n');
  for (let i = 0; i < parts.length; i++) {
    if (i > 0) r.appendChild(dom.createElementNS(W_NS, 'w:br'));
    const t = dom.createElementNS(W_NS, 'w:t');
    t.setAttribute('xml:space', 'preserve');
    t.textContent = parts[i]!;
    r.appendChild(t);
  }

  parent.appendChild(r);
  return r;
}

export function buildParagraphElement(
  dom: Document,
  block: StructuredParagraphBlock & { page_break_before?: boolean },
): Element {
  const p = dom.createElementNS(W_NS, 'w:p');
  const pPr = dom.createElementNS(W_NS, 'w:pPr');
  p.appendChild(pPr);

  const style = styleIdForRole(block.role, block.level ?? 0);
  const pStyle = dom.createElementNS(W_NS, 'w:pStyle');
  pStyle.setAttributeNS(W_NS, 'w:val', style);
  pPr.appendChild(pStyle);

  if (block.page_break_before) {
    pPr.appendChild(dom.createElementNS(W_NS, 'w:pageBreakBefore'));
  }

  if (block.alignment) {
    const jc = dom.createElementNS(W_NS, 'w:jc');
    jc.setAttributeNS(W_NS, 'w:val', block.alignment);
    pPr.appendChild(jc);
  }

  if (typeof block.level === 'number' && block.level > 0 && block.role !== 'heading') {
    const ind = dom.createElementNS(W_NS, 'w:ind');
    ind.setAttributeNS(W_NS, 'w:left', String(block.level * 720));
    pPr.appendChild(ind);
  }

  if (block.runs && block.runs.length > 0) {
    for (const run of block.runs) appendTextRun(dom, p, run.text, run);
  } else {
    appendTextRun(dom, p, block.text);
  }

  return p;
}

export function buildTableElement(dom: Document, table: StructuredTableBlock): Element {
  const tbl = dom.createElementNS(W_NS, 'w:tbl');
  const tblPr = dom.createElementNS(W_NS, 'w:tblPr');
  const tblStyle = dom.createElementNS(W_NS, 'w:tblStyle');
  tblStyle.setAttributeNS(W_NS, 'w:val', 'TableGrid');
  tblPr.appendChild(tblStyle);
  const tblW = dom.createElementNS(W_NS, 'w:tblW');
  tblW.setAttributeNS(W_NS, 'w:w', '0');
  tblW.setAttributeNS(W_NS, 'w:type', 'auto');
  tblPr.appendChild(tblW);
  tbl.appendChild(tblPr);

  const columnCount = Math.max(
    0,
    ...table.rows.map((row) =>
      row.cells.reduce((count, cell) => count + (cell.colspan && cell.colspan > 1 ? cell.colspan : 1), 0),
    ),
  );
  const tblGrid = dom.createElementNS(W_NS, 'w:tblGrid');
  for (let i = 0; i < columnCount; i++) {
    tblGrid.appendChild(dom.createElementNS(W_NS, 'w:gridCol'));
  }
  tbl.appendChild(tblGrid);

  for (const row of table.rows) {
    const tr = dom.createElementNS(W_NS, 'w:tr');
    if (row.is_header) {
      const trPr = dom.createElementNS(W_NS, 'w:trPr');
      trPr.appendChild(dom.createElementNS(W_NS, 'w:tblHeader'));
      tr.appendChild(trPr);
    }

    for (const cell of row.cells) {
      const tc = dom.createElementNS(W_NS, 'w:tc');
      const tcPr = dom.createElementNS(W_NS, 'w:tcPr');
      if (cell.shading) {
        const shd = dom.createElementNS(W_NS, 'w:shd');
        shd.setAttributeNS(W_NS, 'w:fill', cell.shading);
        tcPr.appendChild(shd);
      }
      if (cell.colspan && cell.colspan > 1) {
        const gridSpan = dom.createElementNS(W_NS, 'w:gridSpan');
        gridSpan.setAttributeNS(W_NS, 'w:val', String(cell.colspan));
        tcPr.appendChild(gridSpan);
      }
      tc.appendChild(tcPr);
      const p = dom.createElementNS(W_NS, 'w:p');
      if (cell.runs && cell.runs.length > 0) {
        for (const run of cell.runs) appendTextRun(dom, p, run.text, run);
      } else {
        appendTextRun(dom, p, cell.text, row.is_header ? { text: cell.text, bold: true } : undefined);
      }
      tc.appendChild(p);
      tr.appendChild(tc);
    }

    tbl.appendChild(tr);
  }

  return tbl;
}

function buildRunProperties(dom: Document, run: DraftRun | undefined): Element | null {
  if (!run) return null;
  const rPr = dom.createElementNS(W_NS, 'w:rPr');
  if (run.bold !== undefined) appendToggle(dom, rPr, 'b', run.bold);
  if (run.italic !== undefined) appendToggle(dom, rPr, 'i', run.italic);
  if (run.underline !== undefined) appendToggle(dom, rPr, 'u', run.underline, 'single', 'none');
  if (run.strike !== undefined) appendToggle(dom, rPr, 'strike', run.strike);
  if (run.color) {
    const color = dom.createElementNS(W_NS, 'w:color');
    color.setAttributeNS(W_NS, 'w:val', run.color.replace(/^#/, ''));
    rPr.appendChild(color);
  }
  if (run.highlight) {
    const highlight = dom.createElementNS(W_NS, 'w:highlight');
    highlight.setAttributeNS(W_NS, 'w:val', run.highlight);
    rPr.appendChild(highlight);
  }
  return rPr.firstChild ? rPr : null;
}

function appendToggle(
  dom: Document,
  rPr: Element,
  tag: 'b' | 'i' | 'u' | 'strike',
  value: boolean,
  valWhenTrue?: string,
  valWhenFalse = 'false',
): void {
  const el = dom.createElementNS(W_NS, `w:${tag}`);
  if (!value) el.setAttributeNS(W_NS, 'w:val', valWhenFalse);
  if (value && valWhenTrue) el.setAttributeNS(W_NS, 'w:val', valWhenTrue);
  rPr.appendChild(el);
}

function styleIdForRole(role: StructuredParagraphBlock['role'], level: number): string {
  if (role === 'heading') return `Heading${Math.min(level + 1, 4)}`;
  if (role === 'bullet') return 'ListBullet';
  if (role === 'step') return 'ListNumber';
  if (role === 'quote') return 'Quote';
  // note/caution/warning/definition intentionally fall back to Normal until
  // template or freeform style inventory maps those semantic roles explicitly.
  return 'Normal';
}

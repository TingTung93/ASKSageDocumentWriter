// Clone-and-mutate DOCX writer. Loads the original bytes via JSZip,
// applies a list of typed edit operations against the OOXML in place,
// repackages the zip, and returns a new Blob. Every formatting node
// the operations don't explicitly touch (<w:pPr>, <w:rPr>, <w:sectPr>,
// headers, footers, styles, numbering, theme, etc.) is preserved
// untouched.
//
// Two entry points:
//   exportEditedDocx(bytes, overrides)  — legacy paragraph-text-only
//                                          API used by the existing
//                                          Documents UI accept-flow
//   applyDocumentEdits(bytes, ops[])    — full op union API used by
//                                          the LLM-driven edit
//                                          pipeline (Phase B and on)

import JSZip from 'jszip';
import type { DocumentEditOp } from './types';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

export interface ApplyEditsResult {
  /** New DOCX as a Blob, ready for download */
  blob: Blob;
  /** How many of the requested edits were applied successfully */
  applied: number;
  /** Indices the writer could not find or process */
  skipped: number[];
}

export interface ApplyOpsResult {
  blob: Blob;
  applied: Array<{ op: string; success: boolean; error?: string }>;
}

export async function exportEditedDocx(
  originalBytes: ArrayBuffer | Uint8Array | Blob,
  overrides: Record<number, string>,
): Promise<ApplyEditsResult> {
  // ─── No-op passthrough ────────────────────────────────────────────
  // If there are zero edits to apply, return the original bytes
  // unchanged. We still validate the input is a real DOCX (one cheap
  // zip-directory load) so we don't return garbage to a confused
  // caller, but we skip the parse → serialize → re-zip round trip
  // entirely. The exported bytes are the input bytes — the strongest
  // possible guarantee for the "open and re-export with no edits"
  // workflow: the export IS the input.
  const overrideCount = Object.keys(overrides).length;
  if (overrideCount === 0) {
    const validateZip = await JSZip.loadAsync(originalBytes);
    if (!validateZip.file('word/document.xml')) {
      throw new Error('Not a valid DOCX: word/document.xml is missing');
    }
    const blob = await toBlob(originalBytes);
    return { blob, applied: 0, skipped: [] };
  }

  const zip = await JSZip.loadAsync(originalBytes);
  const file = zip.file('word/document.xml');
  if (!file) {
    throw new Error('Not a valid DOCX: word/document.xml is missing');
  }
  const docXml = await file.async('string');
  const dom = new DOMParser().parseFromString(docXml, 'text/xml');

  const errs = dom.getElementsByTagName('parsererror');
  if (errs.length > 0) {
    throw new Error(`XML parse error: ${errs[0]!.textContent ?? 'unknown'}`);
  }

  const paragraphs = Array.from(dom.getElementsByTagNameNS(W_NS, 'p'));
  let applied = 0;
  const skipped: number[] = [];

  for (const [indexStr, newText] of Object.entries(overrides)) {
    const index = Number(indexStr);
    const p = paragraphs[index];
    if (!p) {
      skipped.push(index);
      continue;
    }
    try {
      replaceParagraphText(dom, p, newText);
      applied += 1;
    } catch {
      skipped.push(index);
    }
  }

  // Serialize the modified DOM back to a string. We must preserve the
  // XML declaration and namespace declarations from the original
  // root element — XMLSerializer in jsdom and browsers does this.
  const newXml = new XMLSerializer().serializeToString(dom);

  // Re-add the XML declaration if it was lost (some serializers strip it).
  const xmlHeader = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const finalXml = newXml.startsWith('<?xml') ? newXml : xmlHeader + newXml;

  zip.file('word/document.xml', finalXml);

  // Generate as Blob in browsers (works on file://). In jsdom tests
  // we use uint8array because Blob support is partial.
  const isBrowser = typeof window !== 'undefined' && typeof window.Blob !== 'undefined';
  const blob = isBrowser
    ? await zip.generateAsync({ type: 'blob', mimeType: DOCX_MIME })
    : ((await zip.generateAsync({ type: 'uint8array' })) as unknown as Blob);

  return { blob, applied, skipped };
}

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * Apply a list of typed DocumentEditOp operations to a DOCX. This is
 * the new entry point — `exportEditedDocx` is a thin wrapper for
 * paragraph-text-only legacy callers.
 *
 * Each op is dispatched to a small focused mutator function that
 * walks the OOXML to find the right element and applies the change.
 * Per-op success/failure is reported so the UI can show what stuck.
 */
export async function applyDocumentEdits(
  originalBytes: ArrayBuffer | Uint8Array | Blob,
  ops: DocumentEditOp[],
): Promise<ApplyOpsResult> {
  // No-op passthrough: if there are zero ops, validate the input is
  // a real DOCX and return the original bytes unchanged. Same
  // contract as exportEditedDocx's no-op path.
  if (ops.length === 0) {
    const validateZip = await JSZip.loadAsync(originalBytes);
    if (!validateZip.file('word/document.xml')) {
      throw new Error('Not a valid DOCX: word/document.xml is missing');
    }
    const blob = await toBlob(originalBytes);
    return { blob, applied: [] };
  }

  const zip = await JSZip.loadAsync(originalBytes);
  const file = zip.file('word/document.xml');
  if (!file) {
    throw new Error('Not a valid DOCX: word/document.xml is missing');
  }
  const docXml = await file.async('string');
  const dom = new DOMParser().parseFromString(docXml, 'text/xml');
  const errs = dom.getElementsByTagName('parsererror');
  if (errs.length > 0) {
    throw new Error(`XML parse error: ${errs[0]!.textContent ?? 'unknown'}`);
  }

  // Cache of body paragraphs (document order). We compute this once
  // and re-use because most ops address paragraphs by index. If a
  // delete_paragraph or insert_paragraph_after op runs we recompute.
  let paragraphs = listBodyParagraphs(dom);
  let tables = listTables(dom);

  const applied: ApplyOpsResult['applied'] = [];

  for (const op of ops) {
    try {
      switch (op.op) {
        case 'replace_paragraph_text': {
          const p = paragraphs[op.index];
          if (!p) throw new Error(`paragraph index ${op.index} out of range`);
          replaceParagraphText(dom, p, op.new_text);
          applied.push({ op: op.op, success: true });
          break;
        }
        case 'replace_run_text': {
          const p = paragraphs[op.paragraph_index];
          if (!p) throw new Error(`paragraph index ${op.paragraph_index} out of range`);
          const runs = listRuns(p);
          const r = runs[op.run_index];
          if (!r) throw new Error(`run index ${op.run_index} out of range in paragraph ${op.paragraph_index}`);
          replaceRunText(dom, r, op.new_text);
          applied.push({ op: op.op, success: true });
          break;
        }
        case 'set_run_property': {
          const p = paragraphs[op.paragraph_index];
          if (!p) throw new Error(`paragraph index ${op.paragraph_index} out of range`);
          const runs = listRuns(p);
          const r = runs[op.run_index];
          if (!r) throw new Error(`run index ${op.run_index} out of range`);
          setRunProperty(dom, r, op.property, op.value);
          applied.push({ op: op.op, success: true });
          break;
        }
        case 'set_cell_text': {
          const cell = findCell(tables, op.table_index, op.row_index, op.cell_index);
          if (!cell) throw new Error(`cell ${op.table_index}/${op.row_index}/${op.cell_index} not found`);
          setCellText(dom, cell, op.new_text);
          applied.push({ op: op.op, success: true });
          break;
        }
        case 'insert_table_row': {
          const table = tables[op.table_index];
          if (!table) throw new Error(`table index ${op.table_index} out of range`);
          insertTableRow(dom, table, op.after_row_index, op.cells);
          // Tables changed shape — recompute caches
          paragraphs = listBodyParagraphs(dom);
          tables = listTables(dom);
          applied.push({ op: op.op, success: true });
          break;
        }
        case 'delete_table_row': {
          const table = tables[op.table_index];
          if (!table) throw new Error(`table index ${op.table_index} out of range`);
          deleteTableRow(table, op.row_index);
          paragraphs = listBodyParagraphs(dom);
          tables = listTables(dom);
          applied.push({ op: op.op, success: true });
          break;
        }
        case 'set_content_control_value': {
          const sdt = findSdtByTag(dom, op.tag);
          if (!sdt) throw new Error(`content control with tag "${op.tag}" not found`);
          setSdtValue(dom, sdt, op.value);
          applied.push({ op: op.op, success: true });
          break;
        }
        case 'set_paragraph_style': {
          const p = paragraphs[op.index];
          if (!p) throw new Error(`paragraph index ${op.index} out of range`);
          setParagraphStyle(dom, p, op.style_id);
          applied.push({ op: op.op, success: true });
          break;
        }
        case 'set_paragraph_alignment': {
          const p = paragraphs[op.index];
          if (!p) throw new Error(`paragraph index ${op.index} out of range`);
          setParagraphAlignment(dom, p, op.alignment);
          applied.push({ op: op.op, success: true });
          break;
        }
        case 'delete_paragraph': {
          const p = paragraphs[op.index];
          if (!p) throw new Error(`paragraph index ${op.index} out of range`);
          p.parentNode?.removeChild(p);
          // Recompute caches because indices have shifted
          paragraphs = listBodyParagraphs(dom);
          tables = listTables(dom);
          applied.push({ op: op.op, success: true });
          break;
        }
        default: {
          const _exhaustive: never = op;
          throw new Error(`unknown op: ${JSON.stringify(_exhaustive)}`);
        }
      }
    } catch (e) {
      applied.push({
        op: op.op,
        success: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // Serialize and re-zip
  const newXml = new XMLSerializer().serializeToString(dom);
  const xmlHeader = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const finalXml = newXml.startsWith('<?xml') ? newXml : xmlHeader + newXml;
  zip.file('word/document.xml', finalXml);

  const isBrowser = typeof window !== 'undefined' && typeof window.Blob !== 'undefined';
  const blob = isBrowser
    ? await zip.generateAsync({ type: 'blob', mimeType: DOCX_MIME })
    : ((await zip.generateAsync({ type: 'uint8array' })) as unknown as Blob);

  return { blob, applied };
}

// ─── Paragraph / run / table walkers ──────────────────────────────

function listBodyParagraphs(dom: Document): Element[] {
  const body = dom.getElementsByTagNameNS(W_NS, 'body')[0];
  if (!body) return [];
  return Array.from(body.getElementsByTagNameNS(W_NS, 'p'));
}

function listRuns(p: Element): Element[] {
  // Walk the paragraph for <w:r> children, recursing into containers.
  const runs: Element[] = [];
  function walk(node: Element) {
    for (let i = 0; i < node.childNodes.length; i++) {
      const child = node.childNodes[i]!;
      if (child.nodeType !== 1) continue;
      const el = child as Element;
      if (el.namespaceURI !== W_NS) continue;
      if (el.localName === 'r') {
        runs.push(el);
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

interface TableHandle {
  el: Element;
  rows: Element[];
}

function listTables(dom: Document): TableHandle[] {
  const body = dom.getElementsByTagNameNS(W_NS, 'body')[0];
  if (!body) return [];
  return Array.from(body.getElementsByTagNameNS(W_NS, 'tbl')).map((el) => ({
    el,
    rows: Array.from(el.getElementsByTagNameNS(W_NS, 'tr')),
  }));
}

function findCell(
  tables: TableHandle[],
  tableIdx: number,
  rowIdx: number,
  cellIdx: number,
): Element | null {
  const t = tables[tableIdx];
  if (!t) return null;
  const r = t.rows[rowIdx];
  if (!r) return null;
  const cells = Array.from(r.getElementsByTagNameNS(W_NS, 'tc'));
  return cells[cellIdx] ?? null;
}

// ─── Per-op mutators ──────────────────────────────────────────────

function replaceRunText(dom: Document, r: Element, newText: string): void {
  const textEls = Array.from(r.getElementsByTagNameNS(W_NS, 't'));
  if (textEls.length === 0) {
    const t = dom.createElementNS(W_NS, 'w:t');
    t.setAttribute('xml:space', 'preserve');
    t.textContent = newText;
    r.appendChild(t);
    return;
  }
  if (newText.startsWith(' ') || newText.endsWith(' ')) {
    textEls[0]!.setAttribute('xml:space', 'preserve');
  }
  textEls[0]!.textContent = newText;
  for (let i = 1; i < textEls.length; i++) {
    textEls[i]!.textContent = '';
  }
}

function setRunProperty(
  dom: Document,
  r: Element,
  property: 'bold' | 'italic' | 'underline' | 'strike',
  value: boolean,
): void {
  // Map our property names to OOXML element names
  const localName =
    property === 'bold'
      ? 'b'
      : property === 'italic'
        ? 'i'
        : property === 'underline'
          ? 'u'
          : 'strike';

  let rPr = r.getElementsByTagNameNS(W_NS, 'rPr')[0];
  if (!rPr) {
    rPr = dom.createElementNS(W_NS, 'w:rPr');
    // rPr must be the first child of <w:r>
    r.insertBefore(rPr, r.firstChild);
  }
  // Find existing toggle element
  const existing = Array.from(rPr.childNodes).find(
    (n) => n.nodeType === 1 && (n as Element).namespaceURI === W_NS && (n as Element).localName === localName,
  ) as Element | undefined;
  if (value) {
    if (!existing) {
      const el = dom.createElementNS(W_NS, `w:${localName}`);
      // For underline, default val to "single"
      if (localName === 'u') {
        el.setAttributeNS(W_NS, 'w:val', 'single');
      }
      rPr.appendChild(el);
    }
  } else {
    if (existing) rPr.removeChild(existing);
  }
}

function setCellText(dom: Document, cell: Element, newText: string): void {
  // Find the first paragraph inside the cell, replace its text using
  // the same first-w:t replacement logic. If no paragraphs exist,
  // create one.
  const ps = Array.from(cell.getElementsByTagNameNS(W_NS, 'p'));
  if (ps.length === 0) {
    const p = dom.createElementNS(W_NS, 'w:p');
    const r = dom.createElementNS(W_NS, 'w:r');
    const t = dom.createElementNS(W_NS, 'w:t');
    t.setAttribute('xml:space', 'preserve');
    t.textContent = newText;
    r.appendChild(t);
    p.appendChild(r);
    cell.appendChild(p);
    return;
  }
  replaceParagraphText(dom, ps[0]!, newText);
  // Empty subsequent paragraphs in the same cell so the cell content
  // becomes a single line. (Cells with multi-paragraph content can be
  // re-built with multiple insert_table_row calls.)
  for (let i = 1; i < ps.length; i++) {
    const ts = Array.from(ps[i]!.getElementsByTagNameNS(W_NS, 't'));
    for (const t of ts) t.textContent = '';
  }
}

function insertTableRow(
  dom: Document,
  table: TableHandle,
  afterRowIndex: number,
  cellTexts: string[],
): void {
  // Clone the row at afterRowIndex (or the first row if 0/-1) so the
  // new row inherits trPr / tcPr / column widths / borders. Then
  // overwrite each cell's first paragraph text.
  const sourceIdx = Math.max(0, Math.min(table.rows.length - 1, afterRowIndex));
  const source = table.rows[sourceIdx];
  if (!source) throw new Error('insert_table_row: source row missing');
  const clone = source.cloneNode(true) as Element;

  const newCells = Array.from(clone.getElementsByTagNameNS(W_NS, 'tc'));
  for (let i = 0; i < newCells.length; i++) {
    const text = cellTexts[i] ?? '';
    setCellText(dom, newCells[i]!, text);
  }

  // Insert after the source row in the document
  source.parentNode?.insertBefore(clone, source.nextSibling);
}

function deleteTableRow(table: TableHandle, rowIndex: number): void {
  const row = table.rows[rowIndex];
  if (!row) throw new Error('delete_table_row: row index out of range');
  row.parentNode?.removeChild(row);
}

function findSdtByTag(dom: Document, tag: string): Element | null {
  const sdts = Array.from(dom.getElementsByTagNameNS(W_NS, 'sdt'));
  for (const sdt of sdts) {
    const sdtPr = sdt.getElementsByTagNameNS(W_NS, 'sdtPr')[0];
    if (!sdtPr) continue;
    const tagEl = sdtPr.getElementsByTagNameNS(W_NS, 'tag')[0];
    const val = tagEl ? tagEl.getAttributeNS(W_NS, 'val') : null;
    if (val === tag) return sdt;
  }
  return null;
}

function setSdtValue(dom: Document, sdt: Element, value: string): void {
  // Replace the first <w:t> inside the sdt's content. If the content
  // is wrapped in <w:sdtContent>, descend into it.
  const sdtContent = sdt.getElementsByTagNameNS(W_NS, 'sdtContent')[0] ?? sdt;
  const textEls = Array.from(sdtContent.getElementsByTagNameNS(W_NS, 't'));
  if (textEls.length === 0) {
    // Create a w:r/w:t structure inside sdtContent
    const r = dom.createElementNS(W_NS, 'w:r');
    const t = dom.createElementNS(W_NS, 'w:t');
    t.setAttribute('xml:space', 'preserve');
    t.textContent = value;
    r.appendChild(t);
    sdtContent.appendChild(r);
    return;
  }
  if (value.startsWith(' ') || value.endsWith(' ')) {
    textEls[0]!.setAttribute('xml:space', 'preserve');
  }
  textEls[0]!.textContent = value;
  for (let i = 1; i < textEls.length; i++) {
    textEls[i]!.textContent = '';
  }
}

function setParagraphStyle(dom: Document, p: Element, styleId: string): void {
  let pPr = p.getElementsByTagNameNS(W_NS, 'pPr')[0];
  if (!pPr) {
    pPr = dom.createElementNS(W_NS, 'w:pPr');
    p.insertBefore(pPr, p.firstChild);
  }
  let pStyle = pPr.getElementsByTagNameNS(W_NS, 'pStyle')[0];
  if (!pStyle) {
    pStyle = dom.createElementNS(W_NS, 'w:pStyle');
    pPr.insertBefore(pStyle, pPr.firstChild);
  }
  pStyle.setAttributeNS(W_NS, 'w:val', styleId);
}

function setParagraphAlignment(
  dom: Document,
  p: Element,
  alignment: 'left' | 'center' | 'right' | 'justify' | 'both',
): void {
  let pPr = p.getElementsByTagNameNS(W_NS, 'pPr')[0];
  if (!pPr) {
    pPr = dom.createElementNS(W_NS, 'w:pPr');
    p.insertBefore(pPr, p.firstChild);
  }
  let jc = pPr.getElementsByTagNameNS(W_NS, 'jc')[0];
  if (!jc) {
    jc = dom.createElementNS(W_NS, 'w:jc');
    pPr.appendChild(jc);
  }
  jc.setAttributeNS(W_NS, 'w:val', alignment);
}

async function toBlob(input: ArrayBuffer | Uint8Array | Blob): Promise<Blob> {
  if (input instanceof Blob) return input;
  // Browser path
  if (typeof window !== 'undefined' && typeof window.Blob !== 'undefined') {
    return new Blob([input as BlobPart], { type: DOCX_MIME });
  }
  // jsdom test path — return the input cast as Blob (parser tests
  // accept ArrayBuffer/Uint8Array directly via parseDocx).
  return input as unknown as Blob;
}

/**
 * Replace the visible text of a paragraph while preserving its run
 * properties. Strategy:
 *   - Find every `<w:t>` element inside the paragraph
 *   - Set the FIRST one's textContent to newText
 *   - Empty all subsequent ones (so the paragraph still has the same
 *     run structure but only the first run carries content)
 *   - If the paragraph has no `<w:t>` at all, create a `<w:r><w:t>` wrapper
 *
 * This loses internal formatting variation (bold inside a paragraph
 * gets flattened) but preserves the paragraph's style id, alignment,
 * indentation, list membership, and any surrounding XML structure.
 */
function replaceParagraphText(dom: Document, p: Element, newText: string): void {
  const textEls = Array.from(p.getElementsByTagNameNS(W_NS, 't'));

  if (textEls.length === 0) {
    // Empty paragraph — create a w:r/w:t wrapper using xml:space="preserve"
    // so leading/trailing whitespace is honored.
    const r = dom.createElementNS(W_NS, 'w:r');
    const t = dom.createElementNS(W_NS, 'w:t');
    t.setAttribute('xml:space', 'preserve');
    t.textContent = newText;
    r.appendChild(t);
    p.appendChild(r);
    return;
  }

  const first = textEls[0]!;
  // Preserve whitespace if the new text starts or ends with whitespace
  if (newText.startsWith(' ') || newText.endsWith(' ')) {
    first.setAttribute('xml:space', 'preserve');
  }
  first.textContent = newText;

  // Empty all subsequent text elements in this paragraph so they don't
  // duplicate content. The runs themselves stay so we don't disturb
  // any sibling formatting nodes.
  for (let i = 1; i < textEls.length; i++) {
    textEls[i]!.textContent = '';
  }
}

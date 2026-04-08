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
        case 'insert_paragraph_after': {
          const p = paragraphs[op.index];
          if (!p) throw new Error(`paragraph index ${op.index} out of range`);
          insertParagraphAfter(dom, p, op.new_text, op.style_id);
          paragraphs = listBodyParagraphs(dom);
          tables = listTables(dom);
          applied.push({ op: op.op, success: true });
          break;
        }
        case 'merge_paragraphs': {
          const p1 = paragraphs[op.index];
          const p2 = paragraphs[op.index + 1];
          if (!p1) throw new Error(`paragraph index ${op.index} out of range`);
          if (!p2) throw new Error(`merge_paragraphs: no paragraph at index ${op.index + 1} to merge into ${op.index}`);
          mergeParagraphs(dom, p1, p2, op.separator ?? ' ');
          paragraphs = listBodyParagraphs(dom);
          tables = listTables(dom);
          applied.push({ op: op.op, success: true });
          break;
        }
        case 'split_paragraph': {
          const p = paragraphs[op.index];
          if (!p) throw new Error(`paragraph index ${op.index} out of range`);
          splitParagraph(dom, p, op.split_at_text);
          paragraphs = listBodyParagraphs(dom);
          tables = listTables(dom);
          applied.push({ op: op.op, success: true });
          break;
        }
        case 'set_paragraph_indent': {
          const p = paragraphs[op.paragraph_index];
          if (!p) throw new Error(`paragraph index ${op.paragraph_index} out of range`);
          setParagraphIndent(dom, p, op.left_twips, op.first_line_twips, op.hanging_twips);
          applied.push({ op: op.op, success: true });
          break;
        }
        case 'set_paragraph_spacing': {
          const p = paragraphs[op.paragraph_index];
          if (!p) throw new Error(`paragraph index ${op.paragraph_index} out of range`);
          setParagraphSpacing(dom, p, op.before_twips, op.after_twips, op.line_value, op.line_rule);
          applied.push({ op: op.op, success: true });
          break;
        }
        case 'set_run_font': {
          const p = paragraphs[op.paragraph_index];
          if (!p) throw new Error(`paragraph index ${op.paragraph_index} out of range`);
          const runs = listRuns(p);
          const r = runs[op.run_index];
          if (!r) throw new Error(`run index ${op.run_index} out of range`);
          setRunFont(dom, r, op.family, op.size_pt);
          applied.push({ op: op.op, success: true });
          break;
        }
        case 'set_run_color': {
          const p = paragraphs[op.paragraph_index];
          if (!p) throw new Error(`paragraph index ${op.paragraph_index} out of range`);
          const runs = listRuns(p);
          const r = runs[op.run_index];
          if (!r) throw new Error(`run index ${op.run_index} out of range`);
          setRunColor(dom, r, op.color, op.highlight);
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
// ─── Phase E: structural ops (insert / merge / split) ───────────

/**
 * Insert a new paragraph immediately after `anchor`. The new paragraph
 * inherits the anchor's pPr (so it picks up the same style, alignment,
 * indentation, list membership) unless `styleId` is provided, in
 * which case the cloned pPr's pStyle is overwritten.
 */
function insertParagraphAfter(
  dom: Document,
  anchor: Element,
  newText: string,
  styleId?: string,
): void {
  const newP = dom.createElementNS(W_NS, 'w:p');
  // Clone the anchor's pPr so the new paragraph picks up its formatting.
  const anchorPPr = anchor.getElementsByTagNameNS(W_NS, 'pPr')[0];
  if (anchorPPr) {
    const clonedPPr = anchorPPr.cloneNode(true) as Element;
    newP.appendChild(clonedPPr);
    if (styleId) {
      let pStyle = clonedPPr.getElementsByTagNameNS(W_NS, 'pStyle')[0];
      if (!pStyle) {
        pStyle = dom.createElementNS(W_NS, 'w:pStyle');
        clonedPPr.insertBefore(pStyle, clonedPPr.firstChild);
      }
      pStyle.setAttributeNS(W_NS, 'w:val', styleId);
    }
  } else if (styleId) {
    const pPr = dom.createElementNS(W_NS, 'w:pPr');
    const pStyle = dom.createElementNS(W_NS, 'w:pStyle');
    pStyle.setAttributeNS(W_NS, 'w:val', styleId);
    pPr.appendChild(pStyle);
    newP.appendChild(pPr);
  }
  // Add a single run carrying the new text.
  const r = dom.createElementNS(W_NS, 'w:r');
  const t = dom.createElementNS(W_NS, 'w:t');
  t.setAttribute('xml:space', 'preserve');
  t.textContent = newText;
  r.appendChild(t);
  newP.appendChild(r);
  // Insert after the anchor in the parent.
  const parent = anchor.parentNode;
  if (!parent) throw new Error('insertParagraphAfter: anchor has no parent');
  if (anchor.nextSibling) {
    parent.insertBefore(newP, anchor.nextSibling);
  } else {
    parent.appendChild(newP);
  }
}

/**
 * Merge paragraph `p2` into `p1` and remove `p2`. The combined text
 * lives in `p1`'s first run; the separator is appended between the
 * two paragraphs' visible text. `p1`'s pPr is preserved (so the
 * resulting merged paragraph keeps p1's style/alignment/indent).
 */
function mergeParagraphs(dom: Document, p1: Element, p2: Element, separator: string): void {
  const text1 = collectVisibleText(p1);
  const text2 = collectVisibleText(p2);
  const combined = `${text1}${separator}${text2}`;
  replaceParagraphText(dom, p1, combined);
  p2.parentNode?.removeChild(p2);
}

/**
 * Split paragraph `p` at the first occurrence of `splitAtText`. The
 * split point becomes the start of a new paragraph inserted after
 * `p`. The new paragraph inherits `p`'s pPr (style, alignment, etc).
 * Throws if `splitAtText` is not found in the paragraph's visible
 * text.
 */
function splitParagraph(dom: Document, p: Element, splitAtText: string): void {
  const fullText = collectVisibleText(p);
  const splitIdx = fullText.indexOf(splitAtText);
  if (splitIdx === -1) {
    throw new Error(
      `split_paragraph: split_at_text not found in paragraph (looked for "${splitAtText.slice(0, 60)}${splitAtText.length > 60 ? '…' : ''}" in "${fullText.slice(0, 80)}${fullText.length > 80 ? '…' : ''}")`,
    );
  }
  const before = fullText.slice(0, splitIdx);
  const after = fullText.slice(splitIdx);
  // Replace the original paragraph's text with the "before" half.
  replaceParagraphText(dom, p, before);
  // Insert a new paragraph after `p` carrying the "after" half.
  // The styleId is undefined so insertParagraphAfter clones p's pPr.
  insertParagraphAfter(dom, p, after, undefined);
}

/** Collect all `<w:t>` text from a paragraph in document order. */
function collectVisibleText(p: Element): string {
  const ts = Array.from(p.getElementsByTagNameNS(W_NS, 't'));
  return ts.map((t) => t.textContent ?? '').join('');
}

// ─── Phase F: paragraph & run formatting ────────────────────────

/**
 * Set / clear the indent fields on a paragraph. Each field is
 * tri-state: undefined = leave unchanged, null = clear the attribute,
 * number = set the attribute. We mutate `<w:ind>` inside `<w:pPr>`,
 * creating either as needed.
 */
function setParagraphIndent(
  dom: Document,
  p: Element,
  left_twips: number | null | undefined,
  first_line_twips: number | null | undefined,
  hanging_twips: number | null | undefined,
): void {
  let pPr = p.getElementsByTagNameNS(W_NS, 'pPr')[0];
  if (!pPr) {
    pPr = dom.createElementNS(W_NS, 'w:pPr');
    p.insertBefore(pPr, p.firstChild);
  }
  let ind = pPr.getElementsByTagNameNS(W_NS, 'ind')[0];
  if (!ind) {
    ind = dom.createElementNS(W_NS, 'w:ind');
    pPr.appendChild(ind);
  }
  applyTwipAttr(ind, 'w:left', left_twips);
  applyTwipAttr(ind, 'w:firstLine', first_line_twips);
  applyTwipAttr(ind, 'w:hanging', hanging_twips);
  // If every attribute was cleared, drop the empty <w:ind> element so
  // the document doesn't carry no-op nodes.
  if (ind.attributes.length === 0) {
    ind.parentNode?.removeChild(ind);
  }
}

/**
 * Set / clear paragraph spacing fields on `<w:spacing>` inside `<w:pPr>`.
 * Same tri-state semantics as setParagraphIndent.
 */
function setParagraphSpacing(
  dom: Document,
  p: Element,
  before_twips: number | null | undefined,
  after_twips: number | null | undefined,
  line_value: number | null | undefined,
  line_rule: 'auto' | 'exact' | 'atLeast' | undefined,
): void {
  let pPr = p.getElementsByTagNameNS(W_NS, 'pPr')[0];
  if (!pPr) {
    pPr = dom.createElementNS(W_NS, 'w:pPr');
    p.insertBefore(pPr, p.firstChild);
  }
  let spacing = pPr.getElementsByTagNameNS(W_NS, 'spacing')[0];
  if (!spacing) {
    spacing = dom.createElementNS(W_NS, 'w:spacing');
    pPr.appendChild(spacing);
  }
  applyTwipAttr(spacing, 'w:before', before_twips);
  applyTwipAttr(spacing, 'w:after', after_twips);
  if (line_value !== undefined) {
    if (line_value === null) {
      spacing.removeAttributeNS(W_NS, 'line');
      spacing.removeAttributeNS(W_NS, 'lineRule');
    } else {
      spacing.setAttributeNS(W_NS, 'w:line', String(line_value));
      if (line_rule) {
        spacing.setAttributeNS(W_NS, 'w:lineRule', line_rule);
      }
    }
  } else if (line_rule) {
    spacing.setAttributeNS(W_NS, 'w:lineRule', line_rule);
  }
  if (spacing.attributes.length === 0) {
    spacing.parentNode?.removeChild(spacing);
  }
}

/** Helper for the tri-state twip attribute pattern. */
function applyTwipAttr(el: Element, qname: string, value: number | null | undefined): void {
  if (value === undefined) return;
  const localName = qname.startsWith('w:') ? qname.slice(2) : qname;
  if (value === null) {
    el.removeAttributeNS(W_NS, localName);
  } else {
    el.setAttributeNS(W_NS, qname, String(value));
  }
}

/**
 * Set / clear a run's font family and/or size. Mutates `<w:rFonts>`
 * and `<w:sz>` inside the run's `<w:rPr>`. Tri-state: undefined =
 * leave unchanged, null = clear, value = set.
 */
function setRunFont(
  dom: Document,
  r: Element,
  family: string | null | undefined,
  size_pt: number | null | undefined,
): void {
  const rPr = ensureRPr(dom, r);
  if (family !== undefined) {
    if (family === null) {
      const existing = rPr.getElementsByTagNameNS(W_NS, 'rFonts')[0];
      if (existing) rPr.removeChild(existing);
    } else {
      let rFonts = rPr.getElementsByTagNameNS(W_NS, 'rFonts')[0];
      if (!rFonts) {
        rFonts = dom.createElementNS(W_NS, 'w:rFonts');
        rPr.appendChild(rFonts);
      }
      // Set all four font slots so it sticks regardless of script.
      rFonts.setAttributeNS(W_NS, 'w:ascii', family);
      rFonts.setAttributeNS(W_NS, 'w:hAnsi', family);
      rFonts.setAttributeNS(W_NS, 'w:cs', family);
      rFonts.setAttributeNS(W_NS, 'w:eastAsia', family);
    }
  }
  if (size_pt !== undefined) {
    if (size_pt === null) {
      const existingSz = rPr.getElementsByTagNameNS(W_NS, 'sz')[0];
      if (existingSz) rPr.removeChild(existingSz);
      const existingSzCs = rPr.getElementsByTagNameNS(W_NS, 'szCs')[0];
      if (existingSzCs) rPr.removeChild(existingSzCs);
    } else {
      // Word stores font size in HALF-points.
      const halfPoints = String(Math.round(size_pt * 2));
      let sz = rPr.getElementsByTagNameNS(W_NS, 'sz')[0];
      if (!sz) {
        sz = dom.createElementNS(W_NS, 'w:sz');
        rPr.appendChild(sz);
      }
      sz.setAttributeNS(W_NS, 'w:val', halfPoints);
      let szCs = rPr.getElementsByTagNameNS(W_NS, 'szCs')[0];
      if (!szCs) {
        szCs = dom.createElementNS(W_NS, 'w:szCs');
        rPr.appendChild(szCs);
      }
      szCs.setAttributeNS(W_NS, 'w:val', halfPoints);
    }
  }
}

/**
 * Set / clear a run's text color (hex without #) and/or highlight
 * (Word palette name). Pass null to clear. Empty string is treated
 * as null for color.
 */
function setRunColor(
  dom: Document,
  r: Element,
  color: string | null,
  highlight: string | null | undefined,
): void {
  const rPr = ensureRPr(dom, r);
  if (color === null || color === '' || color === 'auto') {
    const existing = rPr.getElementsByTagNameNS(W_NS, 'color')[0];
    if (existing) rPr.removeChild(existing);
  } else {
    let colorEl = rPr.getElementsByTagNameNS(W_NS, 'color')[0];
    if (!colorEl) {
      colorEl = dom.createElementNS(W_NS, 'w:color');
      rPr.appendChild(colorEl);
    }
    colorEl.setAttributeNS(W_NS, 'w:val', color.replace(/^#/, ''));
  }
  if (highlight !== undefined) {
    if (highlight === null || highlight === '') {
      const existing = rPr.getElementsByTagNameNS(W_NS, 'highlight')[0];
      if (existing) rPr.removeChild(existing);
    } else {
      let h = rPr.getElementsByTagNameNS(W_NS, 'highlight')[0];
      if (!h) {
        h = dom.createElementNS(W_NS, 'w:highlight');
        rPr.appendChild(h);
      }
      h.setAttributeNS(W_NS, 'w:val', highlight);
    }
  }
}

/** Get-or-create the `<w:rPr>` element for a run. */
function ensureRPr(dom: Document, r: Element): Element {
  let rPr = r.getElementsByTagNameNS(W_NS, 'rPr')[0];
  if (!rPr) {
    rPr = dom.createElementNS(W_NS, 'w:rPr');
    r.insertBefore(rPr, r.firstChild);
  }
  return rPr;
}

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

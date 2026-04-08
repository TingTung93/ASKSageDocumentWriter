// Clone-and-mutate DOCX writer. Loads the original bytes via JSZip,
// finds each edited paragraph by document-order index, replaces the
// first `<w:t>` element's text content with the new text, empties any
// subsequent `<w:t>` elements in the same paragraph, and writes the
// repackaged zip back. Every formatting node (`<w:pPr>`, `<w:rPr>`,
// `<w:sectPr>`, headers, footers, styles) is preserved untouched.
//
// This is also the proof-of-concept for the Phase 3 template assembler:
// the same technique scales to splicing drafted section content into
// template fill regions.

import JSZip from 'jszip';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

export interface ApplyEditsResult {
  /** New DOCX as a Blob, ready for download */
  blob: Blob;
  /** How many of the requested edits were applied successfully */
  applied: number;
  /** Indices the writer could not find or process */
  skipped: number[];
}

export async function exportEditedDocx(
  originalBytes: ArrayBuffer | Uint8Array | Blob,
  overrides: Record<number, string>,
): Promise<ApplyEditsResult> {
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

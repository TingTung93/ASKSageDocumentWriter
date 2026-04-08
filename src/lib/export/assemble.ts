// Phase 5a — DOCX assembly writer. Clones a template's original DOCX
// bytes via JSZip, walks word/document.xml, and replaces each
// heading-bounded section's paragraph range with new <w:p> elements
// built from a DraftParagraph[] payload. Every byte of the zip we
// don't explicitly touch — headers, footers, styles, numbering,
// theme, media, content_types, rels — is preserved unchanged.
//
// This is the section-granularity sibling of lib/document/writer.ts's
// applyDocumentEdits. Same clone-and-mutate pattern (load zip, parse
// document.xml into a DOM, mutate, serialize back, re-zip), but
// operating on paragraph ranges instead of per-op edits.
//
// Only heading_bounded BodyFillRegions are supported in v1. Regions
// of kind content_control, bookmark, or placeholder are skipped with
// status `skipped_unsupported_region` — the template's original
// content for those regions is left untouched. A future pass can
// extend this writer with sdt-content-replacement and bookmark-range
// replacement; the per-section status union already has a slot for
// each case.

import JSZip from 'jszip';
import type { TemplateRecord } from '../db/schema';
import type { BodyFillRegion } from '../template/types';
import type { DraftParagraph } from '../draft/types';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export type AssembleSectionStatus =
  | { kind: 'assembled'; paragraphs_replaced: number; paragraphs_inserted: number }
  | { kind: 'skipped_no_draft' }
  | { kind: 'skipped_unsupported_region'; reason: string }
  | { kind: 'failed'; error: string };

export interface AssembleProjectDocxArgs {
  /** The source template — its docx_bytes is the clone-and-mutate skeleton. */
  template: TemplateRecord;
  /**
   * Map from section_id → drafted paragraphs. Sections without an
   * entry are left as the template's original text. The assembler
   * does NOT splice anything for missing sections — that's a
   * deliberate "skip what's not drafted" rule, NOT an error.
   */
  draftedBySectionId: Map<string, DraftParagraph[]>;
  /** Optional: tracking the per-section assembly result. */
  onSectionAssembled?: (section: BodyFillRegion, status: AssembleSectionStatus) => void;
}

export interface AssembleProjectDocxResult {
  /** The assembled DOCX as a Blob ready to download. */
  blob: Blob;
  /** Per-section status — useful for UI surfacing. */
  section_results: Array<{
    section_id: string;
    section_name: string;
    status: AssembleSectionStatus;
  }>;
  /** Summary for toasts. */
  total_assembled: number;
  total_skipped: number;
  total_failed: number;
}

/**
 * Build a finished DOCX from a template + drafted sections.
 *
 * Strategy:
 *   1. Load the original docx via JSZip.
 *   2. Parse word/document.xml into a DOM.
 *   3. Snapshot the document's flat <w:p> sequence in the SAME
 *      document order the template parser uses (tree order from
 *      getElementsByTagNameNS), so BodyFillRegion anchor indices
 *      match the elements we resolve here.
 *   4. Process sections in REVERSE document order (highest
 *      anchor_paragraph_index first). Reverse order keeps earlier
 *      indices valid as we remove and insert nodes later in the doc.
 *   5. For each section:
 *        - Skip if unsupported region kind.
 *        - Skip if no draft for that section_id.
 *        - Resolve the <w:p> elements in [anchor, end_anchor].
 *        - Verify they share a common parent (they must — heading
 *          ranges are contiguous at the body level).
 *        - Build new <w:p> elements from the drafted content.
 *        - Insert new nodes before the first old node, then remove
 *          the old range.
 *        - Record status.
 *   6. Serialize the DOM back to XML, write into the zip, return Blob.
 */
export async function assembleProjectDocx(
  args: AssembleProjectDocxArgs,
): Promise<AssembleProjectDocxResult> {
  const { template, draftedBySectionId, onSectionAssembled } = args;
  const sections = template.schema_json.sections;

  // No-op passthrough: empty draft map → return the original bytes
  // unchanged. This gives the strongest round-trip guarantee for the
  // "open and re-export with nothing drafted" workflow (e.g. the
  // recipe runner aborted before any section completed).
  const hasAnyDraft = Array.from(draftedBySectionId.values()).some(
    (arr) => arr && arr.length > 0,
  );
  if (!hasAnyDraft) {
    const validateZip = await JSZip.loadAsync(template.docx_bytes);
    if (!validateZip.file('word/document.xml')) {
      throw new Error('Not a valid DOCX: word/document.xml is missing');
    }
    const section_results = sections.map((s) => {
      const status: AssembleSectionStatus =
        s.fill_region.kind === 'heading_bounded'
          ? { kind: 'skipped_no_draft' }
          : {
              kind: 'skipped_unsupported_region',
              reason: `fill_region.kind=${s.fill_region.kind} is not supported in v1`,
            };
      onSectionAssembled?.(s, status);
      return { section_id: s.id, section_name: s.name, status };
    });
    const blob = await toBlob(template.docx_bytes);
    return {
      blob,
      section_results,
      total_assembled: 0,
      total_skipped: section_results.length,
      total_failed: 0,
    };
  }

  const zip = await JSZip.loadAsync(template.docx_bytes);
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

  // Snapshot flat paragraph list in the SAME order the parser used.
  // The parser calls body.getElementsByTagNameNS(W_NS, 'p') which
  // returns descendants in document (tree) order. We mirror that here
  // so BodyFillRegion anchor indices line up with these elements.
  const body = dom.getElementsByTagNameNS(W_NS, 'body')[0];
  if (!body) {
    throw new Error('DOCX has no w:body element');
  }
  const paragraphEls: Element[] = Array.from(body.getElementsByTagNameNS(W_NS, 'p'));

  const availableStyleIds = new Set(
    template.schema_json.formatting.named_styles.map((s) => s.id),
  );

  // Work queue: index in sections[] + computed order key. Reverse
  // by the anchor_paragraph_index so mutating later ranges first
  // keeps earlier indices stable.
  const work = sections.map((section, originalIdx) => {
    const order =
      section.fill_region.kind === 'heading_bounded'
        ? section.fill_region.anchor_paragraph_index
        : -1; // non-heading-bounded regions don't participate in ordering; they're skipped below
    return { section, originalIdx, order };
  });
  // Process highest anchor first. Non-heading-bounded regions get
  // order = -1 which puts them last — but we mark them skipped anyway
  // without mutating the DOM, so ordering among skipped entries is
  // irrelevant.
  work.sort((a, b) => b.order - a.order);

  // Results keyed by the ORIGINAL index order, so the caller sees
  // sections in their natural document order.
  const resultByOriginalIdx = new Array<AssembleSectionStatus | undefined>(sections.length);

  for (const { section, originalIdx } of work) {
    const status = processSection(dom, section, paragraphEls, draftedBySectionId, availableStyleIds);
    resultByOriginalIdx[originalIdx] = status;
    onSectionAssembled?.(section, status);
  }

  // Serialize back to XML and write into the zip. Preserve the XML
  // declaration exactly the same way writer.ts does it.
  const newXml = new XMLSerializer().serializeToString(dom);
  const xmlHeader = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const finalXml = newXml.startsWith('<?xml') ? newXml : xmlHeader + newXml;
  zip.file('word/document.xml', finalXml);

  const isBrowser = typeof window !== 'undefined' && typeof window.Blob !== 'undefined';
  const blob = isBrowser
    ? await zip.generateAsync({ type: 'blob', mimeType: DOCX_MIME })
    : ((await zip.generateAsync({ type: 'uint8array' })) as unknown as Blob);

  const section_results = sections.map((s, i) => ({
    section_id: s.id,
    section_name: s.name,
    status: resultByOriginalIdx[i]!,
  }));

  let total_assembled = 0;
  let total_skipped = 0;
  let total_failed = 0;
  for (const r of section_results) {
    if (r.status.kind === 'assembled') total_assembled += 1;
    else if (r.status.kind === 'failed') total_failed += 1;
    else total_skipped += 1;
  }

  return { blob, section_results, total_assembled, total_skipped, total_failed };
}

// ─── Per-section processor ────────────────────────────────────────

function processSection(
  dom: Document,
  section: BodyFillRegion,
  paragraphEls: Element[],
  draftedBySectionId: Map<string, DraftParagraph[]>,
  availableStyleIds: Set<string>,
): AssembleSectionStatus {
  const fr = section.fill_region;
  if (fr.kind !== 'heading_bounded') {
    return {
      kind: 'skipped_unsupported_region',
      reason: `fill_region.kind=${fr.kind} is not supported in v1`,
    };
  }

  // Whole-body fallback uses anchor_paragraph_index: -1 and spans the
  // entire paragraph list. Replacing the whole body would rip out
  // tables, section properties, and any structural scaffolding — not
  // safe for v1. Mark unsupported.
  if (fr.anchor_paragraph_index < 0) {
    return {
      kind: 'skipped_unsupported_region',
      reason: 'whole_body fallback (anchor_paragraph_index=-1) is not supported in v1',
    };
  }

  const draft = draftedBySectionId.get(section.id);
  if (!draft || draft.length === 0) {
    return { kind: 'skipped_no_draft' };
  }

  try {
    const startIdx = fr.anchor_paragraph_index;
    const endIdx = fr.end_anchor_paragraph_index;
    if (
      startIdx < 0 ||
      endIdx < startIdx ||
      endIdx >= paragraphEls.length
    ) {
      return {
        kind: 'failed',
        error: `section anchor range [${startIdx}..${endIdx}] out of bounds (paragraphs=${paragraphEls.length})`,
      };
    }

    const oldRange: Element[] = [];
    for (let i = startIdx; i <= endIdx; i++) {
      const el = paragraphEls[i];
      if (!el) {
        return {
          kind: 'failed',
          error: `missing <w:p> element at flat index ${i}`,
        };
      }
      oldRange.push(el);
    }

    // All paragraphs in the range must share a common parent; otherwise
    // we'd be trying to splice across table cells / sdtContent blocks,
    // which is unsafe. Heading-bounded ranges at the body level
    // naturally share <w:body> as their parent.
    const parent = oldRange[0]!.parentNode;
    if (!parent) {
      return { kind: 'failed', error: 'first paragraph in range has no parent' };
    }
    for (const el of oldRange) {
      if (el.parentNode !== parent) {
        return {
          kind: 'failed',
          error: 'section range spans multiple parent containers (table cells / sdtContent); unsupported',
        };
      }
    }

    // Build new <w:p> elements from the drafted content.
    const newEls = draft.map((dp) => buildParagraph(dom, dp, availableStyleIds));

    // Insert new nodes before the first old one, then remove the old
    // range. Order matters: insert first so we have stable sibling
    // references while removing.
    const firstOld = oldRange[0]!;
    for (const n of newEls) {
      parent.insertBefore(n, firstOld);
    }
    for (const old of oldRange) {
      parent.removeChild(old);
    }

    return {
      kind: 'assembled',
      paragraphs_replaced: oldRange.length,
      paragraphs_inserted: newEls.length,
    };
  } catch (e) {
    return {
      kind: 'failed',
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

// ─── <w:p> construction ───────────────────────────────────────────

/**
 * Build a fresh <w:p> element from a DraftParagraph. Creates a
 * minimal paragraph with:
 *   - Optional <w:pPr><w:pStyle w:val="..."/></w:pPr> from
 *     roleToStyleId()
 *   - A single <w:r> run containing a <w:t xml:space="preserve"> with
 *     the paragraph text
 *
 * For role === 'table_row' we render the cells as a comma-joined
 * single paragraph. Real table-cell construction is out of scope
 * for v1 — a future enhancement can generate real <w:tbl>/<w:tr>/<w:tc>
 * scaffolds when the template's section body_style_id indicates a
 * table context.
 */
function buildParagraph(
  dom: Document,
  dp: DraftParagraph,
  availableStyleIds: Set<string>,
): Element {
  const p = dom.createElementNS(W_NS, 'w:p');

  const styleId = roleToStyleId(dp.role, availableStyleIds);
  if (styleId) {
    const pPr = dom.createElementNS(W_NS, 'w:pPr');
    const pStyle = dom.createElementNS(W_NS, 'w:pStyle');
    pStyle.setAttributeNS(W_NS, 'w:val', styleId);
    pPr.appendChild(pStyle);
    p.appendChild(pPr);
  }

  // Determine the rendered text. table_row is flattened to
  // "cell1, cell2, cell3" — v1 compromise; see file header.
  let text: string;
  if (dp.role === 'table_row' && Array.isArray(dp.cells) && dp.cells.length > 0) {
    text = dp.cells.join(', ');
  } else {
    text = dp.text ?? '';
  }

  const r = dom.createElementNS(W_NS, 'w:r');
  const t = dom.createElementNS(W_NS, 'w:t');
  // xml:space="preserve" so leading/trailing whitespace is honored.
  // Using setAttribute (not NS) because xml:space is an XML-namespace
  // attribute and the parser accepts the unqualified form for output.
  t.setAttribute('xml:space', 'preserve');
  t.textContent = text;
  r.appendChild(t);
  p.appendChild(r);

  return p;
}

/**
 * Map a DraftParagraph role to a Word paragraph style id. The mapping
 * is heuristic: we look for plausible DHA / Word default style names
 * in `availableStyleIds` (intersecting with what the template
 * actually defines), picking the first match. Returns null if
 * nothing reasonable is available — callers can fall back to the
 * document default style in that case.
 */
export function roleToStyleId(
  role: DraftParagraph['role'],
  availableStyleIds: Set<string>,
): string | null {
  const candidates = ROLE_STYLE_CANDIDATES[role] ?? [];
  for (const c of candidates) {
    if (availableStyleIds.has(c)) return c;
  }
  // Final fallbacks that are near-universal in Word templates.
  for (const fallback of ['BodyText', 'Body Text', 'Normal']) {
    if (availableStyleIds.has(fallback)) return fallback;
  }
  return null;
}

/**
 * Priority-ordered candidate style ids for each drafter role tag.
 * The first id in each list that the template actually defines
 * (present in availableStyleIds) wins. Entries cover the common
 * OOXML style ids, the DHA template-specific style ids we've seen,
 * and the Word default "with spaces" names.
 */
const ROLE_STYLE_CANDIDATES: Record<DraftParagraph['role'], string[]> = {
  heading: ['Heading1', 'Heading 1', 'Heading2', 'Heading 2', 'Title'],
  body: ['BodyText', 'Body Text', 'Normal'],
  step: ['ListNumber', 'List Number', 'ListParagraph', 'List Paragraph'],
  bullet: ['ListBullet', 'List Bullet', 'ListParagraph', 'List Paragraph'],
  // note / caution / warning are semantically body-ish callouts. Map
  // them to BodyText first so the visual weight stays uniform with
  // surrounding prose. Templates that define a dedicated IntenseQuote
  // style can be special-cased in a later pass.
  note: ['BodyText', 'Body Text', 'Normal'],
  caution: ['BodyText', 'Body Text', 'Normal'],
  warning: ['BodyText', 'Body Text', 'Normal'],
  definition: ['BodyText', 'Body Text', 'Normal'],
  table_row: ['BodyText', 'Body Text', 'Normal'],
  quote: ['Quote', 'IntenseQuote', 'Intense Quote', 'BodyText', 'Body Text', 'Normal'],
};

// ─── Blob helper ──────────────────────────────────────────────────

async function toBlob(input: ArrayBuffer | Uint8Array | Blob): Promise<Blob> {
  if (input instanceof Blob) return input;
  if (typeof window !== 'undefined' && typeof window.Blob !== 'undefined') {
    return new Blob([input as BlobPart], { type: DOCX_MIME });
  }
  return input as unknown as Blob;
}

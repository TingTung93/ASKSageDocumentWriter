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
import type { DraftParagraph, DraftRun } from '../draft/types';

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
 *        - Group consecutive same-parent paragraphs into runs. Most
 *          body sections produce one group (parent = <w:body>), but
 *          Army memo header/date/subject blocks live across multiple
 *          <w:tc> cells and content-control sections cross
 *          <w:sdtContent> boundaries — those produce multiple groups.
 *        - Build new <w:p> elements from the drafted content; if
 *          there are multiple groups, distribute the drafts across
 *          them proportionally to each group's old paragraph count
 *          (with a hard floor of 1 paragraph per group so empty
 *          <w:tc> cells don't break Word).
 *        - For each group: insert new nodes before its first old
 *          paragraph, then remove its old paragraphs.
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
      const k = s.fill_region.kind;
      const status: AssembleSectionStatus =
        k === 'heading_bounded' || k === 'document_part'
          ? { kind: 'skipped_no_draft' }
          : {
              kind: 'skipped_unsupported_region',
              reason: `fill_region.kind=${k} is not supported in v1`,
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

  // Pre-pass: scan the whole body for representative bullet and
  // numbered-list paragraphs. Most sections don't contain list items
  // in their source range, so when the drafter emits a `bullet` role
  // we have nothing local to clone the numPr from. Lifting one
  // bullet template from anywhere in the document gives every
  // section access to a real list binding (numId → numbering.xml).
  const formatInventory = collectGlobalFormatInventory(dom);

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
    if (section.fill_region.kind === 'document_part') {
      // Header / footer parts live in their own XML files. We process
      // them in a separate async pass below — leave the slot empty
      // for now so the result order is preserved.
      continue;
    }
    const status = processSection(
      dom,
      section,
      paragraphEls,
      draftedBySectionId,
      availableStyleIds,
      formatInventory,
    );
    resultByOriginalIdx[originalIdx] = status;
    onSectionAssembled?.(section, status);
  }

  // ── document_part pass ──
  // For each header/footer fill region with a draft entry, open the
  // referenced part XML, splice the drafted paragraphs into the
  // <w:hdr>/<w:ftr> root with cloned pPr/rPr from the original first
  // paragraph, and write the file back into the zip. Each part is
  // processed independently — failures in one don't affect others.
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i]!;
    if (section.fill_region.kind !== 'document_part') continue;
    const status = await processDocumentPartSection(
      zip,
      section,
      draftedBySectionId,
      availableStyleIds,
      formatInventory,
    );
    resultByOriginalIdx[i] = status;
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
  inventory: FormatInventory,
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

    // Group oldRange into runs of consecutive paragraphs that share a
    // parentNode. The flat paragraphEls list comes from a tree-order
    // traversal of <w:body>, so a section whose anchor range spans
    // table cells or sdtContent blocks will have paragraphs whose
    // parents alternate between <w:body>, <w:tc>, and <w:sdtContent>.
    // Groups preserve document order — an earlier-in-doc group always
    // appears earlier in the array.
    const groups = groupByParent(oldRange);
    if (groups.length === 0) {
      return { kind: 'failed', error: 'first paragraph in range has no parent' };
    }

    // Single-container fast path. Identical to the legacy single
    // splice — keeps the round-trip tests against the existing
    // body-only fixtures byte-stable.
    if (groups.length === 1) {
      const group = groups[0]!;
      const formatTemplates = collectFormatTemplates(group.paragraphs);
      const newEls = buildSectionElements(
        dom,
        draft,
        availableStyleIds,
        formatTemplates,
        inventory,
      );
      const firstOld = group.paragraphs[0]!;
      for (const n of newEls) {
        group.parent.insertBefore(n, firstOld);
      }
      for (const old of group.paragraphs) {
        group.parent.removeChild(old);
      }
      return {
        kind: 'assembled',
        paragraphs_replaced: group.paragraphs.length,
        paragraphs_inserted: newEls.length,
      };
    }

    // Cross-container splice. Distribute the drafted paragraphs
    // across the groups proportionally to each group's old paragraph
    // count, with a hard floor of 1 paragraph per group — an empty
    // <w:tc> would make Word refuse to open the file.
    const slices = distributeDraftAcrossGroups(draft, groups);
    let totalReplaced = 0;
    let totalInserted = 0;
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i]!;
      const slice = slices[i]!;
      const formatTemplates = collectFormatTemplates(group.paragraphs);
      const newEls = buildSectionElements(
        dom,
        slice,
        availableStyleIds,
        formatTemplates,
        inventory,
      );
      const firstOld = group.paragraphs[0]!;
      for (const n of newEls) {
        group.parent.insertBefore(n, firstOld);
      }
      for (const old of group.paragraphs) {
        group.parent.removeChild(old);
      }
      totalReplaced += group.paragraphs.length;
      totalInserted += newEls.length;
    }

    return {
      kind: 'assembled',
      paragraphs_replaced: totalReplaced,
      paragraphs_inserted: totalInserted,
    };
  } catch (e) {
    return {
      kind: 'failed',
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

// ─── document_part processor ──────────────────────────────────────
//
// Header and footer XML parts are self-contained documents rooted at
// <w:hdr> or <w:ftr>. We mutate them in place: load → parse → replace
// all <w:p> children of the root with new ones built from the draft,
// preserving the first original paragraph's pPr/rPr so the letterhead
// keeps its centering, font, and tabs. Non-paragraph children
// (<w:tbl>, <w:sdt>, drawings) are left alone — only the loose
// paragraph stream is replaced.

async function processDocumentPartSection(
  zip: JSZip,
  section: BodyFillRegion,
  draftedBySectionId: Map<string, DraftParagraph[]>,
  availableStyleIds: Set<string>,
  inventory: FormatInventory,
): Promise<AssembleSectionStatus> {
  const fr = section.fill_region;
  if (fr.kind !== 'document_part') {
    return {
      kind: 'failed',
      error: `processDocumentPartSection called with non-document_part region (${fr.kind})`,
    };
  }

  const draft = draftedBySectionId.get(section.id);
  if (!draft || draft.length === 0) {
    return { kind: 'skipped_no_draft' };
  }

  const file = zip.file(fr.part_path);
  if (!file) {
    return {
      kind: 'failed',
      error: `referenced part not found in zip: ${fr.part_path}`,
    };
  }

  try {
    const partXml = await file.async('string');
    const partDom = new DOMParser().parseFromString(partXml, 'text/xml');
    const errs = partDom.getElementsByTagName('parsererror');
    if (errs.length > 0) {
      return {
        kind: 'failed',
        error: `XML parse error in ${fr.part_path}: ${errs[0]!.textContent ?? 'unknown'}`,
      };
    }

    // Header parts are rooted at <w:hdr>, footer at <w:ftr>.
    const rootName = fr.placement === 'header' ? 'hdr' : 'ftr';
    const root = partDom.getElementsByTagNameNS(W_NS, rootName)[0];
    if (!root) {
      return {
        kind: 'failed',
        error: `${fr.part_path} has no <w:${rootName}> root element`,
      };
    }

    // Capture format templates from the existing top-level paragraphs
    // before we remove them. We only consider DIRECT children of the
    // root — paragraphs nested inside tables / sdt have their own
    // formatting and shouldn't be touched.
    const oldParagraphs: Element[] = [];
    for (let n = root.firstChild; n; n = n.nextSibling) {
      if (
        n.nodeType === 1 &&
        (n as Element).localName === 'p' &&
        (n as Element).namespaceURI === W_NS
      ) {
        oldParagraphs.push(n as Element);
      }
    }

    if (oldParagraphs.length === 0) {
      // Empty header/footer (or contains only tables). Append the
      // drafted paragraphs as fresh ones with no template formatting.
      const emptyTemplates: FormatTemplates = {
        heading: { pPr: null, rPr: null },
        body: { pPr: null, rPr: null },
      };
      // Header/footer parts use a SEPARATE DOM (partDom) from the
      // main body. The body-side inventory's elements belong to the
      // wrong owner Document, so cloneNode() across documents would
      // fail. Re-collect a tiny inventory from the part itself; it's
      // rare for a header/footer to contain its own bullet anyway,
      // so this usually returns an empty map and bullet drafts in
      // headers fall through to body styling — acceptable for v1.
      const partInventory = collectGlobalFormatInventory(partDom);
      void inventory; // body-side inventory intentionally unused here
      const newEls = buildSectionElements(
        partDom,
        draft,
        availableStyleIds,
        emptyTemplates,
        partInventory,
      );
      for (const el of newEls) {
        root.appendChild(el);
      }
    } else {
      const formatTemplates = collectFormatTemplates(oldParagraphs);
      const partInventory = collectGlobalFormatInventory(partDom);
      void inventory;
      const newEls = buildSectionElements(
        partDom,
        draft,
        availableStyleIds,
        formatTemplates,
        partInventory,
      );
      // Insert the new paragraphs immediately before the first old
      // one, then remove the old paragraphs. Anything that wasn't a
      // direct <w:p> child (tables, sdt, drawing anchors) is left in
      // place, preserving the structural scaffolding of the part.
      const firstOld = oldParagraphs[0]!;
      for (const n of newEls) {
        root.insertBefore(n, firstOld);
      }
      for (const old of oldParagraphs) {
        root.removeChild(old);
      }
    }

    const newXml = new XMLSerializer().serializeToString(partDom);
    const xmlHeader = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
    const finalXml = newXml.startsWith('<?xml') ? newXml : xmlHeader + newXml;
    zip.file(fr.part_path, finalXml);

    return {
      kind: 'assembled',
      paragraphs_replaced: oldParagraphs.length,
      paragraphs_inserted: draft.length,
    };
  } catch (e) {
    return {
      kind: 'failed',
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

// ─── <w:p> construction ───────────────────────────────────────────

// ─── Cross-container splice helpers ───────────────────────────────
//
// A heading-bounded section's anchor range comes out of the parser as
// a flat [startIdx..endIdx] window over the body's tree-order
// paragraph list. When the template puts content inside table cells
// (Army memo header blocks), bookmark-wrapped sdtContent (DHA policy
// content controls), or footnote bodies, the paragraphs in that
// window have DIFFERENT parentNode values even though they're in
// document order. The legacy single-splice path bailed with
// "section range spans multiple parent containers" — which made
// every Army memo lose its Header Block, Date/Reference, Subject Line,
// and any SDT-wrapped numbered paragraphs.
//
// The fix is per-container splice: group consecutive same-parent
// paragraphs into runs ("groups"), distribute the drafted paragraphs
// across the groups proportionally to each group's old paragraph
// count, and splice each group independently. Every group must end
// up with at least one paragraph — Word refuses to open a DOCX whose
// <w:tc> contains zero <w:p> elements.

interface ContainerGroup {
  parent: Node;
  paragraphs: Element[];
}

/**
 * Split `oldRange` into runs of consecutive paragraphs whose
 * parentNode is identical (object equality on the DOM Node, not
 * structural). Order is preserved. Returns [] when oldRange is empty
 * or its first element has no parent.
 */
function groupByParent(oldRange: Element[]): ContainerGroup[] {
  if (oldRange.length === 0) return [];
  const firstParent = oldRange[0]!.parentNode;
  if (!firstParent) return [];
  const groups: ContainerGroup[] = [{ parent: firstParent, paragraphs: [oldRange[0]!] }];
  for (let i = 1; i < oldRange.length; i++) {
    const el = oldRange[i]!;
    const parent = el.parentNode;
    if (!parent) {
      // Detached element shouldn't happen because we just walked them
      // out of paragraphEls. If it does, swallow it rather than
      // crashing — the section will end up missing one paragraph.
      continue;
    }
    const last = groups[groups.length - 1]!;
    if (parent === last.parent) {
      last.paragraphs.push(el);
    } else {
      groups.push({ parent, paragraphs: [el] });
    }
  }
  return groups;
}

/**
 * Allocate the drafted paragraphs across the container groups.
 *
 * Strategy: each group's share is proportional to the original
 * paragraph count (so a header block table whose Header section
 * occupied 4 cells with 1 paragraph each gets ~25% of the new draft
 * per cell). Three constraints:
 *
 *   1. Every group MUST receive at least one paragraph — an empty
 *      <w:tc> breaks Word.
 *   2. Total of all slices MUST equal draft.length so every drafted
 *      paragraph lands somewhere.
 *   3. Order is preserved: slice 0 contains the first N paragraphs of
 *      the draft, slice 1 the next M, etc. Drafters write their output
 *      in document order, so this matches the user's mental model.
 *
 * Edge case: when draft.length < groups.length we can't give every
 * group a unique paragraph. We synthesize blank-body placeholder
 * paragraphs to pad short groups so the at-least-1 invariant holds
 * AND no draft content is dropped. The placeholders inherit the
 * group's own format template at splice time, so they look like
 * empty cells in the source — which is the correct degraded
 * appearance.
 */
function distributeDraftAcrossGroups(
  draft: DraftParagraph[],
  groups: ContainerGroup[],
): DraftParagraph[][] {
  const slices: DraftParagraph[][] = groups.map(() => []);
  if (groups.length === 0) return slices;

  // Short-draft case: every group needs at least one paragraph but
  // there aren't enough drafts to go around. Hand out one draft per
  // group from the front; pad the remaining groups with blank
  // placeholders. The last group with real content also absorbs
  // any leftover drafts (so a 5-draft / 3-group split puts
  // [1, 1, 3] in the slices).
  if (draft.length <= groups.length) {
    for (let i = 0; i < groups.length; i++) {
      if (i < draft.length) {
        slices[i] = [draft[i]!];
      } else {
        slices[i] = [{ role: 'body', text: '' }];
      }
    }
    return slices;
  }

  // Normal case: draft.length >= groups.length. Allocate
  // proportionally to old paragraph count, then fix up so each
  // group has at least 1 and the sum equals draft.length.
  const totalOld = groups.reduce((s, g) => s + g.paragraphs.length, 0);
  const counts = new Array<number>(groups.length).fill(0);
  let assigned = 0;
  for (let i = 0; i < groups.length - 1; i++) {
    const share = Math.max(
      1,
      Math.round((draft.length * groups[i]!.paragraphs.length) / totalOld),
    );
    counts[i] = share;
    assigned += share;
  }
  // Last group absorbs the remainder. Floor at 1.
  counts[counts.length - 1] = Math.max(1, draft.length - assigned);
  assigned = counts.reduce((s, n) => s + n, 0);

  // If rounding pushed us OVER draft.length, peel from the end of
  // each group (skipping group 0) until we're back at draft.length.
  while (assigned > draft.length) {
    let trimmed = false;
    for (let i = counts.length - 1; i >= 0 && assigned > draft.length; i--) {
      if (counts[i]! > 1) {
        counts[i] -= 1;
        assigned -= 1;
        trimmed = true;
      }
    }
    if (!trimmed) break; // every group is at the floor; can't shrink
  }
  // If we're still over (because every group hit the floor), pad
  // the draft with blank trailers and let the loop below pick them
  // up. This branch only fires when groups.length > draft.length,
  // which the short-draft path above already handles — defensive only.

  // Slice the draft in order using counts[]. If we run out, pad
  // with blank placeholders (defensive — shouldn't happen now).
  let cursor = 0;
  for (let i = 0; i < groups.length; i++) {
    const want = counts[i]!;
    const slice: DraftParagraph[] = [];
    for (let j = 0; j < want; j++) {
      if (cursor < draft.length) {
        slice.push(draft[cursor]!);
        cursor += 1;
      } else {
        slice.push({ role: 'body', text: '' });
      }
    }
    slices[i] = slice;
  }
  return slices;
}

/**
 * Snapshot of formatting we lifted from the old paragraph range. Each
 * field is an Element belonging to the SAME owner Document as the one
 * we're mutating, so cloneNode() is safe and the clones can be
 * inserted directly without import.
 *
 * `heading` is the pPr/rPr from the first paragraph in the range
 * (typically the section heading anchor). `body` is from the last
 * non-heading paragraph; falls back to heading if the range has only
 * one paragraph or if no body paragraph carried a pPr.
 */
interface FormatTemplate {
  pPr: Element | null;
  /** rPr lifted from the FIRST <w:r> of the source paragraph. */
  rPr: Element | null;
}

interface FormatTemplates {
  heading: FormatTemplate;
  body: FormatTemplate;
}

/**
 * Document-wide inventory of representative paragraph templates by
 * role pattern. Built once per assembly run by walking every <w:p>
 * in the body's DOM and classifying by pStyle / numPr presence.
 *
 * The KEY use is supplying bullet/step templates to sections whose
 * own source range contains no list-styled paragraphs — most body
 * sections in a typical Army memo are pure prose, but the drafter
 * still emits `bullet` roles when listing items, and without a real
 * <w:numPr> binding the drafted "bullets" render as plain prose with
 * inherited indent. Lifting one bullet pPr from anywhere in the
 * document gives every section access to a working list binding
 * (numId → numbering.xml definition).
 *
 * The Map's elements are owned by the same Document the inventory
 * was built from; cloning is only safe when buildParagraph is also
 * mutating that same Document. The header/footer path re-collects
 * its own per-part inventory.
 */
interface FormatInventory {
  byRole: Map<DraftParagraph['role'], FormatTemplate>;
}

/**
 * Walk every <w:p> in the document and pick the FIRST representative
 * paragraph for each role pattern we recognize. Classification is
 * driven by the paragraph's pStyle id and the presence of <w:numPr>:
 *
 *   - bullet : pStyle matches /ListBullet/, OR pStyle is ListParagraph
 *              with a numPr present (the OOXML "list paragraph"
 *              convention used when the bullet binding lives entirely
 *              in numPr rather than the style)
 *   - step   : pStyle matches /ListNumber/
 *   - heading: pStyle matches /^Heading/
 *   - body   : everything else (we don't actively use this since the
 *              local section template covers body)
 *
 * The numbering classification is intentionally conservative: we
 * don't crack open numbering.xml to inspect numFmt values. The
 * pStyle name is the strongest signal templates actually use.
 */
function collectGlobalFormatInventory(dom: Document): FormatInventory {
  const inventory: FormatInventory = { byRole: new Map() };
  const paragraphs = Array.from(dom.getElementsByTagNameNS(W_NS, 'p'));
  for (const p of paragraphs) {
    const pPr = firstChildNS(p, 'pPr');
    if (!pPr) continue;
    const pStyleEl = firstChildNS(pPr, 'pStyle');
    const styleId = pStyleEl?.getAttributeNS(W_NS, 'val') ?? '';
    const hasNumPr = !!firstChildNS(pPr, 'numPr');

    let role: DraftParagraph['role'] | null = null;
    if (/list\s*bullet/i.test(styleId)) {
      role = 'bullet';
    } else if (/list\s*number/i.test(styleId)) {
      role = 'step';
    } else if (/^list\s*paragraph$/i.test(styleId) && hasNumPr) {
      // ListParagraph is the generic "I'm in a list" style; assume
      // bullet unless a same-doc numbered occurrence comes along
      // first (we keep the first match per role).
      role = 'bullet';
    } else if (/^heading/i.test(styleId)) {
      role = 'heading';
    } else {
      role = 'body';
    }

    if (!inventory.byRole.has(role)) {
      inventory.byRole.set(role, extractFormatTemplate(p));
    }
  }
  return inventory;
}

function collectFormatTemplates(oldRange: Element[]): FormatTemplates {
  const empty: FormatTemplate = { pPr: null, rPr: null };
  if (oldRange.length === 0) {
    return { heading: empty, body: empty };
  }
  const headingTpl = extractFormatTemplate(oldRange[0]!);
  // Walk from the back so we land on a body-shaped paragraph rather
  // than a trailing blank. We accept the first one that actually has
  // a pPr — paragraphs with no pPr at all carry no information.
  let bodyTpl: FormatTemplate = headingTpl;
  for (let i = oldRange.length - 1; i >= 1; i--) {
    const candidate = extractFormatTemplate(oldRange[i]!);
    if (candidate.pPr || candidate.rPr) {
      bodyTpl = candidate;
      break;
    }
  }
  return { heading: headingTpl, body: bodyTpl };
}

function extractFormatTemplate(p: Element): FormatTemplate {
  const pPr = firstChildNS(p, 'pPr');
  // Locate the first <w:r>'s <w:rPr>. Skip <w:r>s that wrap only
  // formatting markers (e.g. footnoteReference) — we want a typical
  // text run if available.
  let rPr: Element | null = null;
  const runs = p.getElementsByTagNameNS(W_NS, 'r');
  for (let i = 0; i < runs.length; i++) {
    const candidate = firstChildNS(runs[i]!, 'rPr');
    if (candidate) {
      rPr = candidate;
      break;
    }
  }
  return { pPr, rPr };
}

function firstChildNS(parent: Element, localName: string): Element | null {
  for (let n = parent.firstChild; n; n = n.nextSibling) {
    if (
      n.nodeType === 1 /* ELEMENT_NODE */ &&
      (n as Element).localName === localName &&
      (n as Element).namespaceURI === W_NS
    ) {
      return n as Element;
    }
  }
  return null;
}

/**
 * Pick the closer-shaped format template for a drafted paragraph.
 *
 * Selection order:
 *   1. bullet/step roles → global inventory's bullet/step template
 *      when present. The local section's range almost never contains
 *      list-styled paragraphs, so this is the ONLY way drafted
 *      bullets get a real <w:numPr> binding.
 *   2. heading role → local heading-anchor template (the first
 *      paragraph in the section's range).
 *   3. anything else → local body template (last paragraph in range
 *      with a pPr).
 *
 * table_row keeps body too — real table cell construction is still
 * out of scope for v1.
 */
function selectFormatTemplate(
  role: DraftParagraph['role'],
  templates: FormatTemplates,
  inventory: FormatInventory,
): FormatTemplate {
  if (role === 'bullet' || role === 'step') {
    const fromInventory = inventory.byRole.get(role);
    if (fromInventory && (fromInventory.pPr || fromInventory.rPr)) {
      return fromInventory;
    }
  }
  if (role === 'heading') return templates.heading;
  return templates.body;
}

/**
 * Build the full element list to splice into a section, walking the
 * draft once and collapsing every run of consecutive table_row
 * paragraphs into a single real <w:tbl>. Non-row paragraphs go through
 * `buildParagraph` unchanged.
 *
 * Returns a mixed Element[] of <w:p> and <w:tbl> nodes — both are
 * legal direct children of <w:body> and <w:tc>, so the splice path
 * doesn't need to know which is which.
 */
function buildSectionElements(
  dom: Document,
  draft: DraftParagraph[],
  availableStyleIds: Set<string>,
  templates: FormatTemplates,
  inventory: FormatInventory,
): Element[] {
  const out: Element[] = [];
  let i = 0;
  while (i < draft.length) {
    const dp = draft[i]!;
    if (dp.role === 'table_row') {
      // Collect the maximal run of consecutive table_row paragraphs
      // and build them as one <w:tbl>.
      const rows: DraftParagraph[] = [];
      while (i < draft.length && draft[i]!.role === 'table_row') {
        rows.push(draft[i]!);
        i += 1;
      }
      out.push(buildTable(dom, rows, templates));
      continue;
    }
    out.push(buildParagraph(dom, dp, availableStyleIds, templates, inventory));
    i += 1;
  }
  // Word refuses a <w:tbl> as the LAST element of a <w:tc> without a
  // trailing <w:p>. Append a tiny empty paragraph if we end on a table.
  if (out.length > 0 && out[out.length - 1]!.localName === 'tbl') {
    out.push(emptyParagraph(dom));
  }
  return out;
}

function emptyParagraph(dom: Document): Element {
  const p = dom.createElementNS(W_NS, 'w:p');
  return p;
}

// ─── <w:tbl> construction ─────────────────────────────────────────
//
// Real Word tables. Built from a contiguous run of `table_row`
// DraftParagraphs. Column count is the max cells.length across rows;
// short rows get padded with empty cells, long rows extend the grid.
// Borders use a basic single-line all-around style; cell widths are
// computed by splitting a fixed 9000-twip page width (≈6.25" — fits
// inside the standard 1" margins of an 8.5"-wide page) evenly across
// columns. Header rows (is_header=true) get bold rPr applied to all
// cells and a <w:tblHeader/> trPr so the row repeats across pages.

const PAGE_WIDTH_TWIPS = 9000;

function buildTable(
  dom: Document,
  rows: DraftParagraph[],
  templates: FormatTemplates,
): Element {
  // Column count = max cells across rows. Floor at 1 so we never
  // produce an empty grid.
  let cols = 1;
  for (const r of rows) {
    if (Array.isArray(r.cells) && r.cells.length > cols) {
      cols = r.cells.length;
    }
  }
  const colWidth = Math.floor(PAGE_WIDTH_TWIPS / cols);

  const tbl = dom.createElementNS(W_NS, 'w:tbl');

  // ── tblPr ──
  const tblPr = dom.createElementNS(W_NS, 'w:tblPr');
  const tblW = dom.createElementNS(W_NS, 'w:tblW');
  tblW.setAttributeNS(W_NS, 'w:w', String(PAGE_WIDTH_TWIPS));
  tblW.setAttributeNS(W_NS, 'w:type', 'dxa');
  tblPr.appendChild(tblW);

  const tblBorders = dom.createElementNS(W_NS, 'w:tblBorders');
  for (const side of ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']) {
    const b = dom.createElementNS(W_NS, `w:${side}`);
    b.setAttributeNS(W_NS, 'w:val', 'single');
    b.setAttributeNS(W_NS, 'w:sz', '4');
    b.setAttributeNS(W_NS, 'w:space', '0');
    b.setAttributeNS(W_NS, 'w:color', 'auto');
    tblBorders.appendChild(b);
  }
  tblPr.appendChild(tblBorders);

  const tblLayout = dom.createElementNS(W_NS, 'w:tblLayout');
  tblLayout.setAttributeNS(W_NS, 'w:type', 'fixed');
  tblPr.appendChild(tblLayout);

  tbl.appendChild(tblPr);

  // ── tblGrid ──
  const tblGrid = dom.createElementNS(W_NS, 'w:tblGrid');
  for (let c = 0; c < cols; c++) {
    const gridCol = dom.createElementNS(W_NS, 'w:gridCol');
    gridCol.setAttributeNS(W_NS, 'w:w', String(colWidth));
    tblGrid.appendChild(gridCol);
  }
  tbl.appendChild(tblGrid);

  // ── rows ──
  for (const row of rows) {
    tbl.appendChild(buildTableRow(dom, row, cols, colWidth, templates));
  }

  return tbl;
}

function buildTableRow(
  dom: Document,
  row: DraftParagraph,
  cols: number,
  colWidth: number,
  templates: FormatTemplates,
): Element {
  const tr = dom.createElementNS(W_NS, 'w:tr');

  // Header rows: <w:trPr><w:tblHeader/></w:trPr> so Word repeats the
  // row across page breaks. Cells in header rows also get bold runs.
  const isHeader = row.is_header === true;
  if (isHeader) {
    const trPr = dom.createElementNS(W_NS, 'w:trPr');
    trPr.appendChild(dom.createElementNS(W_NS, 'w:tblHeader'));
    tr.appendChild(trPr);
  }

  const cells = Array.isArray(row.cells) ? row.cells : [];
  for (let c = 0; c < cols; c++) {
    const text = c < cells.length ? cells[c]! : '';
    tr.appendChild(buildTableCell(dom, text, colWidth, templates, isHeader));
  }
  return tr;
}

function buildTableCell(
  dom: Document,
  text: string,
  colWidth: number,
  templates: FormatTemplates,
  bold: boolean,
): Element {
  const tc = dom.createElementNS(W_NS, 'w:tc');

  // tcPr: width
  const tcPr = dom.createElementNS(W_NS, 'w:tcPr');
  const tcW = dom.createElementNS(W_NS, 'w:tcW');
  tcW.setAttributeNS(W_NS, 'w:w', String(colWidth));
  tcW.setAttributeNS(W_NS, 'w:type', 'dxa');
  tcPr.appendChild(tcW);
  tc.appendChild(tcPr);

  // <w:tc> requires at least one <w:p>. Build a body-styled paragraph
  // carrying the cell text. Header rows force-apply bold via runs[].
  const cellDp: DraftParagraph = bold
    ? { role: 'body', text: '', runs: [{ text, bold: true }] }
    : { role: 'body', text };
  const p = buildParagraph(
    dom,
    cellDp,
    /* availableStyleIds */ new Set<string>(),
    templates,
    { byRole: new Map() },
  );
  tc.appendChild(p);
  return tc;
}

/**
 * Build a fresh <w:p> element from a DraftParagraph. The paragraph
 * inherits pPr/rPr from a representative paragraph in the section it's
 * replacing — that's how tab stops, indents, alignment, line spacing,
 * and run formatting (font/size/bold) survive the round trip.
 *
 * Order of operations on the cloned pPr:
 *   1. Deep-clone the source pPr (or create a fresh empty one if the
 *      source had none).
 *   2. Strip <w:numPr> unless the new role is bullet/step. Otherwise
 *      a body paragraph would inherit the source's bullet numbering
 *      and become an unintended list item. Strip <w:ind> too IF the
 *      source pPr had a numPr (the ind was list geometry).
 *   3. Replace any existing <w:pStyle> with the role-mapped style id.
 *      For headings, the level field picks Heading{level+1}; for
 *      other roles the level doesn't change the pStyle.
 *   4. Apply the level field:
 *        - bullet/step → set <w:ilvl> on numPr to nest the list item
 *        - body and similar → set <w:ind w:left="720*level"/> when
 *          level > 0, giving the drafter explicit indent control
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
  templates: FormatTemplates,
  inventory: FormatInventory,
): Element {
  const p = dom.createElementNS(W_NS, 'w:p');

  const tpl = selectFormatTemplate(dp.role, templates, inventory);

  // ── pPr ──
  const pPr = tpl.pPr
    ? (tpl.pPr.cloneNode(true) as Element)
    : dom.createElementNS(W_NS, 'w:pPr');

  // Drop list numbering when the new role isn't list-shaped.
  // Otherwise body paragraphs inserted into a section that ended
  // with a bullet list would silently become list items themselves.
  //
  // Also drop the explicit <w:ind> override BUT only when the
  // source pPr had a numPr to begin with — i.e., the ind was
  // list-item geometry (a hanging indent that positions the bullet
  // glyph), not a deliberate body-indent override. Stripping it
  // unconditionally would also clobber legitimate body indents
  // (e.g., the Publication template's body-text style with an
  // explicit left=720 first-line indent).
  if (dp.role !== 'bullet' && dp.role !== 'step') {
    const sourceHadNumPr = !!firstChildNS(pPr, 'numPr');
    removeChildrenByLocalName(pPr, 'numPr');
    if (sourceHadNumPr) {
      removeChildrenByLocalName(pPr, 'ind');
    }
  }

  // Resolve the level (0..8). Drafters that don't care omit the
  // field; deserialized JSON may also pass null/string. Clamp out
  // anything weird so a runaway value can't produce invalid OOXML.
  const level = clampLevel(dp.level);

  // Apply role-mapped pStyle on top of whatever the cloned pPr had.
  // For headings, level picks Heading{N+1}; for other roles the
  // level doesn't change the pStyle (it changes ind/ilvl below).
  const styleId =
    dp.role === 'heading'
      ? headingStyleIdForLevel(level, availableStyleIds)
      : roleToStyleId(dp.role, availableStyleIds);
  if (styleId) {
    setOrReplacePStyle(dom, pPr, styleId);
  }

  // Apply level for list-shaped roles: ensure <w:numPr> exists and
  // its <w:ilvl> matches the requested depth. The numPr binding
  // (numId) came from the global inventory's bullet/step template;
  // we just override the level so a sub-bullet renders correctly.
  if (dp.role === 'bullet' || dp.role === 'step') {
    setNumPrLevel(dom, pPr, level);
  }
  // Apply level for body-shaped roles: replace any existing <w:ind>
  // with a level-driven left indent (0.5" per level). level 0 leaves
  // the cloned ind alone (it carried whatever the source body
  // paragraph had). level 1+ overrides it because the drafter is
  // explicitly asking for an inset/quoted style.
  else if (level > 0 && isBodyShapedRole(dp.role)) {
    setLeftIndent(dom, pPr, level * INDENT_STEP_TWIPS);
  }

  // Bullet/step fallback: if the source pPr has no real numPr binding
  // (or carries the numId=0 sentinel meaning "no list"), the paragraph
  // would render as ordinary prose with no bullet glyph and no
  // indent. Apply a manual left indent and prepend a Unicode bullet
  // glyph so the visual hierarchy survives even on templates whose
  // numbering definitions we can't lift. Indent grows by 0.25" per
  // level (360 twips) on top of a base 360-twip indent.
  let manualBulletPrefix: string | null = null;
  if (dp.role === 'bullet' || dp.role === 'step') {
    if (!hasUsableNumPr(pPr)) {
      const baseTwips = 360 + level * 360;
      setLeftIndent(dom, pPr, baseTwips);
      removeChildrenByLocalName(pPr, 'numPr');
      manualBulletPrefix =
        dp.role === 'bullet' ? `${BULLET_GLYPHS[level % BULLET_GLYPHS.length]}\u00a0` : `\u00a0\u00a0`;
    }
  }

  // page_break_before — hard "start this paragraph on a new page"
  // toggle. OOXML <w:pageBreakBefore/> sits inside pPr; Word respects
  // it whether or not the paragraph carries other formatting.
  if (dp.page_break_before === true) {
    removeChildrenByLocalName(pPr, 'pageBreakBefore');
    pPr.appendChild(dom.createElementNS(W_NS, 'w:pageBreakBefore'));
  }

  // Only attach pPr if it has any children — an empty pPr is legal
  // but pollutes the diff. Skipping when empty also matches the
  // original codepath's behavior when no style was available.
  if (pPr.firstChild) {
    p.appendChild(pPr);
  }

  // ── Run(s) + text ──
  // Three input shapes for paragraph content:
  //   1. dp.runs[] non-empty → rich-text path. One <w:r> per run with
  //      the source rPr augmented by per-run bold/italic/underline.
  //   2. dp.role === 'table_row' AND dp.cells[] → degraded fallback for
  //      a stray table_row that wasn't grouped into a real <w:tbl>.
  //      The grouping happens in buildSectionElements; this branch only
  //      fires when buildParagraph is called directly on a row that
  //      somehow escaped grouping (defensive).
  //   3. plain dp.text path (the most common case).
  if (Array.isArray(dp.runs) && dp.runs.length > 0) {
    appendRichRuns(dom, p, dp.runs, tpl.rPr, manualBulletPrefix);
  } else {
    let text: string;
    if (dp.role === 'table_row' && Array.isArray(dp.cells) && dp.cells.length > 0) {
      text = dp.cells.join(', ');
    } else {
      text = dp.text ?? '';
    }
    if (manualBulletPrefix) {
      text = manualBulletPrefix + text;
    }
    appendPlainTextRun(dom, p, text, tpl.rPr);
  }

  return p;
}

/**
 * Bullet glyphs for the manual-fallback indent path. Indexed by level
 * so nested levels visually differ. Mirrors Word's default
 * ListBullet/ListBullet2/ListBullet3 glyphs.
 */
const BULLET_GLYPHS = ['\u2022', '\u25E6', '\u25AA', '\u2022', '\u25E6', '\u25AA'] as const;

/**
 * True when the pPr already has a <w:numPr> with a numId other than
 * "0". numId=0 is OOXML's "no list" sentinel — a paragraph carrying
 * it renders as plain prose, so we still need the manual bullet
 * fallback.
 */
function hasUsableNumPr(pPr: Element): boolean {
  const numPr = firstChildNS(pPr, 'numPr');
  if (!numPr) return false;
  const numId = firstChildNS(numPr, 'numId');
  if (!numId) return false;
  const val = numId.getAttributeNS(W_NS, 'val') ?? numId.getAttribute('w:val');
  return val !== null && val !== '0';
}

/**
 * Append a single <w:r> with cloned rPr and the given text. Used for
 * the plain-text path and as a building block for richer flows.
 */
function appendPlainTextRun(
  dom: Document,
  p: Element,
  text: string,
  baseRPr: Element | null,
): void {
  const r = dom.createElementNS(W_NS, 'w:r');
  if (baseRPr) {
    r.appendChild(baseRPr.cloneNode(true) as Element);
  }
  const t = dom.createElementNS(W_NS, 'w:t');
  t.setAttribute('xml:space', 'preserve');
  t.textContent = text;
  r.appendChild(t);
  p.appendChild(r);
}

/**
 * Build one <w:r> per DraftRun and append them to `p`. Each run
 * starts from a deep clone of `baseRPr` (so font/size/color carry
 * through) and then layers the run's own bold/italic/underline/strike
 * toggles on top — explicit `false` clears the inherited toggle,
 * `undefined` leaves it alone.
 *
 * The first run absorbs `manualBulletPrefix` if supplied so the
 * bullet glyph rides at the front of the paragraph's text content
 * exactly like the plain-text path would emit it.
 */
function appendRichRuns(
  dom: Document,
  p: Element,
  runs: DraftRun[],
  baseRPr: Element | null,
  manualBulletPrefix: string | null,
): void {
  let prefix = manualBulletPrefix ?? '';
  for (const run of runs) {
    const text = (run.text ?? '');
    if (!text && !prefix) continue;
    const r = dom.createElementNS(W_NS, 'w:r');

    // Clone base rPr first so we layer toggles on top of font/size/color.
    const rPr = baseRPr
      ? (baseRPr.cloneNode(true) as Element)
      : dom.createElementNS(W_NS, 'w:rPr');
    applyRunToggle(dom, rPr, 'b', run.bold);
    applyRunToggle(dom, rPr, 'i', run.italic);
    applyRunToggle(dom, rPr, 'u', run.underline, 'single');
    applyRunToggle(dom, rPr, 'strike', run.strike);
    if (rPr.firstChild) {
      r.appendChild(rPr);
    }

    const t = dom.createElementNS(W_NS, 'w:t');
    t.setAttribute('xml:space', 'preserve');
    t.textContent = prefix + text;
    r.appendChild(t);
    p.appendChild(r);
    prefix = '';
  }
  // If every run was empty, still emit the prefix as a stand-alone run
  // so the bullet glyph isn't dropped.
  if (prefix) {
    appendPlainTextRun(dom, p, prefix, baseRPr);
  }
}

/**
 * Apply a boolean run toggle to an rPr element. Behavior matches
 * OOXML semantics:
 *
 *   - toggle === true  → ensure <w:{tag}/> exists (with optional w:val
 *     attribute, e.g. w:val="single" for underline)
 *   - toggle === false → ensure <w:{tag} w:val="false"/> exists,
 *     overriding any inherited setting
 *   - toggle undefined → leave whatever the cloned rPr already had
 *
 * For the underline tag the optional `valWhenTrue` argument supplies
 * the underline style ("single", "double", etc.). Other tags ignore it.
 */
function applyRunToggle(
  dom: Document,
  rPr: Element,
  tag: 'b' | 'i' | 'u' | 'strike',
  toggle: boolean | undefined,
  valWhenTrue?: string,
): void {
  if (toggle === undefined) return;
  removeChildrenByLocalName(rPr, tag);
  const el = dom.createElementNS(W_NS, `w:${tag}`);
  if (toggle === false) {
    el.setAttributeNS(W_NS, 'w:val', 'false');
  } else if (valWhenTrue) {
    el.setAttributeNS(W_NS, 'w:val', valWhenTrue);
  }
  rPr.appendChild(el);
}

function removeChildrenByLocalName(parent: Element, localName: string): void {
  const toRemove: Element[] = [];
  for (let n = parent.firstChild; n; n = n.nextSibling) {
    if (
      n.nodeType === 1 &&
      (n as Element).localName === localName &&
      (n as Element).namespaceURI === W_NS
    ) {
      toRemove.push(n as Element);
    }
  }
  for (const el of toRemove) parent.removeChild(el);
}

/**
 * Ensure pPr has exactly one <w:pStyle> child pointing at `styleId`.
 * Per OOXML, <w:pStyle> must be the FIRST child of <w:pPr> if present,
 * so we remove any existing pStyle and prepend a fresh one.
 */
function setOrReplacePStyle(dom: Document, pPr: Element, styleId: string): void {
  removeChildrenByLocalName(pPr, 'pStyle');
  const pStyle = dom.createElementNS(W_NS, 'w:pStyle');
  pStyle.setAttributeNS(W_NS, 'w:val', styleId);
  if (pPr.firstChild) {
    pPr.insertBefore(pStyle, pPr.firstChild);
  } else {
    pPr.appendChild(pStyle);
  }
}

// ─── Level helpers ────────────────────────────────────────────────
//
// The drafter can attach an optional `level` field to each
// paragraph. Its meaning depends on the role:
//   - bullet/step: OOXML list nesting (`<w:ilvl>` inside `<w:numPr>`)
//   - body and similar non-list roles: left-indent in 0.5"-per-level
//     steps (`<w:ind w:left="720*N"/>`)
//   - heading: heading hierarchy (Heading1, Heading2, ...)
//
// All three knobs are clamped to a sane range so a runaway level
// from a confused model can't produce invalid OOXML or 50-inch
// indents.

/** One indent step is 0.5" = 720 twips. Standard OOXML list/body indent. */
const INDENT_STEP_TWIPS = 720;

/**
 * Coerce a possibly-undefined / possibly-non-numeric level into a
 * non-negative integer in [0, 8]. OOXML's max ilvl is 8, and beyond
 * level 4 it stops looking like deliberate nesting and starts
 * looking like a runaway model.
 */
function clampLevel(level: number | null | undefined): number {
  if (level === undefined || level === null) return 0;
  const n = typeof level === 'number' ? level : Number(level);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(8, Math.floor(n)));
}

/** Body-shaped roles whose level maps to a left-indent override. */
function isBodyShapedRole(role: DraftParagraph['role']): boolean {
  return (
    role === 'body' ||
    role === 'note' ||
    role === 'caution' ||
    role === 'warning' ||
    role === 'definition' ||
    role === 'quote'
  );
}

/**
 * Ensure the pPr has a <w:numPr> child whose <w:ilvl> matches the
 * requested level. Called for bullet/step roles AFTER
 * selectFormatTemplate has already cloned a list-shaped pPr from
 * the global format inventory — that gave us the numId binding;
 * here we just override the ilvl so the bullet renders at the
 * right depth.
 */
function setNumPrLevel(dom: Document, pPr: Element, level: number): void {
  let numPr = firstChildNS(pPr, 'numPr');
  if (!numPr) {
    // Defensive: the format-template path should have given us a
    // numPr, but if it didn't (e.g., the document had no list
    // paragraphs anywhere) create a minimal one with numId=0.
    // numId=0 is a valid sentinel meaning "no list" — Word will
    // render it as a plain paragraph, which is the right degraded
    // behavior when the template has no real bullet binding.
    numPr = dom.createElementNS(W_NS, 'w:numPr');
    const numId = dom.createElementNS(W_NS, 'w:numId');
    numId.setAttributeNS(W_NS, 'w:val', '0');
    numPr.appendChild(numId);
    pPr.appendChild(numPr);
  }
  // Set or replace the ilvl child.
  let ilvl = firstChildNS(numPr, 'ilvl');
  if (!ilvl) {
    ilvl = dom.createElementNS(W_NS, 'w:ilvl');
    // ilvl must come before numId per the OOXML schema.
    if (numPr.firstChild) {
      numPr.insertBefore(ilvl, numPr.firstChild);
    } else {
      numPr.appendChild(ilvl);
    }
  }
  ilvl.setAttributeNS(W_NS, 'w:val', String(level));
}

/**
 * Replace the pPr's <w:ind> with one whose w:left is the requested
 * twip value. Removes any existing ind first so we don't end up with
 * two of them. Called only for body-shaped roles when level > 0;
 * level 0 leaves the cloned ind alone (it carried whatever the
 * source paragraph had).
 */
function setLeftIndent(dom: Document, pPr: Element, twips: number): void {
  removeChildrenByLocalName(pPr, 'ind');
  const ind = dom.createElementNS(W_NS, 'w:ind');
  ind.setAttributeNS(W_NS, 'w:left', String(twips));
  pPr.appendChild(ind);
}

/**
 * Pick a Heading{N+1} style id for a heading paragraph at the given
 * level. Falls back from "Heading1" → "Heading 1" → the next-lower
 * level → the generic role mapper. Templates with sparse heading
 * styles (only Heading1 defined) silently land on Heading1 for
 * everything, which is the correct degraded behavior.
 */
function headingStyleIdForLevel(
  level: number,
  availableStyleIds: Set<string>,
): string | null {
  // Try the requested level first, then walk back toward Heading1.
  for (let i = level; i >= 0; i--) {
    const n = i + 1; // level 0 → Heading1
    const candidates = [`Heading${n}`, `Heading ${n}`];
    for (const c of candidates) {
      if (availableStyleIds.has(c)) return c;
    }
  }
  // Final fallback to the generic role mapper, which knows about
  // Title and the BodyText sentinel.
  return roleToStyleId('heading', availableStyleIds);
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

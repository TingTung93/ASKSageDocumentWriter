// Stable content-based anchors for paragraph-targeted document edit ops.
//
// The default targeting mechanism for ops is an integer paragraph
// index. That works fine for a single round-trip but breaks down when
// structural ops (insert/merge/split/delete_paragraph) shift indices
// between when the LLM emitted the op and when the writer applies
// it. The orchestrator handles this by re-listing paragraphs after
// each structural op, but two ops emitted from the same chunk can
// reference the same paragraph by inconsistent indices.
//
// A content anchor is a small fingerprint of a paragraph (style id +
// numbering id + first ~60 trimmed chars of visible text) that the
// writer can resolve at apply time by searching the current paragraph
// list. If the anchor matches exactly one paragraph, the writer uses
// that paragraph. If zero or multiple match, the writer falls back to
// the integer index.
//
// The anchor is intentionally NOT a cryptographic hash — it's
// human-readable so debugging is easy. Two paragraphs with the same
// first 60 chars are vanishingly rare in practice for the document
// types this app handles.

import type { ParagraphInfo } from '../template/parser';

/**
 * Number of characters from the trimmed paragraph text used in the
 * anchor signature. 60 is empirically enough to disambiguate every
 * paragraph in the DHA fixture set.
 */
const ANCHOR_TEXT_LENGTH = 60;

export interface ParagraphAnchor {
  /** Style id (pStyle/@val) — null if the paragraph has no explicit style. */
  style_id: string | null;
  /** Numbering id (numPr/numId) — null if not in a list. */
  numbering_id: number | null;
  /** First N chars of the trimmed paragraph text. */
  text_prefix: string;
  /** Original integer index — used as a fallback when the anchor doesn't resolve. */
  fallback_index: number;
}

/**
 * Compute a content anchor for a paragraph at op-creation time. The
 * caller (Documents.tsx StoredEdit constructor or the orchestrator)
 * stores this on the op so the writer can resolve it independently
 * of integer-index drift.
 */
export function computeAnchor(p: ParagraphInfo): ParagraphAnchor {
  return {
    style_id: p.style_id,
    numbering_id: p.numbering_id,
    text_prefix: p.text.trim().slice(0, ANCHOR_TEXT_LENGTH),
    fallback_index: p.index,
  };
}

/**
 * Resolve an anchor against the current paragraph list. Returns the
 * matched paragraph index, or null if no unambiguous match exists.
 *
 * Match strategy (in order of strictness):
 *   1. Exact: same style_id, same numbering_id, same text_prefix
 *      → if exactly one match, return its index
 *   2. Text-only fallback: just the text_prefix
 *      → if exactly one match, return its index
 *   3. None of the above → return null and let the caller fall back
 *      to fallback_index
 */
export function resolveAnchor(
  anchor: ParagraphAnchor,
  paragraphs: ParagraphInfo[],
): number | null {
  // Tier 1 — full match
  const fullMatches = paragraphs.filter(
    (p) =>
      p.style_id === anchor.style_id &&
      p.numbering_id === anchor.numbering_id &&
      p.text.trim().slice(0, ANCHOR_TEXT_LENGTH) === anchor.text_prefix,
  );
  if (fullMatches.length === 1) return fullMatches[0]!.index;
  // Multiple full matches → ambiguous; fall through to text-only.
  // Zero full matches → also fall through.

  // Tier 2 — text-only
  const textMatches = paragraphs.filter(
    (p) => p.text.trim().slice(0, ANCHOR_TEXT_LENGTH) === anchor.text_prefix,
  );
  if (textMatches.length === 1) return textMatches[0]!.index;

  return null;
}

/**
 * Apply-time resolver used by the writer. Returns the integer index
 * to use, considering both the anchor (if present) and the original
 * fallback index. Strategy:
 *
 *   - If the op has no anchor, use the integer index unchanged
 *   - If the anchor resolves uniquely, use the resolved index
 *   - If the anchor doesn't resolve (zero or multiple matches), check
 *     whether the fallback_index still points at a paragraph whose
 *     text starts with the anchor's text_prefix. If yes, use it.
 *     This catches the common case where an earlier op deleted a
 *     paragraph and shifted indices but the target itself is unchanged.
 *   - Otherwise return null and let the caller decide whether to
 *     skip the op or surface an error.
 */
export function resolveOpIndex(
  anchor: ParagraphAnchor | undefined,
  rawIndex: number,
  paragraphs: ParagraphInfo[],
): number | null {
  if (!anchor) {
    // No anchor available — use the raw index if it's in range.
    return rawIndex >= 0 && rawIndex < paragraphs.length ? rawIndex : null;
  }
  const resolved = resolveAnchor(anchor, paragraphs);
  if (resolved !== null) return resolved;
  // Anchor failed. Try the fallback index, but only if its current
  // content is plausibly the same paragraph we anchored against.
  const candidate = paragraphs[rawIndex];
  if (
    candidate &&
    candidate.text.trim().slice(0, ANCHOR_TEXT_LENGTH) === anchor.text_prefix
  ) {
    return rawIndex;
  }
  // Last-ditch: the integer fallback the anchor itself records (may
  // differ from rawIndex if the orchestrator already remapped). Same
  // content check.
  const fallback = paragraphs[anchor.fallback_index];
  if (
    fallback &&
    fallback.text.trim().slice(0, ANCHOR_TEXT_LENGTH) === anchor.text_prefix
  ) {
    return anchor.fallback_index;
  }
  return null;
}

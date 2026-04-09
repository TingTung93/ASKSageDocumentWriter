// placeholders.ts — find and resolve [INSERT: ...] placeholders that
// the drafter (or the metadata batch) emitted because the LLM had no
// way to ground a fact in the available context.
//
// Convention: a placeholder is the literal text "[INSERT: <description>]"
// inside a paragraph's text or table cell, where <description> names
// what the user needs to supply (e.g. "[INSERT: contracting officer
// name]"). Both the per-section drafter's prompt and the metadata
// batch's prompt instruct the model to use exactly this format.
//
// The recipe's fill-placeholders stage uses these helpers to:
//   1. scan every ready draft for the project,
//   2. surface a flat list of placeholders to the UI as an
//      intervention point,
//   3. accept user-supplied resolutions in natural language and
//      substitute them back into the paragraphs verbatim.
//
// Substitutions are PER-OCCURRENCE — two paragraphs that both contain
// "[INSERT: contracting officer name]" each get an independent entry,
// so the user can fill them in differently if they wish, OR the UI
// can dedupe by description label and apply the same answer to all
// matching occurrences.

import type { DraftParagraph } from './types';

/** Regex matching a single [INSERT: <description>] occurrence. The
 *  description captures everything up to (but not including) the
 *  first ']' so descriptions cannot contain a literal ']'. */
const PLACEHOLDER_RE = /\[INSERT:\s*([^\]]+)\]/g;

export interface PlaceholderOccurrence {
  /** Index of the paragraph in the source paragraphs array. */
  paragraph_index: number;
  /** When the paragraph is a table_row, which cell index this is in. */
  cell_index?: number;
  /** Character offset within the paragraph text / cell text. Used by
   *  the apply step to do an O(1) substitution rather than re-scanning
   *  the whole paragraph (and to disambiguate two placeholders that
   *  share the same description text). */
  start: number;
  /** End offset (exclusive). */
  end: number;
  /** The full matched literal, e.g. "[INSERT: contracting officer name]". */
  raw: string;
  /** The trimmed description, e.g. "contracting officer name". */
  description: string;
}

/**
 * Scan a draft's paragraphs for every [INSERT: ...] occurrence.
 * Returns one entry per occurrence (not per unique description) so
 * the UI can decide how to group or dedupe. Empty array when there
 * are no placeholders.
 */
export function scanDraftForPlaceholders(
  paragraphs: DraftParagraph[],
): PlaceholderOccurrence[] {
  const out: PlaceholderOccurrence[] = [];
  paragraphs.forEach((p, idx) => {
    if (Array.isArray(p.cells) && p.cells.length > 0) {
      p.cells.forEach((cellText, cellIdx) => {
        if (typeof cellText !== 'string') return;
        scanString(cellText, (match) => {
          out.push({
            paragraph_index: idx,
            cell_index: cellIdx,
            start: match.start,
            end: match.end,
            raw: match.raw,
            description: match.description,
          });
        });
      });
      return;
    }
    if (typeof p.text !== 'string') return;
    scanString(p.text, (match) => {
      out.push({
        paragraph_index: idx,
        start: match.start,
        end: match.end,
        raw: match.raw,
        description: match.description,
      });
    });
  });
  return out;
}

interface RawMatch {
  start: number;
  end: number;
  raw: string;
  description: string;
}

function scanString(text: string, emit: (match: RawMatch) => void): void {
  // Reset the regex's lastIndex on every entry — PLACEHOLDER_RE is a
  // module-level /g regex so its state persists between scans.
  PLACEHOLDER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PLACEHOLDER_RE.exec(text)) !== null) {
    emit({
      start: m.index,
      end: m.index + m[0].length,
      raw: m[0],
      description: (m[1] ?? '').trim(),
    });
  }
}

export interface PlaceholderResolution {
  /** Matches PlaceholderOccurrence.paragraph_index. */
  paragraph_index: number;
  cell_index?: number;
  start: number;
  end: number;
  /** What to substitute IN PLACE of the [INSERT: ...] literal. The
   *  caller should pass exactly the user's natural-language answer
   *  (no surrounding brackets, no quotes added). An empty string
   *  means "leave the placeholder in place" — the apply step skips
   *  resolutions with empty values so the user can selectively defer. */
  value: string;
}

export interface ApplyResolutionsResult {
  paragraphs: DraftParagraph[];
  /** Number of placeholders that were actually substituted (excludes
   *  resolutions with empty values, and excludes resolutions whose
   *  offsets no longer line up because the paragraphs were edited
   *  between scan and apply). */
  applied: number;
  /** Resolutions whose offsets didn't match the current paragraphs.
   *  Caller can re-scan and try again, or surface as a warning. */
  stale: number;
}

/**
 * Apply a list of resolutions to a paragraphs array, returning a NEW
 * paragraphs array with the substitutions made. The original input
 * is not mutated.
 *
 * Resolutions are applied in DESCENDING offset order so a multi-
 * occurrence substitution within the same paragraph doesn't shift
 * the offsets of later occurrences. Resolutions whose offsets no
 * longer point at a literal "[INSERT:" prefix are counted as stale
 * and skipped.
 */
export function applyPlaceholderResolutions(
  paragraphs: DraftParagraph[],
  resolutions: PlaceholderResolution[],
): ApplyResolutionsResult {
  // Deep-clone so we don't mutate the caller's input. JSON round-trip
  // is fine here — DraftParagraph is plain string data only.
  const next: DraftParagraph[] = JSON.parse(JSON.stringify(paragraphs));

  // Group resolutions by (paragraph_index, cell_index?) so each text
  // span gets one descending-order pass.
  const groups = new Map<string, PlaceholderResolution[]>();
  for (const r of resolutions) {
    if (!r.value || !r.value.length) continue;
    const key = `${r.paragraph_index}::${r.cell_index ?? -1}`;
    let bucket = groups.get(key);
    if (!bucket) {
      bucket = [];
      groups.set(key, bucket);
    }
    bucket.push(r);
  }

  let applied = 0;
  let stale = 0;
  for (const [key, bucket] of groups) {
    const [pIdxStr, cIdxStr] = key.split('::');
    const pIdx = Number(pIdxStr);
    const cIdx = Number(cIdxStr);
    const target = next[pIdx];
    if (!target) {
      stale += bucket.length;
      continue;
    }

    // Sort descending by start so substitutions don't perturb earlier
    // offsets in the same string.
    bucket.sort((a, b) => b.start - a.start);

    if (cIdx >= 0) {
      const cells = target.cells ?? [];
      const original = cells[cIdx];
      if (typeof original !== 'string') {
        stale += bucket.length;
        continue;
      }
      let working = original;
      for (const r of bucket) {
        if (!isLiveOccurrence(working, r)) {
          stale += 1;
          continue;
        }
        working = working.slice(0, r.start) + r.value + working.slice(r.end);
        applied += 1;
      }
      cells[cIdx] = working;
      target.cells = cells;
      continue;
    }

    let working = target.text;
    for (const r of bucket) {
      if (!isLiveOccurrence(working, r)) {
        stale += 1;
        continue;
      }
      working = working.slice(0, r.start) + r.value + working.slice(r.end);
      applied += 1;
    }
    target.text = working;
  }

  return { paragraphs: next, applied, stale };
}

/** True when the slice [start, end) on `text` still looks like an
 *  [INSERT: ...] placeholder. We don't strictly require it to be the
 *  SAME placeholder — just that the offsets still point at one. */
function isLiveOccurrence(text: string, r: PlaceholderResolution): boolean {
  if (r.start < 0 || r.end > text.length) return false;
  const slice = text.slice(r.start, r.end);
  return slice.startsWith('[INSERT:') && slice.endsWith(']');
}

/**
 * Convenience: collapse a flat occurrence list to UNIQUE descriptions
 * with the count of occurrences for each. The intervention UI uses
 * this to render one input per description rather than one per
 * occurrence (a section with the same placeholder twice is usually
 * supposed to get the same answer twice).
 */
export interface UniquePlaceholder {
  description: string;
  occurrences: PlaceholderOccurrence[];
}

export function uniquePlaceholdersByDescription(
  occurrences: PlaceholderOccurrence[],
): UniquePlaceholder[] {
  const map = new Map<string, UniquePlaceholder>();
  for (const o of occurrences) {
    const key = o.description.toLowerCase();
    let entry = map.get(key);
    if (!entry) {
      entry = { description: o.description, occurrences: [] };
      map.set(key, entry);
    }
    entry.occurrences.push(o);
  }
  return Array.from(map.values());
}

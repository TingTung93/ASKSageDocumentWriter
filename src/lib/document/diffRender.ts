// Text diff helpers for the speculative-preview overlay.
//
// The document cleanup workflow surfaces LLM-proposed edits as an
// inline diff painted on top of a docx-preview render. The overlay
// walks the rendered DOM paragraph-by-paragraph, and for each
// paragraph that differs from the original it needs to replace the
// innerHTML with a colorized version showing inserts and deletes.
//
// This module owns the per-paragraph text diff (word-level) and the
// HTML emitter used by that overlay. No external deps — a small
// hand-rolled LCS walk is plenty for prose paragraphs (a few hundred
// chars each).

export interface DiffSegment {
  kind: 'keep' | 'insert' | 'delete';
  text: string;
}

/**
 * Tokenize a string into whitespace-preserving word tokens. Each
 * token is either a run of non-whitespace or a run of whitespace,
 * and concatenating all tokens reproduces the original string
 * exactly. We tokenize this way so the reconstructed diff output
 * keeps the original spacing without any special-casing.
 */
function tokenize(s: string): string[] {
  if (s.length === 0) return [];
  const out: string[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i]!;
    const isSpace = /\s/.test(ch);
    let j = i + 1;
    while (j < s.length && /\s/.test(s[j]!) === isSpace) {
      j++;
    }
    out.push(s.slice(i, j));
    i = j;
  }
  return out;
}

/**
 * Compact a raw segment stream by merging runs of the same kind.
 * The LCS walk naturally produces per-token segments; merging gives
 * a cleaner DOM and cheaper rendering.
 */
function compact(segments: DiffSegment[]): DiffSegment[] {
  const out: DiffSegment[] = [];
  for (const seg of segments) {
    if (seg.text.length === 0) continue;
    const last = out[out.length - 1];
    if (last && last.kind === seg.kind) {
      last.text += seg.text;
    } else {
      out.push({ kind: seg.kind, text: seg.text });
    }
  }
  return out;
}

/**
 * Per-segment diff between two strings using a word-level LCS.
 * Returns an array of segments tagged 'keep' / 'insert' / 'delete'.
 * Ties in the LCS table are broken in favor of long keep runs (we
 * prefer the "up" direction when scores are equal, which matches
 * the intuition that stable prefixes should stay grouped).
 */
export function computeInlineDiff(before: string, after: string): DiffSegment[] {
  if (before === after) {
    if (before.length === 0) return [];
    return [{ kind: 'keep', text: before }];
  }
  const a = tokenize(before);
  const b = tokenize(after);
  const n = a.length;
  const m = b.length;

  if (n === 0) {
    return [{ kind: 'insert', text: after }];
  }
  if (m === 0) {
    return [{ kind: 'delete', text: before }];
  }

  // Classic O(n*m) LCS table. Fine for paragraph-sized input.
  // dp[i][j] = LCS length of a[0..i) vs b[0..j).
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i]![j] = dp[i - 1]![j - 1]! + 1;
      } else {
        const up = dp[i - 1]![j]!;
        const left = dp[i]![j - 1]!;
        dp[i]![j] = up >= left ? up : left;
      }
    }
  }

  // Walk back from (n,m) to (0,0) producing per-token segments in
  // reverse, then reverse + compact at the end.
  const rev: DiffSegment[] = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      rev.push({ kind: 'keep', text: a[i - 1]! });
      i--;
      j--;
    } else {
      const up = dp[i - 1]![j]!;
      const left = dp[i]![j - 1]!;
      // Tie-breaking: prefer 'up' (treat as delete) when scores
      // are equal. Combined with the >= above this favors stable
      // prefixes staying on the keep path.
      if (up >= left) {
        rev.push({ kind: 'delete', text: a[i - 1]! });
        i--;
      } else {
        rev.push({ kind: 'insert', text: b[j - 1]! });
        j--;
      }
    }
  }
  while (i > 0) {
    rev.push({ kind: 'delete', text: a[i - 1]! });
    i--;
  }
  while (j > 0) {
    rev.push({ kind: 'insert', text: b[j - 1]! });
    j--;
  }
  rev.reverse();
  return compact(rev);
}

/**
 * Escape a raw string for HTML interpolation. Only the five XML
 * entities we care about — the overlay never emits user-controlled
 * attribute values, so we don't need the quote variants, but we
 * include them anyway to keep this helper generally safe.
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Render a list of DiffSegments as a single HTML string. Each
 * segment becomes a <span> with a CSS class the overlay container
 * can style (diff-keep / diff-insert / diff-delete). The text
 * content is HTML-escaped; no raw markup is ever emitted.
 */
export function renderDiffSegmentsHtml(segments: DiffSegment[]): string {
  const parts: string[] = [];
  for (const seg of segments) {
    const cls =
      seg.kind === 'keep'
        ? 'diff-keep'
        : seg.kind === 'insert'
        ? 'diff-insert'
        : 'diff-delete';
    parts.push(`<span class="${cls}">${escapeHtml(seg.text)}</span>`);
  }
  return parts.join('');
}

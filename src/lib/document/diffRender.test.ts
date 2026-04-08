import { describe, it, expect } from 'vitest';
import {
  computeInlineDiff,
  renderDiffSegmentsHtml,
  type DiffSegment,
} from './diffRender';

describe('computeInlineDiff', () => {
  it('returns a single keep segment when strings are identical', () => {
    const segs = computeInlineDiff('a b c', 'a b c');
    expect(segs).toEqual<DiffSegment[]>([{ kind: 'keep', text: 'a b c' }]);
  });

  it('returns empty array when both inputs are empty', () => {
    expect(computeInlineDiff('', '')).toEqual([]);
  });

  it('marks a single-word substitution with a keep/delete/insert/keep sequence', () => {
    const segs = computeInlineDiff('a b c', 'a x c');
    // Reconstructed "before" = keeps + deletes
    const before = segs
      .filter((s) => s.kind !== 'insert')
      .map((s) => s.text)
      .join('');
    const after = segs
      .filter((s) => s.kind !== 'delete')
      .map((s) => s.text)
      .join('');
    expect(before).toBe('a b c');
    expect(after).toBe('a x c');
    // Ensure we actually saw a delete of 'b' and an insert of 'x'.
    expect(segs.some((s) => s.kind === 'delete' && s.text.includes('b'))).toBe(true);
    expect(segs.some((s) => s.kind === 'insert' && s.text.includes('x'))).toBe(true);
    // And the 'a' and 'c' anchors were kept (not rewritten).
    expect(segs.some((s) => s.kind === 'keep' && s.text.includes('a'))).toBe(true);
    expect(segs.some((s) => s.kind === 'keep' && s.text.includes('c'))).toBe(true);
  });

  it('treats a pure addition as all insert', () => {
    const segs = computeInlineDiff('', 'hello world');
    expect(segs).toEqual<DiffSegment[]>([
      { kind: 'insert', text: 'hello world' },
    ]);
  });

  it('treats a pure removal as all delete', () => {
    const segs = computeInlineDiff('hello world', '');
    expect(segs).toEqual<DiffSegment[]>([
      { kind: 'delete', text: 'hello world' },
    ]);
  });

  it('handles a mid-sentence word swap with stable prefix and suffix', () => {
    const segs = computeInlineDiff('the quick brown fox', 'the slow brown fox');
    const before = segs
      .filter((s) => s.kind !== 'insert')
      .map((s) => s.text)
      .join('');
    const after = segs
      .filter((s) => s.kind !== 'delete')
      .map((s) => s.text)
      .join('');
    expect(before).toBe('the quick brown fox');
    expect(after).toBe('the slow brown fox');
    // The 'the ' prefix must be kept (stable anchor).
    expect(segs[0]!.kind).toBe('keep');
    expect(segs[0]!.text.startsWith('the')).toBe(true);
    // The 'brown fox' suffix must also appear as a keep segment.
    const keeps = segs.filter((s) => s.kind === 'keep').map((s) => s.text).join('');
    expect(keeps).toContain('brown');
    expect(keeps).toContain('fox');
    // And 'quick' is deleted while 'slow' is inserted.
    expect(segs.some((s) => s.kind === 'delete' && s.text.includes('quick'))).toBe(true);
    expect(segs.some((s) => s.kind === 'insert' && s.text.includes('slow'))).toBe(true);
  });
});

describe('renderDiffSegmentsHtml', () => {
  it('emits one span per segment with the expected class names', () => {
    const html = renderDiffSegmentsHtml([
      { kind: 'keep', text: 'a ' },
      { kind: 'delete', text: 'b ' },
      { kind: 'insert', text: 'x ' },
      { kind: 'keep', text: 'c' },
    ]);
    expect(html).toBe(
      '<span class="diff-keep">a </span>' +
        '<span class="diff-delete">b </span>' +
        '<span class="diff-insert">x </span>' +
        '<span class="diff-keep">c</span>',
    );
  });

  it('escapes &, <, > in segment text', () => {
    const html = renderDiffSegmentsHtml([
      { kind: 'keep', text: 'A & B <c>' },
    ]);
    expect(html).toBe('<span class="diff-keep">A &amp; B &lt;c&gt;</span>');
    // And the raw markup characters do not appear unescaped.
    expect(html).not.toContain('<c>');
    expect(html).not.toContain('A & B');
  });

  it('returns empty string for an empty segment list', () => {
    expect(renderDiffSegmentsHtml([])).toBe('');
  });

  it('round-trips visible text — sum of segment.text equals the decoded output text', () => {
    const segs: DiffSegment[] = [
      { kind: 'keep', text: 'The ' },
      { kind: 'delete', text: 'quick ' },
      { kind: 'insert', text: 'slow ' },
      { kind: 'keep', text: 'brown fox & friends' },
    ];
    const expectedText = segs.map((s) => s.text).join('');
    const html = renderDiffSegmentsHtml(segs);
    // Strip the spans and un-escape to get the visible text back.
    const stripped = html
      .replace(/<span class="diff-(?:keep|insert|delete)">/g, '')
      .replace(/<\/span>/g, '')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&');
    expect(stripped).toBe(expectedText);
  });
});

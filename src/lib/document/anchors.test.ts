import { describe, expect, it } from 'vitest';
import { computeAnchor, resolveAnchor, resolveOpIndex } from './anchors';
import type { ParagraphInfo } from '../template/parser';

function makeParagraph(
  index: number,
  text: string,
  style_id: string | null = null,
  numbering_id: number | null = null,
): ParagraphInfo {
  return {
    index,
    text,
    style_id,
    numbering_id,
    numbering_level: null,
    outline_level: null,
    alignment: null,
    indent_left_twips: null,
    indent_first_line_twips: null,
    indent_hanging_twips: null,
    bold: false,
    italic: false,
    bookmark_starts: [],
    bookmark_ends: [],
    content_control_tag: null,
    in_table: false,
    runs: [],
    el: null as unknown as Element,
  };
}

describe('computeAnchor', () => {
  it('captures style id, numbering id, and the text prefix', () => {
    const p = makeParagraph(7, 'The contractor shall provide periodic maintenance for the equipment.', 'BodyText', 3);
    const anchor = computeAnchor(p);
    expect(anchor.style_id).toBe('BodyText');
    expect(anchor.numbering_id).toBe(3);
    expect(anchor.text_prefix).toBe('The contractor shall provide periodic maintenance for the eq');
    expect(anchor.fallback_index).toBe(7);
  });

  it('handles paragraphs with no style or numbering', () => {
    const p = makeParagraph(0, 'A short paragraph.');
    const anchor = computeAnchor(p);
    expect(anchor.style_id).toBeNull();
    expect(anchor.numbering_id).toBeNull();
    expect(anchor.text_prefix).toBe('A short paragraph.');
  });
});

describe('resolveAnchor', () => {
  it('returns the index of a unique full match', () => {
    const ps = [
      makeParagraph(0, 'First paragraph here.', 'Heading1'),
      makeParagraph(1, 'Second paragraph with body content text.', 'BodyText'),
      makeParagraph(2, 'Third paragraph here.', 'BodyText'),
    ];
    const anchor = computeAnchor(ps[1]!);
    expect(resolveAnchor(anchor, ps)).toBe(1);
  });

  it('falls back to text-only match when style differs', () => {
    const ps = [
      makeParagraph(0, 'Unique text content for this paragraph.', 'BodyText'),
      makeParagraph(1, 'Other text.', 'BodyText'),
    ];
    const original = computeAnchor(ps[0]!);
    // Mutate the style_id on the actual paragraph (simulating a style edit
    // that landed earlier in the same batch)
    ps[0] = makeParagraph(0, 'Unique text content for this paragraph.', 'NormalIndent');
    expect(resolveAnchor(original, ps)).toBe(0);
  });

  it('returns null when nothing matches', () => {
    const ps = [makeParagraph(0, 'Some text here.', 'BodyText')];
    const phantomAnchor = {
      style_id: 'BodyText',
      numbering_id: null,
      text_prefix: 'Completely different text that does not appear',
      fallback_index: 0,
    };
    expect(resolveAnchor(phantomAnchor, ps)).toBeNull();
  });

  it('returns null when multiple paragraphs match the same prefix', () => {
    const ps = [
      makeParagraph(0, 'The contractor shall provide a deliverable.', 'BodyText'),
      makeParagraph(1, 'The contractor shall provide a deliverable.', 'BodyText'),
    ];
    const anchor = computeAnchor(ps[0]!);
    // Both paragraphs match → ambiguous → null
    expect(resolveAnchor(anchor, ps)).toBeNull();
  });
});

describe('resolveOpIndex', () => {
  it('uses the raw index when no anchor is provided', () => {
    const ps = [makeParagraph(0, 'a'), makeParagraph(1, 'b'), makeParagraph(2, 'c')];
    expect(resolveOpIndex(undefined, 1, ps)).toBe(1);
  });

  it('returns null when raw index is out of range and no anchor', () => {
    const ps = [makeParagraph(0, 'a')];
    expect(resolveOpIndex(undefined, 5, ps)).toBeNull();
  });

  it('uses anchor resolution when present and unambiguous', () => {
    const ps = [
      makeParagraph(0, 'first text content'),
      makeParagraph(1, 'second text content'),
    ];
    const anchor = computeAnchor(ps[1]!);
    // Pretend an earlier op shifted things; pass a wrong raw index.
    expect(resolveOpIndex(anchor, 0, ps)).toBe(1);
  });

  it("falls back to the raw index when the anchor doesn't resolve but raw index still matches", () => {
    const ps = [makeParagraph(0, 'first text content'), makeParagraph(1, 'second text content')];
    // Anchor with text_prefix that matches paragraph 0 but a phantom
    // style id that doesn't, and a phantom fallback that doesn't exist.
    const anchor = {
      style_id: 'PhantomStyle',
      numbering_id: null,
      text_prefix: 'first text content',
      fallback_index: 99,
    };
    expect(resolveOpIndex(anchor, 0, ps)).toBe(0);
  });
});

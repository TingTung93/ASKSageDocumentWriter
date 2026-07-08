import { describe, expect, it } from 'vitest';
import { lowerEditPlan } from './plan';
import type { ParagraphInfo } from '../template/parser';

function makeParagraph(index: number, text: string): ParagraphInfo {
  return {
    index,
    style_id: 'Normal',
    text,
    numbering_id: null,
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
    el: document.createElement('p'),
  };
}

describe('lowerEditPlan', () => {
  it('lowers complete paragraph revision to replace_paragraph_text', () => {
    const result = lowerEditPlan(
      [
        {
          kind: 'complete_paragraph_revision',
          paragraph_index: 1,
          new_text: 'This paragraph now fully explains the requirement.',
          rationale: 'Replace thin prose with complete explanation.',
        },
      ],
      [makeParagraph(1, 'Thin prose.')],
      new Set(['Normal']),
    );

    expect(result.ops).toEqual([
      {
        op: 'replace_paragraph_text',
        index: 1,
        new_text: 'This paragraph now fully explains the requirement.',
        rationale: 'Replace thin prose with complete explanation.',
      },
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  it('lowers missing content insertion to insert_paragraph_after', () => {
    const result = lowerEditPlan(
      [
        {
          kind: 'insert_missing_content',
          after_paragraph_index: 2,
          new_text: 'This transition connects the background to the requirement.',
          rationale: 'Add missing transition.',
        },
      ],
      [makeParagraph(2, 'Background ends here.')],
      new Set(['Normal']),
    );

    expect(result.ops).toEqual([
      {
        op: 'insert_paragraph_after',
        index: 2,
        new_text: 'This transition connects the background to the requirement.',
        rationale: 'Add missing transition.',
      },
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  it('lowers structural delete, merge, and split plans', () => {
    const result = lowerEditPlan(
      [
        {
          kind: 'delete_paragraph',
          paragraph_index: 3,
          rationale: 'Remove duplicate heading.',
        },
        {
          kind: 'merge_paragraphs',
          paragraph_index: 4,
          separator: ' ',
          rationale: 'Repair accidental fragmentation.',
        },
        {
          kind: 'split_paragraph',
          paragraph_index: 5,
          split_at_text: 'Second idea starts here.',
          rationale: 'Separate two ideas.',
        },
      ],
      [
        makeParagraph(3, 'Duplicate heading'),
        makeParagraph(4, 'First fragment'),
        makeParagraph(5, 'First idea. Second idea starts here.'),
      ],
      new Set(['Normal']),
    );

    expect(result.ops).toEqual([
      {
        op: 'delete_paragraph',
        index: 3,
        rationale: 'Remove duplicate heading.',
      },
      {
        op: 'merge_paragraphs',
        index: 4,
        separator: ' ',
        rationale: 'Repair accidental fragmentation.',
      },
      {
        op: 'split_paragraph',
        index: 5,
        split_at_text: 'Second idea starts here.',
        rationale: 'Separate two ideas.',
      },
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  it('emits invalid_text when a revision or insertion has no text', () => {
    const result = lowerEditPlan(
      [
        {
          kind: 'complete_paragraph_revision',
          paragraph_index: 0,
          new_text: '   ',
        },
        {
          kind: 'insert_missing_content',
          after_paragraph_index: 0,
          new_text: '',
        },
      ],
      [makeParagraph(0, 'Original.')],
      new Set(['Normal']),
    );

    expect(result.ops).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
    expect(result.diagnostics[0]).toMatchObject({
      severity: 'error',
      code: 'invalid_text',
    });
    expect(result.diagnostics[1]).toMatchObject({
      severity: 'error',
      code: 'invalid_text',
    });
  });

  it('emits split_text_not_found when split marker is absent from the paragraph', () => {
    const result = lowerEditPlan(
      [
        {
          kind: 'split_paragraph',
          paragraph_index: 0,
          split_at_text: 'Missing marker',
        },
      ],
      [makeParagraph(0, 'Original text.')],
      new Set(['Normal']),
    );

    expect(result.ops).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      severity: 'error',
      code: 'split_text_not_found',
    });
  });

  it('lowers heading role style for paragraph index 0 to Heading1', () => {
    const result = lowerEditPlan(
      [{ kind: 'apply_role_style', paragraph_index: 0, role: 'heading' }],
      [makeParagraph(0, 'Introduction')],
      new Set(['Normal', 'Heading1']),
    );

    expect(result.ops).toEqual([
      {
        op: 'set_paragraph_style',
        index: 0,
        style_id: 'Heading1',
        rationale: 'Apply heading style.',
      },
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  it('emits paragraph_not_found when paragraph index is absent', () => {
    const result = lowerEditPlan(
      [{ kind: 'apply_role_style', paragraph_index: 99, role: 'heading' }],
      [makeParagraph(0, 'Introduction')],
      new Set(['Normal', 'Heading1']),
    );

    expect(result.ops).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      severity: 'error',
      code: 'paragraph_not_found',
    });
    expect(result.diagnostics[0]!.message).toContain('99');
  });

  it('emits style_not_available when no heading style candidate is available', () => {
    const result = lowerEditPlan(
      [{ kind: 'apply_role_style', paragraph_index: 0, role: 'heading' }],
      [makeParagraph(0, 'Introduction')],
      new Set(['Normal']),
    );

    expect(result.ops).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      severity: 'error',
      code: 'style_not_available',
    });
    expect(result.diagnostics[0]!.message).toContain('heading');
  });
});

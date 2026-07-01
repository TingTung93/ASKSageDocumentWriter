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

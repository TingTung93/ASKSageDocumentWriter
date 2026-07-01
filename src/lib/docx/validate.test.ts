import { describe, expect, it } from 'vitest';
import type { StructuredBlock } from './ir';
import { validateStructuredBlocks } from './validate';

describe('validateStructuredBlocks', () => {
  it('clamps excessive paragraph levels and reports a warning', () => {
    const blocks: StructuredBlock[] = [
      { kind: 'paragraph', role: 'bullet', text: 'Deep item', level: 99 },
    ];

    const result = validateStructuredBlocks(blocks, { repair: true });

    expect(result.ok).toBe(true);
    expect(result.blocks[0]).toMatchObject({ kind: 'paragraph', level: 8 });
    expect(result.diagnostics[0]).toMatchObject({
      severity: 'warning',
      code: 'level_clamped',
    });
  });

  it('converts roles outside the permitted set to body when repair is enabled', () => {
    const blocks: StructuredBlock[] = [
      { kind: 'paragraph', role: 'warning', text: 'Unsafe role' },
    ];

    const result = validateStructuredBlocks(blocks, {
      repair: true,
      permittedRoles: new Set(['body']),
    });

    expect(result.blocks[0]).toMatchObject({ kind: 'paragraph', role: 'body' });
    expect(result.diagnostics[0]).toMatchObject({ code: 'role_repaired' });
  });

  it('removes empty runs from rich paragraphs', () => {
    const blocks: StructuredBlock[] = [
      {
        kind: 'paragraph',
        role: 'body',
        text: '',
        runs: [{ text: '' }, { text: 'Keep me', bold: true }],
      },
    ];

    const result = validateStructuredBlocks(blocks, { repair: true });

    expect(result.blocks[0]).toMatchObject({
      kind: 'paragraph',
      runs: [{ text: 'Keep me', bold: true }],
    });
    expect(result.diagnostics.map((d) => d.code)).toContain('empty_run_removed');
  });

  it('preserves empty runs when repair is disabled', () => {
    const blocks: StructuredBlock[] = [
      {
        kind: 'paragraph',
        role: 'body',
        text: '',
        runs: [{ text: '' }, { text: 'Keep me', bold: true }],
      },
    ];

    const result = validateStructuredBlocks(blocks, { repair: false });

    expect(result.blocks[0]).toMatchObject({
      kind: 'paragraph',
      runs: [{ text: '' }, { text: 'Keep me', bold: true }],
    });
    expect(result.diagnostics.map((d) => d.code)).toContain('empty_run_removed');
  });

  it('reports empty visible paragraphs after removing empty runs', () => {
    const blocks: StructuredBlock[] = [
      {
        kind: 'paragraph',
        role: 'body',
        text: '',
        runs: [{ text: '' }],
      },
    ];

    const result = validateStructuredBlocks(blocks, { repair: true });

    expect(result.blocks[0]).toMatchObject({ kind: 'paragraph', text: '' });
    expect(result.blocks[0]).not.toHaveProperty('runs');
    expect(result.diagnostics.map((d) => d.message)).toContain('Paragraph has no visible text.');
  });

  it('pads short table rows to the widest row', () => {
    const blocks: StructuredBlock[] = [
      {
        kind: 'table',
        rows: [
          { is_header: true, cells: [{ text: 'A' }, { text: 'B' }] },
          { is_header: false, cells: [{ text: '1' }] },
        ],
      },
    ];

    const result = validateStructuredBlocks(blocks, { repair: true });

    expect(result.blocks[0]).toMatchObject({
      kind: 'table',
      rows: [
        { cells: [{ text: 'A' }, { text: 'B' }] },
        { cells: [{ text: '1' }, { text: '' }] },
      ],
    });
  });

  it('keeps empty tables and reports an error when repair is disabled', () => {
    const blocks: StructuredBlock[] = [
      {
        kind: 'table',
        rows: [],
      },
    ];

    const result = validateStructuredBlocks(blocks, { repair: false });

    expect(result.ok).toBe(false);
    expect(result.blocks).toEqual(blocks);
    expect(result.diagnostics[0]).toMatchObject({
      severity: 'error',
      code: 'empty_table_removed',
    });
  });

  it('blocks invalid roles when repair is disabled', () => {
    const blocks: StructuredBlock[] = [
      { kind: 'paragraph', role: 'warning', text: 'Unsafe role' },
    ];

    const result = validateStructuredBlocks(blocks, {
      repair: false,
      permittedRoles: new Set(['body']),
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]).toMatchObject({
      severity: 'error',
      code: 'role_not_permitted',
    });
  });
});

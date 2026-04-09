// Pure-function tests for the style consistency op applier. The LLM
// call itself is not exercised — these tests pin sanitize + apply
// behavior so the recipe stage can rely on deterministic semantics.

import { describe, it, expect } from 'vitest';
import { applyStyleFixOps, type StyleFixOp } from './style_consistency';
import type { DraftParagraph } from './types';

function makeDraftMap(): Map<string, DraftParagraph[]> {
  return new Map<string, DraftParagraph[]>([
    [
      'sec_a',
      [
        { role: 'heading', text: 'Background', level: 0 },
        { role: 'body', text: 'The contractor shall provide services.' },
        { role: 'body', text: 'Bullet point one' }, // misclassified as body
        { role: 'body', text: '' }, // stray empty
        { role: 'body', text: 'Final summary line.' },
      ],
    ],
    [
      'sec_b',
      [
        { role: 'table_row', text: '', cells: ['Role', 'Responsibility'] }, // header
        { role: 'table_row', text: '', cells: ['CO', 'Award'] },
        { role: 'table_row', text: '', cells: ['COR'] }, // short row
      ],
    ],
  ]);
}

describe('applyStyleFixOps', () => {
  it('set_role updates role and leaves other fields untouched', () => {
    const drafts = makeDraftMap();
    const ops: StyleFixOp[] = [
      { kind: 'set_role', section_id: 'sec_a', paragraph_index: 2, role: 'bullet' },
    ];
    const { updated, applied } = applyStyleFixOps(drafts, ops);
    expect(applied.length).toBe(1);
    const sec = updated.get('sec_a')!;
    expect(sec[2]!.role).toBe('bullet');
    expect(sec[2]!.text).toBe('Bullet point one');
    // Original draft map untouched (returned a new Map).
    expect(drafts.get('sec_a')![2]!.role).toBe('body');
  });

  it('set_runs replaces text with rich runs and clears the text field', () => {
    const drafts = makeDraftMap();
    const ops: StyleFixOp[] = [
      {
        kind: 'set_runs',
        section_id: 'sec_a',
        paragraph_index: 1,
        runs: [
          { text: 'The ' },
          { text: 'contractor', bold: true },
          { text: ' shall provide services.' },
        ],
      },
    ];
    const { updated, applied } = applyStyleFixOps(drafts, ops);
    expect(applied.length).toBe(1);
    const p = updated.get('sec_a')![1]!;
    expect(p.runs).toBeDefined();
    expect(p.runs!.length).toBe(3);
    expect(p.runs![1]!.bold).toBe(true);
    expect(p.text).toBe('');
  });

  it('clear_runs recovers plain text from the runs array', () => {
    const drafts = new Map<string, DraftParagraph[]>([
      [
        'sec_a',
        [
          {
            role: 'body',
            text: '',
            runs: [
              { text: 'Hello ', bold: true },
              { text: 'world.' },
            ],
          },
        ],
      ],
    ]);
    const ops: StyleFixOp[] = [
      { kind: 'clear_runs', section_id: 'sec_a', paragraph_index: 0 },
    ];
    const { updated } = applyStyleFixOps(drafts, ops);
    const p = updated.get('sec_a')![0]!;
    expect(p.runs).toBeUndefined();
    expect(p.text).toBe('Hello world.');
  });

  it('set_text replaces text and drops any runs (markdown stripping)', () => {
    const drafts = new Map<string, DraftParagraph[]>([
      [
        'sec_a',
        [
          {
            role: 'body',
            text: '**bold leak** then normal',
            runs: [{ text: '**bold leak** then normal' }],
          },
        ],
      ],
    ]);
    const ops: StyleFixOp[] = [
      {
        kind: 'set_text',
        section_id: 'sec_a',
        paragraph_index: 0,
        text: 'bold leak then normal',
      },
    ];
    const { updated } = applyStyleFixOps(drafts, ops);
    const p = updated.get('sec_a')![0]!;
    expect(p.text).toBe('bold leak then normal');
    expect(p.runs).toBeUndefined();
  });

  it('set_table_header marks a row as a header', () => {
    const drafts = makeDraftMap();
    const ops: StyleFixOp[] = [
      { kind: 'set_table_header', section_id: 'sec_b', paragraph_index: 0, is_header: true },
    ];
    const { updated, applied } = applyStyleFixOps(drafts, ops);
    expect(applied.length).toBe(1);
    expect(updated.get('sec_b')![0]!.is_header).toBe(true);
  });

  it('set_table_header is a no-op when target is not a table_row', () => {
    const drafts = makeDraftMap();
    const ops: StyleFixOp[] = [
      { kind: 'set_table_header', section_id: 'sec_a', paragraph_index: 0, is_header: true },
    ];
    const { applied } = applyStyleFixOps(drafts, ops);
    // Applied at "applied" time means: did we mutate? The applier
    // returns null for mismatched-role targets, so applied is empty.
    expect(applied.length).toBe(0);
  });

  it('pad_table_row pads a short row with empty cells', () => {
    const drafts = makeDraftMap();
    const ops: StyleFixOp[] = [
      { kind: 'pad_table_row', section_id: 'sec_b', paragraph_index: 2, target_cell_count: 2 },
    ];
    const { updated, applied } = applyStyleFixOps(drafts, ops);
    expect(applied.length).toBe(1);
    const row = updated.get('sec_b')![2]!;
    expect(row.cells).toEqual(['COR', '']);
  });

  it('set_cell rewrites a single cell and pads to reach the index', () => {
    const drafts = makeDraftMap();
    const ops: StyleFixOp[] = [
      {
        kind: 'set_cell',
        section_id: 'sec_b',
        paragraph_index: 2,
        cell_index: 1,
        cell_text: 'Monitor',
      },
    ];
    const { updated, applied } = applyStyleFixOps(drafts, ops);
    expect(applied.length).toBe(1);
    expect(updated.get('sec_b')![2]!.cells).toEqual(['COR', 'Monitor']);
  });

  it('set_level updates the level field', () => {
    const drafts = makeDraftMap();
    const ops: StyleFixOp[] = [
      { kind: 'set_level', section_id: 'sec_a', paragraph_index: 0, level: 1 },
    ];
    const { updated } = applyStyleFixOps(drafts, ops);
    expect(updated.get('sec_a')![0]!.level).toBe(1);
  });

  it('set_page_break_before toggles the flag', () => {
    const drafts = makeDraftMap();
    const ops: StyleFixOp[] = [
      {
        kind: 'set_page_break_before',
        section_id: 'sec_a',
        paragraph_index: 0,
        page_break_before: true,
      },
    ];
    const { updated } = applyStyleFixOps(drafts, ops);
    expect(updated.get('sec_a')![0]!.page_break_before).toBe(true);
  });

  it('delete_paragraph in descending order keeps earlier indices valid', () => {
    const drafts = makeDraftMap();
    // Delete index 3 (empty) and index 2 (the one we'd otherwise
    // re-classify). Issue them in input order; the applier must apply
    // in DESCENDING index order so 2 still points to the right thing.
    const ops: StyleFixOp[] = [
      { kind: 'delete_paragraph', section_id: 'sec_a', paragraph_index: 2 },
      { kind: 'delete_paragraph', section_id: 'sec_a', paragraph_index: 3 },
    ];
    const { updated, applied } = applyStyleFixOps(drafts, ops);
    expect(applied.length).toBe(2);
    const sec = updated.get('sec_a')!;
    expect(sec.length).toBe(3);
    expect(sec.map((p) => p.text)).toEqual([
      'Background',
      'The contractor shall provide services.',
      'Final summary line.',
    ]);
  });

  it('delete + non-delete ops in the same section both apply correctly', () => {
    const drafts = makeDraftMap();
    const ops: StyleFixOp[] = [
      { kind: 'set_role', section_id: 'sec_a', paragraph_index: 2, role: 'bullet' },
      { kind: 'delete_paragraph', section_id: 'sec_a', paragraph_index: 3 },
    ];
    const { updated } = applyStyleFixOps(drafts, ops);
    const sec = updated.get('sec_a')!;
    expect(sec.length).toBe(4);
    // The role change must have landed on the original index 2
    // BEFORE the delete shifted things.
    const bulleted = sec.find((p) => p.text === 'Bullet point one')!;
    expect(bulleted.role).toBe('bullet');
  });

  it('out-of-range paragraph_index is silently dropped', () => {
    const drafts = makeDraftMap();
    const ops: StyleFixOp[] = [
      { kind: 'set_role', section_id: 'sec_a', paragraph_index: 99, role: 'heading' },
    ];
    const { updated, applied } = applyStyleFixOps(drafts, ops);
    expect(applied.length).toBe(0);
    expect(updated.get('sec_a')!.length).toBe(5);
  });

  it('unknown section_id is silently dropped', () => {
    const drafts = makeDraftMap();
    const ops: StyleFixOp[] = [
      { kind: 'set_role', section_id: 'sec_zzz', paragraph_index: 0, role: 'heading' },
    ];
    const { applied } = applyStyleFixOps(drafts, ops);
    expect(applied.length).toBe(0);
  });

  it('original draft map is never mutated', () => {
    const drafts = makeDraftMap();
    const before = JSON.stringify(Array.from(drafts.entries()));
    applyStyleFixOps(drafts, [
      { kind: 'set_role', section_id: 'sec_a', paragraph_index: 2, role: 'bullet' },
      { kind: 'delete_paragraph', section_id: 'sec_a', paragraph_index: 3 },
      { kind: 'set_table_header', section_id: 'sec_b', paragraph_index: 0, is_header: true },
    ]);
    const after = JSON.stringify(Array.from(drafts.entries()));
    expect(after).toBe(before);
  });

  it('set_role to the same role is a no-op', () => {
    const drafts = makeDraftMap();
    const { applied } = applyStyleFixOps(drafts, [
      { kind: 'set_role', section_id: 'sec_a', paragraph_index: 0, role: 'heading' },
    ]);
    expect(applied.length).toBe(0);
  });
});

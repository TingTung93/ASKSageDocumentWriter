import { describe, expect, it } from 'vitest';
import type { ProjectRecord } from '../../db/schema';
import type { DraftParagraph } from '../../draft/types';
import {
  createFreeformBlockSnapshot,
  findFreeformBlocks,
  replaceFreeformBlock,
} from './freeform-block';

const freeform: DraftParagraph[] = [
  { role: 'heading', level: 0, text: 'Overview' },
  { role: 'body', text: 'Overview body.' },
  { role: 'heading', level: 0, text: 'Recommendations' },
  { role: 'body', text: 'Recommendation body.' },
  { role: 'bullet', text: 'Act now.' },
];
const project = {
  id: 'project-1',
  name: 'Paper',
  description: '',
  mode: 'freeform',
  freeform_draft: freeform,
  template_ids: [],
  reference_dataset_names: [],
  shared_inputs: {},
  model_overrides: {},
  live_search: 0,
  created_at: 'now',
  updated_at: 'now',
} satisfies ProjectRecord;

describe('freeform block target', () => {
  it('identifies H1-bounded blocks and captures outline/adjacent context', async () => {
    expect(findFreeformBlocks(freeform)).toEqual([
      { headingIndex: 0, endIndex: 2 },
      { headingIndex: 2, endIndex: 5 },
    ]);
    const snapshot = await createFreeformBlockSnapshot({
      project,
      headingIndex: 2,
      targetVersionId: 'version-1',
    });
    expect(snapshot.block.map((paragraph) => paragraph.text)).toEqual([
      'Recommendations', 'Recommendation body.', 'Act now.',
    ]);
    expect(snapshot.outline).toEqual(['Overview', 'Recommendations']);
    expect(snapshot.adjacent.previous).toContain('Overview body.');
    expect(Object.isFrozen(snapshot.block)).toBe(true);
  });

  it('replaces only the selected block after index drift', async () => {
    const snapshot = await createFreeformBlockSnapshot({
      project,
      headingIndex: 2,
      targetVersionId: 'version-1',
    });
    const current: DraftParagraph[] = [
      { role: 'heading', level: 0, text: 'Preface' },
      { role: 'body', text: 'New.' },
      ...freeform,
    ];
    const result = await replaceFreeformBlock(current, snapshot, [
      { role: 'heading', level: 0, text: 'Recommendations' },
      { role: 'body', text: 'Revised recommendation.' },
    ]);
    expect(result.map((paragraph) => paragraph.text)).toEqual([
      'Preface', 'New.', 'Overview', 'Overview body.',
      'Recommendations', 'Revised recommendation.',
    ]);
  });

  it('rejects replacements that cross block boundaries', async () => {
    const snapshot = await createFreeformBlockSnapshot({
      project,
      headingIndex: 0,
      targetVersionId: 'version-1',
    });
    await expect(replaceFreeformBlock(freeform, snapshot, [
      { role: 'heading', level: 0, text: 'Overview' },
      { role: 'heading', level: 0, text: 'Unexpected Block' },
    ])).rejects.toThrow(/boundaries/i);
  });
});

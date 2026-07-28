import { describe, expect, it } from 'vitest';
import type { ProjectRecord } from '../../db/schema';
import type { DraftParagraph } from '../../draft/types';
import {
  createFreeformParagraphSnapshot,
  replaceFreeformParagraph,
} from './freeform-paragraph';

const paragraphs: DraftParagraph[] = [
  { role: 'heading', level: 0, text: 'Overview' },
  { role: 'body', text: 'First paragraph.' },
  { role: 'body', text: 'Selected paragraph.' },
  { role: 'heading', level: 0, text: 'Next' },
  { role: 'body', text: 'Next paragraph.' },
];
const project = {
  id: 'freeform-1',
  name: 'Paper',
  description: '',
  mode: 'freeform',
  freeform_draft: paragraphs,
  template_ids: [],
  reference_dataset_names: [],
  shared_inputs: {},
  model_overrides: {},
  live_search: 0,
  created_at: 'now',
  updated_at: 'now',
} satisfies ProjectRecord;

describe('freeform paragraph target', () => {
  it('captures stable paragraph and containing block identity', async () => {
    const snapshot = await createFreeformParagraphSnapshot({
      project,
      paragraphIndex: 2,
      targetVersionId: 'version-1',
    });
    expect(snapshot.target.anchor.indexHint).toBe(2);
    expect(snapshot.blockHeading).toBe('Overview');
    expect(snapshot.paragraph.text).toBe('Selected paragraph.');
  });

  it('rebases within the same block and replaces only the paragraph', async () => {
    const snapshot = await createFreeformParagraphSnapshot({
      project,
      paragraphIndex: 2,
      targetVersionId: 'version-1',
    });
    const current = [
      { role: 'body', text: 'Inserted before document.' } as DraftParagraph,
      ...paragraphs,
    ];
    const result = await replaceFreeformParagraph(current, snapshot, {
      role: 'body',
      text: 'Revised paragraph.',
    });
    expect(result[3]?.text).toBe('Revised paragraph.');
    expect(result[4]?.text).toBe('Next');
  });

  it('rejects a paragraph that moved to another H1 block', async () => {
    const snapshot = await createFreeformParagraphSnapshot({
      project,
      paragraphIndex: 2,
      targetVersionId: 'version-1',
    });
    const moved = [
      { role: 'heading', level: 0, text: 'Overview' } as DraftParagraph,
      { role: 'body', text: 'First paragraph.' } as DraftParagraph,
      { role: 'heading', level: 0, text: 'Next' } as DraftParagraph,
      { role: 'body', text: 'Selected paragraph.' } as DraftParagraph,
      { role: 'body', text: 'Next paragraph.' } as DraftParagraph,
    ];
    await expect(replaceFreeformParagraph(moved, snapshot, {
      role: 'body',
      text: 'Revised.',
    })).rejects.toThrow();
  });
});

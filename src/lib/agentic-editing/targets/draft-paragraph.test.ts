import { describe, expect, it } from 'vitest';
import type { DraftParagraph } from '../../draft/types';
import {
  createStableParagraphAnchor,
  resolveStableParagraphAnchor,
  StaleParagraphTargetError,
} from './draft-paragraph';

const paragraphs: DraftParagraph[] = [
  { role: 'body', text: 'Before.' },
  { role: 'bullet', text: 'Selected.', level: 1 },
  { role: 'body', text: 'After.' },
];

describe('stable paragraph identity', () => {
  it('uses the index only as a hint and deterministically rebases after insertion', async () => {
    const anchor = await createStableParagraphAnchor(paragraphs, 1, 'version-1');
    const shifted = [{ role: 'body', text: 'Inserted.' } as DraftParagraph, ...paragraphs];
    await expect(resolveStableParagraphAnchor(shifted, anchor)).resolves.toBe(2);
    expect(anchor).toMatchObject({
      targetVersionId: 'version-1',
      indexHint: 1,
      role: 'bullet',
    });
  });

  it('rejects ambiguous duplicate paragraphs when surrounding anchors do not disambiguate', async () => {
    const duplicate: DraftParagraph[] = [
      { role: 'body', text: 'Same.' },
    ];
    const anchor = await createStableParagraphAnchor(duplicate, 0, 'version-1');
    const moved: DraftParagraph[] = [
      { role: 'body', text: 'Other.' },
      { role: 'body', text: 'Same.' },
      { role: 'body', text: 'Same.' },
    ];
    await expect(resolveStableParagraphAnchor(moved, anchor))
      .rejects.toBeInstanceOf(StaleParagraphTargetError);
  });

  it('rejects changed content as stale', async () => {
    const anchor = await createStableParagraphAnchor(paragraphs, 1, 'version-1');
    const changed = paragraphs.map((paragraph, index) =>
      index === 1 ? { ...paragraph, text: 'Changed elsewhere.' } : paragraph);
    await expect(resolveStableParagraphAnchor(changed, anchor))
      .rejects.toBeInstanceOf(StaleParagraphTargetError);
  });
});

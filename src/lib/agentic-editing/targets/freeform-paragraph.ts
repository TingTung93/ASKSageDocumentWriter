import type { ProjectRecord } from '../../db/schema';
import type { DraftParagraph } from '../../draft/types';
import { sha256 } from '../artifacts';
import {
  createStableParagraphAnchor,
  replaceAnchoredParagraph,
  resolveStableParagraphAnchor,
  type StableParagraphAnchor,
} from './draft-paragraph';
import { findFreeformBlocks } from './freeform-block';

export interface FreeformParagraphSnapshot {
  target: {
    kind: 'freeform_paragraph';
    projectId: string;
    blockHeadingHash: string;
    anchor: StableParagraphAnchor;
  };
  paragraph: DraftParagraph;
  blockHeading: string;
  baseHash: string;
}

export async function createFreeformParagraphSnapshot(input: {
  project: ProjectRecord;
  paragraphIndex: number;
  targetVersionId: string;
}): Promise<Readonly<FreeformParagraphSnapshot>> {
  const paragraphs = input.project.freeform_draft;
  if ((input.project.mode ?? 'template') !== 'freeform' || !paragraphs?.length) {
    throw new Error('Project does not contain a freeform draft.');
  }
  const block = findFreeformBlocks(paragraphs)
    .find((range) =>
      input.paragraphIndex >= range.headingIndex && input.paragraphIndex < range.endIndex);
  if (!block) throw new Error('Paragraph is not inside an H1-bounded freeform block.');
  const heading = paragraphs[block.headingIndex]!;
  const withoutHash: Omit<FreeformParagraphSnapshot, 'baseHash'> = {
    target: {
      kind: 'freeform_paragraph',
      projectId: input.project.id,
      blockHeadingHash: await sha256(heading.text),
      anchor: await createStableParagraphAnchor(
        paragraphs,
        input.paragraphIndex,
        input.targetVersionId,
      ),
    },
    paragraph: clone(paragraphs[input.paragraphIndex]!),
    blockHeading: heading.text,
  };
  return deepFreeze({
    ...withoutHash,
    baseHash: await sha256(JSON.stringify(withoutHash)),
  });
}

export async function replaceFreeformParagraph(
  paragraphs: DraftParagraph[],
  snapshot: FreeformParagraphSnapshot,
  replacement: DraftParagraph,
): Promise<DraftParagraph[]> {
  const index = await resolveStableParagraphAnchor(paragraphs, snapshot.target.anchor);
  const block = findFreeformBlocks(paragraphs)
    .find((range) => index >= range.headingIndex && index < range.endIndex);
  if (!block ||
      await sha256(paragraphs[block.headingIndex]!.text) !== snapshot.target.blockHeadingHash) {
    throw new Error('Freeform paragraph moved outside its original block.');
  }
  if (replacement.role === 'heading' && (replacement.level ?? 0) === 0 &&
      index !== block.headingIndex) {
    throw new Error('Paragraph replacement cannot create a new top-level block boundary.');
  }
  return replaceAnchoredParagraph(
    paragraphs,
    {
      target: {
        kind: 'template_paragraph',
        projectId: snapshot.target.projectId,
        templateId: 'freeform',
        sectionId: snapshot.blockHeading,
        anchor: snapshot.target.anchor,
      },
      paragraph: snapshot.paragraph,
      neighbors: {},
      permittedRoles: [],
      baseHash: snapshot.baseHash,
    },
    replacement,
  );
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  }
  return value;
}

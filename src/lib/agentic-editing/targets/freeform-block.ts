import type { ProjectRecord } from '../../db/schema';
import type { DraftParagraph } from '../../draft/types';
import { sha256 } from '../artifacts';

export interface FreeformBlockRange {
  headingIndex: number;
  endIndex: number;
}

export interface FreeformBlockSnapshot {
  target: {
    kind: 'freeform_block';
    projectId: string;
    targetVersionId: string;
    headingHash: string;
    headingIndexHint: number;
  };
  block: DraftParagraph[];
  outline: string[];
  adjacent: {
    previous?: string;
    next?: string;
  };
  baseHash: string;
}

export function findFreeformBlocks(paragraphs: DraftParagraph[]): FreeformBlockRange[] {
  const headings = paragraphs.flatMap((paragraph, index) =>
    isTopLevelHeading(paragraph) ? [index] : []);
  return headings.map((headingIndex, position) => ({
    headingIndex,
    endIndex: headings[position + 1] ?? paragraphs.length,
  }));
}

export async function createFreeformBlockSnapshot(input: {
  project: ProjectRecord;
  headingIndex: number;
  targetVersionId: string;
}): Promise<Readonly<FreeformBlockSnapshot>> {
  const paragraphs = requireFreeformDraft(input.project);
  const range = findFreeformBlocks(paragraphs)
    .find((candidate) => candidate.headingIndex === input.headingIndex);
  if (!range) throw new Error('Freeform block must begin at a top-level heading.');
  const heading = paragraphs[range.headingIndex]!;
  const ranges = findFreeformBlocks(paragraphs);
  const position = ranges.findIndex((candidate) => candidate.headingIndex === range.headingIndex);
  const withoutHash: Omit<FreeformBlockSnapshot, 'baseHash'> = {
    target: {
      kind: 'freeform_block',
      projectId: input.project.id,
      targetVersionId: requireVersion(input.targetVersionId),
      headingHash: await sha256(heading.text),
      headingIndexHint: range.headingIndex,
    },
    block: clone(paragraphs.slice(range.headingIndex, range.endIndex)),
    outline: ranges.map((candidate) => paragraphs[candidate.headingIndex]!.text),
    adjacent: {
      ...(position > 0
        ? { previous: summarize(paragraphs.slice(ranges[position - 1]!.headingIndex, range.headingIndex)) }
        : {}),
      ...(ranges[position + 1]
        ? { next: summarize(paragraphs.slice(ranges[position + 1]!.headingIndex, ranges[position + 2]?.headingIndex)) }
        : {}),
    },
  };
  return deepFreeze({
    ...withoutHash,
    baseHash: await sha256(JSON.stringify(withoutHash)),
  });
}

export async function replaceFreeformBlock(
  paragraphs: DraftParagraph[],
  snapshot: FreeformBlockSnapshot,
  replacement: DraftParagraph[],
): Promise<DraftParagraph[]> {
  validateBlock(replacement);
  const range = await resolveBlock(paragraphs, snapshot);
  return [
    ...clone(paragraphs.slice(0, range.headingIndex)),
    ...clone(replacement),
    ...clone(paragraphs.slice(range.endIndex)),
  ];
}

export async function resolveBlock(
  paragraphs: DraftParagraph[],
  snapshot: FreeformBlockSnapshot,
): Promise<FreeformBlockRange> {
  const candidates: FreeformBlockRange[] = [];
  for (const range of findFreeformBlocks(paragraphs)) {
    if (await sha256(paragraphs[range.headingIndex]!.text) === snapshot.target.headingHash) {
      candidates.push(range);
    }
  }
  if (candidates.length !== 1) throw new Error('Freeform block target is stale or ambiguous.');
  return candidates[0]!;
}

function validateBlock(paragraphs: DraftParagraph[]): void {
  if (!paragraphs.length || !isTopLevelHeading(paragraphs[0]!)) {
    throw new Error('Freeform block replacement must begin with one top-level heading.');
  }
  if (paragraphs.slice(1).some(isTopLevelHeading)) {
    throw new Error('Freeform block replacement cannot cross top-level heading boundaries.');
  }
  if (paragraphs.every((paragraph) => !paragraph.text.trim())) {
    throw new Error('Freeform block replacement cannot be empty.');
  }
}

function isTopLevelHeading(paragraph: DraftParagraph): boolean {
  return paragraph.role === 'heading' && (paragraph.level ?? 0) === 0;
}

function requireFreeformDraft(project: ProjectRecord): DraftParagraph[] {
  if ((project.mode ?? 'template') !== 'freeform' || !project.freeform_draft?.length) {
    throw new Error('Project does not contain a freeform draft.');
  }
  return project.freeform_draft;
}

function requireVersion(value: string): string {
  if (!value.trim()) throw new Error('Target version ID is required.');
  return value;
}

function summarize(paragraphs: DraftParagraph[]): string {
  return paragraphs.map((paragraph) => paragraph.text).join(' ').slice(0, 240);
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

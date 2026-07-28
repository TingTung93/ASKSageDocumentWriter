import type { DraftParagraph } from '../../draft/types';
import { sha256 } from '../artifacts';
import type { TemplateSectionSnapshot } from './template-section';

export interface StableParagraphAnchor {
  targetVersionId: string;
  indexHint: number;
  role: DraftParagraph['role'];
  contentHash: string;
  previousHash?: string;
  nextHash?: string;
}

export interface TemplateParagraphSnapshot {
  target: {
    kind: 'template_paragraph';
    projectId: string;
    templateId: string;
    sectionId: string;
    anchor: StableParagraphAnchor;
  };
  paragraph: DraftParagraph;
  neighbors: {
    previous?: DraftParagraph;
    next?: DraftParagraph;
  };
  permittedRoles: string[];
  baseHash: string;
}

export class StaleParagraphTargetError extends Error {
  constructor(message = 'Paragraph target is stale or no longer uniquely identifiable.') {
    super(message);
    this.name = 'StaleParagraphTargetError';
  }
}

export async function createStableParagraphAnchor(
  paragraphs: DraftParagraph[],
  index: number,
  targetVersionId: string,
): Promise<StableParagraphAnchor> {
  const paragraph = paragraphs[index];
  if (!paragraph) throw new Error(`Paragraph index ${index} is out of range.`);
  if (!targetVersionId.trim()) throw new Error('Target version ID is required.');
  return {
    targetVersionId,
    indexHint: index,
    role: paragraph.role,
    contentHash: await paragraphHash(paragraph),
    ...(paragraphs[index - 1] ? { previousHash: await paragraphHash(paragraphs[index - 1]!) } : {}),
    ...(paragraphs[index + 1] ? { nextHash: await paragraphHash(paragraphs[index + 1]!) } : {}),
  };
}

export async function resolveStableParagraphAnchor(
  paragraphs: DraftParagraph[],
  anchor: StableParagraphAnchor,
): Promise<number> {
  const hinted = paragraphs[anchor.indexHint];
  if (hinted && await matchesParagraph(hinted, anchor)) return anchor.indexHint;

  const candidates: number[] = [];
  for (let index = 0; index < paragraphs.length; index += 1) {
    if (!await matchesParagraph(paragraphs[index]!, anchor)) continue;
    if (anchor.previousHash && (!paragraphs[index - 1] ||
        await paragraphHash(paragraphs[index - 1]!) !== anchor.previousHash)) continue;
    if (anchor.nextHash && (!paragraphs[index + 1] ||
        await paragraphHash(paragraphs[index + 1]!) !== anchor.nextHash)) continue;
    candidates.push(index);
  }
  if (candidates.length !== 1) throw new StaleParagraphTargetError();
  return candidates[0]!;
}

export async function createTemplateParagraphSnapshot(input: {
  section: TemplateSectionSnapshot;
  paragraphIndex: number;
  targetVersionId: string;
}): Promise<Readonly<TemplateParagraphSnapshot>> {
  const paragraphs = input.section.draft.paragraphs;
  const anchor = await createStableParagraphAnchor(
    paragraphs,
    input.paragraphIndex,
    input.targetVersionId,
  );
  const paragraph = clone(paragraphs[input.paragraphIndex]!);
  const withoutHash: Omit<TemplateParagraphSnapshot, 'baseHash'> = {
    target: {
      kind: 'template_paragraph',
      projectId: input.section.target.projectId,
      templateId: input.section.target.templateId,
      sectionId: input.section.target.sectionId,
      anchor,
    },
    paragraph,
    neighbors: {
      ...(paragraphs[input.paragraphIndex - 1]
        ? { previous: clone(paragraphs[input.paragraphIndex - 1]!) }
        : {}),
      ...(paragraphs[input.paragraphIndex + 1]
        ? { next: clone(paragraphs[input.paragraphIndex + 1]!) }
        : {}),
    },
    permittedRoles: [...input.section.section.permittedRoles],
  };
  return deepFreeze({
    ...withoutHash,
    baseHash: await sha256(JSON.stringify(withoutHash)),
  });
}

export async function replaceAnchoredParagraph(
  paragraphs: DraftParagraph[],
  snapshot: TemplateParagraphSnapshot,
  replacement: DraftParagraph,
): Promise<DraftParagraph[]> {
  validateReplacement(replacement, snapshot.permittedRoles);
  const index = await resolveStableParagraphAnchor(paragraphs, snapshot.target.anchor);
  return paragraphs.map((paragraph, current) =>
    current === index ? clone(replacement) : clone(paragraph));
}

function validateReplacement(paragraph: DraftParagraph, permittedRoles: string[]): void {
  if (!paragraphText(paragraph).trim()) throw new Error('Paragraph replacement cannot be empty.');
  if (permittedRoles.length && !permittedRoles.includes(paragraph.role)) {
    throw new Error(`Paragraph role "${paragraph.role}" is not permitted by the target.`);
  }
  if (paragraph.level !== undefined &&
      (!Number.isInteger(paragraph.level) || paragraph.level < 0 || paragraph.level > 8)) {
    throw new Error('Paragraph nesting level must be an integer from 0 through 8.');
  }
}

async function matchesParagraph(
  paragraph: DraftParagraph,
  anchor: StableParagraphAnchor,
): Promise<boolean> {
  return paragraph.role === anchor.role && await paragraphHash(paragraph) === anchor.contentHash;
}

async function paragraphHash(paragraph: DraftParagraph): Promise<string> {
  return sha256(JSON.stringify(canonicalParagraph(paragraph)));
}

function canonicalParagraph(paragraph: DraftParagraph): DraftParagraph {
  return JSON.parse(JSON.stringify(paragraph)) as DraftParagraph;
}

function paragraphText(paragraph: DraftParagraph): string {
  if (paragraph.runs?.length) return paragraph.runs.map((run) => run.text).join('');
  if (paragraph.role === 'table_row') return (paragraph.cells ?? []).join(' ');
  return paragraph.text;
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

import type { DraftParagraph, ParagraphRole } from '../draft/types';
import { scanDraftForPlaceholders } from '../draft/placeholders';
import { applyDraftEdits } from '../edit/dispatcher';
import type { DraftEditOp } from '../edit/types';
import type { TemplateSectionSnapshot } from './targets/template-section';

const ROLES = new Set<ParagraphRole>([
  'heading', 'body', 'step', 'bullet', 'note', 'caution', 'warning',
  'definition', 'table_row', 'quote',
]);
const SOURCE_MARKER = /\[Source:\s*([^\]\r\n]+)\]/gi;

export interface TemplateSectionProposal {
  target: TemplateSectionSnapshot['target'];
  baseHash: string;
  operations: DraftEditOp[];
}

export interface TemplateSectionValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
  result?: DraftParagraph[];
  appliedOperationIndexes: number[];
}

export function validateTemplateSectionProposal(
  snapshot: TemplateSectionSnapshot,
  proposal: TemplateSectionProposal,
): TemplateSectionValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!sameTarget(snapshot.target, proposal.target)) {
    errors.push('Proposal target does not match the selected template section.');
  }
  if (proposal.baseHash !== snapshot.baseHash) {
    errors.push('Proposal base snapshot is stale.');
  }
  if (!Array.isArray(proposal.operations) || proposal.operations.length === 0) {
    errors.push('Proposal contains no draft operations.');
  }

  proposal.operations.forEach((operation, index) => {
    if (operation.template_id !== snapshot.target.templateId ||
        operation.section_id !== snapshot.target.sectionId) {
      errors.push(`Operation ${index} targets a different template section.`);
    }
    validateOperation(operation, index, snapshot, errors);
  });

  if (errors.length) return { ok: false, errors, warnings, appliedOperationIndexes: [] };
  const applied = applyDraftEdits(
    { edits: proposal.operations },
    {
      get: (templateId, sectionId) =>
        templateId === snapshot.target.templateId && sectionId === snapshot.target.sectionId
          ? snapshot.draft.paragraphs
          : undefined,
    },
  );
  const statuses = applied.applied;
  statuses.forEach((status, index) => {
    if (!status.success) errors.push(`Operation ${index} could not be applied: ${status.error}`);
  });
  const result = applied.updated.get(
    `${snapshot.target.templateId}::${snapshot.target.sectionId}`,
  );
  if (!result) errors.push('Proposal did not produce a section result.');
  else validateResult(snapshot, result, errors, warnings);

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    ...(result ? { result } : {}),
    appliedOperationIndexes: statuses.flatMap((status, index) => status.success ? [index] : []),
  };
}

function validateOperation(
  operation: DraftEditOp,
  index: number,
  snapshot: TemplateSectionSnapshot,
  errors: string[],
): void {
  switch (operation.op) {
    case 'replace_paragraph':
      if (!operation.text.trim()) errors.push(`Operation ${index} has an empty replacement.`);
      if (operation.role) validateRole(operation.role, index, snapshot, errors);
      break;
    case 'insert_paragraph':
      if (!operation.text.trim()) errors.push(`Operation ${index} inserts an empty paragraph.`);
      validateRole(operation.role, index, snapshot, errors);
      break;
    case 'delete_paragraph':
      break;
    case 'replace_text_in_section':
      if (!operation.find) errors.push(`Operation ${index} has an empty find value.`);
      if (!operation.replace.trim() && operation.find.trim()) {
        errors.push(`Operation ${index} performs an empty destructive replacement.`);
      }
      break;
    default: {
      const unreachable: never = operation;
      errors.push(`Operation ${index} is not permitted: ${JSON.stringify(unreachable)}`);
    }
  }
}

function validateRole(
  role: ParagraphRole,
  index: number,
  snapshot: TemplateSectionSnapshot,
  errors: string[],
): void {
  if (!ROLES.has(role)) errors.push(`Operation ${index} has an invalid paragraph role.`);
  const permitted = snapshot.section.permittedRoles;
  if (permitted.length && !permitted.includes(role)) {
    errors.push(`Operation ${index} uses role "${role}", which is not permitted by the template.`);
  }
}

function validateResult(
  snapshot: TemplateSectionSnapshot,
  result: DraftParagraph[],
  errors: string[],
  warnings: string[],
): void {
  if (result.length === 0 || result.every((paragraph) => !paragraphText(paragraph).trim())) {
    errors.push('Proposal would leave the required section empty.');
  }
  for (const [index, paragraph] of result.entries()) {
    if (!ROLES.has(paragraph.role)) errors.push(`Paragraph ${index} has an invalid role.`);
    if (paragraph.level !== undefined &&
        (!Number.isInteger(paragraph.level) || paragraph.level < 0 || paragraph.level > 8)) {
      errors.push(`Paragraph ${index} has an invalid nesting level.`);
    }
    validateCitationMarkers(paragraphText(paragraph), index, errors);
  }

  const previous = placeholderCounts(snapshot.draft.paragraphs);
  const next = placeholderCounts(result);
  for (const [placeholder, count] of next) {
    if (count > (previous.get(placeholder) ?? 0)) {
      errors.push(`Proposal introduces unresolved placeholder "${placeholder}".`);
    }
  }
  const target = snapshot.section.targetWords;
  if (target) {
    const words = result.reduce((sum, paragraph) => sum + wordCount(paragraphText(paragraph)), 0);
    if (words < target[0] || words > target[1]) {
      warnings.push(`Section contains ${words} words; template target is ${target[0]}–${target[1]}.`);
    }
  }
}

function validateCitationMarkers(text: string, index: number, errors: string[]): void {
  const openers = text.match(/\[Source:/gi)?.length ?? 0;
  const valid = [...text.matchAll(SOURCE_MARKER)].filter((match) => match[1]!.trim()).length;
  if (openers !== valid) errors.push(`Paragraph ${index} contains malformed citation syntax.`);
}

function placeholderCounts(paragraphs: DraftParagraph[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of scanDraftForPlaceholders(paragraphs)) {
    const key = item.raw.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function paragraphText(paragraph: DraftParagraph): string {
  if (paragraph.role === 'table_row') return (paragraph.cells ?? []).join(' ');
  if (paragraph.runs?.length) return paragraph.runs.map((run) => run.text).join('');
  return paragraph.text;
}

function wordCount(value: string): number {
  return value.trim() ? value.trim().split(/\s+/).length : 0;
}

function sameTarget(
  left: TemplateSectionSnapshot['target'],
  right: TemplateSectionSnapshot['target'],
): boolean {
  return left.kind === right.kind &&
    left.projectId === right.projectId &&
    left.templateId === right.templateId &&
    left.sectionId === right.sectionId;
}

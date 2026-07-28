export interface TemplateSectionSelection {
  kind: 'template_section';
  projectId: string;
  templateId: string;
  sectionId: string;
  label?: string;
}

export interface TemplateParagraphSelection extends Omit<TemplateSectionSelection, 'kind'> {
  kind: 'template_paragraph';
  paragraphId: string;
  indexHint?: number;
}

export interface FreeformBlockSelection {
  kind: 'freeform_block';
  projectId: string;
  blockId: string;
  label?: string;
}

export interface FreeformParagraphSelection extends Omit<FreeformBlockSelection, 'kind'> {
  kind: 'freeform_paragraph';
  paragraphId: string;
  indexHint?: number;
}

export type DraftSelection =
  | TemplateSectionSelection
  | TemplateParagraphSelection
  | FreeformBlockSelection
  | FreeformParagraphSelection;

export interface DraftSelectionScope {
  projectId: string;
  templates: ReadonlyArray<{
    id: string;
    sectionIds: readonly string[];
    paragraphIds?: readonly string[];
  }>;
  freeformBlockIds?: readonly string[];
  freeformParagraphIds?: readonly string[];
}

export type DraftSelectionValidation =
  | { valid: true; selection: DraftSelection }
  | {
      valid: false;
      reason: 'malformed' | 'wrong_project' | 'missing_template' | 'missing_section';
    };

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function normalizeDraftSelection(value: unknown): DraftSelection | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  if (
    !nonEmptyString(candidate.projectId)
  ) {
    return null;
  }
  const common = {
    projectId: candidate.projectId.trim(),
    ...(nonEmptyString(candidate.label) ? { label: candidate.label.trim() } : {}),
  };

  if (
    (candidate.kind === 'template_section' || candidate.kind === 'template_paragraph')
    && nonEmptyString(candidate.templateId)
    && nonEmptyString(candidate.sectionId)
  ) {
    if (candidate.kind === 'template_paragraph' && !nonEmptyString(candidate.paragraphId)) return null;
    return {
      kind: candidate.kind,
      ...common,
      templateId: candidate.templateId.trim(),
      sectionId: candidate.sectionId.trim(),
      ...(candidate.kind === 'template_paragraph'
        ? {
            paragraphId: (candidate.paragraphId as string).trim(),
            ...(Number.isInteger(candidate.indexHint) ? { indexHint: candidate.indexHint as number } : {}),
          }
        : {}),
    } as DraftSelection;
  }
  if (
    (candidate.kind === 'freeform_block' || candidate.kind === 'freeform_paragraph')
    && nonEmptyString(candidate.blockId)
  ) {
    if (candidate.kind === 'freeform_paragraph' && !nonEmptyString(candidate.paragraphId)) return null;
    return {
      kind: candidate.kind,
      ...common,
      blockId: candidate.blockId.trim(),
      ...(candidate.kind === 'freeform_paragraph'
        ? {
            paragraphId: (candidate.paragraphId as string).trim(),
            ...(Number.isInteger(candidate.indexHint) ? { indexHint: candidate.indexHint as number } : {}),
          }
        : {}),
    } as DraftSelection;
  }
  return null;
}

export function validateDraftSelection(
  value: unknown,
  scope: DraftSelectionScope,
): DraftSelectionValidation {
  const selection = normalizeDraftSelection(value);
  if (!selection) return { valid: false, reason: 'malformed' };
  if (selection.projectId !== scope.projectId) {
    return { valid: false, reason: 'wrong_project' };
  }
  if (selection.kind === 'template_section' || selection.kind === 'template_paragraph') {
    const template = scope.templates.find(({ id }) => id === selection.templateId);
    if (!template) return { valid: false, reason: 'missing_template' };
    if (!template.sectionIds.includes(selection.sectionId)) {
      return { valid: false, reason: 'missing_section' };
    }
    if (
      selection.kind === 'template_paragraph' &&
      template.paragraphIds &&
      !template.paragraphIds.includes(selection.paragraphId)
    ) return { valid: false, reason: 'missing_section' };
  } else if (
    !scope.freeformBlockIds?.includes(selection.blockId) ||
    (
      selection.kind === 'freeform_paragraph' &&
      scope.freeformParagraphIds &&
      !scope.freeformParagraphIds.includes(selection.paragraphId)
    )
  ) {
    return { valid: false, reason: 'missing_section' };
  }
  return { valid: true, selection };
}

export function templateParagraphSelection(
  projectId: string,
  templateId: string,
  sectionId: string,
  paragraphId: string,
  indexHint?: number,
): TemplateParagraphSelection {
  return normalizeDraftSelection({
    kind: 'template_paragraph', projectId, templateId, sectionId, paragraphId, indexHint,
  }) as TemplateParagraphSelection;
}

export function freeformBlockSelection(
  projectId: string,
  blockId: string,
  label?: string,
): FreeformBlockSelection {
  return normalizeDraftSelection({
    kind: 'freeform_block', projectId, blockId, label,
  }) as FreeformBlockSelection;
}

export function freeformParagraphSelection(
  projectId: string,
  blockId: string,
  paragraphId: string,
  indexHint?: number,
): FreeformParagraphSelection {
  return normalizeDraftSelection({
    kind: 'freeform_paragraph', projectId, blockId, paragraphId, indexHint,
  }) as FreeformParagraphSelection;
}

export function isDraftSelectionValid(
  value: unknown,
  scope: DraftSelectionScope,
): value is DraftSelection {
  return validateDraftSelection(value, scope).valid;
}

export function templateSectionSelection(
  projectId: string,
  templateId: string,
  sectionId: string,
  label?: string,
): TemplateSectionSelection {
  const selection = normalizeDraftSelection({
    kind: 'template_section',
    projectId,
    templateId,
    sectionId,
    label,
  });
  if (!selection) throw new Error('Template section selection requires non-empty ids');
  return selection as TemplateSectionSelection;
}

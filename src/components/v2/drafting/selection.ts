export interface TemplateSectionSelection {
  kind: 'template_section';
  projectId: string;
  templateId: string;
  sectionId: string;
  label?: string;
}

/**
 * The shared target union. Later phases add paragraph and freeform variants
 * here without changing selection consumers.
 */
export type DraftSelection = TemplateSectionSelection;

export interface DraftSelectionScope {
  projectId: string;
  templates: ReadonlyArray<{
    id: string;
    sectionIds: readonly string[];
  }>;
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
    candidate.kind !== 'template_section'
    || !nonEmptyString(candidate.projectId)
    || !nonEmptyString(candidate.templateId)
    || !nonEmptyString(candidate.sectionId)
  ) {
    return null;
  }

  return {
    kind: 'template_section',
    projectId: candidate.projectId.trim(),
    templateId: candidate.templateId.trim(),
    sectionId: candidate.sectionId.trim(),
    ...(nonEmptyString(candidate.label) ? { label: candidate.label.trim() } : {}),
  };
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
  const template = scope.templates.find(({ id }) => id === selection.templateId);
  if (!template) return { valid: false, reason: 'missing_template' };
  if (!template.sectionIds.includes(selection.sectionId)) {
    return { valid: false, reason: 'missing_section' };
  }
  return { valid: true, selection };
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
  return selection;
}

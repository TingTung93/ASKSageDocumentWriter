import { describe, expect, it } from 'vitest';
import {
  isDraftSelectionValid,
  normalizeDraftSelection,
  templateSectionSelection,
  validateDraftSelection,
  type DraftSelectionScope,
} from './selection';

const scope: DraftSelectionScope = {
  projectId: 'project-1',
  templates: [
    { id: 'template-1', sectionIds: ['scope', 'approach'] },
  ],
};

describe('draft selection', () => {
  it('normalizes a template section and trims identifiers', () => {
    expect(normalizeDraftSelection({
      kind: 'template_section',
      projectId: ' project-1 ',
      templateId: ' template-1 ',
      sectionId: ' scope ',
      label: ' Scope ',
    })).toEqual(templateSectionSelection(
      'project-1',
      'template-1',
      'scope',
      'Scope',
    ));
  });

  it('fails closed for malformed and future unknown selection kinds', () => {
    expect(normalizeDraftSelection(null)).toBeNull();
    expect(normalizeDraftSelection({
      kind: 'paragraph',
      projectId: 'project-1',
      templateId: 'template-1',
      sectionId: 'scope',
    })).toBeNull();
    expect(normalizeDraftSelection({
      kind: 'template_section',
      projectId: '',
      templateId: 'template-1',
      sectionId: 'scope',
    })).toBeNull();
  });

  it('validates project, template, and section identity', () => {
    const valid = templateSectionSelection('project-1', 'template-1', 'scope');
    expect(validateDraftSelection(valid, scope)).toEqual({ valid: true, selection: valid });
    expect(isDraftSelectionValid(valid, scope)).toBe(true);

    expect(validateDraftSelection(
      { ...valid, projectId: 'project-2' },
      scope,
    )).toEqual({ valid: false, reason: 'wrong_project' });
    expect(validateDraftSelection(
      { ...valid, templateId: 'missing' },
      scope,
    )).toEqual({ valid: false, reason: 'missing_template' });
    expect(validateDraftSelection(
      { ...valid, sectionId: 'missing' },
      scope,
    )).toEqual({ valid: false, reason: 'missing_section' });
  });
});

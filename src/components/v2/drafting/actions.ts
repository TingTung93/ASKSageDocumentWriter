import type { AcceptanceCriterion } from '../../../lib/agentic-editing/types';

export interface DraftAction {
  id: 'tighten' | 'expand' | 'clarify' | 'tone' | 'custom';
  label: string;
  instruction: string;
  criteria: AcceptanceCriterion[];
}

function criterion(
  id: string,
  description: string,
  kind: AcceptanceCriterion['kind'],
): AcceptanceCriterion {
  return { id, description, kind, required: true, source: 'system' };
}

export const DRAFT_ACTIONS: readonly DraftAction[] = [
  {
    id: 'tighten',
    label: 'Tighten',
    instruction: 'Make this section more concise without removing material facts or citations.',
    criteria: [criterion('preserve-facts', 'Preserve material facts and citations.', 'content')],
  },
  {
    id: 'expand',
    label: 'Expand',
    instruction: 'Add useful detail to this section using only information already present in the draft.',
    criteria: [criterion('no-new-claims', 'Do not invent unsupported claims.', 'grounding')],
  },
  {
    id: 'clarify',
    label: 'Clarify',
    instruction: 'Improve clarity and organization while preserving the section’s meaning.',
    criteria: [criterion('preserve-meaning', 'Preserve the original meaning.', 'content')],
  },
  {
    id: 'tone',
    label: 'Professional tone',
    instruction: 'Rewrite this section in a clear, professional tone without changing its substance.',
    criteria: [criterion('professional-tone', 'Use a clear professional tone.', 'style')],
  },
] as const;

export function actionById(id: DraftAction['id']): DraftAction | undefined {
  return DRAFT_ACTIONS.find((action) => action.id === id);
}

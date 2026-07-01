import type { ParagraphInfo } from '../template/parser';
import type { DocumentEditOp } from './types';

export type HighLevelEditPlan = {
  kind: 'apply_role_style';
  paragraph_index: number;
  role: 'heading' | 'body' | 'quote' | 'bullet' | 'step';
  rationale?: string;
};

export type EditPlanDiagnostic = {
  severity: 'error';
  code: 'paragraph_not_found' | 'style_not_available';
  message: string;
};

export interface LoweredEditPlan {
  ops: DocumentEditOp[];
  diagnostics: EditPlanDiagnostic[];
}

const ROLE_STYLE_CANDIDATES: Record<HighLevelEditPlan['role'], string[]> = {
  heading: ['Heading1', 'Heading 1'],
  body: ['BodyText', 'Body Text', 'Normal'],
  quote: ['Quote', 'IntenseQuote', 'Normal'],
  bullet: ['ListBullet', 'List Bullet', 'ListParagraph', 'Normal'],
  step: ['ListNumber', 'List Number', 'ListParagraph', 'Normal'],
};

export function lowerEditPlan(
  plans: HighLevelEditPlan[],
  paragraphs: ParagraphInfo[],
  availableParagraphStyleIds: Set<string>,
): LoweredEditPlan {
  const ops: DocumentEditOp[] = [];
  const diagnostics: EditPlanDiagnostic[] = [];
  const paragraphsByIndex = new Map(paragraphs.map((paragraph) => [paragraph.index, paragraph]));

  for (const plan of plans) {
    if (!paragraphsByIndex.has(plan.paragraph_index)) {
      diagnostics.push({
        severity: 'error',
        code: 'paragraph_not_found',
        message: `Paragraph index ${plan.paragraph_index} was not found.`,
      });
      continue;
    }

    const styleId = ROLE_STYLE_CANDIDATES[plan.role].find((candidate) =>
      availableParagraphStyleIds.has(candidate),
    );
    if (!styleId) {
      diagnostics.push({
        severity: 'error',
        code: 'style_not_available',
        message: `No available paragraph style for ${plan.role} role.`,
      });
      continue;
    }

    ops.push({
      op: 'set_paragraph_style',
      index: plan.paragraph_index,
      style_id: styleId,
      rationale: plan.rationale ?? `Apply ${plan.role} style.`,
    });
  }

  return { ops, diagnostics };
}

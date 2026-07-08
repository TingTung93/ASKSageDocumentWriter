import type { ParagraphInfo } from '../template/parser';
import type { DocumentEditOp } from './types';

export type PlannedParagraphRole = 'heading' | 'body' | 'quote' | 'bullet' | 'step';

export type HighLevelEditPlan = {
  kind: 'apply_role_style';
  paragraph_index: number;
  role: PlannedParagraphRole;
  rationale?: string;
} | {
  kind: 'complete_paragraph_revision';
  paragraph_index: number;
  new_text: string;
  rationale?: string;
} | {
  kind: 'insert_missing_content';
  after_paragraph_index: number;
  new_text: string;
  style_id?: string;
  rationale?: string;
} | {
  kind: 'delete_paragraph';
  paragraph_index: number;
  rationale?: string;
} | {
  kind: 'merge_paragraphs';
  paragraph_index: number;
  separator?: string;
  rationale?: string;
} | {
  kind: 'split_paragraph';
  paragraph_index: number;
  split_at_text: string;
  rationale?: string;
};

export type EditPlanDiagnostic = {
  severity: 'error';
  code:
    | 'paragraph_not_found'
    | 'style_not_available'
    | 'invalid_text'
    | 'split_text_not_found';
  message: string;
};

export interface LoweredEditPlan {
  ops: DocumentEditOp[];
  diagnostics: EditPlanDiagnostic[];
}

const ROLE_STYLE_CANDIDATES: Record<PlannedParagraphRole, string[]> = {
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
    const paragraphIndex = targetParagraphIndex(plan);
    const paragraph = paragraphsByIndex.get(paragraphIndex);
    if (!paragraph) {
      diagnostics.push({
        severity: 'error',
        code: 'paragraph_not_found',
        message: `Paragraph index ${paragraphIndex} was not found.`,
      });
      continue;
    }

    switch (plan.kind) {
      case 'apply_role_style': {
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
        break;
      }
      case 'complete_paragraph_revision': {
        const newText = plan.new_text.trim();
        if (!newText) {
          diagnostics.push({
            severity: 'error',
            code: 'invalid_text',
            message: `Replacement text for paragraph index ${plan.paragraph_index} is empty.`,
          });
          continue;
        }
        ops.push({
          op: 'replace_paragraph_text',
          index: plan.paragraph_index,
          new_text: newText,
          rationale: plan.rationale ?? 'Apply complete paragraph revision.',
        });
        break;
      }
      case 'insert_missing_content': {
        const newText = plan.new_text.trim();
        if (!newText) {
          diagnostics.push({
            severity: 'error',
            code: 'invalid_text',
            message: `Inserted text after paragraph index ${plan.after_paragraph_index} is empty.`,
          });
          continue;
        }
        ops.push({
          op: 'insert_paragraph_after',
          index: plan.after_paragraph_index,
          new_text: newText,
          style_id: plan.style_id,
          rationale: plan.rationale ?? 'Insert missing content.',
        });
        break;
      }
      case 'delete_paragraph': {
        ops.push({
          op: 'delete_paragraph',
          index: plan.paragraph_index,
          rationale: plan.rationale ?? 'Delete paragraph.',
        });
        break;
      }
      case 'merge_paragraphs': {
        ops.push({
          op: 'merge_paragraphs',
          index: plan.paragraph_index,
          separator: plan.separator,
          rationale: plan.rationale ?? 'Merge adjacent paragraphs.',
        });
        break;
      }
      case 'split_paragraph': {
        const splitAtText = plan.split_at_text.trim();
        if (!splitAtText) {
          diagnostics.push({
            severity: 'error',
            code: 'invalid_text',
            message: `Split marker for paragraph index ${plan.paragraph_index} is empty.`,
          });
          continue;
        }
        if (!paragraph.text.includes(splitAtText)) {
          diagnostics.push({
            severity: 'error',
            code: 'split_text_not_found',
            message: `Split marker was not found in paragraph index ${plan.paragraph_index}.`,
          });
          continue;
        }
        ops.push({
          op: 'split_paragraph',
          index: plan.paragraph_index,
          split_at_text: splitAtText,
          rationale: plan.rationale ?? 'Split paragraph.',
        });
        break;
      }
    }
  }

  return { ops, diagnostics };
}

function targetParagraphIndex(plan: HighLevelEditPlan): number {
  return plan.kind === 'insert_missing_content'
    ? plan.after_paragraph_index
    : plan.paragraph_index;
}

import type { LLMClient } from '../provider/types';
import type { ProjectRecord, TemplateRecord, DraftRecord } from '../db/schema';
import type { BodyFillRegion } from '../template/types';
import type { AppSettings } from '../settings/types';
import type { DraftParagraph, PriorSectionSummary } from './types';
import { draftSection, summarizeDraft } from './drafter';
import { critiqueDraft, formatRevisionNotes } from './critique';
import { getContextItems, renderNotesBlock } from '../project/context';

export interface DraftAndValidateSectionArgs {
  client: LLMClient;
  project: ProjectRecord;
  template: TemplateRecord;
  section: BodyFillRegion;
  allDrafts: DraftRecord[];
  settings: AppSettings;
  /** When present, the critic finding that triggered this re-draft. */
  finding?: string;
  existingPromptSent?: string;
}

export interface DraftAndValidateSectionResult {
  paragraphs: DraftParagraph[];
  validation_issues: string[];
  prompt_sent: string;
  tokens_in: number;
  tokens_out: number;
}

/**
 * Run one "re-draft + critique" pass for a single section. Mirrors the
 * inline flow that used to live in V2DraftPane.handleFix. Returns the
 * validated paragraphs plus fields the caller needs to persist on the
 * DraftRecord.
 */
export async function draftAndValidateSection(
  args: DraftAndValidateSectionArgs,
): Promise<DraftAndValidateSectionResult> {
  const { client, project, template, section, allDrafts, settings, finding, existingPromptSent } = args;

  const contextItems = getContextItems(project);
  const notesBlock = renderNotesBlock(contextItems);
  // The attached-references block was baked into the original prompt at
  // draft time; slicing it back out lets the revision see the same refs
  // without another /server/file round-trip.
  const referencesBlock =
    existingPromptSent?.match(/=== ATTACHED REFERENCES ===[\s\S]*?=== END ATTACHED REFERENCES ===/)?.[0] ?? null;

  const priorSummaries: PriorSectionSummary[] = [];
  for (const depId of section.depends_on ?? []) {
    const depDraft = allDrafts.find((d) => d.section_id === depId);
    if (depDraft) {
      priorSummaries.push({
        section_id: depId,
        name: section.name,
        summary: summarizeDraft(depDraft.paragraphs, undefined),
      });
    }
  }

  const revisionNotes = finding
    ? formatRevisionNotes([{ severity: 'medium', category: 'other', message: finding }])
    : null;

  const draftingModelOverride = settings.models.drafting ?? undefined;

  const result = await draftSection(client, {
    template: template.schema_json,
    section,
    project_description: project.description,
    shared_inputs: project.shared_inputs,
    prior_summaries: priorSummaries,
    notes_block: notesBlock,
    references_block: referencesBlock,
    revision_notes_block: revisionNotes,
    options: {
      model: draftingModelOverride,
    },
  });

  const criticResult = await critiqueDraft(client, {
    template: template.schema_json,
    section,
    draft: result.paragraphs,
    project_description: project.description,
    references_block: referencesBlock,
    template_example: null,
    prior_summaries: priorSummaries,
    model: settings.models.critic ?? undefined,
  });

  return {
    paragraphs: result.paragraphs,
    validation_issues: criticResult.issues.map((i) => i.message),
    prompt_sent: result.prompt_sent,
    tokens_in: result.tokens_in + criticResult.tokens_in,
    tokens_out: result.tokens_out + criticResult.tokens_out,
  };
}

// draftProject — orchestrates drafting every section across every
// template in a project. Walks each template's sections in dependency
// order so a section that depends_on another is drafted only after its
// dependency is ready. Persists each drafted section to Dexie as it
// completes so a refresh mid-run doesn't lose work.

import type { AskSageClient } from '../asksage/client';
import { db, type DraftRecord, type ProjectRecord, type TemplateRecord } from '../db/schema';
import type { BodyFillRegion } from '../template/types';
import { draftSection, summarizeDraft } from './drafter';
import type { DraftingOptions, PriorSectionSummary } from './types';
import { getContextItems, renderContextBlock } from '../project/context';

export interface DraftProjectCallbacks {
  onSectionStart?: (template: TemplateRecord, section: BodyFillRegion) => void;
  onSectionComplete?: (
    template: TemplateRecord,
    section: BodyFillRegion,
    draft: DraftRecord,
  ) => void;
  onSectionError?: (template: TemplateRecord, section: BodyFillRegion, err: Error) => void;
  onProjectComplete?: () => void;
}

export interface DraftProjectArgs {
  project: ProjectRecord;
  templates: TemplateRecord[];
  options?: DraftingOptions;
  callbacks?: DraftProjectCallbacks;
}

/**
 * Topological sort of sections by `depends_on`. Sections with circular
 * deps fall back to original order at the position of the first one
 * involved in the cycle.
 */
function orderSectionsByDependencies(sections: BodyFillRegion[]): BodyFillRegion[] {
  const byId = new Map(sections.map((s) => [s.id, s]));
  const visited = new Set<string>();
  const inProgress = new Set<string>();
  const out: BodyFillRegion[] = [];

  function visit(s: BodyFillRegion) {
    if (visited.has(s.id)) return;
    if (inProgress.has(s.id)) return; // cycle — break
    inProgress.add(s.id);
    for (const depId of s.depends_on ?? []) {
      const dep = byId.get(depId);
      if (dep) visit(dep);
    }
    inProgress.delete(s.id);
    visited.add(s.id);
    out.push(s);
  }

  // Visit in original order to preserve stable ordering for sections
  // with no dependencies between them.
  for (const s of sections) visit(s);
  return out;
}

function draftId(projectId: string, templateId: string, sectionId: string): string {
  return `${projectId}::${templateId}::${sectionId}`;
}

export async function draftProject(
  client: AskSageClient,
  args: DraftProjectArgs,
): Promise<void> {
  const { project, templates, options, callbacks } = args;

  // Render the project's chat notes + attached file extracts ONCE for
  // the whole run. The same block gets injected into every per-section
  // drafting prompt — no point re-rendering it 30 times.
  const contextBlock = renderContextBlock(getContextItems(project));

  for (const template of templates) {
    const ordered = orderSectionsByDependencies(template.schema_json.sections);
    const priorSummaries: PriorSectionSummary[] = [];
    const summariesById = new Map<string, PriorSectionSummary>();

    for (const section of ordered) {
      callbacks?.onSectionStart?.(template, section);

      // Mark pending in DB
      const id = draftId(project.id, template.id, section.id);
      const pendingRecord: DraftRecord = {
        id,
        project_id: project.id,
        template_id: template.id,
        section_id: section.id,
        paragraphs: [],
        references: '',
        status: 'drafting',
        generated_at: new Date().toISOString(),
        model: options?.model ?? 'google-claude-46-sonnet',
        tokens_in: 0,
        tokens_out: 0,
      };
      await db.drafts.put(pendingRecord);

      // Pull only the prior summaries this section depends_on (or, if
      // depends_on is empty, send all prior summaries from the same
      // template — they're cheap and give the LLM a sense of arc).
      const relevant =
        section.depends_on && section.depends_on.length > 0
          ? section.depends_on
              .map((id) => summariesById.get(id))
              .filter((s): s is PriorSectionSummary => !!s)
          : priorSummaries.slice(-6);

      // Dataset resolution priority:
      //   1. explicit per-call override in options
      //   2. project's owned dataset (where attached files were trained)
      //   3. first manually-typed reference dataset
      //   4. 'none'
      const resolvedDataset =
        options?.dataset ??
        project.dataset_name ??
        project.reference_dataset_names[0] ??
        'none';

      try {
        const result = await draftSection(client, {
          template: template.schema_json,
          section,
          project_description: project.description,
          shared_inputs: project.shared_inputs,
          prior_summaries: relevant,
          context_block: contextBlock,
          options: {
            ...options,
            dataset: resolvedDataset,
            // Project-level live search applies to every section unless
            // an explicit per-call override was passed in options.
            live: options?.live ?? project.live_search ?? 0,
          },
        });

        const summary = summarizeDraft(
          result.paragraphs,
          // The LLM's self_summary lives in the raw response — drafter
          // doesn't return it directly. Pull from the first paragraph
          // as a fallback for now; future iteration can plumb it through.
          undefined,
        );
        const ps: PriorSectionSummary = {
          section_id: section.id,
          name: section.name,
          summary,
        };
        priorSummaries.push(ps);
        summariesById.set(section.id, ps);

        const ready: DraftRecord = {
          ...pendingRecord,
          paragraphs: result.paragraphs,
          references: result.references,
          status: 'ready',
          generated_at: new Date().toISOString(),
          model: result.model,
          tokens_in: result.tokens_in,
          tokens_out: result.tokens_out,
        };
        await db.drafts.put(ready);
        callbacks?.onSectionComplete?.(template, section, ready);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const errorRecord: DraftRecord = {
          ...pendingRecord,
          status: 'error',
          error: message,
        };
        await db.drafts.put(errorRecord);
        callbacks?.onSectionError?.(
          template,
          section,
          err instanceof Error ? err : new Error(message),
        );
        // Continue with the next section — partial success is better
        // than aborting the whole project.
      }
    }
  }

  callbacks?.onProjectComplete?.();
}

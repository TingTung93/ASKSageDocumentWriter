// draftProject — orchestrates drafting every section across every
// template in a project. Walks each template's sections in dependency
// order so a section that depends_on another is drafted only after its
// dependency is ready. Persists each drafted section to Dexie as it
// completes so a refresh mid-run doesn't lose work.

import { type LLMClient, canEmbed } from '../provider/types';
import { type UsageByModel, emptyUsage, mergeUsage, recordUsage } from '../usage';
import { extractReferencesForRun } from './file_extract';
import {
  db,
  type DraftRecord,
  type ProjectContextFile,
  type ProjectRecord,
  type TemplateRecord,
} from '../db/schema';
import type { BodyFillRegion } from '../template/types';
import { draftSection, summarizeDraft } from './drafter';
import { draftDocumentPart } from './draftDocumentPart';
import type { DraftingOptions, PriorSectionSummary } from './types';
import { getContextItems, renderNotesBlock } from '../project/context';
import {
  renderSelectedChunks,
  selectChunksForSection,
} from '../project/chunk';
import { extractParagraphs, type ParagraphInfo } from '../template/parser';
import { sliceTemplateExampleForSection } from './template_slice';
import { classifySectionSize } from './section_size';
import {
  indexMappings,
  lookupMapping,
  type SectionMapping,
} from '../agent/section_mapping';
import { runDraftWithCriticLoop } from './critique';
import {
  runCrossSectionReview,
  type CrossSectionResult,
  type DraftedSectionInput,
} from './cross_section';
import { loadSettings } from '../settings/store';

export interface DraftProjectCallbacks {
  onSectionStart?: (template: TemplateRecord, section: BodyFillRegion) => void;
  onSectionComplete?: (
    template: TemplateRecord,
    section: BodyFillRegion,
    draft: DraftRecord,
  ) => void;
  onSectionError?: (template: TemplateRecord, section: BodyFillRegion, err: Error) => void;
  onProjectComplete?: () => void;
  /** Called when an attached reference file is being uploaded for extraction. */
  onReferenceExtractStart?: (file: ProjectContextFile) => void;
  /** Called when extraction completes (success or failure). */
  onReferenceExtractDone?: (file: ProjectContextFile, chars: number, error?: string) => void;
  /** Called once after every section has converged, before the cross-section review pass. */
  onCrossSectionStart?: (sectionCount: number) => void;
  /** Called when the cross-section review completes. */
  onCrossSectionComplete?: (result: CrossSectionResult) => void;
}

export interface DraftProjectArgs {
  project: ProjectRecord;
  templates: TemplateRecord[];
  options?: DraftingOptions;
  callbacks?: DraftProjectCallbacks;
  /**
   * Reference→section mappings produced by the recipe's
   * map-references-to-sections stage. When supplied, the orchestrator:
   *   - looks up each section's mapping to pick preferred chunks
   *   - uses the mapping's estimated_content_words to size the section
   *     (so a content-rich source can override a bare-bones template)
   *   - passes the drafting_strategy through to the prompt builder
   * When omitted, the orchestrator falls back to template-only sizing
   * and lets the Jaccard heuristic pick chunks (the legacy path).
   */
  section_mappings?: SectionMapping[];
}

export interface DraftProjectResult {
  /** Sections that completed (status='ready') in the per-section loop. */
  sections_drafted: number;
  /** Sections that errored or were skipped (e.g. inline_metadata). */
  sections_errored: number;
  /** Aggregate token usage across every per-section call in this run. */
  tokens_in: number;
  tokens_out: number;
  /**
   * Per-model usage breakdown for the whole drafting pass — includes
   * the per-section drafter, every critic-loop iteration (which may
   * use a different model than the drafter via settings.critic.critic_model),
   * and the optional cross-section review pass at the end.
   */
  usage_by_model: UsageByModel;
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
  client: LLMClient,
  args: DraftProjectArgs,
): Promise<DraftProjectResult> {
  const { project, templates, options, callbacks, section_mappings } = args;
  // Per-run aggregates that get returned to the recipe runner so it
  // can report accurate token totals in the run history. The legacy
  // void return type silently dropped these and made the recipe
  // history report ~0 tokens for runs that actually consumed tens of
  // thousands.
  let runTokensIn = 0;
  let runTokensOut = 0;
  let sectionsDrafted = 0;
  let sectionsErrored = 0;
  // Per-model usage rolled up across every drafter + critic + cross-
  // section call in this run. The critic loop tracks its own
  // per-model breakdown internally (drafts vs critiques may run on
  // different models); we just merge each loop's result into the
  // run total here.
  const usage_by_model: UsageByModel = emptyUsage();

  // Index the mappings by (template_id, section_id) for O(1) lookup
  // inside the per-section loop. When no mapping was supplied this is
  // an empty index — every lookup returns undefined and downstream
  // code falls back to template-only behavior.
  const mappingIndex = section_mappings ? indexMappings(section_mappings) : undefined;

  // ─── Pre-flight 1: extract attached reference files ──────────────
  // Routes through extractReferencesForRun, which picks the right
  // extraction path based on client.capabilities.fileUpload:
  //   - Ask Sage  → /server/file (server-side; supports PDF/RTF/etc.)
  //   - OpenRouter → in-browser DOCX + plain-text extractor
  // Either way the result is cached on the file record so re-runs are
  // a no-op. Files we can't extract degrade to filename-only context
  // (the per-section prompt still has SUBJECT + SHARED INPUTS to work
  // from); the run is never aborted by an extraction failure.
  const items = getContextItems(project);
  const files = items.filter((i): i is ProjectContextFile => i.kind === 'file');
  const { extractedById } = await extractReferencesForRun({
    client,
    project,
    files,
    onStart: (f) => callbacks?.onReferenceExtractStart?.(f),
    onDone: (f, chars, err) => callbacks?.onReferenceExtractDone?.(f, chars, err),
  });

  // Notes are global to the run (cheap, high-signal).
  const notesBlock = renderNotesBlock(items);

  // Read critic settings ONCE for the run. Disabled by default unless
  // settings.critic.enabled is true. Single-pass behavior preserved
  // when disabled (max_iterations: 0 in the loop runner short-circuits).
  const settings = await loadSettings();
  const criticEnabled = settings.critic?.enabled ?? false;
  const criticMaxIterations = criticEnabled ? settings.critic?.max_iterations ?? 2 : 0;
  const criticStrictness = settings.critic?.strictness ?? 'moderate';
  const criticModel = settings.critic?.critic_model ?? settings.models.critic ?? undefined;

  // Accumulate drafted section inputs for the post-loop cross-section
  // review pass. Each successful section is appended.
  const draftedSectionInputs: DraftedSectionInput[] = [];

  // Compute total chunk pool size once for the references-block header.
  // Used by every section's render call so the header reads "X of Y
  // chunks selected" consistently.
  const totalChunkCount = files.reduce((acc, f) => {
    if (f.chunks && f.chunks.length > 0) return acc + f.chunks.length;
    // Estimate naive chunk count from extracted text length.
    const text = extractedById.get(f.id) ?? '';
    return acc + Math.max(1, Math.ceil(text.length / 5_000));
  }, 0);

  // ─── Pre-flight 3: batch-embed section queries ────────────────────
  // When the provider supports embeddings, vectorize every section's
  // scoring query (name + intent) in a single API call. The resulting
  // map is keyed by section id so the per-section selection call can
  // pass its query embedding for cosine-similarity scoring. This runs
  // once per draft run — re-drafts re-embed (cheap, ~15 short strings)
  // because section queries may have changed.
  const sectionQueryEmbeddings = new Map<string, number[]>();
  if (canEmbed(client)) {
    // Collect all sections across all templates (deduplicate by id in
    // case multiple templates share section ids — unlikely but safe).
    const allSections: Array<{ id: string; query: string }> = [];
    const seenIds = new Set<string>();
    for (const t of templates) {
      const schema = t.schema_json;
      for (const s of schema.sections ?? []) {
        if (seenIds.has(s.id)) continue;
        seenIds.add(s.id);
        allSections.push({
          id: s.id,
          query: `${s.name} ${s.intent ?? ''}`.trim(),
        });
      }
    }
    if (allSections.length > 0) {
      try {
        const { embeddings, tokens } = await client.embed(
          allSections.map((s) => s.query),
        );
        for (let i = 0; i < allSections.length; i++) {
          sectionQueryEmbeddings.set(allSections[i]!.id, embeddings[i]!);
        }
        recordUsage(usage_by_model, 'openai/text-embedding-3-small', {
          tokens_in: tokens,
          tokens_out: 0,
        });
      } catch {
        // Embedding failure is non-fatal — selection falls back to
        // Jaccard. Log but don't abort the run.
      }
    }
  }

  for (const template of templates) {
    // ─── Pre-flight 2: parse the template DOCX once per template ───
    // Used to slice per-section example text from the actual source.
    let templateParagraphs: ParagraphInfo[] = [];
    try {
      templateParagraphs = await extractParagraphs(template.docx_bytes);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[draftProject] couldn't re-parse template ${template.id} for example text — sections will draft without TEMPLATE EXAMPLE blocks:`,
        err,
      );
    }

    const ordered = orderSectionsByDependencies(template.schema_json.sections);
    const priorSummaries: PriorSectionSummary[] = [];
    const summariesById = new Map<string, PriorSectionSummary>();

    for (const section of ordered) {
      const id = draftId(project.id, template.id, section.id);

      // Slice the template example and look up the mapping FIRST so
      // we can classify size before touching Dexie. The order matters:
      // if we wrote a 'drafting' stub up here and THEN classified, we
      // would clobber whatever the metadata batch already persisted
      // for this section (a ready row OR a more diagnostic error).
      const templateExample = sliceTemplateExampleForSection(templateParagraphs, section);
      const mapping = lookupMapping(mappingIndex, template.id, section.id);
      const sizeClass = classifySectionSize({
        section,
        template_example: templateExample,
        mapping,
      });

      // inline_metadata sections are owned by the metadata batch
      // stage, which runs BEFORE this loop. We never want to draft
      // them here — but we also must not write ANY DB row for them,
      // since that would overwrite the batch's output. Just skip the
      // iteration entirely. If the metadata batch never ran (e.g. a
      // resume after a partial failure), the section's row will be
      // missing and the assembly stage will mark it skipped — which
      // is the correct degraded behavior for a stage that didn't run.
      if (sizeClass === 'inline_metadata') {
        sectionsErrored += 0; // intentional no-op for clarity
        continue;
      }

      callbacks?.onSectionStart?.(template, section);

      // Mark pending in DB. Only after we've decided this section is
      // actually going to be drafted by the per-section path.
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

      // ── document_part (letterhead) branch ──
      // Headers and footers are drafted per-slot, not per-paragraph.
      // We skip the whole body-draft apparatus (prior summaries,
      // reference chunks, critic loop, cross-section review): letterhead
      // text is a narrow slot fill driven by the project's subject +
      // shared inputs. Store the result on DraftRecord.slots and move
      // on. The assembler picks the slots path when present.
      if (section.fill_region.kind === 'document_part') {
        try {
          const dpDraft = await draftDocumentPart(
            client,
            {
              template: template.schema_json,
              section: section as typeof section & {
                fill_region: typeof section.fill_region & { kind: 'document_part' };
              },
              project_description: project.description,
              shared_inputs: project.shared_inputs,
            },
            { model: options?.model },
          );
          const ready: DraftRecord = {
            ...pendingRecord,
            paragraphs: [],
            slots: dpDraft.slots,
            status: 'ready',
            generated_at: new Date().toISOString(),
          };
          await db.drafts.put(ready);
          sectionsDrafted += 1;
          callbacks?.onSectionComplete?.(template, section, ready);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const errorRecord: DraftRecord = {
            ...pendingRecord,
            status: 'error',
            error: message,
          };
          await db.drafts.put(errorRecord);
          sectionsErrored += 1;
          callbacks?.onSectionError?.(
            template,
            section,
            err instanceof Error ? err : new Error(message),
          );
        }
        continue;
      }

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
      //   2. first manually-typed reference dataset (curated on Datasets tab)
      //   3. 'none'
      // The legacy project.dataset_name (train-into-dataset auto-provision)
      // was dropped in v5 in favor of inlining attached files directly
      // into the prompt.
      const resolvedDataset =
        options?.dataset ?? project.reference_dataset_names[0] ?? 'none';

      // Build the per-section ATTACHED REFERENCES block. The mapper's
      // matched chunks (when present) get seated FIRST regardless of
      // their Jaccard score; remaining slots are filled by the local
      // heuristic. Size class controls both char budget and chunk count.
      const selectedChunks = selectChunksForSection({
        files,
        extractedById,
        section,
        template_example: templateExample,
        size_class: sizeClass,
        preferred_chunk_ids: mapping?.matched_chunk_ids,
        query_embedding: sectionQueryEmbeddings.get(section.id),
      });
      const referencesBlock = renderSelectedChunks(selectedChunks, totalChunkCount);
      const referencesInlinedChars = referencesBlock?.length ?? 0;
      const referencesInlinedChunks = selectedChunks.length;
      const referencesInlinedChunkIds = selectedChunks.map((c) => c.chunk_id);

      try {
        // Phase 3: wrap the section call in the critic loop. The
        // closure captures the per-section context so the loop can
        // re-invoke draftSection with revision notes inlined into
        // the prompt. When max_iterations is 0 the loop short-circuits
        // to a single-pass behavior identical to the legacy flow.
        const baseDraftArgs = {
          template: template.schema_json,
          section,
          project_description: project.description,
          shared_inputs: project.shared_inputs,
          prior_summaries: relevant,
          notes_block: notesBlock,
          references_block: referencesBlock,
          template_example: templateExample,
          drafting_strategy: mapping?.drafting_strategy ?? null,
          effective_word_target: mapping?.estimated_content_words ?? null,
          options: {
            ...options,
            dataset: resolvedDataset,
            live: options?.live ?? project.live_search ?? 0,
          },
        };

        const loopResult = await runDraftWithCriticLoop({
          client,
          draftFn: async (revisionNotes) => {
            const r = await draftSection(client, {
              ...baseDraftArgs,
              revision_notes_block: revisionNotes,
            });
            return {
              paragraphs: r.paragraphs,
              prompt_sent: r.prompt_sent,
              references: r.references,
              tokens_in: r.tokens_in,
              tokens_out: r.tokens_out,
              model: r.model,
            };
          },
          template: template.schema_json,
          section,
          project_description: project.description,
          references_block: referencesBlock,
          template_example: templateExample,
          prior_summaries: relevant,
          max_iterations: criticMaxIterations,
          strictness: criticStrictness,
          model: criticModel,
        });

        const summary = summarizeDraft(loopResult.paragraphs, undefined);
        const ps: PriorSectionSummary = {
          section_id: section.id,
          name: section.name,
          summary,
        };
        priorSummaries.push(ps);
        summariesById.set(section.id, ps);

        const ready: DraftRecord = {
          ...pendingRecord,
          paragraphs: loopResult.paragraphs,
          references: loopResult.references,
          prompt_sent: loopResult.prompt_sent,
          status: 'ready',
          generated_at: new Date().toISOString(),
          model: loopResult.model,
          tokens_in: loopResult.total_tokens_in,
          tokens_out: loopResult.total_tokens_out,
          critic_iterations: loopResult.iterations,
          critic_converged: loopResult.converged,
          critic_strictness: criticEnabled ? criticStrictness : undefined,
          references_inlined_chars: referencesInlinedChars,
          references_inlined_chunks: referencesInlinedChunks,
          references_inlined_chunk_ids: referencesInlinedChunkIds,
        };
        await db.drafts.put(ready);
        runTokensIn += loopResult.total_tokens_in;
        runTokensOut += loopResult.total_tokens_out;
        mergeUsage(usage_by_model, loopResult.usage_by_model);
        sectionsDrafted += 1;

        // Stash for the post-loop cross-section review pass.
        draftedSectionInputs.push({
          template_id: template.id,
          template_name: template.name,
          section,
          paragraphs: loopResult.paragraphs,
        });

        callbacks?.onSectionComplete?.(template, section, ready);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const errorRecord: DraftRecord = {
          ...pendingRecord,
          status: 'error',
          error: message,
        };
        await db.drafts.put(errorRecord);
        sectionsErrored += 1;
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

  // Phase 4: cross-section review pass. One LLM call against the
  // assembled draft looking for contradictions, terminology drift,
  // and missing cross-references that span 2+ sections. The result
  // is surfaced to the UI via the onCrossSectionComplete callback;
  // we do NOT auto-fix — humans review.
  if (draftedSectionInputs.length >= 2) {
    callbacks?.onCrossSectionStart?.(draftedSectionInputs.length);
    try {
      const xResult = await runCrossSectionReview({
        client,
        project_description: project.description,
        templates: templates.map((t) => t.schema_json),
        sections: draftedSectionInputs,
      });
      runTokensIn += xResult.tokens_in ?? 0;
      runTokensOut += xResult.tokens_out ?? 0;
      mergeUsage(usage_by_model, xResult.usage_by_model);
      callbacks?.onCrossSectionComplete?.(xResult);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[draftProject] cross-section review failed:', err);
      // Non-fatal: the user still has per-section drafts.
    }
  }

  callbacks?.onProjectComplete?.();

  return {
    sections_drafted: sectionsDrafted,
    sections_errored: sectionsErrored,
    tokens_in: runTokensIn,
    tokens_out: runTokensOut,
    usage_by_model,
  };
}

// blobToFile + extractedTextFromRet were moved to lib/asksage/extract
// so the document cleanup pipeline can share them without depending
// on the drafting orchestrator. The section-level template example
// slice helper moved to ./template_slice so the metadata batch
// drafter can share it.


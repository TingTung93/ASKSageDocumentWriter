// draftProject — orchestrates drafting every section across every
// template in a project. Walks each template's sections in dependency
// order so a section that depends_on another is drafted only after its
// dependency is ready. Persists each drafted section to Dexie as it
// completes so a refresh mid-run doesn't lose work.

import type { AskSageClient } from '../asksage/client';
import {
  db,
  type DraftRecord,
  type ProjectContextFile,
  type ProjectRecord,
  type TemplateRecord,
} from '../db/schema';
import type { BodyFillRegion } from '../template/types';
import { draftSection, summarizeDraft } from './drafter';
import type { DraftingOptions, PriorSectionSummary } from './types';
import { getContextItems, renderNotesBlock } from '../project/context';
import {
  renderSelectedChunks,
  selectChunksForSection,
} from '../project/chunk';
import { extractParagraphs, type ParagraphInfo } from '../template/parser';
import { blobToFile, extractedTextFromRet } from '../asksage/extract';
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

  // ─── Pre-flight 1: extract attached reference files ──────────────
  // Each file goes to /server/file ONCE per run; the extracted text
  // is cached in memory and reused for every per-section call. This
  // is the inline-references path — the model literally sees the file
  // contents instead of relying on opaque RAG retrieval.
  const items = getContextItems(project);
  const files = items.filter((i): i is ProjectContextFile => i.kind === 'file');
  const extractedById = new Map<string, string>();
  for (const f of files) {
    callbacks?.onReferenceExtractStart?.(f);
    try {
      const fileObj = blobToFile(f.bytes, f.filename, f.mime_type);
      const upload = await client.uploadFile(fileObj);
      const text = extractedTextFromRet(upload.ret);
      extractedById.set(f.id, text);
      callbacks?.onReferenceExtractDone?.(f, text.length);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.error(`[draftProject] failed to extract ${f.filename}:`, err);
      callbacks?.onReferenceExtractDone?.(f, 0, msg);
      // Don't bail the whole run; the section just won't see this file.
    }
  }

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
      //   2. first manually-typed reference dataset (curated on Datasets tab)
      //   3. 'none'
      // The legacy project.dataset_name (train-into-dataset auto-provision)
      // was dropped in v5 in favor of inlining attached files directly
      // into the prompt.
      const resolvedDataset =
        options?.dataset ?? project.reference_dataset_names[0] ?? 'none';

      // Slice the template's actual paragraphs for THIS section using
      // the parser-recorded anchor range. This is the TEMPLATE EXAMPLE
      // block — gives the model structural anchoring without baking in
      // the template's example subject matter.
      const templateExample = sliceTemplateExample(templateParagraphs, section);

      // Build the per-section ATTACHED REFERENCES block. We score every
      // chunk in every reference file against this section's intent +
      // name + project subject, then greedy-select the top-N up to a
      // per-section character budget. Files that haven't been
      // semantically chunked are naive-chunked on the fly. This is
      // what makes a 60-page reference doc usable: each section sees
      // only the most relevant slices, not the whole thing.
      const selectedChunks = selectChunksForSection({
        files,
        extractedById,
        section,
        project_description: project.description,
      });
      const referencesBlock = renderSelectedChunks(selectedChunks, totalChunkCount);

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
        };
        await db.drafts.put(ready);

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
      callbacks?.onCrossSectionComplete?.(xResult);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[draftProject] cross-section review failed:', err);
      // Non-fatal: the user still has per-section drafts.
    }
  }

  callbacks?.onProjectComplete?.();
}

// ─── Helpers ──────────────────────────────────────────────────────

/** Per-section template example cap. ~6k chars ≈ ~1500 tokens. */
const TEMPLATE_EXAMPLE_CAP_CHARS = 6000;

// blobToFile + extractedTextFromRet were moved to lib/asksage/extract
// so the document cleanup pipeline can share them without depending
// on the drafting orchestrator.

/**
 * Slice the parsed template paragraphs for a single section using its
 * fill_region anchors. Returns the trimmed text joined with newlines,
 * or null if we can't determine the anchor range. Caps at
 * TEMPLATE_EXAMPLE_CAP_CHARS so a huge section doesn't blow the prompt.
 */
function sliceTemplateExample(
  paragraphs: ParagraphInfo[],
  section: BodyFillRegion,
): string | null {
  if (paragraphs.length === 0) return null;
  const fr = section.fill_region;
  if (fr.kind !== 'heading_bounded') {
    // content_control / bookmark / placeholder regions don't carry
    // paragraph anchors. We could widen to a heuristic but for v1
    // we just skip these — the section spec still has its name and
    // intent so the model isn't flying blind.
    return null;
  }
  // Anchor is the heading paragraph itself; body content starts the
  // paragraph after.
  const start = Math.max(0, fr.anchor_paragraph_index + 1);
  const end = Math.min(paragraphs.length - 1, fr.end_anchor_paragraph_index);
  if (end < start) return null;
  const slice = paragraphs.slice(start, end + 1);
  const text = slice
    .map((p) => p.text.trim())
    .filter((t) => t.length > 0)
    .join('\n');
  if (text.length === 0) return null;
  if (text.length <= TEMPLATE_EXAMPLE_CAP_CHARS) return text;
  return text.slice(0, TEMPLATE_EXAMPLE_CAP_CHARS - 1).trimEnd() + '…';
}


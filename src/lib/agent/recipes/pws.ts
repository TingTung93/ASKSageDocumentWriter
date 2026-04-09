// pws.ts — the "Build a PWS" recipe.
//
// Composes Phase 2 (pre-flight), Phase 3 (per-section critic loop via
// the drafting orchestrator), Phase 4 (cross-section review), and
// Phase 5a (DOCX assembly) into a deterministic sequence of stages the
// runner walks end-to-end.
//
// Subject-agnostic by construction: the recipe is a stage LIST, not a
// subject-matter expert. Every LLM call inside a stage ultimately goes
// through a subject-agnostic phase module. This recipe is named "PWS"
// purely because PWS is the most common output shape for DHA MTF
// contracting packets; the same stage sequence works for any section-
// oriented template and is reused as the base shape for future recipes
// (J&A, market research, SOPs).

import type { Recipe, RecipeStage, RecipeStageResult } from '../recipe';
import { runReadinessCheck, suggestTemplate, proposeSharedInputs } from '../preflight';
import { deriveSharedInputFields } from '../../project/helpers';
import { semanticChunkText } from '../../project/chunk';
import { getContextItems, renderNotesBlock } from '../../project/context';
import { draftProject } from '../../draft/orchestrator';
import { runMetadataBatch } from '../../draft/metadata_batch';
import { runCrossSectionReview, type DraftedSectionInput } from '../../draft/cross_section';
import {
  runStyleConsistencyReview,
  type StyleReviewSectionInput,
} from '../../draft/style_consistency';
import { loadSettings } from '../../settings/store';
import { assembleProjectDocx } from '../../export/assemble';
import { blobToFile, extractedTextFromRet } from '../../asksage/extract';
import { extractFileLocally, cacheExtractedText } from '../../project/local_extract';
import { type UsageByModel, mergeUsage } from '../../usage';
import {
  mapReferencesToSections,
  type SectionMapping,
} from '../section_mapping';
import {
  scanDraftForPlaceholders,
  type PlaceholderOccurrence,
} from '../../draft/placeholders';
import type { ProjectContextFile, TemplateRecord, DraftRecord } from '../../db/schema';
import { db } from '../../db/schema';

/** Stable id used by downstream stages to look up the mapping in ctx.state. */
const MAP_STAGE_ID = 'map-references-to-sections';

interface MapStageOutput {
  mappings: SectionMapping[];
  skipped: boolean;
}

/**
 * Pull the mapping list out of the recipe runner's state snapshot.
 * Returns undefined when the mapping stage hasn't run yet (resume
 * before the stage), failed, or returned a non-array shape — every
 * downstream consumer is required to fall back gracefully in that
 * case.
 */
function readMappingsFromState(state: Record<string, unknown>): SectionMapping[] | undefined {
  const out = state[MAP_STAGE_ID];
  if (!out || typeof out !== 'object') return undefined;
  const mappings = (out as MapStageOutput).mappings;
  if (!Array.isArray(mappings)) return undefined;
  return mappings;
}

// ─── Stage implementations ───────────────────────────────────────

/**
 * Stage 1 — pre-flight. Runs the readiness check and, if not ready,
 * returns `needs_intervention` so the runner pauses and the UI can
 * show the gap list. The user fixes gaps, then clicks "continue" and
 * the caller re-invokes the runner (or calls resumeRecipeRun if the
 * run was persisted).
 */
const preflightStage: RecipeStage = {
  id: 'preflight',
  name: 'Pre-flight readiness check',
  description:
    'Inspect the project subject, selected templates, and attached references for gaps before drafting starts.',
  required: true,
  intervention_point: true,
  async run(ctx): Promise<RecipeStageResult> {
    try {
      const items = getContextItems(ctx.project);
      const reference_files = items.filter(
        (i): i is ProjectContextFile => i.kind === 'file',
      );
      const notes_block = renderNotesBlock(items);
      const report = await runReadinessCheck(ctx.client, {
        project: ctx.project,
        templates: ctx.templates,
        reference_files,
        notes_block,
      });
      // Pause ONLY for truly blocking conditions: missing REQUIRED
      // shared inputs (deterministic, computed by the helper) or a
      // vague subject the model can't draft from. Action-list errors
      // (e.g. "no contracting officer name") used to block here too,
      // but the user's preference is to draft with [INSERT: ...]
      // placeholders rather than gate the run on every advisory the
      // LLM flagged. The downstream drafter and the metadata batch
      // both honor the placeholder convention so the user gets a
      // complete document with obvious gaps to fill in.
      const blocking =
        report.missing_shared_inputs.length > 0 || report.vague_subject;
      if (blocking) {
        return {
          kind: 'needs_intervention',
          reason:
            report.missing_shared_inputs.length > 0
              ? `Missing required inputs: ${report.missing_shared_inputs.join(', ')}`
              : 'Project subject is too vague to draft from.',
          output: report,
          tokens_in: report.tokens_in,
          tokens_out: report.tokens_out,
          usage_by_model: report.usage_by_model,
        };
      }
      return {
        kind: 'ok',
        output: report,
        tokens_in: report.tokens_in,
        tokens_out: report.tokens_out,
        usage_by_model: report.usage_by_model,
      };
    } catch (err) {
      return {
        kind: 'failed',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};

/**
 * Stage 2 — template selection. ONLY pauses for intervention if no
 * template is currently selected on the project. When a template is
 * already selected we skip straight through with `ok`.
 */
const templateSelectionStage: RecipeStage = {
  id: 'template-selection',
  name: 'Template selection',
  description: 'Suggest the best-matching template when the project has none selected.',
  required: true,
  // intervention_point is decided at runtime by the result kind below;
  // the static flag is set true so the runner honors a pause when one
  // is returned.
  intervention_point: true,
  async run(ctx): Promise<RecipeStageResult> {
    try {
      if (ctx.project.template_ids.length > 0) {
        return { kind: 'ok', output: { skipped: true, reason: 'template already selected' } };
      }
      const items = getContextItems(ctx.project);
      const reference_files = items.filter(
        (i): i is ProjectContextFile => i.kind === 'file',
      );
      const suggestion = await suggestTemplate(ctx.client, {
        project: ctx.project,
        templates: ctx.templates,
        reference_files,
      });
      if (!suggestion) {
        return {
          kind: 'failed',
          error: 'No templates available to suggest. Load a template before running the recipe.',
        };
      }
      return {
        kind: 'needs_intervention',
        reason: `Confirm template selection: ${suggestion.template_name}`,
        output: suggestion,
        tokens_in: suggestion.tokens_in,
        tokens_out: suggestion.tokens_out,
        usage_by_model: suggestion.usage_by_model,
      };
    } catch (err) {
      return {
        kind: 'failed',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};

/**
 * Stage 3 — auto-fill shared inputs. Proposes values for every missing
 * required field and writes them directly into the project record
 * tagged as 'preflight'. No intervention point in v1 — the integrator
 * may want to add an "apply or skip" gate later.
 */
const autoFillSharedInputsStage: RecipeStage = {
  id: 'auto-fill-shared-inputs',
  name: 'Auto-fill shared inputs',
  description: 'Propose and apply values for missing required shared inputs.',
  required: true,
  intervention_point: false,
  async run(ctx): Promise<RecipeStageResult> {
    try {
      const shared_fields = deriveSharedInputFields(ctx.templates);
      if (shared_fields.length === 0) {
        return { kind: 'ok', output: { applied: [] } };
      }
      const items = getContextItems(ctx.project);
      const reference_files = items.filter(
        (i): i is ProjectContextFile => i.kind === 'file',
      );
      const notes_block = renderNotesBlock(items);
      const { proposals, tokens_in, tokens_out, usage_by_model } = await proposeSharedInputs(ctx.client, {
        project: ctx.project,
        shared_fields,
        reference_files,
        notes_block,
      });
      // Apply every proposal whose field is currently empty. We do
      // NOT overwrite user-provided values.
      const applied: Array<{ key: string; value: string; source: string }> = [];
      const updated_shared_inputs = { ...ctx.project.shared_inputs };
      const updated_meta = { ...(ctx.project.shared_inputs_meta ?? {}) };
      const filled_at = new Date().toISOString();
      for (const [key, prop] of Object.entries(proposals)) {
        const existing = updated_shared_inputs[key];
        if (existing && existing.trim()) continue;
        updated_shared_inputs[key] = prop.value;
        const source = `preflight:${prop.source}` as
          | 'preflight:project_subject'
          | 'preflight:reference_file'
          | 'preflight:inferred'
          | 'preflight:default';
        updated_meta[key] = {
          source,
          source_label: prop.source_label,
          confidence: prop.confidence,
          filled_at,
        };
        applied.push({ key, value: prop.value, source });
      }
      if (applied.length > 0) {
        const patched = {
          ...ctx.project,
          shared_inputs: updated_shared_inputs,
          shared_inputs_meta: updated_meta,
          updated_at: new Date().toISOString(),
        };
        await db.projects.put(patched);
        // Mutate ctx.project so later stages see the filled values.
        ctx.project.shared_inputs = updated_shared_inputs;
        ctx.project.shared_inputs_meta = updated_meta;
      }
      return {
        kind: 'ok',
        output: { applied, proposals },
        tokens_in,
        tokens_out,
        usage_by_model,
      };
    } catch (err) {
      return {
        kind: 'failed',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};

/**
 * Stage 4 — extract + chunk references. For every file that lacks
 * `chunks`, run an LLM-driven semantic chunking pass via
 * lib/project/chunk.ts::semanticChunkText. This step is idempotent —
 * re-running over a project whose files already have chunks is a
 * no-op.
 */
const extractAndChunkReferencesStage: RecipeStage = {
  id: 'extract-and-chunk-references',
  name: 'Chunk reference files',
  description:
    'Run semantic chunking over any attached reference file that has not yet been chunked.',
  required: true,
  intervention_point: false,
  async run(ctx): Promise<RecipeStageResult> {
    try {
      const items = getContextItems(ctx.project);
      const files = items.filter((i): i is ProjectContextFile => i.kind === 'file');
      const chunked: Array<{ file_id: string; filename: string; chunk_count: number }> = [];
      let stageTokensIn = 0;
      let stageTokensOut = 0;
      const stageUsage: UsageByModel = {};
      for (const file of files) {
        if (file.chunks && file.chunks.length > 0) continue;
        // Extract text using whichever path the active client supports.
        // Cache hits short-circuit both paths so re-runs are cheap.
        let text = file.extracted_text ?? '';
        if (!text || text.length === 0) {
          if (ctx.client.capabilities.fileUpload) {
            try {
              const fileObj = blobToFile(file.bytes, file.filename, file.mime_type);
              const upload = await (ctx.client as unknown as {
                uploadFile(f: File): Promise<{ ret: string | Record<string, unknown> }>;
              }).uploadFile(fileObj);
              text = extractedTextFromRet(upload.ret);
            } catch (err) {
              // eslint-disable-next-line no-console
              console.warn(
                `[pws.extract-and-chunk] /server/file failed for ${file.filename}:`,
                err,
              );
              continue;
            }
          } else {
            const local = await extractFileLocally(file);
            if (!local.text) {
              // eslint-disable-next-line no-console
              console.info(
                `[pws.extract-and-chunk] local extract skipped ${file.filename}: ${local.error ?? 'no text'}`,
              );
              continue;
            }
            text = local.text;
          }
          if (text && text.length > 0) {
            await cacheExtractedText(ctx.project, file.id, text);
          }
        }
        if (!text || text.length === 0) continue;
        const result = await semanticChunkText(ctx.client, text, {
          sourceLabel: file.filename,
        });
        file.chunks = result.chunks;
        stageTokensIn += result.tokens_in;
        stageTokensOut += result.tokens_out;
        mergeUsage(stageUsage, result.usage_by_model);
        chunked.push({ file_id: file.id, filename: file.filename, chunk_count: result.chunks.length });
      }
      if (chunked.length > 0) {
        // Persist the mutated context items back to the project.
        const patched = {
          ...ctx.project,
          context_items: ctx.project.context_items,
          updated_at: new Date().toISOString(),
        };
        await db.projects.put(patched);
      }
      return {
        kind: 'ok',
        output: { chunked },
        tokens_in: stageTokensIn,
        tokens_out: stageTokensOut,
        usage_by_model: stageUsage,
      };
    } catch (err) {
      return {
        kind: 'failed',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};

/**
 * Stage 4a — map reference chunks to template sections. ONE LLM call
 * (chunk titles + summaries only, never bodies) that decides per
 * section which chunks belong to it, how much output content the
 * section should produce after absorbing those chunks, and which
 * drafting strategy the per-section drafter should use. The output
 * lands in ctx.state[MAP_STAGE_ID] for the metadata batch and the
 * per-section drafter to consume.
 *
 * This is the stage that fixes the bare-bones-template + content-
 * rich-source case (DHA-policy template absorbing a MAMC policy):
 * a section whose template example is 40 words but whose mapped
 * source content is 1800 words gets promoted from inline_metadata
 * into long, with the matched chunks pinned as preferred selections.
 *
 * Skips cleanly with status='ok' and zero tokens when no reference
 * files are attached or none have been chunked yet — downstream
 * stages then fall back to template-only sizing (the legacy path).
 */
const mapReferencesStage: RecipeStage = {
  id: MAP_STAGE_ID,
  name: 'Map references to sections',
  description: 'One-shot alignment between template sections and reference chunks; drives per-section sizing, chunk selection, and drafting strategy downstream.',
  required: false,
  intervention_point: false,
  async run(ctx): Promise<RecipeStageResult> {
    try {
      const items = getContextItems(ctx.project);
      const reference_files = items.filter(
        (i): i is ProjectContextFile => i.kind === 'file',
      );
      const result = await mapReferencesToSections(ctx.client, {
        project: ctx.project,
        templates: ctx.templates,
        reference_files,
      });
      // Even when skipped (no chunks), we still return the synthetic
      // mappings so downstream lookups don't have to special-case
      // their absence.
      const output: MapStageOutput = {
        mappings: result.mappings,
        skipped: result.skipped,
      };
      return {
        kind: 'ok',
        output,
        tokens_in: result.tokens_in,
        tokens_out: result.tokens_out,
        usage_by_model: result.usage_by_model,
      };
    } catch (err) {
      return {
        kind: 'failed',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};

/**
 * Stage 4b — metadata batch. Drafts every inline_metadata-class section
 * across every selected template in ONE LLM call instead of running
 * each through the per-section drafting loop. This is what stops the
 * recipe from sending a 28k-token reference doc to a 7-word
 * "Memorandum For" line.
 *
 * Runs after auto-fill so the metadata fields can use the just-filled
 * shared inputs as their primary source. Runs even if reference
 * chunking failed — metadata fields rarely need reference text and
 * the batch only sends chunk titles + summaries (not bodies) anyway.
 */
const metadataBatchStage: RecipeStage = {
  id: 'draft-metadata-fields',
  name: 'Draft metadata fields',
  description: 'One-shot fill for short fields (title, addressee, date, signature blocks) so the per-section loop only runs on real prose.',
  required: true,
  intervention_point: false,
  async run(ctx): Promise<RecipeStageResult> {
    try {
      const items = getContextItems(ctx.project);
      const reference_files = items.filter(
        (i): i is ProjectContextFile => i.kind === 'file',
      );
      const notes_block = renderNotesBlock(items);
      const result = await runMetadataBatch(ctx.client, {
        project: ctx.project,
        templates: ctx.templates,
        reference_files,
        notes_block,
        section_mappings: readMappingsFromState(ctx.state),
      });
      return {
        kind: 'ok',
        output: {
          filled: result.filled,
          skipped: result.skipped,
          errored: result.errored,
          model: result.model,
        },
        tokens_in: result.tokens_in,
        tokens_out: result.tokens_out,
        usage_by_model: result.usage_by_model,
      };
    } catch (err) {
      return {
        kind: 'failed',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};

/**
 * Stage 5 — draft every section of every template. Delegates to the
 * existing orchestrator. The orchestrator wires the per-section critic
 * loop internally once Phase 3 integration lands.
 */
const draftSectionsStage: RecipeStage = {
  id: 'draft-sections',
  name: 'Draft sections',
  description: 'Draft every prose section via the per-section orchestrator (inline_metadata fields are skipped — they were filled by the metadata batch stage).',
  required: true,
  intervention_point: false,
  async run(ctx): Promise<RecipeStageResult> {
    try {
      const result = await draftProject(ctx.client, {
        project: ctx.project,
        templates: ctx.templates,
        section_mappings: readMappingsFromState(ctx.state),
      });
      return {
        kind: 'ok',
        output: {
          sections_drafted: result.sections_drafted,
          sections_errored: result.sections_errored,
        },
        tokens_in: result.tokens_in,
        tokens_out: result.tokens_out,
        usage_by_model: result.usage_by_model,
      };
    } catch (err) {
      return {
        kind: 'failed',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};

/**
 * Stage 5b — fill placeholders. Scans every ready draft for the
 * project, looking for [INSERT: ...] placeholders the per-section
 * drafter or the metadata batch left in place because the LLM had
 * no way to ground a fact in the available context. When any are
 * found, returns `needs_intervention` and surfaces them to the UI;
 * the user fills them in (in natural language), the UI mutates the
 * drafts directly in Dexie, and the recipe resumes from the next
 * stage. When the user clicks "skip" the placeholders are left in
 * place — the assembled DOCX still gets exported with literal
 * "[INSERT: ...]" markers the user can find-and-replace later.
 *
 * On resume, the runner re-executes this stage. The re-scan picks
 * up the user's edits — if every placeholder is now resolved, the
 * stage returns `ok`. If a few are still present (e.g. user clicked
 * skip-all), the stage still returns `ok` so the recipe doesn't
 * loop forever — the unresolved count is reported in the output for
 * the run history.
 */
export const FILL_PLACEHOLDERS_STAGE_ID = 'fill-placeholders';

interface FillPlaceholdersStageOutput {
  total_placeholders: number;
  occurrences: Array<
    PlaceholderOccurrence & {
      draft_id: string;
      template_id: string;
      template_name: string;
      section_id: string;
      section_name: string;
    }
  >;
}

const fillPlaceholdersStage: RecipeStage = {
  id: FILL_PLACEHOLDERS_STAGE_ID,
  name: 'Fill placeholders',
  description:
    'Surface any [INSERT: ...] placeholders the drafter left in for the user to fill in before assembly.',
  required: false,
  intervention_point: true,
  async run(ctx): Promise<RecipeStageResult> {
    try {
      const allDrafts = await db.drafts
        .where('project_id')
        .equals(ctx.project.id)
        .toArray();
      const readyDrafts = allDrafts.filter((d) => d.status === 'ready');

      // Index template + section names so the UI can render labels
      // without re-querying.
      const templateNamesById = new Map<string, string>();
      const sectionNamesById = new Map<string, string>();
      for (const t of ctx.templates) {
        templateNamesById.set(t.id, t.name);
        for (const s of t.schema_json.sections) {
          sectionNamesById.set(`${t.id}::${s.id}`, s.name);
        }
      }

      const occurrences: FillPlaceholdersStageOutput['occurrences'] = [];
      for (const draft of readyDrafts) {
        const found = scanDraftForPlaceholders(draft.paragraphs);
        if (found.length === 0) continue;
        const templateName = templateNamesById.get(draft.template_id) ?? draft.template_id;
        const sectionName =
          sectionNamesById.get(`${draft.template_id}::${draft.section_id}`) ?? draft.section_id;
        for (const o of found) {
          occurrences.push({
            ...o,
            draft_id: draft.id,
            template_id: draft.template_id,
            template_name: templateName,
            section_id: draft.section_id,
            section_name: sectionName,
          });
        }
      }

      const output: FillPlaceholdersStageOutput = {
        total_placeholders: occurrences.length,
        occurrences,
      };

      if (occurrences.length === 0) {
        return { kind: 'ok', output };
      }
      return {
        kind: 'needs_intervention',
        reason: `${occurrences.length} placeholder${occurrences.length === 1 ? '' : 's'} need values before assembly.`,
        output,
      };
    } catch (err) {
      return {
        kind: 'failed',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};

/**
 * Stage 6 — cross-section review. Reads the drafted sections back out
 * of Dexie and runs a single LLM pass across the whole document.
 */
const crossSectionReviewStage: RecipeStage = {
  id: 'cross-section-review',
  name: 'Cross-section review',
  description: 'Look across every drafted section for contradictions, drift, and redundancy.',
  required: true,
  intervention_point: false,
  async run(ctx): Promise<RecipeStageResult> {
    try {
      const allDrafts = await db.drafts
        .where('project_id')
        .equals(ctx.project.id)
        .toArray();
      const draftsBySectionId = new Map<string, DraftRecord>();
      for (const d of allDrafts) {
        if (d.status === 'ready') draftsBySectionId.set(d.section_id, d);
      }
      const sections: DraftedSectionInput[] = [];
      for (const tpl of ctx.templates) {
        for (const section of tpl.schema_json.sections) {
          const draft = draftsBySectionId.get(section.id);
          if (!draft) continue;
          sections.push({
            template_id: tpl.id,
            template_name: tpl.name,
            section,
            paragraphs: draft.paragraphs,
          });
        }
      }
      if (sections.length === 0) {
        return {
          kind: 'ok',
          output: { skipped: true, reason: 'no drafted sections to review' },
        };
      }
      const result = await runCrossSectionReview({
        client: ctx.client,
        project_description: ctx.project.description,
        templates: ctx.templates.map((t) => t.schema_json),
        sections,
      });
      return {
        kind: 'ok',
        output: result,
        tokens_in: result.tokens_in,
        tokens_out: result.tokens_out,
        usage_by_model: result.usage_by_model,
      };
    } catch (err) {
      return {
        kind: 'failed',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};

/**
 * Stage 6.5 — style consistency review. Reads every drafted section
 * back out of Dexie, runs ONE LLM pass that looks at the whole
 * document's formatting (role usage, table structure, leaked
 * markdown, heading hierarchy, bullet nesting), and applies the
 * model's structured fix ops back to the per-section drafts before
 * the assembler runs.
 *
 * Skipped when `settings.style_review.enabled` is false. Always
 * non-fatal: if the LLM call or sanitization fails, the stage logs
 * and falls through to assembly with the unchanged drafts.
 */
const styleConsistencyReviewStage: RecipeStage = {
  id: 'style-consistency-review',
  name: 'Style consistency review',
  description:
    'Look across the whole drafted document for inconsistent formatting, malformed tables, leaked markdown, and role mismatches; apply the model\'s fix ops before assembly.',
  required: false,
  intervention_point: false,
  async run(ctx): Promise<RecipeStageResult> {
    try {
      const settings = await loadSettings();
      const enabled = settings.style_review?.enabled ?? true;
      if (!enabled) {
        return {
          kind: 'ok',
          output: { skipped: true, reason: 'style_review.enabled is false' },
        };
      }

      const allDrafts = await db.drafts
        .where('project_id')
        .equals(ctx.project.id)
        .toArray();
      const draftsBySectionId = new Map<string, DraftRecord>();
      for (const d of allDrafts) {
        if (d.status === 'ready') draftsBySectionId.set(d.section_id, d);
      }

      // Build the input list in document order, grouped by template.
      // Order matters for the model — it reads the SECTION LIST as a
      // sequence and reasons about hierarchy across neighbouring
      // sections.
      const sections: StyleReviewSectionInput[] = [];
      for (const tpl of ctx.templates) {
        for (const section of tpl.schema_json.sections) {
          const draft = draftsBySectionId.get(section.id);
          if (!draft) continue;
          sections.push({
            template_id: tpl.id,
            template_name: tpl.name,
            section,
            paragraphs: draft.paragraphs,
          });
        }
      }
      if (sections.length === 0) {
        return {
          kind: 'ok',
          output: { skipped: true, reason: 'no drafted sections to review' },
        };
      }

      const result = await runStyleConsistencyReview({
        client: ctx.client,
        project_description: ctx.project.description,
        templates: ctx.templates.map((t) => t.schema_json),
        sections,
        model: settings.style_review?.review_model,
        max_ops: settings.style_review?.max_ops,
      });

      // Persist updated drafts back to Dexie. Only sections whose
      // paragraph list actually changed get a write — comparing by
      // identity is enough because applyStyleFixOps deep-clones the
      // map.
      let sectionsUpdated = 0;
      for (const [section_id, updatedParagraphs] of result.updated) {
        const original = draftsBySectionId.get(section_id);
        if (!original) continue;
        if (original.paragraphs === updatedParagraphs) continue;
        // Quick equality check: if structurally identical, skip the write.
        const before = JSON.stringify(original.paragraphs);
        const after = JSON.stringify(updatedParagraphs);
        if (before === after) continue;
        await db.drafts.put({
          ...original,
          paragraphs: updatedParagraphs,
          generated_at: new Date().toISOString(),
        });
        sectionsUpdated += 1;
      }

      return {
        kind: 'ok',
        output: {
          ops_proposed: result.ops.length,
          ops_applied: result.ops_applied.length,
          ops_dropped: result.ops_dropped.length,
          sections_updated: sectionsUpdated,
          model: result.model,
          // Surface a compact view of the applied ops so the UI can
          // show what was changed without re-querying Dexie.
          applied_ops: result.ops_applied.map((o) => ({
            kind: o.kind,
            section_id: o.section_id,
            paragraph_index: o.paragraph_index,
            reason: o.reason,
          })),
        },
        tokens_in: result.tokens_in,
        tokens_out: result.tokens_out,
        usage_by_model: result.usage_by_model,
      };
    } catch (err) {
      // Non-fatal: the assembler still has the unchanged drafts. Log
      // and return ok with a skipped marker so the runner moves on.
      // eslint-disable-next-line no-console
      console.error('[style-consistency-review] failed, falling through:', err);
      return {
        kind: 'ok',
        output: {
          skipped: true,
          reason: err instanceof Error ? err.message : String(err),
        },
      };
    }
  },
};

/**
 * Stage 7 — assemble DOCX. Calls the Phase 5a writer once per template
 * and stashes the blob(s) on the stage output for the UI to offer as
 * downloads.
 */
const assembleDocxStage: RecipeStage = {
  id: 'assemble-docx',
  name: 'Assemble DOCX',
  description: 'Clone each template and splice in the drafted sections to produce a finished DOCX.',
  required: true,
  intervention_point: false,
  async run(ctx): Promise<RecipeStageResult> {
    try {
      const allDrafts = await db.drafts
        .where('project_id')
        .equals(ctx.project.id)
        .toArray();
      const byTemplateAndSection = new Map<string, Map<string, DraftRecord>>();
      for (const d of allDrafts) {
        if (d.status !== 'ready') continue;
        let m = byTemplateAndSection.get(d.template_id);
        if (!m) {
          m = new Map();
          byTemplateAndSection.set(d.template_id, m);
        }
        m.set(d.section_id, d);
      }

      const outputs: Array<{
        template_id: string;
        template_name: string;
        blob_url: string;
        filename: string;
        total_assembled: number;
        total_skipped: number;
        total_failed: number;
      }> = [];

      for (const tpl of ctx.templates) {
        const perSection = byTemplateAndSection.get(tpl.id) ?? new Map<string, DraftRecord>();
        const draftedBySectionId = new Map<string, DraftRecord['paragraphs']>();
        for (const [sid, d] of perSection) draftedBySectionId.set(sid, d.paragraphs);
        const result = await assembleProjectDocx({
          template: tpl as TemplateRecord,
          draftedBySectionId,
        });
        const url = URL.createObjectURL(result.blob);
        outputs.push({
          template_id: tpl.id,
          template_name: tpl.name,
          blob_url: url,
          filename: `${ctx.project.name || tpl.name}.docx`,
          total_assembled: result.total_assembled,
          total_skipped: result.total_skipped,
          total_failed: result.total_failed,
        });
      }

      return { kind: 'ok', output: { outputs } };
    } catch (err) {
      return {
        kind: 'failed',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};

// ─── Recipe definition ───────────────────────────────────────────

export const PWS_RECIPE: Recipe = {
  // The id stays 'pws' for backwards compatibility with persisted
  // recipe_runs rows that reference it; the recipe is actually
  // subject-agnostic. The display name is generic and the runner
  // overrides it per-project at run time (see runRecipe display_name).
  id: 'pws',
  name: 'Auto-draft document',
  description:
    'Pre-flight the project, auto-fill shared inputs, chunk references, one-shot the metadata fields, draft every prose section, cross-section review, and assemble a finished DOCX.',
  applies_to: ['pws', 'performance_work_statement', 'sow', 'mfr', 'mou', 'memo', 'policy', 'sop'],
  // Recipe runs on either provider. Stages branch internally on
  // client.capabilities — Ask Sage uses /server/file, OpenRouter uses
  // the in-browser DOCX/text extractor and inlines the result the
  // same way. PDFs and other formats degrade to filename-only context
  // on OpenRouter (the user can convert to DOCX if needed).
  required_provider: 'any',
  estimated_tokens_in: 250_000,
  estimated_tokens_out: 60_000,
  stages: [
    preflightStage,
    templateSelectionStage,
    autoFillSharedInputsStage,
    extractAndChunkReferencesStage,
    mapReferencesStage,
    metadataBatchStage,
    draftSectionsStage,
    fillPlaceholdersStage,
    crossSectionReviewStage,
    styleConsistencyReviewStage,
    assembleDocxStage,
  ],
};

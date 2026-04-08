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
import { getContextItems } from '../../project/context';
import { draftProject } from '../../draft/orchestrator';
import { runCrossSectionReview, type DraftedSectionInput } from '../../draft/cross_section';
import { assembleProjectDocx } from '../../export/assemble';
import { blobToFile, extractedTextFromRet } from '../../asksage/extract';
import type { ProjectContextFile, TemplateRecord, DraftRecord } from '../../db/schema';
import { db } from '../../db/schema';

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
      const report = await runReadinessCheck(ctx.client, {
        project: ctx.project,
        templates: ctx.templates,
        reference_files,
      });
      if (!report.ready_to_draft) {
        return {
          kind: 'needs_intervention',
          reason:
            report.missing_shared_inputs.length > 0
              ? `Missing required inputs: ${report.missing_shared_inputs.join(', ')}`
              : report.vague_subject
                ? 'Project subject is too vague to draft from.'
                : 'Pre-flight found blocking issues.',
          output: report,
          tokens_in: report.tokens_in,
          tokens_out: report.tokens_out,
        };
      }
      return {
        kind: 'ok',
        output: report,
        tokens_in: report.tokens_in,
        tokens_out: report.tokens_out,
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
      const proposals = await proposeSharedInputs(ctx.client, {
        project: ctx.project,
        shared_fields,
        reference_files,
      });
      // Apply every proposal whose field is currently empty. We do
      // NOT overwrite user-provided values.
      const applied: Array<{ key: string; value: string; source: string }> = [];
      const updated_shared_inputs = { ...ctx.project.shared_inputs };
      for (const [key, prop] of Object.entries(proposals)) {
        const existing = updated_shared_inputs[key];
        if (existing && existing.trim()) continue;
        updated_shared_inputs[key] = prop.value;
        applied.push({ key, value: prop.value, source: `preflight:${prop.source}` });
      }
      if (applied.length > 0) {
        const patched = {
          ...ctx.project,
          shared_inputs: updated_shared_inputs,
          updated_at: new Date().toISOString(),
        };
        await db.projects.put(patched);
        // Mutate ctx.project so later stages see the filled values.
        ctx.project.shared_inputs = updated_shared_inputs;
      }
      return { kind: 'ok', output: { applied, proposals } };
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
      for (const file of files) {
        if (file.chunks && file.chunks.length > 0) continue;
        // Extract text via /server/file and chunk it.
        const fileObj = blobToFile(file.bytes, file.filename, file.mime_type);
        const upload = await ctx.client.uploadFile(fileObj);
        const text = extractedTextFromRet(upload.ret);
        if (!text || text.length === 0) continue;
        const chunks = await semanticChunkText(ctx.client, text, {
          sourceLabel: file.filename,
        });
        file.chunks = chunks;
        chunked.push({ file_id: file.id, filename: file.filename, chunk_count: chunks.length });
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
      return { kind: 'ok', output: { chunked } };
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
  description: 'Draft every section of every selected template via the orchestrator.',
  required: true,
  intervention_point: false,
  async run(ctx): Promise<RecipeStageResult> {
    try {
      let sections_drafted = 0;
      let sections_errored = 0;
      await draftProject(ctx.client, {
        project: ctx.project,
        templates: ctx.templates,
        callbacks: {
          onSectionComplete: () => {
            sections_drafted += 1;
          },
          onSectionError: () => {
            sections_errored += 1;
          },
        },
      });
      return {
        kind: 'ok',
        output: { sections_drafted, sections_errored },
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
  id: 'pws',
  name: 'Build a PWS',
  description:
    'Pre-flight the project, auto-fill shared inputs, chunk references, draft every section, cross-section review, and assemble a finished DOCX.',
  applies_to: ['pws', 'performance_work_statement', 'sow'],
  required_provider: 'asksage',
  estimated_tokens_in: 250_000,
  estimated_tokens_out: 60_000,
  stages: [
    preflightStage,
    templateSelectionStage,
    autoFillSharedInputsStage,
    extractAndChunkReferencesStage,
    draftSectionsStage,
    crossSectionReviewStage,
    assembleDocxStage,
  ],
};

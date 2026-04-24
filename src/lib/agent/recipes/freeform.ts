/**
 * Freeform document recipe — produces a complete document from a style
 * profile + project context, without requiring a DOCX template.
 *
 * Stages:
 *   1. Extract references — pull text from attached files
 *   2. Draft document — single LLM call to produce the whole document
 *
 * The drafted paragraphs are saved to `project.freeform_draft` so the
 * workspace can render a semantic-block preview and allow per-block
 * edits. DOCX assembly is explicit — triggered from the Export button,
 * not from the recipe pipeline.
 */

import type { Recipe, RecipeStage, RecipeStageResult, RecipeRunContext } from '../recipe';
import { getContextItems } from '../../project/context';
import { extractFileLocally, cacheExtractedText } from '../../project/local_extract';
import { blobToFile, extractedTextFromRet } from '../../asksage/extract';
import { draftFreeformDocument } from '../../freeform/drafter';
import { getFreeformStyle } from '../../freeform/styles';
import { loadSettings } from '../../settings/store';
import { db } from '../../db/schema';
import type { ProjectContextFile } from '../../db/schema';
import type { UsageByModel } from '../../usage';

// ─── Stage 1: Extract references ─────────────────────────────────

const extractReferencesStage: RecipeStage = {
  id: 'extract-references',
  name: 'Extracting reference material',
  description: 'Read text from attached files so the AI can use them as context.',
  required: false,
  intervention_point: false,
  async run(ctx: RecipeRunContext): Promise<RecipeStageResult> {
    const items = getContextItems(ctx.project);
    const files = items.filter((c): c is ProjectContextFile => c.kind === 'file');

    if (files.length === 0) {
      return { kind: 'ok', output: { file_extracts: {} } };
    }

    ctx.callbacks?.onStageProgress?.(this, `Extracting text from ${files.length} file(s)…`);

    const file_extracts: Record<string, string> = {};

    for (const f of files) {
      // Use cached text if available
      if (f.extracted_text) {
        file_extracts[f.id] = f.extracted_text;
        continue;
      }

      try {
        let text = '';
        if (ctx.client.capabilities.fileUpload) {
          // Ask Sage path: upload via /server/file for extraction
          const fileObj = blobToFile(f.bytes, f.filename, f.mime_type);
          const upload = await (ctx.client as unknown as {
            uploadFile(f: File): Promise<{ ret: string | Record<string, unknown> }>;
          }).uploadFile(fileObj);
          text = extractedTextFromRet(upload.ret);
        } else {
          // Local extraction fallback
          const local = await extractFileLocally(f);
          text = local.text ?? '';
        }

        if (text.length > 0) {
          file_extracts[f.id] = text;
          await cacheExtractedText(ctx.project, f.id, text);
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`[freeform] failed to extract ${f.filename}:`, err);
      }
    }

    return { kind: 'ok', output: { file_extracts } };
  },
};

// ─── Stage 2: Draft document ─────────────────────────────────────

const draftDocumentStage: RecipeStage = {
  id: 'draft-freeform-document',
  name: 'Drafting document',
  description: 'Generate the complete document using the selected style and your reference material.',
  required: true,
  intervention_point: false,
  async run(ctx: RecipeRunContext): Promise<RecipeStageResult> {
    const styleId = ctx.project.freeform_style;
    if (!styleId) {
      return { kind: 'failed', error: 'No document style selected on this project.' };
    }
    const style = getFreeformStyle(styleId);
    if (!style) {
      return { kind: 'failed', error: `Unknown document style: ${styleId}` };
    }

    ctx.callbacks?.onStageProgress?.(this, `Writing ${style.name}…`);

    // Get file extracts from prior stage
    const priorOutput = ctx.state['extract-references'] as { file_extracts: Record<string, string> } | undefined;
    const fileExtracts = new Map<string, string>(
      Object.entries(priorOutput?.file_extracts ?? {}),
    );

    const contextItems = getContextItems(ctx.project);

    // Load model override from settings
    const settings = await loadSettings();
    const modelOverride = settings.models.drafting ?? undefined;

    const result = await draftFreeformDocument({
      client: ctx.client,
      style,
      project_description: ctx.project.description,
      context_items: contextItems,
      file_extracts: fileExtracts,
      model: modelOverride,
      dataset: ctx.project.reference_dataset_names[0],
      live: ctx.project.live_search || undefined,
      limit_references: 6,
    });

    // Save draft + references to the project record
    await db.projects.update(ctx.project.id, {
      freeform_draft: result.paragraphs,
      freeform_draft_model: result.model,
      freeform_draft_tokens_in: result.tokens_in,
      freeform_draft_tokens_out: result.tokens_out,
      freeform_draft_generated_at: new Date().toISOString(),
      freeform_draft_raw_references: result.raw_references,
      freeform_draft_sources: result.sources,
      updated_at: new Date().toISOString(),
    });

    const usage_by_model: UsageByModel = {
      [result.model]: {
        tokens_in: result.tokens_in,
        tokens_out: result.tokens_out,
        calls: 1,
      },
    };

    return {
      kind: 'ok',
      output: { paragraphs: result.paragraphs, model: result.model },
      tokens_in: result.tokens_in,
      tokens_out: result.tokens_out,
      usage_by_model,
    };
  },
};

// ─── Recipe definition ───────────────────────────────────────────

export const FREEFORM_RECIPE: Recipe = {
  id: 'freeform-document',
  name: 'Freeform Document',
  description:
    'Write a complete document (white paper, executive summary, memo, etc.) from your project description and attached reference material — no template required.',
  applies_to: ['freeform'],
  required_provider: 'any',
  estimated_tokens_in: 8000,
  estimated_tokens_out: 4000,
  stages: [
    extractReferencesStage,
    draftDocumentStage,
  ],
};

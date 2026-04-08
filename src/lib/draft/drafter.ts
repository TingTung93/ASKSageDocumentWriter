// draftSection — drafts a single section of a template by calling Ask
// Sage with the drafting prompt and parsing the structured paragraph
// output. Pure orchestration; the orchestrator (orchestrator.ts) walks
// the section list in dependency order and calls this for each.

import type { AskSageClient } from '../asksage/client';
import type { BodyFillRegion, TemplateSchema } from '../template/types';
import { buildDraftingPrompt } from './prompt';
import type {
  DraftingOptions,
  DraftingResult,
  LLMDraftOutput,
  PriorSectionSummary,
} from './types';

export const DEFAULT_DRAFTING_MODEL = 'google-claude-46-sonnet';
// Drafting must stick to retrieved + inlined content. The earlier 0.2
// default let the model drift toward training-data priors when the
// prompt didn't have strong subject anchoring.
export const DEFAULT_DRAFTING_TEMPERATURE = 0;

export interface DraftSectionArgs {
  template: TemplateSchema;
  section: BodyFillRegion;
  project_description: string;
  shared_inputs: Record<string, string>;
  prior_summaries: PriorSectionSummary[];
  /**
   * Pre-rendered NOTES block (chat notes only). Built once per draft
   * run by the orchestrator. See lib/project/context.renderNotesBlock.
   */
  notes_block?: string | null;
  /**
   * Pre-rendered ATTACHED REFERENCES block (full text of every file
   * the user attached, extracted via /server/file at the start of the
   * draft run and cached in memory). Same string for every section
   * call in the run.
   */
  references_block?: string | null;
  /**
   * The actual paragraphs of THIS section as they appear in the
   * source template, joined into one string. Sliced from the parsed
   * DOCX by the orchestrator. Tells the model how the section
   * "looks" structurally without baking subject matter.
   */
  template_example?: string | null;
  options?: DraftingOptions;
}

export async function draftSection(
  client: AskSageClient,
  args: DraftSectionArgs,
): Promise<DraftingResult> {
  const opts = args.options ?? {};
  const model = opts.model ?? DEFAULT_DRAFTING_MODEL;
  const temperature = opts.temperature ?? DEFAULT_DRAFTING_TEMPERATURE;

  const prompt = buildDraftingPrompt({
    template: args.template,
    section: args.section,
    project_description: args.project_description,
    shared_inputs: args.shared_inputs,
    prior_summaries: args.prior_summaries,
    notes_block: args.notes_block,
    references_block: args.references_block,
    template_example: args.template_example,
  });

  const { data, raw } = await client.queryJson<LLMDraftOutput>({
    message: prompt.message,
    system_prompt: prompt.system_prompt,
    model,
    dataset: opts.dataset ?? 'none',
    limit_references: opts.limit_references ?? 6,
    temperature,
    live: opts.live ?? 0,
    usage: true,
  });

  // Defensive: the LLM may sometimes wrap paragraphs in odd shapes.
  // Normalize to an array of {role, text}.
  const paragraphs = Array.isArray(data?.paragraphs)
    ? data.paragraphs.filter(
        (p): p is NonNullable<typeof p> => !!p && typeof p === 'object' && 'role' in p,
      )
    : [];

  const usage = (raw.usage as { prompt_tokens?: number; completion_tokens?: number }) ?? {};

  return {
    paragraphs,
    references: raw.references ?? '',
    usage: raw.usage ?? null,
    prompt_sent: prompt.message,
    model,
    tokens_in: usage.prompt_tokens ?? 0,
    tokens_out: usage.completion_tokens ?? 0,
  };
}

/**
 * Build a short summary of a drafted section's content for use as a
 * prior_summary input to dependent sections. We use the LLM's
 * self_summary if it produced one, otherwise concatenate the first
 * paragraph's text up to ~200 chars.
 */
export function summarizeDraft(
  paragraphs: { role: string; text: string }[],
  llm_self_summary: string | undefined,
): string {
  if (llm_self_summary && llm_self_summary.trim().length > 0) {
    return llm_self_summary.trim().slice(0, 300);
  }
  const first = paragraphs.find((p) => p.text && p.text.trim().length > 0);
  if (!first) return '(empty draft)';
  return first.text.slice(0, 200);
}

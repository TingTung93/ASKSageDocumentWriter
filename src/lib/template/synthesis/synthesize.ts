// Top-level orchestrator for Phase 1b semantic schema synthesis.
//
// Flow:
//   (1) Re-parse the stored DOCX bytes to recover paragraph content
//   (2) Extract a small sample of body text per section
//   (3) Build the prompt from structural digest + samples
//   (4) Call Ask Sage with model = google-gemini-2.5-flash
//   (5) Parse the model's response as strict JSON
//   (6) Merge the semantic output into the structural schema
//
// Returns the merged schema, the raw LLM output, and the token usage so
// the caller can persist + display them. Throws AskSageError on any
// network/parse failure with full diagnostic detail.

import type { LLMClient } from '../../provider/types';
import { extractParagraphs } from '../parser';
import type { TemplateSchema } from '../types';
import { extractSamples, extractFullBody } from './sample';
import { buildSynthesisPrompt } from './prompt';
import { mergeSemanticIntoSchema } from './merge';
import { scanSchemaForSubjectLeakage } from './leakage';
import type {
  LLMSemanticOutput,
  SynthesisOptions,
  SynthesisResult,
} from './types';

// Synthesis runs ONCE per template and the result is cached. Quality
// matters far more than cost on this call. Sonnet 4.6 produces much
// better section breakdowns and structured JSON than Flash on complex
// templates (PWS, market research) — Flash routinely runs out of output
// budget on schemas with 30+ sections and produces only the first few.
// Switched as the default after empirical comparison on real DHA
// templates 2026-04-07.
export const DEFAULT_SYNTHESIS_MODEL = 'google-claude-46-sonnet';

export async function synthesizeSchema(
  client: LLMClient,
  structural: TemplateSchema,
  docx_bytes: Uint8Array | ArrayBuffer | Blob,
  opts: SynthesisOptions = {},
): Promise<SynthesisResult> {
  const model = opts.model ?? DEFAULT_SYNTHESIS_MODEL;
  const temperature = opts.temperature ?? 0;

  // (1)+(2): re-parse paragraphs, extract per-section samples, and pull
  // the full template body so the LLM has rich context (placeholder
  // text, instructions, example wording) — not just heading text.
  const paragraphs = await extractParagraphs(docx_bytes);
  const samples = extractSamples(structural, paragraphs);
  const fullBody = extractFullBody(paragraphs, structural, {
    body_cap_chars: opts.body_cap_chars,
  });

  // (3): build prompt.
  const prompt = buildSynthesisPrompt({
    schema: structural,
    samples,
    full_body: fullBody,
    user_hint: opts.user_hint,
  });
  // eslint-disable-next-line no-console
  console.info(
    `[synthesize] template="${structural.name}" sections=${structural.sections.length} ` +
      `paragraphs=${fullBody.lines.length}/${fullBody.total_paragraphs}` +
      `${fullBody.truncated ? ' (truncated)' : ''} ` +
      `prompt_chars=${prompt.message.length} (≈${Math.round(prompt.message.length / 4)} tokens)`,
  );

  // (4)+(5): call Ask Sage and parse JSON.
  const { data, raw } = await client.queryJson<LLMSemanticOutput>({
    message: prompt.message,
    system_prompt: prompt.system_prompt,
    model,
    dataset: 'none',
    temperature,
    usage: true,
  });

  // (6): merge.
  const merged = mergeSemanticIntoSchema(structural, data, {
    semantic_synthesizer: model,
    ingested_at: structural.source.ingested_at,
  });

  // (7): sanity scan — flag any sections whose intent looks like it
  // baked in subject matter from the template's example placeholder
  // text. The drafter overrides this at draft time, but a clean
  // schema is still better than a dirty one for downstream reuse.
  const subject_leakage_warnings = scanSchemaForSubjectLeakage(merged.sections);

  return {
    schema: merged,
    llm_output: data,
    usage: raw.usage ?? null,
    prompt_sent: prompt.message,
    model,
    body_truncated: fullBody.truncated,
    body_paragraphs_sent: fullBody.lines.length,
    body_paragraphs_total: fullBody.total_paragraphs,
    body_chars_sent: fullBody.total_chars,
    subject_leakage_warnings,
  };
}

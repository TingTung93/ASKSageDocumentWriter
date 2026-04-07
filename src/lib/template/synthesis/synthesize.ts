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

import type { AskSageClient } from '../../asksage/client';
import { extractParagraphs } from '../parser';
import type { TemplateSchema } from '../types';
import { extractSamples, extractFullBody } from './sample';
import { buildSynthesisPrompt } from './prompt';
import { mergeSemanticIntoSchema } from './merge';
import type {
  LLMSemanticOutput,
  SynthesisOptions,
  SynthesisResult,
} from './types';

export const DEFAULT_SYNTHESIS_MODEL = 'google-gemini-2.5-flash';

export async function synthesizeSchema(
  client: AskSageClient,
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
  const fullBody = extractFullBody(paragraphs, structural);

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

  return {
    schema: merged,
    llm_output: data,
    usage: raw.usage ?? null,
    prompt_sent: prompt.message,
    model,
  };
}

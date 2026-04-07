// Folds the LLM's semantic output into the structural TemplateSchema.
// Pure function — given the same inputs, produces the same output. The
// structural half is never overwritten; only the semantic fields are
// added or replaced. If the LLM omits a section, that section's
// semantic fields stay empty (the schema viewer will show that).

import type { TemplateSchema } from '../types';
import type { LLMSemanticOutput } from './types';

export interface MergeOptions {
  semantic_synthesizer: string;
  ingested_at?: string;
}

export function mergeSemanticIntoSchema(
  structural: TemplateSchema,
  semantic: LLMSemanticOutput,
  opts: MergeOptions,
): TemplateSchema {
  // Build a lookup from id → semantic section
  const bySectionId = new Map(semantic.sections.map((s) => [s.id, s]));

  const sections = structural.sections.map((section) => {
    const llm = bySectionId.get(section.id);
    if (!llm) return section;
    return {
      ...section,
      intent: llm.intent,
      target_words: llm.target_words,
      depends_on: llm.depends_on,
      validation: llm.validation as Record<string, unknown> | undefined,
    };
  });

  return {
    ...structural,
    sections,
    style: {
      voice: semantic.style.voice,
      tense: semantic.style.tense,
      register: semantic.style.register,
      jargon_policy: semantic.style.jargon_policy,
      banned_phrases: semantic.style.banned_phrases,
    },
    source: {
      ...structural.source,
      semantic_synthesizer: opts.semantic_synthesizer,
      ingested_at: opts.ingested_at ?? structural.source.ingested_at,
    },
  };
}

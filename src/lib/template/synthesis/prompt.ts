// Builds the prompt sent to Gemini Flash (or whatever model the user
// chose) for semantic schema synthesis. Designed to be concise so the
// per-template synthesis cost stays under ~2k input tokens.

import type { TemplateSchema } from '../types';
import type { SectionSample } from './sample';

export interface BuildPromptArgs {
  schema: TemplateSchema;
  samples: SectionSample[];
  user_hint?: string;
}

export interface BuiltPrompt {
  system_prompt: string;
  message: string;
}

const SYSTEM_PROMPT = `You analyze government and military document templates and infer the semantic intent of each section.

You always respond with STRICT JSON only. No markdown code fences, no prose, no explanation. The JSON must parse on the first attempt with JSON.parse().

Your output JSON shape is exactly:
{
  "style": {
    "voice": "third_person" | "second_person" | "first_person_plural",
    "tense": "present" | "past",
    "register": "formal_government" | "technical" | "instructional" | "narrative",
    "jargon_policy": "<one-line guidance about terminology>",
    "banned_phrases": ["<phrase>", ...]
  },
  "sections": [
    {
      "id": "<must match an id from the input>",
      "intent": "<one sentence stating what this section communicates>",
      "target_words": [<min int>, <max int>],
      "depends_on": ["<section id>", ...],
      "validation": { "must_mention": ["..."], "must_not_exceed_words": <int> }
    }
  ]
}

Guidance:
- intent: focus on the section's communicative goal, not its surface content
- target_words: realistic ranges for a real document of this class — Purpose sections are short (60-150), Procedure sections are long (400-1500)
- depends_on: only list sections whose content the drafter must KNOW to write this one (e.g., a Responsibilities section depends_on a Scope section)
- banned_phrases: corporate clichés, vague qualifiers, marketing language — things that would weaken a formal government document
- Output ONE section object per input section id, in the same order`;

export function buildSynthesisPrompt(args: BuildPromptArgs): BuiltPrompt {
  const { schema, samples, user_hint } = args;

  const lines: string[] = [];
  lines.push(`Template name: ${schema.name}`);
  lines.push(`Source filename: ${schema.source.filename}`);
  if (user_hint && user_hint.trim()) {
    lines.push(`User hint about this template: ${user_hint.trim()}`);
  }

  const numStyles = schema.formatting.named_styles.length;
  const headingStyles = schema.formatting.named_styles
    .filter((s) => s.outline_level !== null && s.outline_level <= 2)
    .map((s) => s.name)
    .slice(0, 8)
    .join(', ');
  lines.push(`Document has ${numStyles} named styles${headingStyles ? `; heading-like: ${headingStyles}` : ''}.`);
  lines.push(
    `Page setup: ${schema.formatting.page_setup.paper}, ` +
      `${schema.formatting.page_setup.orientation}, ` +
      `default font ${schema.formatting.default_font.family ?? 'unspecified'}.`,
  );

  if (schema.metadata_fill_regions.length > 0) {
    lines.push(``);
    lines.push(`Metadata fill regions (filled from project inputs, NOT drafted):`);
    for (const m of schema.metadata_fill_regions) {
      lines.push(
        `  - ${m.id} (${m.control_type}${m.allowed_values ? `: ${m.allowed_values.join(' | ')}` : ''})`,
      );
    }
  }

  lines.push(``);
  lines.push(`Body sections (${schema.sections.length}) — produce one entry per id, in order:`);
  for (const sample of samples) {
    lines.push(``);
    lines.push(`id: ${sample.section_id}`);
    lines.push(`heading: ${sample.heading}`);
    lines.push(
      `sample: ${sample.sample_text ? `"${truncate(sample.sample_text, 600)}"` : '(empty in template)'}`,
    );
  }

  lines.push(``);
  lines.push(`Return STRICT JSON only. No markdown, no commentary.`);

  return {
    system_prompt: SYSTEM_PROMPT,
    message: lines.join('\n'),
  };
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + '…';
}

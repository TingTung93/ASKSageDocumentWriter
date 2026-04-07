// Builds the prompt sent to Gemini Flash (or whatever model the user
// chose) for semantic schema synthesis. Designed to be concise so the
// per-template synthesis cost stays under ~2k input tokens.

import type { TemplateSchema } from '../types';
import type { SectionSample, FullBody } from './sample';

export interface BuildPromptArgs {
  schema: TemplateSchema;
  samples: SectionSample[];
  full_body: FullBody;
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
  const { schema, samples, full_body, user_hint } = args;

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

  // ─── Full template body — the most important context ───────────────
  // DHA templates have rich placeholder/instruction text (italic
  // bracketed guidance like "[Insert purpose statement, 2-3 sentences]")
  // that the LLM cannot infer from headings alone. We send every
  // paragraph of the document with its paragraph index so the LLM can
  // correlate against the per-section paragraph ranges below.
  lines.push(``);
  lines.push(
    `=== FULL TEMPLATE BODY (${full_body.lines.length}/${full_body.total_paragraphs} paragraphs, ${full_body.total_chars} chars${full_body.truncated ? '; TRAILING TRUNCATED' : ''}) ===`,
  );
  lines.push(
    `This is the verbatim text of the template document. Use it to understand what each section is FOR — placeholder instructions, example wording, and tone are the strongest signals of intent.`,
  );
  for (const line of full_body.lines) {
    lines.push(`[${line.index}] ${line.text}`);
  }
  lines.push(`=== END FULL TEMPLATE BODY ===`);

  // ─── Per-section anchored samples ──────────────────────────────────
  lines.push(``);
  lines.push(
    `Body sections (${schema.sections.length}) — produce ONE entry per id, in order. Each section lists its paragraph range from the full body above so you know which lines to focus on:`,
  );
  for (const sample of samples) {
    lines.push(``);
    lines.push(`id: ${sample.section_id}`);
    lines.push(`heading: ${sample.heading}`);
    if (sample.paragraph_range) {
      lines.push(`paragraph_range: [${sample.paragraph_range[0]}, ${sample.paragraph_range[1]}]`);
    } else {
      lines.push(`paragraph_range: (not anchored — see full body above)`);
    }
    lines.push(
      sample.sample_text
        ? `anchored_text: """${sample.sample_text}"""`
        : `anchored_text: (empty in template)`,
    );
  }

  lines.push(``);
  lines.push(`Return STRICT JSON only. No markdown, no commentary.`);

  return {
    system_prompt: SYSTEM_PROMPT,
    message: lines.join('\n'),
  };
}

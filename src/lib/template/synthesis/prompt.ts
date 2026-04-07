// Builds the prompt sent to Gemini Flash (or whatever model the user
// chose) for semantic schema synthesis. Designed to be concise so the
// per-template synthesis cost stays under ~2k input tokens.

import type { TemplateSchema } from '../types';
import type { SectionSample, FullBody, ParagraphLine } from './sample';

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

const SYSTEM_PROMPT = `You analyze government and military document templates and DESIGN their section structure. You are the AUTHOR of the section list — not just an enricher of pre-existing sections.

You always respond with STRICT JSON only. No markdown code fences, no prose, no explanation. The JSON must parse on the first attempt with JSON.parse().

OUTPUT SCHEMA — you must produce JSON in exactly this shape:
{
  "style": {
    "voice": "third_person" | "second_person" | "first_person_plural",
    "tense": "present" | "past",
    "register": "formal_government" | "technical" | "instructional" | "narrative",
    "jargon_policy": "<one short line about terminology choices>",
    "banned_phrases": ["<specific phrase>", ...]
  },
  "sections": [
    {
      "id": "<snake_case identifier you choose, e.g. scope_and_objectives>",
      "name": "<display name as it should appear in the document, e.g. '1. Scope'>",
      "paragraph_range": [<first_paragraph_index>, <last_paragraph_index>],
      "intent": "<one sentence stating what this section communicates>",
      "target_words": [<min_int>, <max_int>],
      "depends_on": ["<other section id from this list>", ...],
      "validation": { "must_mention": ["..."], "must_not_exceed_words": <int> }
    }
  ]
}

YOUR JOB IS TO BREAK THE DOCUMENT INTO ITS NATURAL SECTIONS. The user has given you:
- A list of paragraphs from the FULL TEMPLATE BODY block, each tagged with its style, numbering reference, content control wrapper, and table membership
- Optionally, a list of "parser-detected sections" — treat these as ADVISORY only. If they're wrong, ignore them and output the right structure.

Your section list must reflect how a HUMAN AUTHOR would naturally segment THIS document type. Use the document's content, headings, numbering, and known conventions to decide:

- For a Performance Work Statement (PWS): sections 1-7 like "1. Scope", "2. Applicable Documents", "3. Definitions", "4. Government Furnished Items", "5. Performance Requirements", "6. Deliverables", "7. Inspection and Acceptance" — each broken into numbered subsections (1.1, 1.2, ...) when the template uses them.
- For a memorandum: addressee block ("MEMORANDUM FOR ..."), subject line ("SUBJECT: ..."), one or more body paragraphs, signature block, point-of-contact line. Each is its own section.
- For an SOP: Purpose, Scope, Responsibilities, Procedure (often subdivided), References, Revision History.
- For a policy: Purpose, Applicability, Policy, Responsibilities, Procedures, Definitions, References.
- For an after-action report: Executive Summary, Background, Observations, Findings, Recommendations.

GUIDANCE on each field:

- id: snake_case, descriptive, unique within this document. Examples: "purpose", "scope_and_objectives", "memorandum_for", "subject_line", "point_of_contact". Do not use generic ids like "section_1".

- name: the display name a reader would expect. For numbered docs, include the number ("1. Scope"). For memos, use the conventional label ("Subject", "Point of Contact").

- paragraph_range: [first_idx, last_idx] inclusive. Use the [N] indices from the FULL TEMPLATE BODY block. Each paragraph index belongs to AT MOST ONE section. Don't overlap. Together your sections should cover the meaningful body content, but you may omit paragraphs that are pure formatting noise (page numbers, repeated headers).

- intent: one sentence focused on the COMMUNICATIVE GOAL, not surface content. Good: "Define the scope of work the contractor is responsible for under this PWS." Bad: "This section is the scope section."

- target_words: realistic for a real document. Title/header sections are short (5-30 words). Purpose/scope sections are 80-200. Procedure or detailed-requirements sections are 400-1500. Memo signature blocks are 5-15.

- depends_on: only list other sections from your own output whose content the DRAFTER must already know. Most sections have no dependencies. A Responsibilities section often depends_on Scope. A Procedure section often depends_on Responsibilities and Scope.

- validation: ONLY concrete, verifiable rules. Use these forms:
    must_mention: [specific terms or phrases that must appear in the drafted text]
    must_not_mention: [specific terms or phrases that must not appear]
    must_not_exceed_words: integer hard cap
    must_be_at_least_words: integer minimum
  If you cannot identify a specific verifiable rule, OMIT the validation field entirely. Do NOT invent rules like "must be professional" or "must be clear" — those are not verifiable.

- banned_phrases: 0 to 7 specific phrases that would weaken THIS document if a drafter used them. Draw from formal-writing critiques RELEVANT to this document type. Examples for a government doc: "going forward", "leverage synergies", "best practices", "robust solution", "stakeholders". If the document doesn't suggest specific phrases to ban, return an empty array []. DO NOT pad the list with generic corporate jargon — five well-chosen items is better than fifty random ones.

- jargon_policy: one short sentence. Example: "Use FAR-defined contracting terms; avoid undefined acronyms."

CRITICAL CONSTRAINTS:
- Output ONE entry per natural section. A typical document has 5-15 sections. Over-segmentation (e.g. one entry per paragraph) and under-segmentation (one entry for the whole document) are both wrong.
- paragraph_range indices MUST come from the FULL TEMPLATE BODY block. Do not invent indices.
- Sections appear in the order they appear in the document.
- Return STRICT JSON. No markdown, no commentary.`;

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
  // paragraph of the document with its paragraph index AND structural
  // annotations (style, numbering, content control, table membership)
  // so the LLM can correlate role with content.
  lines.push(``);
  lines.push(
    `=== FULL TEMPLATE BODY (${full_body.lines.length}/${full_body.total_paragraphs} paragraphs, ${full_body.total_chars} chars${full_body.truncated ? '; TRAILING TRUNCATED' : ''}) ===`,
  );
  lines.push(
    `This is the verbatim text of the template document with structural annotations. Each line has the format:`,
  );
  lines.push(`  [<paragraph_index>] (<style_name> [num=<list_id>·<level>] [table] [sdt=<content_control_tag>] [bookmark=<name>]) "<text>"`);
  lines.push(
    `Annotations in parentheses tell you the paragraph's ROLE: the named style (Heading 1, Body Text, List Bullet, etc.), whether it's in a numbered list, whether it sits inside a table cell, whether it's wrapped by a Word content control (sdt — these are metadata fields like CUI banner, document number, classification), and any bookmarks. Use these annotations together with the text content to infer purpose. Bracketed instructional text like "[Insert purpose statement]" is the strongest signal of section intent.`,
  );
  for (const line of full_body.lines) {
    lines.push(formatBodyLine(line));
  }
  lines.push(`=== END FULL TEMPLATE BODY ===`);

  // ─── Parser-detected section hints (advisory) ──────────────────────
  // The parser made its best guess at sections. They are listed here as
  // a STARTING POINT only. The LLM is the author and should ignore or
  // override these as needed.
  lines.push(``);
  lines.push(
    `=== PARSER-DETECTED SECTIONS (${schema.sections.length}) — ADVISORY ONLY, override freely ===`,
  );
  if (schema.sections.length === 0) {
    lines.push(
      `(none — the parser found no headings or content controls. You must propose the section structure from scratch using the FULL TEMPLATE BODY above.)`,
    );
  } else {
    for (const sample of samples) {
      const range = sample.paragraph_range
        ? `paragraphs [${sample.paragraph_range[0]}, ${sample.paragraph_range[1]}]`
        : 'unanchored';
      lines.push(`  - "${sample.heading}" (${range})`);
    }
    lines.push(
      `These may be over-segmented (every heading-styled line was treated as a new section), wrong, or missing the structure a human would expect. Use them as hints, but produce the section list YOU think is right based on the document body.`,
    );
  }

  lines.push(``);
  lines.push(
    `Now produce your JSON output. Identify the natural sections of this document, anchor each one to its paragraph_range from the FULL TEMPLATE BODY block above, and return STRICT JSON in the schema specified.`,
  );

  return {
    system_prompt: SYSTEM_PROMPT,
    message: lines.join('\n'),
  };
}

function formatBodyLine(line: ParagraphLine): string {
  const annotations: string[] = [];
  const styleLabel = line.style_name ?? line.style_id ?? 'Normal';
  annotations.push(styleLabel);
  if (line.numbering_id !== null) {
    annotations.push(`num=${line.numbering_id}·${line.numbering_level ?? 0}`);
  }
  if (line.in_table) annotations.push('table');
  if (line.content_control_tag) annotations.push(`sdt=${line.content_control_tag}`);
  for (const b of line.bookmark_starts) annotations.push(`bookmark=${b}`);
  return `[${line.index}] (${annotations.join(' ')}) "${line.text}"`;
}

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

const SYSTEM_PROMPT = `You analyze government and military document TEMPLATES and design their section structure. You are the AUTHOR of the section list.

CRITICAL — TEMPLATES ARE REUSABLE FOR ANY SUBJECT
Templates ship with placeholder text that names a sample subject (e.g. "SHARP", "Equal Opportunity", "Suicide Prevention", "Mission Essential Personnel", "Market Research Report"). The user will REUSE this template for many DIFFERENT subjects. Your section list must be SUBJECT-AGNOSTIC — anything you bake into a section will force every future document made from this template to be about the placeholder subject. That is the #1 way templates break.

You always respond with STRICT JSON only. No markdown code fences, no prose, no explanation. The JSON must parse on the first attempt with JSON.parse().

OUTPUT SCHEMA — produce JSON in exactly this shape:
{
  "style": {
    "voice": "third_person" | "second_person" | "first_person_plural",
    "tense": "present" | "past",
    "register": "formal_government" | "technical" | "instructional" | "narrative",
    "jargon_policy": "<one short line about terminology choices, GENERIC>",
    "banned_phrases": ["<weak phrase>", ...]
  },
  "sections": [
    {
      "id": "<snake_case identifier you choose, e.g. scope_and_applicability>",
      "name": "<display name, e.g. '1. Scope'>",
      "paragraph_range": [<first_paragraph_index>, <last_paragraph_index>],
      "intent": "<one sentence stating the COMMUNICATIVE GOAL of this section in subject-agnostic language>",
      "target_words": [<min_int>, <max_int>],
      "depends_on": ["<other section id from this list>", ...],
      "style_notes": "<one short paragraph of plain-prose textual conventions for this section — ALL CAPS title? numbered list? formal passive voice? Anything the drafter needs to match the template's look-and-feel. Empty string if none.>",
      "visual_style": {
        "font_family": "<font family name or null>",
        "font_size_pt": <integer or null>,
        "alignment": "left" | "center" | "right" | "justify" | null,
        "numbering_convention": "none" | "manual_numeric" | "manual_lettered" | "ooxml_list" | null
      },
      "validation": { "must_not_exceed_words": <int>, "must_be_at_least_words": <int> }
    }
  ],
  "document_parts": [
    {
      "part_path": "<word/headerN.xml or word/footerN.xml, echo exactly from DOCUMENT_PARTS block>",
      "placement": "header" | "footer",
      "slots": [
        {
          "slot_index": <integer index from DOCUMENT_PARTS block; only TEXT-ONLY paragraphs, skip paragraphs marked has_drawing=true or has_complex_content=true>,
          "source_text": "<the EXACT source text from the DOCUMENT_PARTS block — echoed verbatim; merger rejects the output if this doesn't match>",
          "intent": "<one sentence subject-agnostic role of this slot, e.g. 'Organization name banner', 'Unit identifier', 'CUI marking'>",
          "style_notes": "<one short line — ALL CAPS? bold? abbreviations? — that the drafter must match>",
          "visual_style": { "font_family": <...>, "font_size_pt": <...>, "alignment": <...>, "numbering_convention": <...> }
        }
      ]
    }
  ]
}

YOUR JOB: break the document into its natural sections. The user has given you:
- Paragraphs from the FULL TEMPLATE BODY block, each tagged with style, numbering, content control, and table membership
- Optionally, parser-detected sections (advisory only — override freely)

Section list must reflect how a HUMAN AUTHOR would naturally segment THIS document TYPE (not subject):
- PWS: "1. Scope", "2. Applicable Documents", "3. Definitions", "4. Government Furnished Items", "5. Performance Requirements", "6. Deliverables", "7. Inspection and Acceptance".
- Memorandum: addressee block, subject line, body paragraphs, signature block, point-of-contact.
- SOP: Purpose, Scope, Responsibilities, Procedure, References, Revision History.
- Policy: Purpose, Applicability, Policy Statement, Responsibilities, Procedures, Definitions, References.
- After-action report: Executive Summary, Background, Observations, Findings, Recommendations.

GUIDANCE per field — read each carefully:

- id: snake_case, descriptive, unique. SUBJECT-AGNOSTIC. Examples:
    GOOD: "purpose", "scope_and_applicability", "responsibilities", "signature_block"
    BAD: "sharp_purpose", "transfusion_scope", "mission_essential_responsibilities"

- name: human display name. Use the structural label, not the subject.
    GOOD: "1. Scope", "Purpose", "Responsibilities"
    BAD: "1. SHARP Scope", "Purpose of the Mission Essential Memo"

- paragraph_range: inclusive [first_idx, last_idx] using [N] indices from the FULL TEMPLATE BODY block. Each index in at most one section. Don't overlap. Cover meaningful body content; omit pure formatting noise (page numbers, repeated headers).

- intent: one sentence describing the COMMUNICATIVE GOAL in subject-agnostic language. The intent must be true regardless of what subject the user later chooses.
    GOOD: "Define the document's scope and applicability to the target audience."
    GOOD: "List the responsibilities of each stakeholder named in the policy."
    GOOD: "Provide point-of-contact information for follow-up questions."
    BAD:  "Define the scope of the SHARP program."
    BAD:  "List who is responsible for executing the transfusion services policy."
    BAD:  "Identify mission essential personnel and provide justification."
    Test: if you removed every proper noun and replaced it with "the document," would the intent still make sense and be useful? If yes, it's good. If no, you've baked in subject matter — rewrite it.

- target_words: realistic for the SECTION TYPE, not the subject. Title/header: 5-30. Purpose/scope: 80-200. Procedures: 400-1500. Signature blocks: 5-15.

- depends_on: only list sections from your own output whose CONTENT the drafter must already know. Most sections have no dependencies. Responsibilities often depends_on Scope. Procedure often depends_on Responsibilities + Scope.

- validation: STRUCTURAL length caps ONLY. Use these two forms and nothing else:
    must_not_exceed_words: integer hard cap (use when the section type has a clear ceiling, e.g., a memo signature block must not exceed 30 words)
    must_be_at_least_words: integer floor (use when a section is meaningless if too short, e.g., a Scope section must be at least 30 words)
  DO NOT produce must_mention or must_not_mention. Those fields are deprecated. They were where synthesizers used to bake placeholder subject matter into the spec, forcing every future drafted document to be about SHARP / mission essential / equal opportunity / whatever the template's example subject was. The drafter now ignores both fields if it sees them. Skip them entirely.
  If a section has no concrete length cap, OMIT validation.

- banned_phrases: 0 to 7 weak/clichéd phrases that would weaken THIS document type if a drafter used them. Generic anti-jargon items like "going forward", "leverage", "synergy", "robust solution". DO NOT include subject-specific phrases. If you can't think of any specific to this document type, return an empty array.

- jargon_policy: one short sentence about terminology choice. Subject-agnostic. Example: "Use FAR-defined contracting terms; spell out acronyms on first use." Not: "Use SHARP-program terminology consistently."

CRITICAL CONSTRAINTS:
- Output ONE entry per natural section. A typical document has 5-15 sections. Over-segmentation (one entry per paragraph) and under-segmentation (one entry for the whole document) are both wrong.
- paragraph_range indices MUST come from the FULL TEMPLATE BODY block. Do not invent indices.
- Sections appear in document order.
- EVERY field must be subject-agnostic. The placeholder text in the template is an EXAMPLE. The user will reuse this template for an unrelated subject; your output must work for that case.
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
  lines.push(`  [<paragraph_index>] (<style_name> [num=<list_id>·<level>] [align=<center|right|justify>] [indent=<twips>] [bold] [italic] [table] [sdt=<content_control_tag>] [bookmark=<name>]) "<text>"`);
  lines.push(
    `Annotations in parentheses tell you the paragraph's STRUCTURAL ROLE:
  - style_name: the paragraph's named style (Heading 1, Body Text, List Bullet, Title, etc.)
  - num=<id>·<level>: paragraph is in a numbered or bulleted list at the given list level
  - align=...: non-left alignment (center / right / justify) — often signals headings, banners, or signature blocks
  - indent=<twips>: left indent in twips (1440 twips = 1 inch); larger values mean nested or sub-content
  - bold / italic: paragraph-level run properties — often signal headings, callouts, or instructional notes
  - table: paragraph is inside a table cell — often a structured field, responsibility matrix entry, or signature block
  - sdt=<tag>: paragraph is wrapped by a Word content control — these are explicit metadata placeholders (CUI banner, document number, classification, etc.) that the LLM should NOT include in body sections
  - bookmark=<name>: a Word bookmark starts on this paragraph — often marks a fillable region

Use these annotations together with the text content to infer each paragraph's purpose. Bracketed instructional text like "[Insert purpose statement]" combined with style/alignment/bold annotations is the strongest signal of section intent.`,
  );
  for (const line of full_body.lines) {
    lines.push(formatBodyLine(line));
  }
  lines.push(`=== END FULL TEMPLATE BODY ===`);

  // ─── Document parts (header/footer XML) ────────────────────────────
  // Page headers and footers live in separate XML parts. They hold
  // letterhead: organization banners, seals, unit identifiers, CUI
  // markings. We expose each paragraph as a numbered slot so the LLM
  // can author per-slot intent/style guidance. Drawing-bearing
  // paragraphs are marked has_drawing=true and MUST be skipped — the
  // assembler will never rewrite them.
  const docPartSections = schema.sections.filter(
    (s) => s.fill_region.kind === 'document_part',
  );
  if (docPartSections.length > 0) {
    lines.push(``);
    lines.push(`DOCUMENT_PARTS:`);
    for (const sec of docPartSections) {
      if (sec.fill_region.kind !== 'document_part') continue;
      const fr = sec.fill_region;
      const labelMatch = fr.part_path.match(/word\/(.*?)\.xml$/);
      const label = labelMatch ? labelMatch[1]! : fr.part_path;
      lines.push(`  ${label} (${fr.part_path}):`);
      for (const d of fr.paragraph_details) {
        const annot: string[] = [];
        annot.push(`align=${d.alignment ?? 'default'}`);
        if (d.font_family) annot.push(`font=${d.font_family}`);
        if (d.font_size_pt !== null) annot.push(`sz=${d.font_size_pt}`);
        annot.push(`has_drawing=${d.has_drawing}`);
        if (d.has_complex_content) annot.push(`has_complex_content=true`);
        lines.push(`    [${d.slot_index}] text=${JSON.stringify(d.text)}  ${annot.join('  ')}`);
      }
    }
    lines.push(
      `Each ${'${'}part{'}'} above is a page header or footer. For each, author a document_parts[] entry with slots[] covering only the TEXT-ONLY paragraphs (has_drawing=false, has_complex_content omitted). Echo source_text verbatim.`.replaceAll(
        '${part}',
        'part',
      ),
    );
  }

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
  if (line.alignment && line.alignment !== 'left') {
    annotations.push(`align=${line.alignment}`);
  }
  if (line.indent_left_twips && line.indent_left_twips > 0) {
    annotations.push(`indent=${line.indent_left_twips}`);
  }
  if (line.bold) annotations.push('bold');
  if (line.italic) annotations.push('italic');
  if (line.in_table) annotations.push('table');
  if (line.content_control_tag) annotations.push(`sdt=${line.content_control_tag}`);
  for (const b of line.bookmark_starts) annotations.push(`bookmark=${b}`);
  return `[${line.index}] (${annotations.join(' ')}) "${line.text}"`;
}

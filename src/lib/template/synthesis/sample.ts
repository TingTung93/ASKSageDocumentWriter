// Extracts content from the parsed paragraph sequence to give the LLM
// rich context for semantic synthesis. Two complementary outputs:
//
//   1. Per-section samples — anchored chunks of body text the LLM can
//      read to understand each section's purpose. These come from the
//      heading_bounded paragraph range when available, or a wider
//      neighborhood when the parser lost the boundary information.
//
//   2. The full template body — every paragraph of the document
//      concatenated with paragraph indices, capped at FULL_BODY_CAP.
//      DHA templates have rich placeholder/instruction text (e.g.
//      "[Provide a clear statement of the SOP's purpose, 2-3 sentences]")
//      that's the SINGLE MOST IMPORTANT signal the LLM has for inferring
//      what each section should contain. We'd rather pay the tokens to
//      send all of it than have the model guess.
//
// Synthesis runs once per template and the result is cached. Token
// economy here matters far less than the quality of the inference, so
// these caps are intentionally generous.

import type { ParagraphInfo } from '../parser';
import type { BodyFillRegion, TemplateSchema } from '../types';

/** Per-section sample cap in characters. ~4000 chars ≈ ~700 words. */
const SECTION_SAMPLE_CAP = 4000;

/**
 * Default total full-body cap in characters. Sized for the current
 * default synthesis model (Claude Sonnet 4.6, 200k context). The cap
 * leaves comfortable headroom for the system prompt (~3k tokens), the
 * structured-section JSON output (5–15k tokens), and a safety margin.
 *
 * 240,000 chars ≈ ~60k tokens, which fits even the largest DHA PWS
 * templates (~84k chars / ~21k tokens) without truncation.
 *
 * History: this used to be 40,000 — sized for Gemini Flash before we
 * switched defaults to Sonnet 4.6 — and silently dropped the back half
 * of any long template. Caller can override via extractFullBody opts.
 */
export const DEFAULT_FULL_BODY_CAP = 240_000;

/**
 * Average overhead added per line by formatBodyLine() in prompt.ts.
 * Real annotated lines look like `[123] (Heading 2 num=5·1) "..."`,
 * which averages 30–50 chars. Use 50 to stay slightly conservative.
 */
const PER_LINE_OVERHEAD = 50;

export interface SectionSample {
  section_id: string;
  heading: string;
  /** Anchored body text for this section, trimmed to SECTION_SAMPLE_CAP */
  sample_text: string;
  /** Paragraph index range used to extract the sample, if applicable */
  paragraph_range: [number, number] | null;
}

export interface ParagraphLine {
  index: number;
  text: string;
  /** styles.xml id (machine name) */
  style_id: string | null;
  /** Resolved human-readable style name from named_styles, if available */
  style_name: string | null;
  numbering_id: number | null;
  numbering_level: number | null;
  /** Paragraph-level overrides; null means "inherit from style" */
  alignment: 'left' | 'center' | 'right' | 'justify' | 'both' | null;
  indent_left_twips: number | null;
  indent_first_line_twips: number | null;
  indent_hanging_twips: number | null;
  bold: boolean;
  italic: boolean;
  /** Tag of the enclosing w:sdt content control, if any */
  content_control_tag: string | null;
  in_table: boolean;
  bookmark_starts: string[];
}

export interface FullBody {
  /** Paragraph-numbered lines that fit under FULL_BODY_CAP */
  lines: ParagraphLine[];
  /** True if FULL_BODY_CAP forced us to drop trailing paragraphs */
  truncated: boolean;
  /** Total non-empty paragraphs in the document */
  total_paragraphs: number;
  /** Total characters across all included lines */
  total_chars: number;
}

export function extractSamples(
  schema: TemplateSchema,
  paragraphs: ParagraphInfo[],
): SectionSample[] {
  return schema.sections.map((section) => extractOne(section, paragraphs));
}

function extractOne(section: BodyFillRegion, paragraphs: ParagraphInfo[]): SectionSample {
  const fr = section.fill_region;

  if (fr.kind === 'heading_bounded') {
    const start = Math.max(0, fr.anchor_paragraph_index + 1);
    const end = Math.min(paragraphs.length, fr.end_anchor_paragraph_index + 1);
    const slice = paragraphs.slice(start, end);
    return {
      section_id: section.id,
      heading: section.name,
      sample_text: joinTrim(slice, SECTION_SAMPLE_CAP),
      paragraph_range: [start, end - 1],
    };
  }

  // Fallback for content controls / bookmarks / placeholders. The
  // parser doesn't currently track which paragraph index a content
  // control begins at, so we widen to a generous neighborhood (the
  // first 30 non-empty paragraphs) and let the full-body block in the
  // prompt fill in any missing context. This is imperfect but the
  // full-body block makes it acceptable for v1.
  const wide = paragraphs.slice(0, 30);
  return {
    section_id: section.id,
    heading: section.name,
    sample_text: joinTrim(wide, SECTION_SAMPLE_CAP),
    paragraph_range: null,
  };
}

export interface ExtractFullBodyOptions {
  /** Override the per-call body cap in characters. Defaults to DEFAULT_FULL_BODY_CAP. */
  body_cap_chars?: number;
}

export function extractFullBody(
  paragraphs: ParagraphInfo[],
  schema?: TemplateSchema,
  opts?: ExtractFullBodyOptions,
): FullBody {
  const cap = opts?.body_cap_chars ?? DEFAULT_FULL_BODY_CAP;

  // Build style_id → style_name lookup once. We use the readable name
  // (e.g. "Heading 1") in the prompt instead of the machine id ("Heading1")
  // because the LLM has stronger priors about human-readable style names.
  const styleNameById = new Map<string, string>();
  if (schema) {
    for (const s of schema.formatting.named_styles) {
      styleNameById.set(s.id, s.name);
    }
  }

  // Include paragraphs that have either text content OR a content
  // control tag (an empty content control still carries semantic
  // information — it's a placeholder waiting to be filled).
  const significant = paragraphs.filter(
    (p) => p.text.trim().length > 0 || p.content_control_tag !== null,
  );

  const lines: ParagraphLine[] = [];
  let total = 0;
  let truncated = false;

  for (const p of significant) {
    const text = p.text.trim();
    const projected = total + text.length + PER_LINE_OVERHEAD;
    if (projected > cap) {
      truncated = true;
      break;
    }
    lines.push({
      index: p.index,
      text,
      style_id: p.style_id,
      style_name: p.style_id ? styleNameById.get(p.style_id) ?? null : null,
      numbering_id: p.numbering_id,
      numbering_level: p.numbering_level,
      alignment: p.alignment,
      indent_left_twips: p.indent_left_twips,
      indent_first_line_twips: p.indent_first_line_twips,
      indent_hanging_twips: p.indent_hanging_twips,
      bold: p.bold,
      italic: p.italic,
      content_control_tag: p.content_control_tag,
      in_table: p.in_table,
      bookmark_starts: p.bookmark_starts,
    });
    total = projected;
  }

  return {
    lines,
    truncated,
    total_paragraphs: significant.length,
    total_chars: total,
  };
}

function joinTrim(paras: ParagraphInfo[], cap: number): string {
  const text = paras
    .map((p) => p.text.trim())
    .filter((t) => t.length > 0)
    .join('\n');
  if (text.length <= cap) return text;
  return text.slice(0, cap - 1).trimEnd() + '…';
}

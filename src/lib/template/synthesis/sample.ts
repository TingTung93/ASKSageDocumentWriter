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
import type { TemplateSchema, BodyFillRegion } from '../types';

/** Per-section sample cap in characters. ~4000 chars ≈ ~700 words. */
const SECTION_SAMPLE_CAP = 4000;

/** Total full-body cap in characters. ~40000 chars ≈ ~7000 words ≈ ~10k tokens. */
const FULL_BODY_CAP = 40000;

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

export function extractFullBody(paragraphs: ParagraphInfo[]): FullBody {
  const nonEmpty = paragraphs.filter((p) => p.text.trim().length > 0);
  const lines: ParagraphLine[] = [];
  let total = 0;
  let truncated = false;

  for (const p of nonEmpty) {
    const text = p.text.trim();
    // Account for the line's overhead in the eventual prompt format
    // ("[NN] " prefix + newline). Use 8 chars as a conservative estimate.
    const projected = total + text.length + 8;
    if (projected > FULL_BODY_CAP) {
      truncated = true;
      break;
    }
    lines.push({ index: p.index, text });
    total = projected;
  }

  return {
    lines,
    truncated,
    total_paragraphs: nonEmpty.length,
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

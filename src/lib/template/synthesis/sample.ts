// Extracts a sample of body text per section from the parsed paragraph
// sequence. Used to give the LLM enough context to infer section intent
// without sending the entire document (token-frugal).

import type { ParagraphInfo } from '../parser';
import type { TemplateSchema, BodyFillRegion } from '../types';

const MAX_SAMPLE_CHARS = 600;

export interface SectionSample {
  section_id: string;
  heading: string;
  /** Concatenated body text, trimmed to MAX_SAMPLE_CHARS */
  sample_text: string;
}

export function extractSamples(
  schema: TemplateSchema,
  paragraphs: ParagraphInfo[],
): SectionSample[] {
  return schema.sections.map((section) => ({
    section_id: section.id,
    heading: section.name,
    sample_text: extractOne(section, paragraphs),
  }));
}

function extractOne(section: BodyFillRegion, paragraphs: ParagraphInfo[]): string {
  const fr = section.fill_region;
  if (fr.kind === 'heading_bounded') {
    // Take paragraphs strictly between the heading and the end anchor
    // (exclusive of the heading itself).
    const start = Math.max(0, fr.anchor_paragraph_index + 1);
    const end = Math.min(paragraphs.length, fr.end_anchor_paragraph_index + 1);
    const slice = paragraphs.slice(start, end);
    return joinTrim(slice);
  }
  // For other kinds, return whatever is currently in the surrounding
  // paragraph(s) — best effort. Future iterations can be smarter.
  return joinTrim(paragraphs.slice(0, 5));
}

function joinTrim(paras: ParagraphInfo[]): string {
  const text = paras
    .map((p) => p.text.trim())
    .filter((t) => t.length > 0)
    .join(' ');
  if (text.length <= MAX_SAMPLE_CHARS) return text;
  return text.slice(0, MAX_SAMPLE_CHARS - 1).trimEnd() + '…';
}

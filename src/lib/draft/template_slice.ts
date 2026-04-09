// template_slice.ts — pull the actual paragraphs of a single template
// section out of the parsed DOCX. Used by the per-section drafter to
// build the TEMPLATE EXAMPLE block (so the model sees how the section
// is shaped without baking in subject matter), and by the metadata
// batch drafter to give the size classifier a fallback word count
// when section.target_words is missing.
//
// Extracted from orchestrator.ts so the metadata batch and the size
// classifier can reuse it without dragging in the full drafting
// pipeline.

import type { ParagraphInfo } from '../template/parser';
import type { BodyFillRegion } from '../template/types';

/** Per-section template example cap. ~6k chars ≈ ~1500 tokens. */
export const TEMPLATE_EXAMPLE_CAP_CHARS = 6000;

/**
 * Slice the parsed template paragraphs for a single section using its
 * fill_region anchors. Returns the trimmed text joined with newlines,
 * or null if we can't determine the anchor range. Caps at
 * TEMPLATE_EXAMPLE_CAP_CHARS so a huge section doesn't blow the prompt.
 */
export function sliceTemplateExampleForSection(
  paragraphs: ParagraphInfo[],
  section: BodyFillRegion,
): string | null {
  const fr = section.fill_region;
  // document_part regions (page headers / footers) carry their own
  // original text on the descriptor — we can't slice them out of the
  // document.xml paragraph list because they live in a different XML
  // part. Use the captured lines as-is.
  if (fr.kind === 'document_part') {
    if (fr.original_text_lines.length === 0) return null;
    const text = fr.original_text_lines.join('\n');
    if (text.length <= TEMPLATE_EXAMPLE_CAP_CHARS) return text;
    return text.slice(0, TEMPLATE_EXAMPLE_CAP_CHARS - 1).trimEnd() + '…';
  }
  if (paragraphs.length === 0) return null;
  if (fr.kind !== 'heading_bounded') {
    // content_control / bookmark / placeholder regions don't carry
    // paragraph anchors. The section spec still has its name and
    // intent so the model isn't flying blind.
    return null;
  }
  const start = Math.max(0, fr.anchor_paragraph_index + 1);
  const end = Math.min(paragraphs.length - 1, fr.end_anchor_paragraph_index);
  if (end < start) return null;
  const slice = paragraphs.slice(start, end + 1);
  const text = slice
    .map((p) => p.text.trim())
    .filter((t) => t.length > 0)
    .join('\n');
  if (text.length === 0) return null;
  if (text.length <= TEMPLATE_EXAMPLE_CAP_CHARS) return text;
  return text.slice(0, TEMPLATE_EXAMPLE_CAP_CHARS - 1).trimEnd() + '…';
}

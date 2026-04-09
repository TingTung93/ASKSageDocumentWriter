// section_size.ts — classify a template section by expected output length
// so the recipe can route trivially-short fields ("Memorandum For", date,
// signature blocks) into a single batched LLM call instead of running the
// full per-section reference-inlined drafting loop on each one.
//
// Why this exists: drafting a 7-word "Memorandum For" line was sending the
// entire 28k-token reference doc and burning the user's monthly quota. The
// reference budget should scale with the output, not with the budget cap.
//
// Source of truth, in order:
//   1. section.target_words[1] — populated by template synthesis (Phase 1b)
//   2. word count of the parsed template_example slice (orchestrator
//      already extracts this; pass it in when available)
//   3. fallback bucket = 'body' so unknown sections get the standard
//      drafting path rather than being silently dropped into the metadata
//      batch.

import type { BodyFillRegion } from '../template/types';
import type { SectionMapping } from '../agent/section_mapping';

export type SectionSizeClass = 'inline_metadata' | 'short' | 'body' | 'long';

/**
 * Upper bounds (in words) for each bucket. Boundaries are inclusive of the
 * lower bucket — a section with target_words[1] === 60 is `inline_metadata`,
 * 61 is `short`. Tuned for DHA contracting templates: 60 captures titles,
 * dates, MFR addressee blocks, document numbers, POC lines, and most
 * signature blocks without grabbing real prose sections.
 */
export const INLINE_METADATA_MAX_WORDS = 60;
export const SHORT_MAX_WORDS = 200;
export const BODY_MAX_WORDS = 700;

export interface ClassifyArgs {
  section: BodyFillRegion;
  /**
   * Optional pre-extracted template example text for this section. The
   * orchestrator already slices this from the parsed DOCX; pass it in to
   * use as a fallback when target_words is missing.
   */
  template_example?: string | null;
  /**
   * Optional reference→section mapping output for this section, from
   * the mapping stage. When supplied:
   *   - The effective word budget becomes
   *       max(template upper bound, mapping.estimated_content_words)
   *     so a 40-word DHA-policy placeholder section with 1800 words of
   *     mapped MAMC source content lands in `long`, not
   *     `inline_metadata`.
   *   - A section can ONLY end up in `inline_metadata` if BOTH the
   *     template upper bound AND the matched-chunk count agree it's
   *     trivial. A section with any matched chunks is at minimum
   *     `short` regardless of how short the template example is.
   */
  mapping?: SectionMapping;
}

/**
 * Classify a section into a size bucket. Prefers the maximum of the
 * template's `target_words[1]` and the mapping's
 * `estimated_content_words` so a content-rich source can override a
 * bare-bones template. Falls back to counting words in the template
 * example, and finally defaults to `'body'` so unknown sections still
 * get drafted properly — over-budgeting is safer than silently
 * dropping a real prose section into the metadata one-shot.
 */
export function classifySectionSize(args: ClassifyArgs): SectionSizeClass {
  const templateBound = pickWordCount(args.section, args.template_example);
  const mappingBound = args.mapping?.estimated_content_words ?? 0;
  const matchedChunkCount = args.mapping?.matched_chunk_ids.length ?? 0;

  const effective = Math.max(templateBound ?? 0, mappingBound);
  let bucket: SectionSizeClass;
  if (templateBound === null && mappingBound === 0) {
    bucket = 'body';
  } else if (effective <= INLINE_METADATA_MAX_WORDS) {
    bucket = 'inline_metadata';
  } else if (effective <= SHORT_MAX_WORDS) {
    bucket = 'short';
  } else if (effective <= BODY_MAX_WORDS) {
    bucket = 'body';
  } else {
    bucket = 'long';
  }

  // Hard guard: any section the mapper thinks has reference content
  // CANNOT be drafted by the metadata batch. Even when the template
  // and the estimate both say short, mapped chunks mean there's
  // substantive source material to absorb — that needs the per-
  // section drafter, not a one-shot key→value fill.
  if (bucket === 'inline_metadata' && matchedChunkCount > 0) {
    return 'short';
  }
  return bucket;
}

/**
 * Resolve the effective expected word count for a section. Returns null
 * when neither target_words nor a template example is available.
 */
export function pickWordCount(
  section: BodyFillRegion,
  template_example?: string | null,
): number | null {
  if (section.target_words && section.target_words.length === 2) {
    const [, hi] = section.target_words;
    if (typeof hi === 'number' && hi > 0) return hi;
  }
  if (template_example && template_example.trim().length > 0) {
    return countWords(template_example);
  }
  return null;
}

/** Whitespace-tokenized word count. Cheap; only used for sizing decisions. */
export function countWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/).length;
}

// Sanity scan for synthesized template schemas. The drafting-time
// SUBJECT block already overrides any baked-in subject matter, but
// it's still useful to warn the user when a freshly synthesized
// section intent contains proper-noun-style domain markers — that's a
// signal the synthesis prompt's subject-agnosticism rule didn't fully
// take, and the template will produce slightly worse drafts than a
// clean one.
//
// The scan walks each section's `intent` and `name`, tokenizes on
// whitespace, and flags tokens that look like subject matter:
//
//   - All-caps acronyms ≥3 chars not on a known whitelist
//   - TitleCase words not at the start of a sentence (proper nouns
//     in the middle of a sentence are usually subject names like
//     "Diasorin", "SHARP", "DoDI 6495.02")
//
// False positives are tolerable here: this is a soft warning, not a
// hard validation gate.

import type { BodyFillRegion } from '../types';
import type { SubjectLeakageWarning } from './types';

/**
 * Acronyms that are STRUCTURAL (i.e., describe the document type or
 * common government boilerplate) and shouldn't trigger a warning even
 * though they're all-caps. Add to this list as you find more.
 */
const ACRONYM_WHITELIST = new Set([
  'PWS',
  'SOW',
  'SOO',
  'IGE',
  'CUI',
  'POC',
  'FAR',
  'DFARS',
  'DOD',
  'DODI',
  'DHA',
  'AAR',
  'SOP',
  'CDRL',
  'OCONUS',
  'CONUS',
  'JSON',
  'PDF',
  'DOCX',
  'TBD',
  'NA',
  'N/A',
  'AI',
  'IT',
  'NIST',
  'OCO',
]);

/**
 * Title-cased words that are STRUCTURAL (section labels, document
 * type names) and shouldn't trigger a warning. These appear in many
 * legitimate intents.
 */
const STRUCTURAL_TITLECASE = new Set([
  'Section',
  'Sections',
  'Document',
  'Template',
  'Performance',
  'Work',
  'Statement',
  'Memorandum',
  'Policy',
  'Procedure',
  'Procedures',
  'Scope',
  'Purpose',
  'Applicability',
  'Responsibilities',
  'References',
  'Definitions',
  'Acquisition',
  'Government',
  'Federal',
  'Agency',
  'Department',
  'Office',
  'Subject',
  'Background',
  'Overview',
  'Summary',
  'Findings',
  'Recommendations',
  'Mission',
  'Essential',
  'Standard',
  'Operating',
]);

export function scanSchemaForSubjectLeakage(
  sections: BodyFillRegion[],
): SubjectLeakageWarning[] {
  const warnings: SubjectLeakageWarning[] = [];
  for (const section of sections) {
    const texts: string[] = [];
    if (section.intent) texts.push(section.intent);
    if (section.style_notes) texts.push(section.style_notes);
    // document_part slots carry their own intent / style_notes; scan
    // each slot's strings too.
    if (section.fill_region.kind === 'document_part' && section.fill_region.slots) {
      for (const slot of section.fill_region.slots) {
        if (slot.intent) texts.push(slot.intent);
        if (slot.style_notes) texts.push(slot.style_notes);
      }
    }
    const all = texts.join(' ');
    if (!all.trim()) continue;
    const flagged = flagSubjectTokens(all);
    if (flagged.length >= 1 && section.style_notes && flagSubjectTokens(section.style_notes).length > 0) {
      // style_notes leaks trigger on a single flagged token (prompt
      // promises subject-agnostic prose, so any proper noun is a tell).
      warnings.push({
        section_id: section.id,
        section_name: section.name,
        intent: section.intent ?? '',
        flagged_tokens: flagged,
      });
      continue;
    }
    if (flagged.length >= 2) {
      warnings.push({
        section_id: section.id,
        section_name: section.name,
        intent: section.intent ?? '',
        flagged_tokens: flagged,
      });
    }
  }
  return warnings;
}

function flagSubjectTokens(text: string): string[] {
  const flagged: string[] = [];
  // Split on whitespace AND punctuation that commonly attaches to
  // proper nouns (commas, periods, parens, semicolons).
  const tokens = text.split(/[\s,.;:()"'\u201c\u201d]+/).filter((t) => t.length > 0);
  let firstWord = true;
  for (const raw of tokens) {
    if (firstWord) {
      firstWord = false;
      continue; // skip first word — sentences naturally start TitleCase
    }
    const stripped = raw.replace(/[^A-Za-z0-9/\-]/g, '');
    if (stripped.length < 3) continue;

    // All-caps acronym ≥3 chars (allow digits and dashes)
    if (/^[A-Z][A-Z0-9/\-]{2,}$/.test(stripped)) {
      if (!ACRONYM_WHITELIST.has(stripped)) flagged.push(stripped);
      continue;
    }

    // TitleCase mid-sentence (uppercase first, then lowercase letters)
    if (/^[A-Z][a-z]+$/.test(stripped) && stripped.length >= 4) {
      if (!STRUCTURAL_TITLECASE.has(stripped)) flagged.push(stripped);
    }
  }
  // De-dupe while preserving order
  return Array.from(new Set(flagged));
}

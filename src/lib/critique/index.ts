// Phase 4 critic STUB. Runs deterministic validation rules against a
// drafted section and reports any issues. The LLM-based critique pass
// is not implemented yet — this file is the structural placeholder.

import type { BodyFillRegion } from '../template/types';
import type { DraftParagraph } from '../draft/types';

export interface ValidationIssue {
  rule: string;
  severity: 'error' | 'warning';
  message: string;
}

export function runValidation(
  section: BodyFillRegion,
  paragraphs: DraftParagraph[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const rules = section.validation ?? {};

  const wholeText = paragraphs.map((p) => p.text).join(' ');
  const wordCount = wholeText.trim().split(/\s+/).filter((w) => w.length > 0).length;

  // must_not_exceed_words
  const maxWords = (rules as { must_not_exceed_words?: number }).must_not_exceed_words;
  if (typeof maxWords === 'number' && wordCount > maxWords) {
    issues.push({
      rule: 'must_not_exceed_words',
      severity: 'error',
      message: `Drafted ${wordCount} words; max ${maxWords}.`,
    });
  }

  // must_be_at_least_words
  const minWords = (rules as { must_be_at_least_words?: number }).must_be_at_least_words;
  if (typeof minWords === 'number' && wordCount < minWords) {
    issues.push({
      rule: 'must_be_at_least_words',
      severity: 'warning',
      message: `Drafted ${wordCount} words; minimum ${minWords}.`,
    });
  }

  // must_mention
  const mustMention = (rules as { must_mention?: string[] }).must_mention ?? [];
  for (const phrase of mustMention) {
    if (!wholeText.toLowerCase().includes(phrase.toLowerCase())) {
      issues.push({
        rule: 'must_mention',
        severity: 'error',
        message: `Required phrase not found: "${phrase}"`,
      });
    }
  }

  // must_not_mention
  const mustNotMention = (rules as { must_not_mention?: string[] }).must_not_mention ?? [];
  for (const phrase of mustNotMention) {
    if (wholeText.toLowerCase().includes(phrase.toLowerCase())) {
      issues.push({
        rule: 'must_not_mention',
        severity: 'warning',
        message: `Banned phrase appears: "${phrase}"`,
      });
    }
  }

  // target_words soft check (warning only)
  if (section.target_words) {
    const [tmin, tmax] = section.target_words;
    if (wordCount < tmin * 0.5) {
      issues.push({
        rule: 'target_words',
        severity: 'warning',
        message: `Drafted ${wordCount} words; target range ${tmin}-${tmax}. Looks short.`,
      });
    } else if (wordCount > tmax * 1.5) {
      issues.push({
        rule: 'target_words',
        severity: 'warning',
        message: `Drafted ${wordCount} words; target range ${tmin}-${tmax}. Looks long.`,
      });
    }
  }

  return issues;
}

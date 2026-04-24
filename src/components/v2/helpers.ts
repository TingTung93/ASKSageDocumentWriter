// Pure helpers shared by V2 view components. Kept in its own module so
// they can be unit-tested without pulling in the component tree (Dexie,
// React Router, etc.).

import type { TemplateRecord, AuditRecord } from '../../lib/db/schema';
import type { DraftParagraph } from '../../lib/draft/types';

export interface FreeformChunk {
  /** Stable id for React keys / scroll targets. */
  id: string;
  /** Heading text if this chunk starts with an H1, else a synthetic label. */
  heading: string;
  /** Paragraphs belonging to this chunk, including the H1 itself (if any). */
  paragraphs: DraftParagraph[];
  /** Index into the source `freeform_draft` where this chunk starts. */
  start: number;
  /** Exclusive end index. */
  end: number;
}

/**
 * Split a freeform draft into H1-bounded chunks. The first chunk covers
 * any preamble paragraphs before the first H1 (or the entire draft if
 * no H1 is present).
 */
export function chunkFreeformByH1(paragraphs: DraftParagraph[]): FreeformChunk[] {
  if (paragraphs.length === 0) return [];
  const chunks: FreeformChunk[] = [];
  let start = 0;
  let heading = 'Preamble';
  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i]!;
    const isH1 = p.role === 'heading' && (p.level ?? 0) === 0;
    if (isH1 && i !== start) {
      chunks.push({
        id: `chunk-${chunks.length}`,
        heading,
        paragraphs: paragraphs.slice(start, i),
        start,
        end: i,
      });
      start = i;
      heading = p.text ?? 'Section';
    } else if (isH1 && i === start) {
      heading = p.text ?? 'Section';
    }
  }
  chunks.push({
    id: `chunk-${chunks.length}`,
    heading,
    paragraphs: paragraphs.slice(start),
    start,
    end: paragraphs.length,
  });
  return chunks;
}

export type AuditKind = 'draft' | 'critic' | 'review' | 'embed';

/**
 * Map a free-form endpoint string to one of the four visual "kind" pills
 * rendered in the audit log. Heuristic is match-in-order: embed wins over
 * critic wins over review, everything else is draft. The ordering matches
 * the CSS hue palette in the design system.
 */
export function inferAuditKind(endpoint: string): AuditKind {
  const e = endpoint.toLowerCase();
  if (e.includes('embed')) return 'embed';
  if (e.includes('critic') || e.includes('critique')) return 'critic';
  if (e.includes('models') || e.includes('synthes')) return 'review';
  return 'draft';
}

/** One-line human summary for an audit row. Truncates the prompt excerpt. */
export function auditSummaryLine(r: AuditRecord): string {
  const parts: string[] = [r.endpoint];
  if (r.model) parts.push(r.model);
  if (r.prompt_excerpt) parts.push(r.prompt_excerpt.slice(0, 80).replace(/\s+/g, ' '));
  return parts.join(' · ');
}

/** HH:MM:SS formatter with a safe fallback when the stamp isn't parseable. */
export function formatAuditTime(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/**
 * Guess a contracting template's kind from its name/filename. The match
 * order matters — PWS is checked before SOW because "PWS" doesn't
 * collide, while "Statement of Work" triggers SOW even if the filename
 * mentions "Performance" elsewhere.
 */
export function inferTemplateKind(t: TemplateRecord): string {
  // Normalize hyphens/underscores to spaces so patterns like
  // "market-research" and "cost_estimate" match the plain-English forms.
  const name = `${t.name} ${t.filename}`.toLowerCase().replace(/[-_]+/g, ' ');
  if (name.includes('pws') || name.includes('performance work')) return 'PWS';
  if (name.includes('j&a') || name.includes('justification')) return 'J&A';
  if (name.includes('market research')) return 'Market research';
  if (name.includes('memo') || name.includes('memorandum')) return 'Memo';
  if (name.includes('igce') || name.includes('cost estimate')) return 'IGCE';
  if (name.includes('sow') || name.includes('statement of work')) return 'SOW';
  return 'Template';
}

/** Chip row for a template card: section count, ingest date, analysis state. */
export function summarizeTemplateChips(t: TemplateRecord): string[] {
  const sectionCount = t.schema_json.sections.length;
  const ingested = t.ingested_at ? new Date(t.ingested_at).toLocaleDateString() : '—';
  const hasSemantic = t.schema_json.source.semantic_synthesizer !== null;
  return [
    `${sectionCount} section${sectionCount === 1 ? '' : 's'}`,
    `ingested ${ingested}`,
    hasSemantic ? 'analyzed' : 'structural',
  ];
}

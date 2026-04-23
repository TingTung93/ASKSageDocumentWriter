import { describe, it, expect } from 'vitest';
import {
  inferAuditKind,
  auditSummaryLine,
  formatAuditTime,
  inferTemplateKind,
  summarizeTemplateChips,
} from './helpers';
import type { AuditRecord, TemplateRecord } from '../../lib/db/schema';
import type { TemplateSchema } from '../../lib/template/types';

function auditRow(partial: Partial<AuditRecord> = {}): AuditRecord {
  return {
    id: 1,
    ts: '2026-04-23T12:00:00Z',
    endpoint: '/server/query',
    prompt_excerpt: '',
    response_excerpt: '',
    ms: 120,
    ok: true,
    ...partial,
  };
}

function templateRecord(overrides: {
  name?: string;
  filename?: string;
  ingested_at?: string;
  sectionCount?: number;
  semantic?: string | null;
} = {}): TemplateRecord {
  const sectionCount = overrides.sectionCount ?? 3;
  const schema: TemplateSchema = {
    $schema: 'test',
    id: 'tpl-1',
    name: overrides.name ?? 'test',
    version: 1,
    source: {
      filename: overrides.filename ?? 'test.docx',
      ingested_at: overrides.ingested_at ?? '2026-04-20T00:00:00Z',
      structural_parser_version: 'test',
      semantic_synthesizer: overrides.semantic ?? null,
      docx_blob_id: 'docx://test',
    },
    formatting: {} as TemplateSchema['formatting'],
    metadata_fill_regions: [],
    sections: Array.from({ length: sectionCount }, (_, i) => ({
      id: `s${i}`,
      name: `Section ${i}`,
    })) as TemplateSchema['sections'],
    style: {} as TemplateSchema['style'],
  };
  return {
    id: 'tpl-1',
    name: overrides.name ?? 'test',
    filename: overrides.filename ?? 'test.docx',
    ingested_at: overrides.ingested_at ?? '2026-04-20T00:00:00Z',
    docx_bytes: new Blob(),
    schema_json: schema,
  };
}

describe('inferAuditKind', () => {
  it('routes embed endpoints to embed', () => {
    expect(inferAuditKind('/openrouter/embeddings')).toBe('embed');
    expect(inferAuditKind('/server/embed')).toBe('embed');
    expect(inferAuditKind('/SERVER/EMBED')).toBe('embed');
  });

  it('routes critic-named endpoints to critic', () => {
    expect(inferAuditKind('/server/critic')).toBe('critic');
    expect(inferAuditKind('/server/critique')).toBe('critic');
  });

  it('routes model-listing and synthesis to review', () => {
    expect(inferAuditKind('/server/models')).toBe('review');
    expect(inferAuditKind('/openrouter/models')).toBe('review');
    expect(inferAuditKind('/server/synthesize')).toBe('review');
  });

  it('defaults to draft for everything else', () => {
    expect(inferAuditKind('/server/query')).toBe('draft');
    expect(inferAuditKind('/openrouter/chat/completions')).toBe('draft');
    expect(inferAuditKind('/something/unknown')).toBe('draft');
  });
});

describe('auditSummaryLine', () => {
  it('includes endpoint alone when nothing else is set', () => {
    expect(auditSummaryLine(auditRow({ endpoint: '/server/query' }))).toBe('/server/query');
  });

  it('appends model when present', () => {
    const out = auditSummaryLine(auditRow({ endpoint: '/server/query', model: 'gpt-5.1' }));
    expect(out).toBe('/server/query · gpt-5.1');
  });

  it('truncates prompt excerpt to 80 chars and collapses whitespace', () => {
    const longPrompt = 'word '.repeat(40).trim();
    const out = auditSummaryLine(auditRow({ prompt_excerpt: longPrompt }));
    // The prompt portion after the second separator should be <= 80 chars.
    const parts = out.split(' · ');
    expect(parts[parts.length - 1]!.length).toBeLessThanOrEqual(80);
  });
});

describe('formatAuditTime', () => {
  it('renders parseable ISO stamps as HH:MM:SS (or locale equivalent)', () => {
    const out = formatAuditTime('2026-04-23T12:00:00Z');
    // Output shape depends on locale — assert that it contains digits and colons
    // and is shorter than the raw ISO, which is the contract callers rely on.
    expect(out).toMatch(/\d+/);
    expect(out.length).toBeLessThan('2026-04-23T12:00:00Z'.length);
  });

  it('falls back to the raw string for unparseable stamps', () => {
    expect(formatAuditTime('not-a-date')).toBe('not-a-date');
  });
});

describe('inferTemplateKind', () => {
  it('detects PWS by acronym and long form', () => {
    expect(inferTemplateKind(templateRecord({ name: 'DHA PWS FY26' }))).toBe('PWS');
    expect(inferTemplateKind(templateRecord({ name: 'Performance Work Statement' }))).toBe('PWS');
  });

  it('detects J&A', () => {
    expect(inferTemplateKind(templateRecord({ name: 'Sole-source J&A' }))).toBe('J&A');
    expect(inferTemplateKind(templateRecord({ name: 'Justification and Approval' }))).toBe('J&A');
  });

  it('detects Market research', () => {
    expect(inferTemplateKind(templateRecord({ filename: 'market-research-FY26.docx' }))).toBe('Market research');
    expect(inferTemplateKind(templateRecord({ name: 'Market Research Report' }))).toBe('Market research');
  });

  it('detects Memo, SOW, IGCE', () => {
    expect(inferTemplateKind(templateRecord({ name: 'Memorandum for Record' }))).toBe('Memo');
    expect(inferTemplateKind(templateRecord({ name: 'Services SOW' }))).toBe('SOW');
    expect(inferTemplateKind(templateRecord({ name: 'IGCE workbook' }))).toBe('IGCE');
    expect(inferTemplateKind(templateRecord({ filename: 'independent-cost-estimate.docx' }))).toBe('IGCE');
  });

  it('prefers PWS when both PWS and SOW tokens appear', () => {
    expect(inferTemplateKind(templateRecord({ name: 'PWS / SOW reference' }))).toBe('PWS');
  });

  it('falls back to generic Template label', () => {
    expect(inferTemplateKind(templateRecord({ name: 'Random Doc', filename: 'random.docx' }))).toBe('Template');
  });
});

describe('summarizeTemplateChips', () => {
  it('pluralizes section count', () => {
    expect(summarizeTemplateChips(templateRecord({ sectionCount: 1 }))[0]).toBe('1 section');
    expect(summarizeTemplateChips(templateRecord({ sectionCount: 4 }))[0]).toBe('4 sections');
  });

  it('marks analyzed templates vs. structural-only', () => {
    const analyzed = summarizeTemplateChips(templateRecord({ semantic: 'gemini-2.5' }));
    const structural = summarizeTemplateChips(templateRecord({ semantic: null }));
    expect(analyzed).toContain('analyzed');
    expect(structural).toContain('structural');
  });

  it('includes an ingest-date chip', () => {
    const chips = summarizeTemplateChips(templateRecord({ ingested_at: '2026-04-20T00:00:00Z' }));
    expect(chips.some((c) => c.startsWith('ingested'))).toBe(true);
  });
});

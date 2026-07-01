import type { QueryResponse } from '../asksage/types';
import type { LLMClient } from '../provider/types';
import { dedupeCitations, extractUrls } from './citations';
import type {
  ResearchCitation,
  ResearchDepth,
  ResearchFinding,
  ResearchRequest,
  ResearchResult,
} from './types';

interface ResearchModelOutput {
  query_plan?: unknown;
  findings?: unknown;
  citations?: unknown;
  gaps?: unknown;
  markdown?: unknown;
}

interface PromptInput {
  project_name: string;
  project_description: string;
  objective: string;
  focus_questions?: string;
  depth: ResearchDepth;
}

export function buildResearchPrompt(input: PromptInput): string {
  const depthGuidance = {
    quick: 'Produce 3-5 findings and 5-8 citations.',
    standard: 'Produce 5-8 findings and 8-12 citations.',
    deep: 'Produce 8-12 findings, 12-20 citations, and explicit follow-up gaps.',
  }[input.depth];

  return [
    'You are preparing a research pack for a document-writing project.',
    '',
    `Project: ${input.project_name}`,
    `Project description: ${input.project_description || '(none provided)'}`,
    `Research objective: ${input.objective}`,
    input.focus_questions?.trim()
      ? `Focus questions:\n${input.focus_questions.trim()}`
      : 'Focus questions: Use the objective and project description.',
    '',
    'Use live web search. Prefer authoritative, current, primary sources where available.',
    depthGuidance,
    '',
    'Return strict JSON with exactly these top-level keys:',
    '- query_plan: string[] of the searches or research angles used',
    '- findings: array of { text: string, citation_ids: string[] }',
    '- citations: array of { title: string, url?: string, source_type?: string, excerpt?: string }',
    '- gaps: string[] of uncertainties or follow-up searches',
    '- markdown: a Markdown reference pack with heading, summary, findings, source table, and gaps',
    '',
    'Every substantive finding must include citation_ids that point to citations in the same JSON.',
    'The markdown field must be a complete Markdown reference pack that can be attached as a project reference document.',
  ].join('\n');
}

export async function runAskSageResearch(
  client: LLMClient,
  input: ResearchRequest,
): Promise<ResearchResult> {
  if (!client.capabilities.liveSearch) {
    throw new Error('Research requires a provider with live web search support.');
  }

  const { data, raw } = await client.queryJson<ResearchModelOutput>({
    message: buildResearchPrompt(input),
    model: input.model,
    dataset: 'none',
    live: 2,
    limit_references: 10,
    temperature: 0.2,
    usage: true,
  });

  const generatedAt = new Date().toISOString();
  const citations = buildCitations(data, raw);
  const findings = normalizeFindings(data.findings, citations);
  const markdown = typeof data.markdown === 'string' && data.markdown.trim()
    ? data.markdown.trim()
    : renderFallbackMarkdown(input.objective, findings, citations, normalizeStringArray(data.gaps));

  return {
    pack: {
      id: newId('research'),
      objective: input.objective.trim(),
      depth: input.depth,
      generated_at: generatedAt,
      query_plan: normalizeStringArray(data.query_plan),
      findings,
      citations,
      gaps: normalizeStringArray(data.gaps),
      markdown,
      raw_references: raw.references,
    },
    tokens_in: raw.usage?.prompt_tokens ?? 0,
    tokens_out: raw.usage?.completion_tokens ?? 0,
    model: input.model,
  };
}

function buildCitations(data: ResearchModelOutput, raw: QueryResponse): ResearchCitation[] {
  const citations: ResearchCitation[] = [];
  const modelCitations = Array.isArray(data.citations) ? data.citations : [];

  modelCitations.forEach((rawCitation, index) => {
    if (!rawCitation || typeof rawCitation !== 'object') return;
    const citation = rawCitation as Record<string, unknown>;
    const url = typeof citation.url === 'string' ? citation.url.trim() : undefined;
    const title =
      typeof citation.title === 'string' && citation.title.trim()
        ? citation.title.trim()
        : url ?? `Source ${index + 1}`;
    citations.push({
      id: typeof citation.id === 'string' && citation.id.trim()
        ? citation.id.trim()
        : `c${index + 1}`,
      title,
      url,
      source_type: normalizeSourceType(citation.source_type),
      excerpt: typeof citation.excerpt === 'string' ? citation.excerpt.trim() : undefined,
    });
  });

  for (const url of extractUrls(raw.references ?? '')) {
    citations.push({
      id: newId('citation'),
      title: url,
      url,
      source_type: 'ask_sage_reference',
    });
  }

  if (typeof data.markdown === 'string') {
    for (const url of extractUrls(data.markdown)) {
      citations.push({
        id: newId('citation'),
        title: url,
        url,
        source_type: 'model_cited',
      });
    }
  }

  return dedupeCitations(citations);
}

function normalizeFindings(rawFindings: unknown, citations: ResearchCitation[]): ResearchFinding[] {
  const citationIds = new Set(citations.map((citation) => citation.id));
  const findings = Array.isArray(rawFindings) ? rawFindings : [];

  return findings
    .map((rawFinding, index): ResearchFinding | null => {
      if (typeof rawFinding === 'string') {
        return { id: `finding_${index + 1}`, text: rawFinding.trim(), citation_ids: [] };
      }
      if (!rawFinding || typeof rawFinding !== 'object') return null;
      const finding = rawFinding as Record<string, unknown>;
      const text = typeof finding.text === 'string' ? finding.text.trim() : '';
      if (!text) return null;
      const rawIds = Array.isArray(finding.citation_ids) ? finding.citation_ids : [];
      const normalizedIds = rawIds
        .filter((id): id is string => typeof id === 'string')
        .map((id) => id.trim())
        .filter((id) => citationIds.has(id));
      return {
        id: typeof finding.id === 'string' && finding.id.trim()
          ? finding.id.trim()
          : `finding_${index + 1}`,
        text,
        citation_ids: normalizedIds,
      };
    })
    .filter((finding): finding is ResearchFinding => Boolean(finding));
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeSourceType(value: unknown): ResearchCitation['source_type'] {
  switch (value) {
    case 'ask_sage_reference':
    case 'model_cited':
    case 'provider_reference':
    case 'web_result':
      return value;
    default:
      return 'web_result';
  }
}

function renderFallbackMarkdown(
  objective: string,
  findings: ResearchFinding[],
  citations: ResearchCitation[],
  gaps: string[],
): string {
  const lines = [`# Research Pack`, '', `Objective: ${objective}`, '', '## Findings'];
  for (const finding of findings) {
    lines.push(`- ${finding.text}`);
  }
  lines.push('', '## Sources');
  for (const citation of citations) {
    lines.push(`- ${citation.url ? `[${citation.title}](${citation.url})` : citation.title}`);
  }
  if (gaps.length > 0) {
    lines.push('', '## Gaps');
    for (const gap of gaps) lines.push(`- ${gap}`);
  }
  return lines.join('\n');
}

function newId(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e9)}`;
}

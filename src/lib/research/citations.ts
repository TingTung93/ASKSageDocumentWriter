import type { ResearchCitation, ResearchPack, ResearchValidation } from './types';

const URL_RE = /https?:\/\/[^\s<>"'`]+/gi;

export function extractUrls(text: string): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const match of text.matchAll(URL_RE)) {
    const url = stripTrailingPunctuation(match[0]);
    const key = normalizeCitationUrl(url);
    if (!seen.has(key)) {
      seen.add(key);
      urls.push(url);
    }
  }
  return urls;
}

export function normalizeCitationUrl(url: string): string {
  try {
    const parsed = new URL(stripTrailingPunctuation(url));
    parsed.hash = '';
    const path = parsed.pathname !== '/' && parsed.pathname.endsWith('/')
      ? parsed.pathname.slice(0, -1)
      : parsed.pathname;
    return `${parsed.protocol}//${parsed.host.toLowerCase()}${path}${parsed.search}`;
  } catch {
    return stripTrailingPunctuation(url).toLowerCase().replace(/\/$/, '');
  }
}

export function dedupeCitations(citations: ResearchCitation[]): ResearchCitation[] {
  const byUrl = new Set<string>();
  const byTitle = new Set<string>();
  const out: ResearchCitation[] = [];

  for (const citation of citations) {
    if (citation.url) {
      const key = normalizeCitationUrl(citation.url);
      if (byUrl.has(key)) continue;
      byUrl.add(key);
      out.push({ ...citation, url: displayCitationUrl(citation.url) });
      continue;
    }

    const titleKey = citation.title.trim().toLowerCase();
    if (!titleKey || byTitle.has(titleKey)) continue;
    byTitle.add(titleKey);
    out.push(citation);
  }

  return out;
}

export function validateResearchPack(pack: ResearchPack): ResearchValidation {
  const citationIds = new Set(pack.citations.map((citation) => citation.id));
  const uncited = pack.findings
    .filter((finding) =>
      finding.citation_ids.length === 0 ||
      finding.citation_ids.every((id) => !citationIds.has(id)),
    )
    .map((finding) => finding.id);

  return {
    finding_count: pack.findings.length,
    citation_count: pack.citations.length,
    uncited_finding_ids: uncited,
  };
}

function stripTrailingPunctuation(url: string): string {
  return url.replace(/[),.;:!?]+$/g, '');
}

function displayCitationUrl(url: string): string {
  try {
    const parsed = new URL(stripTrailingPunctuation(url));
    parsed.hostname = parsed.hostname.toLowerCase();
    return parsed.toString();
  } catch {
    return stripTrailingPunctuation(url);
  }
}

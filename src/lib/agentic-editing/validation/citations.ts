import type { EvidenceReference } from '../types';
import type { ResolvedSourceScope } from '../context/source-scope';
import type { SelectedGroundingChunk } from '../context/relevance';

const CITATION_MARKER = /\[Source:\s*([^\]#\r\n]+?)(?:#([^\]\r\n]+?))?\s*\]/gi;

export interface CitationReference {
  marker: string;
  sourceId: string;
  chunkId?: string;
}

export interface FactualAddition {
  description: string;
  sourceIds: string[];
}

export interface CitationValidationInput {
  beforeText: string;
  afterText: string;
  sourceScope: ResolvedSourceScope;
  selectedChunks: readonly SelectedGroundingChunk[];
  evidence?: readonly EvidenceReference[];
  factualAdditions?: readonly FactualAddition[];
}

export interface CitationValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  citations: CitationReference[];
  added: CitationReference[];
  removed: CitationReference[];
}

export function extractCitationReferences(text: string): CitationReference[] {
  return [...text.matchAll(CITATION_MARKER)].flatMap((match) => {
    const sourceId = match[1]!.trim();
    if (!sourceId) return [];
    return [{
      marker: match[0],
      sourceId,
      ...(match[2]?.trim() ? { chunkId: match[2].trim() } : {}),
    }];
  });
}

function referenceKey(reference: CitationReference): string {
  return `${reference.sourceId}#${reference.chunkId ?? ''}`;
}

export function validateCitationProvenance(
  input: CitationValidationInput,
): CitationValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const citations = extractCitationReferences(input.afterText);
  const before = extractCitationReferences(input.beforeText);
  const validSourceIds = new Set(
    input.sourceScope.entries
      .filter(({ included, allocatedCharacters }) => included && allocatedCharacters > 0)
      .map(({ id }) => id),
  );
  const chunkIdsBySource = new Map<string, Set<string>>();
  for (const chunk of input.selectedChunks) {
    const ids = chunkIdsBySource.get(chunk.sourceId) ?? new Set<string>();
    ids.add(chunk.chunkId);
    chunkIdsBySource.set(chunk.sourceId, ids);
  }

  const openerCount = input.afterText.match(/\[Source:/gi)?.length ?? 0;
  if (openerCount !== citations.length) {
    errors.push('One or more citation markers have malformed syntax.');
  }
  for (const citation of citations) {
    if (!validSourceIds.has(citation.sourceId)) {
      errors.push(`Citation references unknown or excluded source "${citation.sourceId}".`);
      continue;
    }
    if (citation.chunkId && !chunkIdsBySource.get(citation.sourceId)?.has(citation.chunkId)) {
      errors.push(
        `Citation references unknown chunk "${citation.chunkId}" in source "${citation.sourceId}".`,
      );
    }
  }

  for (const evidence of input.evidence ?? []) {
    const [sourceId, chunkId] = evidence.id.split('#', 2);
    if (!sourceId || !validSourceIds.has(sourceId)) {
      errors.push(`Proposal evidence references unknown or excluded source "${evidence.id}".`);
    } else if (chunkId && !chunkIdsBySource.get(sourceId)?.has(chunkId)) {
      errors.push(`Proposal evidence references unknown chunk "${evidence.id}".`);
    }
  }

  for (const addition of input.factualAdditions ?? []) {
    const supported = addition.sourceIds.some((sourceId) => validSourceIds.has(sourceId));
    if (!supported) {
      warnings.push(`Unsupported factual addition: ${addition.description}`);
    }
  }

  const beforeKeys = new Set(before.map(referenceKey));
  const afterKeys = new Set(citations.map(referenceKey));
  return {
    ok: errors.length === 0,
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
    citations,
    added: citations.filter((citation) => !beforeKeys.has(referenceKey(citation))),
    removed: before.filter((citation) => !afterKeys.has(referenceKey(citation))),
  };
}

export function canStrengthenCitations(
  scope: ResolvedSourceScope,
  selectedChunks: readonly SelectedGroundingChunk[],
): boolean {
  const groundedSourceIds = new Set(
    scope.entries
      .filter(({ included, allocatedCharacters }) => included && allocatedCharacters > 0)
      .map(({ id }) => id),
  );
  return selectedChunks.some((chunk) => (
    groundedSourceIds.has(chunk.sourceId) && chunk.includedCharacters > 0
  ));
}

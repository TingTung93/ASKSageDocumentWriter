export interface GroundingChunk {
  sourceId: string;
  chunkId: string;
  title: string;
  summary: string;
  text: string;
  embedding?: readonly number[];
  pinned?: boolean;
}

export interface RelevanceQuery {
  targetText: string;
  instruction: string;
  sectionIntent?: string;
  queryEmbedding?: readonly number[];
  embeddingsVerified: boolean;
}

export interface RelevanceLimits {
  maxChunks: number;
  maxChunksPerSource: number;
  maxContextCharacters: number;
}

export interface SelectedGroundingChunk {
  sourceId: string;
  chunkId: string;
  title: string;
  excerpt: string;
  score: number;
  scoringMethod: 'embedding' | 'lexical';
  reason: 'pinned_by_user' | 'relevance';
  includedCharacters: number;
  truncated: boolean;
}

export interface RelevanceSelection {
  chunks: SelectedGroundingChunk[];
  totalCharacters: number;
  omittedChunkIds: string[];
}

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'in',
  'is', 'it', 'of', 'on', 'or', 'that', 'the', 'this', 'to', 'with',
]);

function tokens(value: string): Set<string> {
  return new Set(
    value.toLowerCase().match(/[a-z0-9][a-z0-9_-]+/g)
      ?.filter((token) => !STOPWORDS.has(token)) ?? [],
  );
}

function lexicalScore(left: Set<string>, right: Set<string>): number {
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  return intersection / new Set([...left, ...right]).size;
}

function cosine(left: readonly number[], right: readonly number[]): number | null {
  if (!left.length || left.length !== right.length) return null;
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index]!;
    const rightValue = right[index]!;
    if (!Number.isFinite(leftValue) || !Number.isFinite(rightValue)) return null;
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }
  if (!leftMagnitude || !rightMagnitude) return null;
  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

export function selectRelevantGroundingChunks(
  chunks: readonly GroundingChunk[],
  query: RelevanceQuery,
  limits: RelevanceLimits,
): RelevanceSelection {
  const queryTokens = tokens([
    query.sectionIntent ?? '',
    query.instruction,
    query.targetText,
  ].join('\n'));
  const scored = chunks.map((chunk, index) => {
    const embeddingScore = query.embeddingsVerified
      && query.queryEmbedding
      && chunk.embedding
      ? cosine(query.queryEmbedding, chunk.embedding)
      : null;
    return {
      chunk,
      index,
      score: embeddingScore ?? lexicalScore(
        queryTokens,
        tokens(`${chunk.title}\n${chunk.summary}\n${chunk.text}`),
      ),
      method: embeddingScore === null ? 'lexical' as const : 'embedding' as const,
    };
  }).sort((left, right) => (
    Number(Boolean(right.chunk.pinned)) - Number(Boolean(left.chunk.pinned))
    || right.score - left.score
    || left.index - right.index
  ));

  const selected: SelectedGroundingChunk[] = [];
  const omitted = new Set(chunks.map(({ chunkId }) => chunkId));
  const perSource = new Map<string, number>();
  let remaining = Math.max(0, limits.maxContextCharacters);
  for (const item of scored) {
    const isPinned = Boolean(item.chunk.pinned);
    const sourceCount = perSource.get(item.chunk.sourceId) ?? 0;
    if (!isPinned && (
      selected.length >= Math.max(0, limits.maxChunks)
      || sourceCount >= Math.max(0, limits.maxChunksPerSource)
      || item.score <= 0
      || remaining <= 0
    )) {
      continue;
    }
    const includedCharacters = Math.min(item.chunk.text.length, remaining);
    selected.push({
      sourceId: item.chunk.sourceId,
      chunkId: item.chunk.chunkId,
      title: item.chunk.title,
      excerpt: item.chunk.text.slice(0, includedCharacters),
      score: item.score,
      scoringMethod: item.method,
      reason: isPinned ? 'pinned_by_user' : 'relevance',
      includedCharacters,
      truncated: includedCharacters < item.chunk.text.length,
    });
    omitted.delete(item.chunk.chunkId);
    perSource.set(item.chunk.sourceId, sourceCount + 1);
    remaining -= includedCharacters;
  }

  return {
    chunks: selected,
    totalCharacters: selected.reduce((sum, chunk) => sum + chunk.includedCharacters, 0),
    omittedChunkIds: chunks
      .map(({ chunkId }) => chunkId)
      .filter((chunkId) => omitted.has(chunkId)),
  };
}

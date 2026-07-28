import { describe, expect, it } from 'vitest';
import type { ResolvedSourceScope } from '../context/source-scope';
import type { SelectedGroundingChunk } from '../context/relevance';
import {
  canStrengthenCitations,
  extractCitationReferences,
  validateCitationProvenance,
} from './citations';

const scope: ResolvedSourceScope = {
  entries: [
    {
      id: 'file-1',
      kind: 'attached_file',
      label: 'Policy.docx',
      estimatedCharacters: 100,
      optional: true,
      included: true,
      pinned: false,
      allocatedCharacters: 100,
      truncated: false,
      reason: 'included_by_user',
    },
    {
      id: 'file-2',
      kind: 'attached_file',
      label: 'Excluded.docx',
      estimatedCharacters: 100,
      optional: true,
      included: false,
      pinned: false,
      allocatedCharacters: 0,
      truncated: false,
      reason: 'excluded_by_user',
    },
  ],
  includedSourceIds: ['file-1'],
  estimatedCharacters: 100,
  allocatedCharacters: 100,
  maxContextCharacters: 1000,
  truncated: false,
};
const chunks: SelectedGroundingChunk[] = [{
  sourceId: 'file-1',
  chunkId: 'chunk-a',
  title: 'Policy',
  excerpt: 'Encryption is required.',
  score: 1,
  scoringMethod: 'lexical',
  reason: 'relevance',
  includedCharacters: 23,
  truncated: false,
}];

describe('citation provenance validation', () => {
  it('extracts source and chunk ids from canonical markers', () => {
    expect(extractCitationReferences('Claim [Source: file-1#chunk-a].')).toEqual([{
      marker: '[Source: file-1#chunk-a]',
      sourceId: 'file-1',
      chunkId: 'chunk-a',
    }]);
  });

  it('validates grounded citations and reports additions and removals', () => {
    const result = validateCitationProvenance({
      beforeText: 'Old claim [Source: file-1].',
      afterText: 'New claim [Source: file-1#chunk-a].',
      sourceScope: scope,
      selectedChunks: chunks,
      evidence: [{ id: 'file-1#chunk-a', label: 'Policy excerpt' }],
    });
    expect(result.ok).toBe(true);
    expect(result.added).toHaveLength(1);
    expect(result.removed).toHaveLength(1);
  });

  it('rejects invented source and chunk ids and malformed markers', () => {
    const result = validateCitationProvenance({
      beforeText: '',
      afterText: [
        'Invented [Source: invented#chunk].',
        'Excluded [Source: file-2].',
        'Bad chunk [Source: file-1#invented].',
        'Malformed [Source: ].',
      ].join(' '),
      sourceScope: scope,
      selectedChunks: chunks,
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringMatching(/unknown or excluded source "invented"/i),
      expect.stringMatching(/unknown or excluded source "file-2"/i),
      expect.stringMatching(/unknown chunk "invented"/i),
      expect.stringMatching(/malformed syntax/i),
    ]));
  });

  it('warns when a declared factual addition has no included provenance', () => {
    const result = validateCitationProvenance({
      beforeText: '',
      afterText: 'The period is five years.',
      sourceScope: scope,
      selectedChunks: chunks,
      factualAdditions: [{
        description: 'The period is five years.',
        sourceIds: ['file-2'],
      }],
    });
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([
      'Unsupported factual addition: The period is five years.',
    ]);
  });

  it('enables citation strengthening only with resolved grounded text', () => {
    expect(canStrengthenCitations(scope, chunks)).toBe(true);
    expect(canStrengthenCitations(scope, [{ ...chunks[0]!, includedCharacters: 0 }])).toBe(false);
  });
});

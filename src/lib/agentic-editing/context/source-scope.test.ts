import { describe, expect, it } from 'vitest';
import { resolveSourceScope, serializeResolvedSourceScope } from './source-scope';
import type { AgentCapabilities } from '../types';

const capabilities: AgentCapabilities = {
  nativeTools: false,
  jsonSchemaOutput: false,
  promptJsonOutput: true,
  embeddings: false,
  providerDatasets: false,
  liveSearch: false,
  localReferenceSearch: true,
  localDocumentInspection: true,
  evidence: [],
};

const sources = [
  { id: 'note-1', kind: 'project_note' as const, label: 'Project note', estimatedCharacters: 40, optional: false },
  { id: 'file-1', kind: 'file_chunk' as const, label: 'Attached file', estimatedCharacters: 80, optional: true },
  { id: 'dataset-1', kind: 'dataset' as const, label: 'Provider dataset', estimatedCharacters: 100, optional: true },
];

describe('source scope', () => {
  it('honors explicit inclusion and exclusion and stores references only', () => {
    const scope = resolveSourceScope({
      sources,
      includedSourceIds: ['file-1'],
      excludedSourceIds: ['note-1'],
      maxContextCharacters: 200,
    }, capabilities);

    expect(scope.includedSourceIds).toEqual(['file-1']);
    expect(scope.entries.find(({ id }) => id === 'note-1')?.reason).toBe('excluded_by_user');
    expect(serializeResolvedSourceScope(scope)).not.toContain('document content');
  });

  it('never silently drops a pinned source and records truncation', () => {
    const scope = resolveSourceScope({
      sources,
      excludedSourceIds: ['file-1'],
      pinnedSourceIds: ['file-1'],
      maxContextCharacters: 25,
    }, capabilities);
    expect(scope.entries.find(({ id }) => id === 'file-1')).toMatchObject({
      included: true,
      pinned: true,
      allocatedCharacters: 25,
      truncated: true,
      reason: 'pinned_by_user',
    });
  });

  it('explains provider modes that are unavailable', () => {
    const scope = resolveSourceScope({
      sources,
      includedSourceIds: ['dataset-1'],
      maxContextCharacters: 200,
    }, capabilities);
    expect(scope.entries.find(({ id }) => id === 'dataset-1')).toMatchObject({
      included: false,
      reason: 'unavailable',
      availabilityReason: expect.stringMatching(/does not support provider datasets/i),
    });
  });

  it('rejects unknown source references', () => {
    expect(() => resolveSourceScope({
      sources,
      pinnedSourceIds: ['invented'],
      maxContextCharacters: 100,
    }, capabilities)).toThrow(/Unknown grounding source id/);
  });
});

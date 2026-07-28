import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { resolveSourceScope, type GroundingSourceRef } from '../../../lib/agentic-editing/context/source-scope';
import type { AgentCapabilities } from '../../../lib/agentic-editing/types';
import { CitationProvenance } from './CitationProvenance';
import { SourceScopePicker } from './SourceScopePicker';

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
const sources: GroundingSourceRef[] = [
  {
    id: 'note-1',
    kind: 'project_note',
    label: 'Requirements note',
    estimatedCharacters: 100,
    optional: true,
    defaultIncluded: true,
  },
  {
    id: 'dataset-1',
    kind: 'dataset',
    label: 'Policy dataset',
    estimatedCharacters: 100,
    optional: true,
    defaultIncluded: true,
  },
];

describe('grounding UI', () => {
  it('lets users exclude optional sources and explains unavailable modes', () => {
    const change = vi.fn();
    const scope = resolveSourceScope({ sources, maxContextCharacters: 1_000 }, capabilities);
    render(
      <SourceScopePicker
        capabilities={capabilities}
        onChange={change}
        scope={scope}
        sources={sources}
      />,
    );
    fireEvent.click(screen.getByText(/Sources \(1 selected\)/));
    expect(screen.getByText(/does not support provider datasets/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: /Requirements note/i }));
    expect(change.mock.calls[0]?.[0].includedSourceIds).toEqual([]);
  });

  it('shows citation additions, removals, and inspectable evidence', () => {
    render(
      <CitationProvenance
        before="Old [CITE: old-source]"
        after="New [CITE: new-source]"
        evidence={[{ id: 'new-source', label: 'Policy memo', excerpt: 'Approved language.' }]}
      />,
    );
    fireEvent.click(screen.getByText(/Citation provenance/));
    expect(screen.getByText(/Added: new-source/)).toBeInTheDocument();
    expect(screen.getByText(/Removed: old-source/)).toBeInTheDocument();
    expect(screen.getByText('Approved language.')).toBeInTheDocument();
  });
});

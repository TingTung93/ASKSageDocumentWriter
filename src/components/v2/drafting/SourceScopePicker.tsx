import type { AgentCapabilities } from '../../../lib/agentic-editing/types';
import {
  resolveSourceScope,
  type GroundingSourceRef,
  type ResolvedSourceScope,
} from '../../../lib/agentic-editing/context/source-scope';

export function SourceScopePicker({
  capabilities,
  maxContextCharacters = 24_000,
  onChange,
  scope,
  sources,
}: {
  capabilities: AgentCapabilities;
  maxContextCharacters?: number;
  onChange: (scope: ResolvedSourceScope) => void;
  scope: ResolvedSourceScope;
  sources: readonly GroundingSourceRef[];
}) {
  const update = (sourceId: string, included: boolean) => {
    const includedIds = new Set(scope.includedSourceIds);
    if (included) includedIds.add(sourceId);
    else includedIds.delete(sourceId);
    onChange(resolveSourceScope({
      sources,
      includedSourceIds: [...includedIds],
      excludedSourceIds: sources
        .filter((source) => !includedIds.has(source.id))
        .map((source) => source.id),
      pinnedSourceIds: scope.entries.filter((entry) => entry.pinned).map((entry) => entry.id),
      maxContextCharacters,
    }, capabilities));
  };

  if (sources.length === 0) {
    return <p style={{ color: 'var(--ink-4)', fontSize: 12 }}>No grounding sources are attached.</p>;
  }
  return (
    <details>
      <summary style={{ cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
        Sources ({scope.includedSourceIds.length} selected)
        {scope.truncated ? ' · context limited' : ''}
      </summary>
      <div aria-label="Source scope" style={{ display: 'grid', gap: 6, marginTop: 8 }}>
        {scope.entries.map((entry) => (
          <label key={entry.id} style={{ alignItems: 'start', display: 'flex', gap: 7, fontSize: 12 }}>
            <input
              checked={entry.included}
              disabled={entry.reason === 'unavailable' || entry.pinned}
              onChange={(event) => update(entry.id, event.target.checked)}
              type="checkbox"
            />
            <span>
              <strong>{entry.label}</strong>
              <span style={{ color: 'var(--ink-4)', marginLeft: 5 }}>
                {sourceKindLabel(entry.kind)}
                {entry.truncated ? ' · truncated' : ''}
              </span>
              {entry.availabilityReason && (
                <span style={{ color: 'var(--ink-4)', display: 'block' }}>
                  {entry.availabilityReason}
                </span>
              )}
            </span>
          </label>
        ))}
        <div style={{ color: 'var(--ink-4)', fontSize: 11 }}>
          {scope.allocatedCharacters.toLocaleString()} of {scope.maxContextCharacters.toLocaleString()} context characters
        </div>
      </div>
    </details>
  );
}

function sourceKindLabel(kind: GroundingSourceRef['kind']): string {
  return kind.replaceAll('_', ' ');
}

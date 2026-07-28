import type { DocumentVersionRecord } from '../../../lib/agentic-editing/types';

export function RevisionTimeline({
  busy,
  canUndo,
  onUndo,
  versions,
}: {
  busy?: boolean;
  canUndo: boolean;
  onUndo: (version: DocumentVersionRecord) => void;
  versions: DocumentVersionRecord[];
}) {
  const visible = orderAcceptedLineage(versions);

  if (visible.length === 0) return null;
  return (
    <details style={{ borderTop: '1px solid var(--line)', marginTop: 12, paddingTop: 10 }}>
      <summary style={{ cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
        Revision history ({visible.length})
      </summary>
      <ol aria-label="Revision history" style={{ listStyle: 'none', margin: '8px 0 0', padding: 0 }}>
        {visible.map((version, index) => (
          <li
            key={version.id}
            style={{ alignItems: 'center', display: 'flex', gap: 8, padding: '5px 0' }}
          >
            <span style={{ flex: 1, fontSize: 12 }}>
              {version.label}
              <span style={{ color: 'var(--ink-4)', marginLeft: 6 }}>
                {new Date(version.created_at).toLocaleString()}
              </span>
            </span>
            {index > 0 && (
              <button
                className="btn btn-sm"
                disabled={busy || !canUndo}
                onClick={() => onUndo(version)}
                type="button"
              >
                Restore
              </button>
            )}
          </li>
        ))}
      </ol>
    </details>
  );
}

export function orderAcceptedLineage(
  versions: DocumentVersionRecord[],
): DocumentVersionRecord[] {
  const accepted = versions.filter((version) => version.status === 'accepted');
  const byId = new Map(accepted.map((version) => [version.id, version]));
  const parentIds = new Set(
    accepted.flatMap((version) => version.parent_version_id ? [version.parent_version_id] : []),
  );
  const heads = accepted
    .filter((version) => !parentIds.has(version.id))
    .sort((a, b) =>
      b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id)
    );
  const ordered: DocumentVersionRecord[] = [];
  const seen = new Set<string>();
  for (const head of heads) {
    let current: DocumentVersionRecord | undefined = head;
    while (current && !seen.has(current.id)) {
      ordered.push(current);
      seen.add(current.id);
      current = current.parent_version_id
        ? byId.get(current.parent_version_id)
        : undefined;
    }
  }
  return ordered.concat(
    accepted
      .filter((version) => !seen.has(version.id))
      .sort((a, b) =>
        b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id)
      ),
  );
}

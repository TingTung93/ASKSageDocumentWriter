import type { EvidenceReference } from '../../../lib/agentic-editing/types';

export function CitationProvenance({
  after,
  before,
  evidence,
}: {
  after: string;
  before: string;
  evidence: EvidenceReference[];
}) {
  const beforeIds = citationIds(before);
  const afterIds = citationIds(after);
  const added = [...afterIds].filter((id) => !beforeIds.has(id));
  const removed = [...beforeIds].filter((id) => !afterIds.has(id));
  if (evidence.length === 0 && added.length === 0 && removed.length === 0) return null;
  return (
    <details style={{ marginTop: 10 }}>
      <summary style={{ cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
        Citation provenance
        {added.length > 0 ? ` · ${added.length} added` : ''}
        {removed.length > 0 ? ` · ${removed.length} removed` : ''}
      </summary>
      {(added.length > 0 || removed.length > 0) && (
        <p style={{ color: 'var(--ink-3)', fontSize: 12 }}>
          {added.length > 0 && <>Added: {added.join(', ')}. </>}
          {removed.length > 0 && <>Removed: {removed.join(', ')}.</>}
        </p>
      )}
      <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
        {evidence.map((item) => (
          <li key={item.id} style={{ fontSize: 12, marginBottom: 6 }}>
            <strong>{item.label}</strong>
            <span style={{ color: 'var(--ink-4)' }}> · {item.id}</span>
            {item.excerpt && <blockquote style={{ margin: '3px 0 0' }}>{item.excerpt}</blockquote>}
          </li>
        ))}
      </ul>
    </details>
  );
}

function citationIds(text: string): Set<string> {
  return new Set(
    [
      ...text.matchAll(/\[CITE:\s*([^\]]+)\]/gi),
      ...text.matchAll(/\[Source:\s*([^\]#]+)(?:#[^\]]+)?\]/gi),
    ]
      .map((match) => match[1]?.trim())
      .filter((id): id is string => Boolean(id)),
  );
}

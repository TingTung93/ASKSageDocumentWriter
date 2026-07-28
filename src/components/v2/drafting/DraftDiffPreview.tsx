export function DraftDiffPreview({
  before,
  after,
  summary,
}: {
  before: string;
  after: string;
  summary?: string;
}) {
  return (
    <section aria-label="Proposed draft change">
      <h4 style={{ margin: '0 0 8px' }}>Review proposed change</h4>
      {summary && <p style={{ color: 'var(--ink-3)', margin: '0 0 10px' }}>{summary}</p>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 }}>
        <DiffColumn label="Current" text={before} tone="var(--danger-bg, #fff4f4)" />
        <DiffColumn label="Proposed" text={after} tone="var(--success-bg, #f2fbf5)" />
      </div>
    </section>
  );
}

function DiffColumn({ label, text, tone }: { label: string; text: string; tone: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 4, textTransform: 'uppercase' }}>
        {label}
      </div>
      <pre style={{
        background: tone,
        border: '1px solid var(--line)',
        borderRadius: 6,
        fontFamily: 'var(--font-sans)',
        fontSize: 13,
        margin: 0,
        maxHeight: 280,
        overflow: 'auto',
        padding: 10,
        whiteSpace: 'pre-wrap',
      }}>
        {text}
      </pre>
    </div>
  );
}

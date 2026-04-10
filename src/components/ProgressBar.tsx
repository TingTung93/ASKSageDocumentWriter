// Visual progress bar for long-running operations (drafting, cleanup).
// CSS lives in index.css (.progress-bar / .progress-bar-fill).

interface ProgressBarProps {
  done: number;
  total: number;
  /** Label shown above the bar. Defaults to "N of M". */
  label?: string;
}

export function ProgressBar({ done, total, label }: ProgressBarProps) {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const complete = done >= total;
  return (
    <div style={{ margin: 'var(--space-2) 0' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: '12px',
          color: 'var(--color-text-muted)',
          marginBottom: '0.25rem',
        }}
      >
        <span>{label ?? `${done} of ${total}`}</span>
        <span>{pct}%</span>
      </div>
      <div className="progress-bar">
        <div
          className={`progress-bar-fill${complete ? ' is-success' : ''}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

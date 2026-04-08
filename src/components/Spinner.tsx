// Tiny CSS spinner. Two variants: default (primary on light background)
// and `light` (white-on-dark, for use inside a colored button).

interface SpinnerProps {
  light?: boolean;
  label?: string;
}

export function Spinner({ light, label }: SpinnerProps) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
      <span
        className={`spinner${light ? ' spinner-light' : ''}`}
        role="status"
        aria-label={label ?? 'Loading'}
      />
      {label && <span>{label}</span>}
    </span>
  );
}

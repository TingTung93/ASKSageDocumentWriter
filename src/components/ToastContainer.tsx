// Renders the toast queue from useToasts in a fixed-position stack.
// Mounted once at the App root.

import { useToasts } from '../lib/state/toast';

export function ToastContainer() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);

  if (toasts.length === 0) return null;

  return (
    <div className="toast-container" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast is-${t.kind}`} role="status">
          <span style={{ flex: 1 }}>{t.message}</span>
          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={() => dismiss(t.id)}
            aria-label="Dismiss"
            style={{ marginTop: 0, padding: '0 0.4rem', lineHeight: 1 }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

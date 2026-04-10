// Friendly empty-state placeholder for list views. Standardized so
// every list looks consistent when there's nothing to show.

import type { ReactNode } from 'react';

interface EmptyStateProps {
  title: string;
  body?: ReactNode;
  icon?: string;
  /** Optional call-to-action button or link rendered below the body */
  action?: ReactNode;
}

export function EmptyState({ title, body, icon, action }: EmptyStateProps) {
  return (
    <div
      style={{
        textAlign: 'center',
        padding: '2rem 1.5rem',
        background: '#fafafa',
        border: '1px dashed #ccc',
        borderRadius: 6,
        color: '#666',
      }}
    >
      {icon && <div style={{ fontSize: 32, marginBottom: '0.5rem' }}>{icon}</div>}
      <div style={{ fontSize: 15, fontWeight: 600, color: '#333' }}>{title}</div>
      {body && <div style={{ fontSize: 13, marginTop: '0.5rem', lineHeight: 1.5 }}>{body}</div>}
      {action && <div style={{ marginTop: '0.75rem' }}>{action}</div>}
    </div>
  );
}

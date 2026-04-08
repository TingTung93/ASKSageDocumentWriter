// Friendly empty-state placeholder for list views. Standardized so
// every list looks consistent when there's nothing to show.

import type { ReactNode } from 'react';

interface EmptyStateProps {
  title: string;
  body?: ReactNode;
  icon?: string;
}

export function EmptyState({ title, body, icon }: EmptyStateProps) {
  return (
    <div
      style={{
        textAlign: 'center',
        padding: '2rem 1rem',
        background: '#fafafa',
        border: '1px dashed #ccc',
        borderRadius: 6,
        color: '#666',
      }}
    >
      {icon && <div style={{ fontSize: 28, marginBottom: '0.5rem' }}>{icon}</div>}
      <div style={{ fontSize: 14, fontWeight: 600, color: '#333' }}>{title}</div>
      {body && <div style={{ fontSize: 13, marginTop: '0.5rem' }}>{body}</div>}
    </div>
  );
}

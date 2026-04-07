import type { ReactNode } from 'react';
import { useAuth } from '../lib/state/auth';

interface ShellProps {
  children: ReactNode;
}

export function Shell({ children }: ShellProps) {
  const apiKey = useAuth((s) => s.apiKey);
  const baseUrl = useAuth((s) => s.baseUrl);
  const models = useAuth((s) => s.models);

  const status = apiKey
    ? `connected · ${new URL(baseUrl).host} · ${models?.length ?? 0} models`
    : 'not connected';

  return (
    <>
      <nav className="shell">
        <span className="brand">Ask Sage Document Writer</span>
        <span className="status">{status}</span>
      </nav>
      {children}
    </>
  );
}

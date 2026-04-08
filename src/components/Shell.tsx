import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../lib/state/auth';

interface ShellProps {
  children: ReactNode;
}

const NAV_ITEMS: { to: string; label: string; end?: boolean }[] = [
  { to: '/', label: 'Connection', end: true },
  { to: '/documents', label: 'Documents' },
  { to: '/templates', label: 'Templates' },
  { to: '/datasets', label: 'Datasets' },
  { to: '/projects', label: 'Projects' },
  { to: '/audit', label: 'Audit' },
  { to: '/settings', label: 'Settings' },
];

export function Shell({ children }: ShellProps) {
  const apiKey = useAuth((s) => s.apiKey);
  const baseUrl = useAuth((s) => s.baseUrl);
  const models = useAuth((s) => s.models);

  const connected = !!apiKey;
  const host = (() => {
    try {
      return new URL(baseUrl).host;
    } catch {
      return baseUrl;
    }
  })();

  return (
    <>
      <nav className="shell">
        <span className="brand">Ask Sage Document Writer</span>
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => (isActive ? 'active' : '')}
          >
            {item.label}
          </NavLink>
        ))}
        <span className="status" title={connected ? `Connected to ${host}` : 'Not connected'}>
          <span className={`status-dot ${connected ? 'is-on' : 'is-off'}`} />
          {connected ? `${host} · ${models?.length ?? 0} models` : 'not connected'}
        </span>
      </nav>
      {children}
    </>
  );
}

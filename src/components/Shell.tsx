import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../lib/state/auth';

interface ShellProps {
  children: ReactNode;
}

const NAV_ITEMS: { to: string; label: string; title: string; end?: boolean }[] = [
  { to: '/', label: 'Connection', title: 'Connect to your AI service (start here)', end: true },
  { to: '/documents', label: 'Documents', title: 'Upload and polish an existing DOCX' },
  { to: '/templates', label: 'Templates', title: 'Upload DOCX templates for drafting' },
  { to: '/datasets', label: 'Datasets', title: 'View and verify your reference datasets' },
  { to: '/projects', label: 'Projects', title: 'Create a project and draft documents' },
  { to: '/audit', label: 'Audit', title: 'View a log of all AI requests made' },
  { to: '/settings', label: 'Settings', title: 'Choose AI models and adjust preferences' },
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
      <nav className="shell" role="navigation" aria-label="Main navigation">
        <span className="brand">Ask Sage Document Writer</span>
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            title={item.title}
            className={({ isActive }) => (isActive ? 'active' : '')}
          >
            {item.label}
          </NavLink>
        ))}
        <span
          className="status"
          role="status"
          aria-live="polite"
          title={connected ? `Connected to ${host}` : 'Not connected — go to the Connection tab to set up'}
        >
          <span className={`status-dot ${connected ? 'is-on' : 'is-off'}`} aria-hidden="true" />
          {connected ? `${host} · ${models?.length ?? 0} models` : 'not connected'}
        </span>
      </nav>
      {children}
    </>
  );
}

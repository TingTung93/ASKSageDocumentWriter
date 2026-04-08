import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
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
        <NavLink to="/" end style={navLinkStyle}>
          Connection
        </NavLink>
        <NavLink to="/templates" style={navLinkStyle}>
          Templates
        </NavLink>
        <NavLink to="/datasets" style={navLinkStyle}>
          Datasets
        </NavLink>
        <NavLink to="/projects" style={navLinkStyle}>
          Projects
        </NavLink>
        <span className="status">{status}</span>
      </nav>
      {children}
    </>
  );
}

function navLinkStyle({ isActive }: { isActive: boolean }): React.CSSProperties {
  return {
    color: isActive ? '#fff' : '#aaa',
    textDecoration: 'none',
    fontWeight: 600,
    fontSize: 13,
    padding: '0 0.5rem',
    borderBottom: isActive ? '2px solid #fff' : '2px solid transparent',
  };
}

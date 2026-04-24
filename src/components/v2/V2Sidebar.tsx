import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../lib/db/schema';
import { useAuth } from '../../lib/state/auth';
import { useNavigate, useParams } from 'react-router-dom';

interface V2SidebarProps {
  view: string;
  setView: (view: string) => void;
}

export function V2Sidebar({ view, setView }: V2SidebarProps) {
  const { id: activeId } = useParams<{ id: string }>();
  const projects = useLiveQuery(() => db.projects.orderBy('updated_at').reverse().toArray(), []);
  const navigate = useNavigate();
  
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
    <aside className="rail">
      <div className="rail-head">
        <div className="mark">A</div>
        <div className="brand-wrap">
          <span className="brand">Ask Sage</span>
          <span className="brand-sub">co-writer · v2</span>
        </div>
      </div>

      <div className="rail-section">
        Projects
        <button className="plus" title="New project" onClick={() => navigate('/projects')}>+</button>
      </div>
      <div className="rail-list">
        {projects?.map(p => (
          <button
            key={p.id}
            className={"rail-item" + (activeId === p.id ? " active" : "")}
            onClick={() => {
                navigate(`/v2/${p.id}`);
                setView('workspace');
            }}
          >
            <span className="dot" />
            <span className="name">{p.name}</span>
            <span className="stamp">{new Date(p.updated_at).toLocaleDateString()}</span>
          </button>
        ))}
      </div>

      <div className="rail-section" style={{ marginTop: 8 }}>Workspace</div>
      <div className="rail-nav">
        {([
          { key: 'library', label: 'Library', kbd: 'L' },
          { key: 'audit', label: 'Activity log', kbd: 'A' },
          { key: 'settings', label: 'Settings', kbd: ',' },
        ] as const).map((item) => (
          <button
            key={item.key}
            onClick={() => setView(item.key)}
            className={view === item.key ? 'on' : ''}
          >
            <span className="nav-dot" />
            <span>{item.label}</span>
            <span className="kbd">{item.kbd}</span>
          </button>
        ))}
      </div>

      <div className="rail-foot">
        <div className="conn" title={connected ? `Connected to ${host}` : 'Not connected'}>
          <span className={`conn-dot ${connected ? '' : 'is-off'}`} style={{ background: connected ? 'var(--sage)' : 'var(--rose)' }} />
          <div className="conn-body">
            <span className="conn-host">{host || 'not connected'}</span>
            <span className="conn-meta">{connected ? `${models?.length ?? 0} models` : 'offline'}</span>
          </div>
          <button className="conn-cog" title="Connection settings" onClick={() => setView("settings")}>⚙</button>
        </div>
        <div className="local-chip" title="Runs entirely in this browser">
          <span className="local-ic">⎙</span>
          <div className="local-who">
            <span className="local-name">Local workstation</span>
            <span className="local-role">all data in this browser</span>
          </div>
        </div>
      </div>
    </aside>
  );
}

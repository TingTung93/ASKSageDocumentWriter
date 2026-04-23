// Sidebar with projects, nav, connection status
const { useState } = React;

function Sidebar({ active, setActive, view, setView }) {
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
        <button className="plus" title="New project">+</button>
      </div>
      <div className="rail-list">
        {window.PROJECTS.map(p => (
          <button
            key={p.id}
            className={"rail-item" + (active === p.id ? " active" : "") + (p.status === "drafting" ? " running" : "")}
            onClick={() => setActive(p.id)}
          >
            <span className="dot" />
            <span className="name">{p.name}</span>
            <span className="stamp">{p.updated}</span>
          </button>
        ))}
      </div>

      <div className="rail-section" style={{ marginTop: 8 }}>Workspace</div>
      <div className="rail-nav">
        <button onClick={() => setView && setView('library')} className={view==='library'?'on':''} style={{background: view==='library'?'var(--paper)':'transparent'}}><span className="dot" style={{background: view==='library'?'var(--accent)':'var(--ink-4)', width:7,height:7,borderRadius:999,display:'inline-block'}}/><span>Library</span><span className="kbd">L</span></button>
        <button onClick={() => setView && setView('audit')} className={view==='audit'?'on':''} style={{background: view==='audit'?'var(--paper)':'transparent'}}><span className="dot" style={{background: view==='audit'?'var(--accent)':'var(--ink-4)', width:7,height:7,borderRadius:999,display:'inline-block'}}/><span>Activity log</span><span className="kbd">A</span></button>
        <button onClick={() => setView && setView('settings')} className={view==='settings'?'on':''} style={{background: view==='settings'?'var(--paper)':'transparent'}}><span className="dot" style={{background: view==='settings'?'var(--accent)':'var(--ink-4)', width:7,height:7,borderRadius:999,display:'inline-block'}}/><span>Settings</span><span className="kbd">,</span></button>
      </div>

      <div className="rail-foot">
        <div className="conn" title="Connected to Ask Sage">
          <span className="conn-dot" />
          <div className="conn-body">
            <span className="conn-host">api.asksage.ai</span>
            <span className="conn-meta">gpt-4o · 12 models</span>
          </div>
          <button className="conn-cog" title="Connection settings" onClick={() => setView && setView("settings")}>⚙</button>
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

window.Sidebar = Sidebar;

// Extracted from Co-Writer.html — loaded via <script type="text/babel" src>.
// Components are attached to window for cross-file sharing.

// Top-level app
const { useState: useStateApp } = React;

function App() {
  const [active, setActive] = useStateApp("p-ebh");
  const [view, setView] = useStateApp("workspace");
  const [firstRun, setFirstRun] = useStateApp(false);
  const [exportOpen, setExportOpen] = useStateApp(false);
  const [ingestOpen, setIngestOpen] = useStateApp(false);
  const [ingestedTemplates, setIngestedTemplates] = useStateApp([]);
  const [cmdkOpen, setCmdkOpen] = useStateApp(false);
  const pushToast = useToast();

  // Bridge window events → toasts
  React.useEffect(() => {
    const handler = (e) => pushToast(e.detail || {});
    window.addEventListener('toast', handler);
    return () => window.removeEventListener('toast', handler);
  }, [pushToast]);

  // Global keyboard shortcuts
  React.useEffect(() => {
    let gPressed = false;
    let gTimer = null;
    const onKey = (e) => {
      const meta = e.metaKey || e.ctrlKey;
      const tag = (e.target.tagName || '').toLowerCase();
      const inField = tag === 'input' || tag === 'textarea';
      if (meta && e.key === 'k') { e.preventDefault(); setCmdkOpen(true); return; }
      if (meta && e.key === 'e') { e.preventDefault(); window.dispatchEvent(new CustomEvent('open-export')); return; }
      if (meta && e.key === 'r') { e.preventDefault(); pushToast({text:'Regenerating §1.3 Performance Objectives…', icon:'↻'}); return; }
      if (inField || meta) return;
      if (e.key === 'g' && !gPressed) { gPressed = true; gTimer = setTimeout(()=>gPressed=false, 800); return; }
      if (gPressed) {
        gPressed = false; clearTimeout(gTimer);
        if (e.key === 'l') { e.preventDefault(); setView('library'); }
        else if (e.key === 'a') { e.preventDefault(); setView('audit'); }
        else if (e.key === 'd') { e.preventDefault(); setView('workspace'); }
        else if (e.key === ',') { e.preventDefault(); setView('settings'); }
        return;
      }
      if (e.key === '/' && tag !== 'input' && tag !== 'textarea') {
        const ta = document.querySelector('.composer textarea');
        if (ta) { e.preventDefault(); ta.focus(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pushToast]);
  React.useEffect(() => {
    const oe = () => setExportOpen(true); const oi = () => setIngestOpen(true);
    window.addEventListener('open-export', oe); window.addEventListener('open-ingest', oi);
    return () => { window.removeEventListener('open-export', oe); window.removeEventListener('open-ingest', oi); };
  }, []);
  const [activeCite, setActiveCite] = useStateApp(null);
  const [state, setState] = useStateApp("drafting"); // drafting | review | done
  const [density, setDensity] = useStateApp("normal");
  const [mode, setMode] = useStateApp("workspace");   // workspace | empty
  const [tweaksOpen, setTweaksOpen] = useStateApp(false);
  const [introOpen, setIntroOpen] = useStateApp(true);

  // Expose Tweaks mode to the platform toolbar
  React.useEffect(() => {
    const onMsg = (e) => {
      if (!e || !e.data || !e.data.type) return;
      if (e.data.type === '__activate_edit_mode') setTweaksOpen(true);
      if (e.data.type === '__deactivate_edit_mode') setTweaksOpen(false);
    };
    window.addEventListener('message', onMsg);
    window.parent.postMessage({ type: '__edit_mode_available' }, '*');
    return () => window.removeEventListener('message', onMsg);
  }, []);

  const activeProject = window.PROJECTS.find(p => p.id === active) || window.PROJECTS[0];

  return (
    <div className="app">
      <Sidebar active={active} setActive={setActive} view={view} setView={setView} />

      <main className="workspace">
        <div className="topbar">
          <div className="crumbs">
            {view === 'settings' ? (
              <><span>Workspace</span><span className="sep">/</span><span className="current">Settings</span></>
            ) : view === 'library' ? (
              <><span>Workspace</span><span className="sep">/</span><span className="current">Library</span></>
            ) : view === 'audit' ? (
              <><span>Workspace</span><span className="sep">/</span><span className="current">Activity log</span></>
            ) : (
              <>
                <span>Projects</span>
                <span className="sep">/</span>
                <span className="current">{activeProject.name}</span>
                <span className="chip">{activeProject.template} template</span>
              </>
            )}
          </div>
          <div className="topbar-actions">
            <button className="btn btn-ghost" onClick={() => setCmdkOpen(true)} title="Command palette" style={{fontFamily:'var(--font-mono)', fontSize:11, color:'var(--ink-3)'}}>
              ⌕ Jump to…  <span style={{marginLeft:6, padding:'1px 5px', borderRadius:3, background:'var(--surface)', border:'1px solid var(--line)', fontSize:10}}>⌘K</span>
            </button>
            {view !== 'workspace' ? (
              <button className="btn" onClick={()=>setView('workspace')}>← Back to workspace</button>
            ) : (
              <>
                <button className="btn btn-ghost">⏵ Share</button>
                <button className="btn">⎘ Duplicate</button>
                <button className="btn btn-accent">＋ New section</button>
              </>
            )}
          </div>
        </div>

        {view === "settings" ? (
          <SettingsView onClose={() => setView("workspace")} />
        ) : view === "library" ? (
          <LibraryView onNewFromTemplate={()=>setView('workspace')} />
        ) : view === "audit" ? (
          <AuditView />
        ) : mode === "empty" ? (
          <EmptyState />
        ) : (
          <div className="panes" data-screen-label="01 Workspace">
            <SourcesPane activeCite={activeCite} setActiveCite={setActiveCite} />
            <ChatPane setActiveCite={setActiveCite} />
            <DraftPane state={state} activeCite={activeCite} setActiveCite={setActiveCite} />
          </div>
        )}
      </main>

      {mode === "firstrun" && <FirstRun onDone={()=>{ setMode("workspace"); setView("settings"); }} />}
      <CommandPalette open={cmdkOpen} onClose={()=>setCmdkOpen(false)} goView={setView} />
      <ExportModal open={exportOpen} onClose={()=>setExportOpen(false)} doc={{title: activeProject.name, subtitle: activeProject.subtitle || activeProject.template + ' draft'}} />
      <IngestModal open={ingestOpen} onClose={()=>setIngestOpen(false)} onIngested={(parsed, file) => { setIngestedTemplates(t => [...t, {name: file.name, sections: parsed.sections.length, placeholders: parsed.placeholders.length}]); pushToast({text: 'Registered template · ' + file.name, icon:'✓', tone:'sage'}); }} />
      <Tweaks
        viewTw={view} setViewTw={setView}
        open={tweaksOpen}
        onClose={() => { setTweaksOpen(false); window.parent.postMessage({type:'__deactivate_edit_mode'},'*'); }}
        state={state} setState={setState}
        density={density} setDensity={setDensity}
        mode={mode} setMode={setMode}
      />
    </div>
  );
}

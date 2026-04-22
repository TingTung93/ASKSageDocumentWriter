import { useState, useEffect } from 'react';
import { V2Sidebar } from './V2Sidebar';
import { V2ProjectWorkspace } from './V2ProjectWorkspace';
import { useLiveQuery } from 'dexie-react-hooks';
import { useParams } from 'react-router-dom';
import { db } from '../../lib/db/schema';
import '../../v2.css';
import { RecipeProvider, useRecipe } from './RecipeContext';
import { V2CommandPalette } from './V2CommandPalette';

export function V2Layout() {
  return (
    <RecipeProvider>
      <V2LayoutInner />
    </RecipeProvider>
  );
}

function V2LayoutInner() {
  const [view, setView] = useState("workspace");
  const [showCP, setShowCP] = useState(false);
  const { id } = useParams<{ id: string }>();
  const project = useLiveQuery(() => (id ? db.projects.get(id) : undefined), [id]);
  const allTemplates = useLiveQuery(() => db.templates.toArray(), []);

  const { startRecipe, isRunning, recipeStageMessage, currentRun, resumeRecipe } = useRecipe();

  useEffect(() => {
    const handleK = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setShowCP(true);
      }
    };
    window.addEventListener('keydown', handleK);
    return () => window.removeEventListener('keydown', handleK);
  }, []);

  const handleStart = async () => {
    if (!project || !allTemplates) return;
    const projectTemplates = allTemplates.filter((t) => project.template_ids.includes(t.id));
    await startRecipe(project, projectTemplates);
  };

  const handleResume = async () => {
    if (!project || !allTemplates) return;
    const projectTemplates = allTemplates.filter((t) => project.template_ids.includes(t.id));
    await resumeRecipe(project, projectTemplates);
  };

  return (
    <div className="app">
      <V2Sidebar view={view} setView={setView} />

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
                <span className="current">{project?.name || 'Loading...'}</span>
              </>
            )}
          </div>
          <div className="topbar-actions">
            {view !== 'workspace' ? (
              <button className="btn" onClick={()=>setView('workspace')}>← Back to workspace</button>
            ) : (
              <>
                {isRunning ? (
                  <div className="status-badge running">
                    <span className="spinner-small" />
                    {recipeStageMessage || 'Running...'}
                  </div>
                ) : currentRun?.status === 'paused' ? (
                  <button className="btn btn-accent" onClick={handleResume}>▶ Resume drafting</button>
                ) : (
                  <button className="btn btn-accent" onClick={handleStart}>✦ Auto-draft</button>
                )}
                <button className="btn btn-ghost" onClick={() => setShowCP(true)}>⌘K Palette</button>
                <button className="btn btn-ghost">⏵ Share</button>
                <button className="btn">⎘ Duplicate</button>
              </>
            )}
          </div>
        </div>

        {view === "settings" ? (
          <div style={{padding: 40}}>Settings View Placeholder</div>
        ) : view === "library" ? (
          <div style={{padding: 40}}>Library View Placeholder</div>
        ) : view === "audit" ? (
          <div style={{padding: 40}}>Audit View Placeholder</div>
        ) : (
          <V2ProjectWorkspace />
        )}
      </main>

      {showCP && (
        <V2CommandPalette 
          onClose={() => setShowCP(false)} 
          setView={setView} 
        />
      )}
    </div>
  );
}

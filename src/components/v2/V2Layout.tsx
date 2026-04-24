import { useState, useEffect, useRef } from 'react';
import { V2Sidebar } from './V2Sidebar';
import { V2ProjectWorkspace } from './V2ProjectWorkspace';
import { V2ExportModal } from './V2ExportModal';
import { useLiveQuery } from 'dexie-react-hooks';
import { useParams } from 'react-router-dom';
import { db } from '../../lib/db/schema';
// v2.css is loaded globally from main.tsx; no per-mount import needed.
import { RecipeProvider, useRecipe } from './RecipeContext';
import { V2CommandPalette } from './V2CommandPalette';
import { V2FirstRun } from './V2FirstRun';
import { V2IngestModal } from './V2IngestModal';
import { V2LibraryView } from './V2LibraryView';
import { V2AuditView } from './V2AuditView';
import { V2SettingsView } from './V2SettingsView';
import { useAuth } from '../../lib/state/auth';
import { toast } from '../../lib/state/toast';

const FIRST_RUN_DISMISSED_KEY = 'asksage:v2:first-run-dismissed';

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
  const [showExport, setShowExport] = useState(false);
  const [showIngest, setShowIngest] = useState(false);
  const apiKey = useAuth((s) => s.apiKey);
  const storageWarnedRef = useRef(false);
  const warnStorageOnce = () => {
    if (storageWarnedRef.current) return;
    storageWarnedRef.current = true;
    toast.info('Session storage unavailable — first-run state will not persist this session');
  };
  const [firstRunDismissed, setFirstRunDismissed] = useState<boolean>(() => {
    try { return sessionStorage.getItem(FIRST_RUN_DISMISSED_KEY) === '1'; } catch { return false; }
  });
  const showFirstRun = !apiKey && !firstRunDismissed;
  const dismissFirstRun = () => {
    try { sessionStorage.setItem(FIRST_RUN_DISMISSED_KEY, '1'); } catch { warnStorageOnce(); }
    setFirstRunDismissed(true);
  };
  const { id } = useParams<{ id: string }>();
  const project = useLiveQuery(() => (id ? db.projects.get(id) : undefined), [id]);
  const allTemplates = useLiveQuery(() => db.templates.toArray(), []);

  const { startRecipe, isRunning, recipeStageMessage, currentRun, resumeRecipe } = useRecipe();

  useEffect(() => {
    const handleK = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setShowCP(true);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'e') {
        e.preventDefault();
        setShowExport(true);
        return;
      }
    };
    const openExport = () => setShowExport(true);
    const regen = () => toast.info('Regenerating active section…');
    const accept = () => toast.success('Findings applied');
    const openIngest = () => setShowIngest(true);
    const slashRegen = () => toast.info('↻ Regenerating active section…');
    const slashExpand = () => toast.info('⇱ Expanding active section…');
    const slashTighten = () => toast.info('⇲ Tightening active section…');
    const slashCite = () => toast.info('⁂ Strengthening citations…');
    const slashRewrite = () => toast.info('✎ Rewrite — pick a target tone');

    window.addEventListener('keydown', handleK);
    window.addEventListener('v2:open-export', openExport);
    window.addEventListener('v2:regen-active', regen);
    window.addEventListener('v2:accept-findings', accept);
    window.addEventListener('v2:open-ingest', openIngest);
    window.addEventListener('v2:slash-regen', slashRegen);
    window.addEventListener('v2:slash-expand', slashExpand);
    window.addEventListener('v2:slash-tighten', slashTighten);
    window.addEventListener('v2:slash-cite', slashCite);
    window.addEventListener('v2:slash-rewrite', slashRewrite);
    return () => {
      window.removeEventListener('keydown', handleK);
      window.removeEventListener('v2:open-export', openExport);
      window.removeEventListener('v2:regen-active', regen);
      window.removeEventListener('v2:accept-findings', accept);
      window.removeEventListener('v2:open-ingest', openIngest);
      window.removeEventListener('v2:slash-regen', slashRegen);
      window.removeEventListener('v2:slash-expand', slashExpand);
      window.removeEventListener('v2:slash-tighten', slashTighten);
      window.removeEventListener('v2:slash-cite', slashCite);
      window.removeEventListener('v2:slash-rewrite', slashRewrite);
    };
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
                <button className="btn btn-ghost" onClick={() => setShowExport(true)}>⇣ Export</button>
              </>
            )}
          </div>
        </div>

        {view === "settings" ? (
          <V2SettingsView />
        ) : view === "library" ? (
          <V2LibraryView onOpenIngest={() => setShowIngest(true)} />
        ) : view === "audit" ? (
          <V2AuditView />
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
      {showFirstRun && <V2FirstRun onDismiss={dismissFirstRun} />}
      {showIngest && <V2IngestModal onClose={() => setShowIngest(false)} />}
      {showExport && project && allTemplates && (
        <V2ExportModal
          project={project}
          templates={allTemplates.filter((t) => project.template_ids.includes(t.id))}
          onClose={() => setShowExport(false)}
        />
      )}
    </div>
  );
}

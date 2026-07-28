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
import { getAuthConnection, useAuth } from '../../lib/state/auth';
import { toast } from '../../lib/state/toast';
import { DraftActionControllerProvider } from './drafting';

const FIRST_RUN_DISMISSED_KEY = 'asksage:v2:first-run-dismissed';

export function V2Layout() {
  return (
    <RecipeProvider>
      <DraftActionControllerProvider>
        <V2LayoutInner />
      </DraftActionControllerProvider>
    </RecipeProvider>
  );
}

function V2LayoutInner() {
  const [view, setView] = useState("workspace");
  const [showNavigation, setShowNavigation] = useState(false);
  const [showCP, setShowCP] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showIngest, setShowIngest] = useState(false);
  const auth = useAuth();
  const connection = getAuthConnection(auth);
  const storageWarnedRef = useRef(false);
  const warnStorageOnce = () => {
    if (storageWarnedRef.current) return;
    storageWarnedRef.current = true;
    toast.info('Session storage unavailable — first-run state will not persist this session');
  };
  const [firstRunDismissed, setFirstRunDismissed] = useState<boolean>(() => {
    try { return sessionStorage.getItem(FIRST_RUN_DISMISSED_KEY) === '1'; } catch { return false; }
  });
  const showFirstRun = !connection.canGenerate && !firstRunDismissed;
  const dismissFirstRun = () => {
    try { sessionStorage.setItem(FIRST_RUN_DISMISSED_KEY, '1'); } catch { warnStorageOnce(); }
    setFirstRunDismissed(true);
  };
  const { id } = useParams<{ id: string }>();
  const project = useLiveQuery(
    async () => (id ? (await db.projects.get(id)) ?? null : null),
    [id],
  );
  const allTemplates = useLiveQuery(() => db.templates.toArray(), []);

  const {
    startRecipe,
    isRunning,
    recipeStageMessage,
    currentRun,
    recoveredRunStatus,
    isRecoveringRun,
    resumeRecipe,
    retryRecipe,
  } = useRecipe();
  const effectiveRunStatus = recoveredRunStatus ?? currentRun?.status ?? null;

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
    window.addEventListener('keydown', handleK);
    return () => {
      window.removeEventListener('keydown', handleK);
    };
  }, []);

  const handleStart = async () => {
    if (!project || !allTemplates || isRunning) return;
    const projectTemplates = allTemplates.filter((t) => project.template_ids.includes(t.id));
    await startRecipe(project, projectTemplates);
  };

  const handleResume = async () => {
    if (!project || !allTemplates || isRunning) return;
    const projectTemplates = allTemplates.filter((t) => project.template_ids.includes(t.id));
    await resumeRecipe(project, projectTemplates);
  };

  const handleRetry = async () => {
    if (!project || !allTemplates || isRunning) return;
    const projectTemplates = allTemplates.filter((t) => project.template_ids.includes(t.id));
    await retryRecipe(project, projectTemplates);
  };

  return (
    <div className={`app${showNavigation ? ' navigation-open' : ''}`}>
      <V2Sidebar
        view={view}
        setView={(nextView) => {
          setView(nextView);
          setShowNavigation(false);
        }}
      />
      {showNavigation && (
        <button
          className="navigation-scrim"
          aria-label="Close navigation"
          onClick={() => setShowNavigation(false)}
        />
      )}

      <main className="workspace">
        <div className="topbar">
          <div className="crumbs">
            <button
              className="mobile-navigation-toggle"
              aria-expanded={showNavigation}
              aria-label="Open workspace navigation"
              onClick={() => setShowNavigation((open) => !open)}
            >
              ☰
            </button>
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
                  <div className="status-badge state-running" role="status" aria-live="polite">
                    <span className="spinner-small" />
                    {recipeStageMessage || 'Running...'}
                  </div>
                ) : isRecoveringRun ? (
                  <div className="status-badge state-loading" role="status" aria-live="polite">
                    <span className="spinner-small" />
                    Recovering last run…
                  </div>
                ) : effectiveRunStatus === 'paused' || effectiveRunStatus === 'interrupted' ? (
                  <button className="btn btn-accent" onClick={handleResume}>▶ Resume drafting</button>
                ) : effectiveRunStatus === 'failed' ? (
                  <button className="btn btn-accent" onClick={handleRetry}>↻ Retry drafting</button>
                ) : (
                  <button
                    className="btn btn-accent"
                    onClick={handleStart}
                    disabled={!project || !allTemplates}
                  >
                    ✦ Auto-draft
                  </button>
                )}
                <button className="btn btn-ghost" onClick={() => setShowCP(true)}>⌘K Palette</button>
                <button
                  className="btn btn-ghost"
                  onClick={() => setShowExport(true)}
                  disabled={!project || !allTemplates}
                >
                  ⇣ Export
                </button>
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
          onOpenExport={() => setShowExport(true)}
          onOpenIngest={() => setShowIngest(true)}
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

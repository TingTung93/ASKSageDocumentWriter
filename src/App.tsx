import { HashRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import { Shell } from './components/Shell';
import { Templates } from './routes/Templates';
import { Projects } from './routes/Projects';
import { ProjectDetail } from './routes/ProjectDetail';
import { Datasets } from './routes/Datasets';
import { Documents } from './routes/Documents';
import { AuditLog } from './routes/AuditLog';
import { Settings } from './routes/Settings';
import { DebugPanel } from './components/DebugPanel';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastContainer } from './components/ToastContainer';
import { registerRecipe } from './lib/agent/recipe';
import { PWS_RECIPE } from './lib/agent/recipes/pws';
import { FREEFORM_RECIPE } from './lib/agent/recipes/freeform';

import { V2Layout } from './components/v2/V2Layout';

// /projects/:id is the legacy per-project workspace. V2 is now the
// primary workspace, so redirect there — the legacy view stays
// available at /legacy/projects/:id as an escape hatch.
export function ProjectDetailRedirect() {
  const { id } = useParams<{ id: string }>();
  return <Navigate to={`/v2/${id}`} replace />;
}

// Register agentic recipes at module load. resumeRecipeRun() looks
// recipes up by id, so they must be registered before the user can
// resume a paused run after a page reload.
registerRecipe(PWS_RECIPE);
registerRecipe(FREEFORM_RECIPE);

// HashRouter (not BrowserRouter) so the built app works from file://,
// from an internal share, or from any static server without rewrite rules.
//
// DebugPanel is rendered OUTSIDE the ErrorBoundary so an opted-in
// diagnostics view (or a startup failure) remains available if the
// application tree crashes.
export function App() {
  return (
    <>
      <ErrorBoundary>
        <HashRouter>
          <Routes>
            {/* V2 owns the application shell and startup experience. */}
            <Route path="/v2" element={<V2Layout />} />
            <Route path="/v2/:id" element={<V2Layout />} />
            <Route path="/" element={<Navigate to="/v2" replace />} />
            <Route path="/projects" element={<Navigate to="/v2" replace />} />
            <Route path="/documents" element={<Navigate to="/v2?view=documents" replace />} />
            <Route path="/templates" element={<Navigate to="/v2?view=library" replace />} />
            <Route path="/datasets" element={<Navigate to="/v2?view=library" replace />} />
            <Route path="/audit" element={<Navigate to="/v2?view=audit" replace />} />
            <Route path="/settings" element={<Navigate to="/v2?view=settings" replace />} />
            <Route path="/projects/:id" element={<ProjectDetailRedirect />} />

            {/* Explicit compatibility routes retain the original chrome. */}
            <Route
              path="/legacy/*"
              element={
                <Shell>
                  <Routes>
                    <Route path="documents" element={<Documents />} />
                    <Route path="templates" element={<Templates />} />
                    <Route path="datasets" element={<Datasets />} />
                    <Route path="projects" element={<Projects />} />
                    <Route path="projects/:id" element={<ProjectDetail />} />
                    <Route path="audit" element={<AuditLog />} />
                    <Route path="settings" element={<Settings />} />
                    <Route path="*" element={<Navigate to="/v2" replace />} />
                  </Routes>
                </Shell>
              }
            />
            <Route path="*" element={<Navigate to="/v2" replace />} />
          </Routes>
        </HashRouter>
      </ErrorBoundary>
      <ToastContainer />
      <DebugPanel />
    </>
  );
}

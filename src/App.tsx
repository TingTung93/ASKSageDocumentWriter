import { HashRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import { Shell } from './components/Shell';
import { Welcome } from './routes/Welcome';
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
function ProjectDetailRedirect() {
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
// DebugPanel is rendered OUTSIDE the ErrorBoundary so it stays visible
// even if the rest of the tree crashes.
export function App() {
  return (
    <>
      <ErrorBoundary>
        <HashRouter>
          <Routes>
            {/* V2 experience has its own sidebar layout */}
            <Route path="/v2/:id" element={<V2Layout />} />
            
            {/* Legacy layout */}
            <Route
              path="*"
              element={
                <Shell>
                  <div style={{ paddingBottom: 'calc(40vh + 2rem)' }}>
                    <Routes>
                      <Route path="/" element={<Welcome />} />
                      <Route path="/documents" element={<Documents />} />
                      <Route path="/templates" element={<Templates />} />
                      <Route path="/datasets" element={<Datasets />} />
                      <Route path="/projects" element={<Projects />} />
                      <Route path="/projects/:id" element={<ProjectDetailRedirect />} />
                      <Route path="/legacy/projects/:id" element={<ProjectDetail />} />
                      <Route path="/audit" element={<AuditLog />} />
                      <Route path="/settings" element={<Settings />} />
                      <Route path="*" element={<Navigate to="/" replace />} />
                    </Routes>
                  </div>
                </Shell>
              }
            />
          </Routes>
        </HashRouter>
      </ErrorBoundary>
      <ToastContainer />
      <DebugPanel />
    </>
  );
}

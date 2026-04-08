import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Shell } from './components/Shell';
import { Welcome } from './routes/Welcome';
import { Templates } from './routes/Templates';
import { Projects } from './routes/Projects';
import { ProjectDetail } from './routes/ProjectDetail';
import { Datasets } from './routes/Datasets';
import { Documents } from './routes/Documents';
import { DebugPanel } from './components/DebugPanel';
import { ErrorBoundary } from './components/ErrorBoundary';

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
          <Shell>
            <div style={{ paddingBottom: 'calc(40vh + 2rem)' }}>
              <Routes>
                <Route path="/" element={<Welcome />} />
                <Route path="/documents" element={<Documents />} />
                <Route path="/templates" element={<Templates />} />
                <Route path="/datasets" element={<Datasets />} />
                <Route path="/projects" element={<Projects />} />
                <Route path="/projects/:id" element={<ProjectDetail />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </div>
          </Shell>
        </HashRouter>
      </ErrorBoundary>
      <DebugPanel />
    </>
  );
}

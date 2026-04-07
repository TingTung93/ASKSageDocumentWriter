import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Shell } from './components/Shell';
import { Welcome } from './routes/Welcome';
import { Templates } from './routes/Templates';
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
                <Route path="/templates" element={<Templates />} />
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

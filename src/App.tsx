import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Shell } from './components/Shell';
import { Welcome } from './routes/Welcome';

// HashRouter (not BrowserRouter) so the built app works from file://,
// from an internal share, or from any static server without rewrite rules.
export function App() {
  return (
    <HashRouter>
      <Shell>
        <Routes>
          <Route path="/" element={<Welcome />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Shell>
    </HashRouter>
  );
}

import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { debugLog } from './lib/debug/log';
// V2 design-system tokens are global — load BEFORE index.css so the
// legacy stylesheet can alias to V2 tokens and override where needed.
import './v2.css';
import './index.css';

// Install global log capture FIRST so any error during React init is
// captured and rendered in the debug panel.
debugLog.install();

try {
  const rootEl = document.getElementById('root');
  if (!rootEl) {
    throw new Error('#root element not found in index.html');
  }
  // eslint-disable-next-line no-console
  console.info('[main] mounting React app');
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
  // eslint-disable-next-line no-console
  console.info('[main] React mount called');
} catch (e) {
  // eslint-disable-next-line no-console
  console.error('[main] crash during init:', e);
  // Render a minimal fallback so the debug panel still has somewhere to live.
  document.body.insertAdjacentHTML(
    'beforeend',
    '<pre style="color:#b00;padding:1rem;font-family:monospace">Startup error — see debug panel below</pre>',
  );
}

import { useSyncExternalStore, useState } from 'react';
import { debugLog, type LogEntry } from '../lib/debug/log';

// Fixed-position panel at the bottom of every screen. Always rendered.
// Subscribes to debugLog and rerenders on every captured entry.
export function DebugPanel() {
  const entries = useSyncExternalStore(debugLog.subscribe, debugLog.getSnapshot);
  const [open, setOpen] = useState(true);

  const errCount = entries.filter((e) => e.level === 'error').length;
  const warnCount = entries.filter((e) => e.level === 'warn').length;

  async function copyAll() {
    const text = debugLog.asText();
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('copy failed:', e);
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        background: '#1a1a1a',
        color: '#e0e0e0',
        borderTop: '2px solid #444',
        fontFamily: 'ui-monospace, Consolas, monospace',
        fontSize: 11,
        zIndex: 99999,
        maxHeight: open ? '40vh' : '28px',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 -4px 12px rgba(0,0,0,0.3)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          padding: '0.25rem 0.5rem',
          borderBottom: open ? '1px solid #444' : 'none',
          background: '#252525',
          flexShrink: 0,
        }}
      >
        <button
          type="button"
          onClick={() => setOpen(!open)}
          style={{
            margin: 0,
            padding: '0.15rem 0.5rem',
            fontSize: 11,
            background: '#444',
            border: '1px solid #666',
            color: '#fff',
            fontFamily: 'inherit',
          }}
        >
          {open ? '▼' : '▲'} Debug log
        </button>
        <span style={{ color: '#888' }}>
          {entries.length} entries
          {errCount > 0 && <span style={{ color: '#f55', fontWeight: 600 }}> · {errCount} error{errCount > 1 ? 's' : ''}</span>}
          {warnCount > 0 && <span style={{ color: '#fa0' }}> · {warnCount} warn</span>}
        </span>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          onClick={copyAll}
          style={{
            margin: 0,
            padding: '0.15rem 0.5rem',
            fontSize: 11,
            background: '#444',
            border: '1px solid #666',
            color: '#fff',
            fontFamily: 'inherit',
          }}
        >
          Copy all
        </button>
        <button
          type="button"
          onClick={() => debugLog.clear()}
          style={{
            margin: 0,
            padding: '0.15rem 0.5rem',
            fontSize: 11,
            background: '#444',
            border: '1px solid #666',
            color: '#fff',
            fontFamily: 'inherit',
          }}
        >
          Clear
        </button>
      </div>
      {open && (
        <div
          style={{
            overflow: 'auto',
            padding: '0.5rem',
            flex: 1,
          }}
        >
          {entries.length === 0 ? (
            <div style={{ color: '#666' }}>(no log entries yet)</div>
          ) : (
            entries.map((e, i) => <LogRow key={i} entry={e} />)
          )}
        </div>
      )}
    </div>
  );
}

const LEVEL_COLOR: Record<string, string> = {
  log: '#ccc',
  info: '#9cf',
  warn: '#fa0',
  error: '#f55',
};

function LogRow({ entry }: { entry: LogEntry }) {
  const time = new Date(entry.ts).toISOString().slice(11, 23);
  return (
    <div
      style={{
        display: 'flex',
        gap: '0.5rem',
        padding: '0.1rem 0',
        borderBottom: '1px solid #2a2a2a',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    >
      <span style={{ color: '#666', flexShrink: 0 }}>{time}</span>
      <span
        style={{
          color: LEVEL_COLOR[entry.level] ?? '#ccc',
          flexShrink: 0,
          minWidth: 38,
          textTransform: 'uppercase',
          fontWeight: 600,
        }}
      >
        {entry.level}
      </span>
      <span style={{ color: '#e0e0e0' }}>{entry.message}</span>
    </div>
  );
}

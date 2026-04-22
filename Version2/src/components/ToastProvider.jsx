// Extracted from Co-Writer.html — loaded via <script type="text/babel" src>.
// Components are attached to window for cross-file sharing.

// ── Toast system ──────────────────────────────────────────────
const ToastCtx = React.createContext(null);
function ToastProvider({ children }) {
  const [toasts, setToasts] = React.useState([]);
  const push = React.useCallback((opts) => {
    const id = Math.random().toString(36).slice(2);
    const t = { id, tone:'accent', ttl: 4000, ...opts };
    setToasts(prev => [...prev, t]);
    setTimeout(() => setToasts(prev => prev.map(x => x.id===id ? {...x, leaving:true} : x)), t.ttl - 200);
    setTimeout(() => setToasts(prev => prev.filter(x => x.id !== id)), t.ttl);
    return id;
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toast-stack">
        {toasts.map(t => (
          <div key={t.id} className={"toast " + (t.tone||'') + (t.leaving?' leave':'')}>
            <span className="ic">{t.icon || '✓'}</span>
            <span>{t.text}</span>
            {t.undo && <span className="undo" onClick={() => { t.undo(); }}>Undo</span>}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
function useToast() { return React.useContext(ToastCtx) || (() => {}); }
window.ToastProvider = ToastProvider;
window.useToast = useToast;

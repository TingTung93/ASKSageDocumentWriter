// Tweaks panel (bottom-right)
const { useEffect: useEffectTw } = React;

function Tweaks({ open, onClose, state, setState, density, setDensity, mode, setMode, viewTw, setViewTw }) {
  useEffectTw(() => {
    document.body.classList.toggle("dense", density === "dense");
    document.body.classList.toggle("airy", density === "airy");
  }, [density]);

  if (!open) return null;

  return (
    <div className="tweaks open">
      <h5>
        Tweaks
        <button className="tw-close" onClick={onClose}>×</button>
      </h5>

      <div className="tw-group">
        <div className="tw-label">View</div>
        <div className="tw-seg">
          <button className={viewTw==='workspace'?'on':''} onClick={() => setViewTw('workspace')}>Draft</button>
          <button className={viewTw==='library'?'on':''} onClick={() => setViewTw('library')}>Library</button>
          <button className={viewTw==='audit'?'on':''} onClick={() => setViewTw('audit')}>Audit</button>
          <button className={viewTw==='settings'?'on':''} onClick={() => setViewTw('settings')}>Settings</button>
        </div>
      </div>
      <div className="tw-group">
        <div className="tw-label">Workspace mode</div>
        <div className="tw-seg">
          <button className={mode==='workspace'?'on':''} onClick={() => setMode('workspace')}>Workspace</button>
          <button className={mode==='empty'?'on':''} onClick={() => setMode('empty')}>New / empty</button>
          <button className={mode==='firstrun'?'on':''} onClick={() => setMode('firstrun')}>First run</button>
        </div>
      </div>

      <div className="tw-group">
        <div className="tw-label">Draft state</div>
        <div className="tw-seg">
          <button className={state==='drafting'?'on':''} onClick={() => setState('drafting')}>Drafting</button>
          <button className={state==='review'?'on':''} onClick={() => setState('review')}>Review</button>
          <button className={state==='done'?'on':''} onClick={() => setState('done')}>Done</button>
        </div>
      </div>

      <div className="tw-group">
        <div className="tw-label">Density</div>
        <div className="tw-seg">
          <button className={density==='dense'?'on':''} onClick={() => setDensity('dense')}>Dense</button>
          <button className={density==='normal'?'on':''} onClick={() => setDensity('normal')}>Balanced</button>
          <button className={density==='airy'?'on':''} onClick={() => setDensity('airy')}>Airy</button>
        </div>
      </div>
    </div>
  );
}

window.Tweaks = Tweaks;

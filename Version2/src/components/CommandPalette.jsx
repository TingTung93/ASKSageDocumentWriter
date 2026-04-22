// Extracted from Co-Writer.html — loaded via <script type="text/babel" src>.
// Components are attached to window for cross-file sharing.

// ── Command palette ──────────────────────────────────────────
function CommandPalette({ open, onClose, goView, actions }) {
  const [query, setQuery] = React.useState('');
  const [idx, setIdx] = React.useState(0);
  const inputRef = React.useRef(null);
  React.useEffect(() => { if (open) { setQuery(''); setIdx(0); setTimeout(()=>inputRef.current?.focus(), 20); } }, [open]);

  const baseItems = React.useMemo(() => [
    { group:'Navigate', ic:'▸', label:'Draft workspace', desc:'Three-pane co-writer view', trail:'G D', run:() => goView('workspace') },
    { group:'Navigate', ic:'▸', label:'Library', desc:'Templates & datasets', trail:'G L', run:() => goView('library') },
    { group:'Navigate', ic:'▸', label:'Activity log', desc:'Audit trail of model calls', trail:'G A', run:() => goView('audit') },
    { group:'Navigate', ic:'▸', label:'Settings', desc:'Connection, models, privacy', trail:'G ,', run:() => goView('settings') },
    { group:'Jump to section', ic:'§', label:'1.1  Background', trail:'1', run:() => document.getElementById('sec-11')?.scrollIntoView({behavior:'smooth'}) },
    { group:'Jump to section', ic:'§', label:'1.2  Scope of Services', trail:'2', run:() => document.getElementById('sec-12')?.scrollIntoView({behavior:'smooth'}) },
    { group:'Jump to section', ic:'§', label:'1.3  Performance Objectives', trail:'3', run:() => document.getElementById('sec-13')?.scrollIntoView({behavior:'smooth'}) },
    { group:'Jump to section', ic:'§', label:'2.1  Staffing & Qualifications', trail:'4', run:() => document.getElementById('sec-21')?.scrollIntoView({behavior:'smooth'}) },
    { group:'Jump to section', ic:'§', label:'2.2  Credentialing & Privileging', trail:'5', run:() => document.getElementById('sec-22')?.scrollIntoView({behavior:'smooth'}) },
    { group:'Actions', ic:'⇣', label:'Export document…', desc:'Word, PDF, or Markdown', trail:'⌘E', run:() => window.dispatchEvent(new CustomEvent('open-export')) },
    { group:'Actions', ic:'＋', label:'Upload DOCX template', desc:'Parse structure and placeholders', trail:'', run:() => { goView('library'); setTimeout(()=>window.dispatchEvent(new CustomEvent('open-ingest')),100); } },
    { group:'Actions', ic:'↻', label:'Regenerate active section', desc:'Re-draft §1.3 with current context', trail:'⌘R', run:() => window.dispatchEvent(new CustomEvent('toast', {detail:{text:'Regenerating §1.3 Performance Objectives…', icon:'↻'}})) },
    { group:'Actions', ic:'✓', label:'Accept all findings', desc:'Apply cross-section review fixes', trail:'', run:() => window.dispatchEvent(new CustomEvent('toast', {detail:{text:'3 findings applied', icon:'✓', tone:'sage'}})) },
    { group:'Actions', ic:'⎇', label:'Branch conversation', desc:'Fork chat from current turn', trail:'', run:() => {} },
  ], [goView]);

  const q = query.toLowerCase().trim();
  const items = q
    ? baseItems.filter(i => (i.label + ' ' + (i.desc||'') + ' ' + i.group).toLowerCase().includes(q))
    : baseItems;
  const groups = {};
  items.forEach(i => { (groups[i.group] = groups[i.group] || []).push(i); });

  const flat = Object.values(groups).flat();
  const runIdx = (i) => { flat[i]?.run?.(); onClose(); };

  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => Math.min(i+1, flat.length-1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx(i => Math.max(i-1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); runIdx(idx); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };

  if (!open) return null;
  let cursor = 0;
  return (
    <div className="cmdk-scrim" onClick={onClose}>
      <div className="cmdk-card" onClick={e=>e.stopPropagation()}>
        <div className="cmdk-input-wrap">
          <span style={{fontSize:18, color:'var(--ink-3)'}}>⌕</span>
          <input ref={inputRef} className="cmdk-input" placeholder="Jump to section, run a command, or search…" value={query} onChange={e=>{setQuery(e.target.value); setIdx(0);}} onKeyDown={onKey} />
          <span className="cmdk-kbd">esc</span>
        </div>
        <div className="cmdk-list">
          {Object.entries(groups).map(([g, rows]) => (
            <div key={g}>
              <div className="cmdk-group-label">{g}</div>
              {rows.map((r) => {
                const myIdx = cursor++;
                return (
                  <div key={myIdx} className={"cmdk-item"+(myIdx===idx?' on':'')} onMouseEnter={()=>setIdx(myIdx)} onClick={()=>runIdx(myIdx)}>
                    <span className="ic">{r.ic}</span>
                    <span>{r.label}{r.desc && <span className="desc">{r.desc}</span>}</span>
                    <span className="trail">{r.trail}</span>
                  </div>
                );
              })}
            </div>
          ))}
          {items.length === 0 && <div style={{padding:'28px 18px', textAlign:'center', color:'var(--ink-3)', fontSize:13}}>No matches for "{query}"</div>}
        </div>
        <div className="cmdk-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>↵</kbd> select</span>
          <span><kbd>esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
window.CommandPalette = CommandPalette;

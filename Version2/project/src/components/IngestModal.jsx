// Extracted from Co-Writer.html — loaded via <script type="text/babel" src>.
// Components are attached to window for cross-file sharing.

function IngestModal({ open, onClose, onIngested }) {
  const [phase, setPhase] = React.useState('drop'); // drop | parsing | done | error
  const [file, setFile] = React.useState(null);
  const [parsed, setParsed] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [hot, setHot] = React.useState(false);
  if (!open) return null;

  const handleFile = async (f) => {
    setFile(f); setPhase('parsing'); setError(null);
    try {
      const p = await parseDocxTemplate(f);
      setParsed(p); setPhase('done');
    } catch(e) {
      setError(e.message || String(e)); setPhase('error');
    }
  };
  const onDrop = (e) => { e.preventDefault(); setHot(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); };
  const onChange = (e) => { const f = e.target.files[0]; if (f) handleFile(f); };

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal-card" onClick={e=>e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-eye">Template ingest</div>
          <div className="modal-title">Add DOCX template</div>
          <div className="modal-sub">Parse structure, detect placeholders, register as a reusable template.</div>
        </div>
        <div className="modal-body">
          {phase === 'drop' && (
            <label className={"ingest-drop" + (hot?' hot':'')}
                   onDragOver={e=>{e.preventDefault();setHot(true);}}
                   onDragLeave={()=>setHot(false)}
                   onDrop={onDrop}>
              <div className="ic">⬆</div>
              <div className="ln1">Drop a .docx file here</div>
              <div className="ln2">or click to browse · max ~20 MB</div>
              <input type="file" accept=".docx" style={{display:'none'}} onChange={onChange} />
            </label>
          )}
          {phase === 'parsing' && file && (
            <div>
              <div style={{fontFamily:'var(--font-mono)',fontSize:12,color:'var(--ink-2)',marginBottom:10}}>{file.name} · {(file.size/1024).toFixed(0)} KB</div>
              <div className="ingest-steps">
                <div className="ingest-step on"><span className="st"/><span>Read file bytes</span><span className="ms">~12ms</span></div>
                <div className="ingest-step on"><span className="st"/><span>Unzip DOCX container</span><span className="ms">~48ms</span></div>
                <div className="ingest-step on"><span className="st"/><span>Parse document.xml → section tree</span><span className="ms">~180ms</span></div>
                <div className="ingest-step pend"><span className="st"/><span>Detect placeholders & example text</span><span className="ms">running…</span></div>
                <div className="ingest-step pend"><span className="st"/><span>Register as template</span><span className="ms">queued</span></div>
              </div>
            </div>
          )}
          {phase === 'done' && parsed && (
            <div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8,marginBottom:12}}>
                <div className="usage-stat"><div className="k">Sections</div><div className="v">{parsed.sections.length}</div></div>
                <div className="usage-stat"><div className="k">Placeholders</div><div className="v">{parsed.placeholders.length}</div></div>
                <div className="usage-stat"><div className="k">Words</div><div className="v">{parsed.wordCount.toLocaleString()}</div></div>
              </div>
              <div style={{fontSize:11,color:'var(--ink-3)',fontFamily:'var(--font-mono)',marginBottom:6,textTransform:'uppercase',letterSpacing:'0.08em'}}>Detected structure</div>
              <div className="parsed-preview">
                {parsed.sections.length === 0 && (
                  <div style={{fontSize:12,color:'var(--ink-3)',padding:10}}>No headings found — template will be single-section. You can split it manually after import.</div>
                )}
                {parsed.sections.slice(0,20).map((s,i) => (
                  <div key={i} className="parsed-section" style={{paddingLeft: (s.level-1)*12}}>
                    <span className="pnum">§{s.num}</span>
                    <span className="ptitle">{s.title}</span>
                    {parsed.placeholders[i] && <span className="pph">{'{{'+parsed.placeholders[i]+'}}'}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
          {phase === 'error' && (
            <div style={{padding:14,background:'var(--rose-soft)',border:'1px solid oklch(0.88 0.05 25)',borderRadius:8,color:'var(--rose)',fontSize:12.5}}>
              Couldn't parse this file: {error}. Make sure it's a valid .docx (Word 2007+).
            </div>
          )}
        </div>
        <div className="modal-foot">
          <span className="left">{phase==='done' && parsed ? 'Structure looks good' : phase==='parsing' ? 'Parsing locally — no upload' : 'Local · no upload'}</span>
          <div style={{display:'flex',gap:8}}>
            <button className="btn" onClick={onClose}>Cancel</button>
            {phase==='done' && <button className="btn btn-primary" onClick={() => { onIngested && onIngested(parsed, file); onClose(); }}>Register template</button>}
          </div>
        </div>
      </div>
    </div>
  );
}
window.IngestModal = IngestModal;

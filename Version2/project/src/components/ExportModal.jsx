// Extracted from Co-Writer.html — loaded via <script type="text/babel" src>.
// Components are attached to window for cross-file sharing.

function ExportModal({ open, onClose, doc }) {
  const [fmt, setFmt] = React.useState('docx');
  const [includeCites, setIncludeCites] = React.useState(true);
  const [includeNotes, setIncludeNotes] = React.useState(false);
  const [redlines, setRedlines] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  if (!open) return null;
  const total = (window.SECTIONS||[]).filter(s=>s.status!=='queued').length;
  const handleExport = async () => {
    setBusy(true);
    try {
      if (fmt === 'docx') { await buildAndDownloadDocx(doc); window.dispatchEvent(new CustomEvent('toast', {detail:{text:'Exported '+(doc.title||'draft')+'.docx', icon:'⇣', tone:'sage'}})); }
      else if (fmt === 'md') {
        const md = (window.SECTIONS||[]).filter(s=>s.status!=='queued').map(s => {
          const body = (window.DRAFT_BODIES && window.DRAFT_BODIES[s.id]) || [];
          return `## ${s.num}  ${s.title}\n\n${body.join('\n\n')}`;
        }).join('\n\n');
        const blob = new Blob(['# ' + (doc.title||'Draft') + '\n\n' + md], { type:'text/markdown' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download=(doc.title||'draft')+'.md'; a.click();
        window.dispatchEvent(new CustomEvent('toast', {detail:{text:'Exported Markdown', icon:'⇣', tone:'sage'}}));
      } else if (fmt === 'pdf') {
        window.print();
      }
    } catch(e) { console.error(e); alert('Export failed: ' + e.message); }
    setBusy(false); onClose();
  };
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal-card" onClick={e=>e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-eye">Export</div>
          <div className="modal-title">{doc.title}</div>
          <div className="modal-sub">{total} drafted sections · includes citations and review summary</div>
        </div>
        <div className="modal-body">
          <div className="fmt-grid">
            <button className={"fmt-opt"+(fmt==='docx'?' on':'')} onClick={()=>setFmt('docx')}>
              <div className="fmt-name">Word document</div><div className="fmt-ext">.docx · editable</div>
            </button>
            <button className={"fmt-opt"+(fmt==='pdf'?' on':'')} onClick={()=>setFmt('pdf')}>
              <div className="fmt-name">PDF</div><div className="fmt-ext">.pdf · review-ready</div>
            </button>
            <button className={"fmt-opt"+(fmt==='md'?' on':'')} onClick={()=>setFmt('md')}>
              <div className="fmt-name">Markdown</div><div className="fmt-ext">.md · plain text</div>
            </button>
          </div>
          <div className="opt-row">
            <div><div className="opt-label">Include citation footnotes</div><div className="opt-desc">Numbered references map back to source documents and dataset chunks.</div></div>
            <div className={"switch"+(includeCites?' on':'')} onClick={()=>setIncludeCites(v=>!v)}/>
          </div>
          <div className="opt-row">
            <div><div className="opt-label">Embed drafter notes as Word comments</div><div className="opt-desc">Section-by-section critic feedback stays attached for reviewer context.</div></div>
            <div className={"switch"+(includeNotes?' on':'')} onClick={()=>setIncludeNotes(v=>!v)}/>
          </div>
          <div className="opt-row">
            <div><div className="opt-label">Tracked changes vs. last export</div><div className="opt-desc">Emit redlines for every section that changed since v0.3.</div></div>
            <div className={"switch"+(redlines?' on':'')} onClick={()=>setRedlines(v=>!v)}/>
          </div>
        </div>
        <div className="modal-foot">
          <span className="left">Est. 6 pages · ~2,400 words</span>
          <div style={{display:'flex',gap:8}}>
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" disabled={busy} onClick={handleExport}>{busy?'Building…':'Export file'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
window.ExportModal = ExportModal;

// Extracted from Co-Writer.html — loaded via <script type="text/babel" src>.
// Components are attached to window for cross-file sharing.

// ── Library view ───────────────────────────────────────────────
function LibraryView({ onNewFromTemplate }) {
  const [tab, setTab] = React.useState('templates');
  const templates = [
    { kind:'PWS', title:'Performance Work Statement', desc:'Outcome-based services contract · FAR Part 37', meta:['42 sections','v2.1','used 14×'] },
    { kind:'J&A', title:'Justification & Approval', desc:'Sole- or limited-source rationale under FAR 6.303', meta:['18 sections','v1.3','used 6×'] },
    { kind:'Market research', title:'Market Research Report', desc:'Capability search, vendor scan, NAICS fit', meta:['12 sections','v1.0','used 9×'] },
    { kind:'Memo', title:'Memorandum (for record)', desc:'DoD memo format · decision / info / record', meta:['5 sections','v1.2','used 22×'] },
    { kind:'SOW', title:'Statement of Work', desc:'Task-based services scope', meta:['28 sections','v1.4','used 4×'] },
    { kind:'IGCE', title:'Independent Gov Cost Estimate', desc:'Structured cost build-up with labor categories', meta:['CLIN grid','v0.9 β','used 2×'] },
  ];
  const datasets = [
    { kind:'Ask Sage dataset', title:'DHA Contracting Library', desc:'2,140 source docs · synced from Ask Sage', meta:['384 MB','synced 04/18','auto'] },
    { kind:'Ask Sage dataset', title:'Behavioral Health Clinical Guidance', desc:'Policies, instructions, and clinical guidance', meta:['84 MB','synced 04/09','auto'] },
    { kind:'Web pin', title:'FAR Part 37 — Service Contracting', desc:'Pinned at acquisition.gov', meta:['web','auto-refresh','—'] },
    { kind:'Local folder', title:'My reference SOWs', desc:'12 .docx files on this workstation', meta:['12 docs','local only','—'] },
  ];
  const list = tab==='templates' ? templates : datasets;
  return (
    <div className="lib-wrap" data-screen-label="03 Library">
      <div className="lib-inner">
        <div className="lib-head">
          <div>
            <div className="settings-eyebrow">Library</div>
            <h1 className="settings-title">Templates & sources</h1>
            <p className="settings-lead">Your DOCX templates and connected reference corpora. Pick a template to start a new draft; connect datasets to make them available to RAG.</p>
          </div>
        </div>
        <div className="lib-tabs">
          <button className={tab==='templates'?'on':''} onClick={()=>setTab('templates')}>Templates ({templates.length})</button>
          <button className={tab==='datasets'?'on':''} onClick={()=>setTab('datasets')}>Datasets & sources ({datasets.length})</button>
        </div>
        <div className="lib-grid">
          {list.map((c,i) => (
            <div key={i} className="lib-card" onClick={() => tab==='templates' && onNewFromTemplate && onNewFromTemplate(c)}>
              <div className="lc-kind">{c.kind}</div>
              <div className="lc-title">{c.title}</div>
              <div className="lc-desc">{c.desc}</div>
              <div className="lc-meta">{c.meta.map((m,j)=>(<span key={j}>{m}</span>))}</div>
            </div>
          ))}
          <div className="lib-card new" onClick={() => tab==='templates' && window.dispatchEvent(new CustomEvent('open-ingest'))}>
            <div>
              <div style={{fontSize:22,marginBottom:6}}>＋</div>
              <div style={{fontSize:13,fontWeight:500,color:'var(--ink)'}}>{tab==='templates' ? 'Upload DOCX template' : 'Connect dataset'}</div>
              <div style={{fontSize:11,marginTop:4,fontFamily:'var(--font-mono)',color:'var(--ink-4)'}}>{tab==='templates'?'parses structure + placeholders':'Ask Sage, folder, or pinned URL'}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
window.LibraryView = LibraryView;

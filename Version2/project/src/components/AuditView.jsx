// Extracted from Co-Writer.html — loaded via <script type="text/babel" src>.
// Components are attached to window for cross-file sharing.

// ── Audit view ────────────────────────────────────────────────
function AuditView() {
  const rows = [
    { time:'10:16:42', kind:'draft', summary:'§1.3 Performance Objectives — draft pass', tok:'1,204', cost:'$0.038', status:'ok' },
    { time:'10:16:38', kind:'embed', summary:'reference chunk selection — 8 sources, top-k 12', tok:'4,200', cost:'$0.001', status:'ok' },
    { time:'10:16:12', kind:'draft', summary:'§1.2 Scope of Services — draft pass', tok:'1,840', cost:'$0.052', status:'ok' },
    { time:'10:15:58', kind:'critic', summary:'§1.2 critic score 0.82 → accepted', tok:'620', cost:'$0.006', status:'ok' },
    { time:'10:15:41', kind:'draft', summary:'§1.2 Scope of Services — first attempt', tok:'1,722', cost:'$0.048', status:'ok' },
    { time:'10:15:20', kind:'draft', summary:'§1.1 Background — draft pass', tok:'980', cost:'$0.028', status:'ok' },
    { time:'10:14:51', kind:'review', summary:'template synthesis — FY24 EBH SOW schema enrichment', tok:'2,480', cost:'$0.071', status:'ok' },
    { time:'10:14:49', kind:'embed', summary:'initial embedding — 4 attached sources', tok:'8,420', cost:'$0.002', status:'ok' },
    { time:'10:14:30', kind:'draft', summary:'clarifying-question pass', tok:'340', cost:'$0.012', status:'ok' },
    { time:'10:13:02', kind:'embed', summary:'dataset resync — DHA Contracting Library', tok:'—', cost:'—', status:'err' },
  ];
  return (
    <div className="audit-wrap" data-screen-label="04 Audit">
      <div className="audit-inner">
        <div className="settings-eyebrow">Activity log</div>
        <h1 className="settings-title">Audit trail</h1>
        <p className="settings-lead">Every request made to your AI provider, with tokens and cost. Exportable as JSON for records retention.</p>
        <div className="audit-tools">
          <input className="audit-search" placeholder="Filter by project, section, or kind…" />
          <button className="btn">All kinds ▾</button>
          <button className="btn">Last 24h ▾</button>
          <button className="btn btn-primary">Export JSON</button>
        </div>
        <div className="audit-list">
          <div className="audit-row head"><span>time</span><span>kind</span><span>summary</span><span>tokens</span><span>cost</span><span>status</span></div>
          {rows.map((r,i)=>(
            <div key={i} className="audit-row">
              <span className="time">{r.time}</span>
              <span><span className={"kind-pill " + r.kind}>{r.kind}</span></span>
              <span className="summary">{r.summary}</span>
              <span className="tok">{r.tok}</span>
              <span className="cost">{r.cost}</span>
              <span className={"status " + r.status}>{r.status==='ok'?'✓ ok':'× 502'}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
window.AuditView = AuditView;

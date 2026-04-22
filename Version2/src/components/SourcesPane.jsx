// Left pane — sources & RAG
const { useState: useStateSrc } = React;

function SourcesPane({ activeCite, setActiveCite }) {
  const [tab, setTab] = useStateSrc("attached");
  const list = tab === "attached" ? window.SOURCES.attached : window.SOURCES.rag;

  return (
    <section className="pane">
      <div className="pane-head">
        <div className="pane-title">
          <h2>Sources</h2>
          <span className="count">{window.SOURCES.attached.length + window.SOURCES.rag.length}</span>
        </div>
        <div className="pane-actions">
          <button className="icon-btn" title="Search">⌕</button>
          <button className="icon-btn" title="More">⋯</button>
        </div>
      </div>

      <div className="sources-subnav">
        <button className={tab === "attached" ? "active" : ""} onClick={() => setTab("attached")}>
          Attached <span style={{opacity:0.6,marginLeft:2,fontFamily:'var(--font-mono)',fontSize:10}}>{window.SOURCES.attached.length}</span>
        </button>
        <button className={tab === "rag" ? "active" : ""} onClick={() => setTab("rag")}>
          RAG & web <span style={{opacity:0.6,marginLeft:2,fontFamily:'var(--font-mono)',fontSize:10}}>{window.SOURCES.rag.length}</span>
        </button>
        <button style={{marginLeft:'auto'}}>Citations</button>
      </div>

      <div className="pane-body">
        <div className="src-group">{tab === "attached" ? "For this draft" : "Connected datasets"}</div>
        {list.map(s => {
          const isCited = s.cites && s.cites.includes(activeCite);
          return (
            <div
              key={s.id}
              className={"src" + (isCited ? " cited" : "")}
              onMouseEnter={() => s.cites && s.cites.length && setActiveCite(s.cites[0])}
              onMouseLeave={() => setActiveCite(null)}
            >
              <div className="src-head">
                <span className={"src-kind " + s.kind}>{s.kindLabel}</span>
                {s.cites && s.cites.length > 0 && (
                  <span className="src-refs">
                    {s.cites.map(c => (
                      <span key={c} className={"cite-pill" + (activeCite === c ? "" : " ghost")}>{c}</span>
                    ))}
                  </span>
                )}
              </div>
              <div className="src-title">{s.title}</div>
              <div className="src-meta">
                <span>{s.meta}</span>
              </div>
            </div>
          );
        })}

        {tab === "attached" && (
          <button className="src-attach">
            <div className="big">＋</div>
            <div style={{marginTop:4}}>Drop .docx, .pdf, .md</div>
            <div style={{fontSize:10.5,color:'var(--ink-4)',fontFamily:'var(--font-mono)',marginTop:3}}>or paste a link</div>
          </button>
        )}
      </div>
    </section>
  );
}

window.SourcesPane = SourcesPane;

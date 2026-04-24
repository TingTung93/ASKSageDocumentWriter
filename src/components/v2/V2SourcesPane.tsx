import { useState, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type ProjectRecord, type ReferenceChunk } from '../../lib/db/schema';

interface V2SourcesPaneProps {
  project: ProjectRecord;
  activeSectionId: string | null;
}

export function V2SourcesPane({ project, activeSectionId }: V2SourcesPaneProps) {
  const [tab, setTab] = useState<"attached" | "rag">("attached");

  const activeDraft = useLiveQuery(
    () => activeSectionId ? db.drafts.where({ project_id: project.id, section_id: activeSectionId }).first() : undefined,
    [project.id, activeSectionId]
  );

  const citedChunkIds = useMemo(() => new Set(activeDraft?.references_inlined_chunk_ids ?? []), [activeDraft]);
  
  const attached = (project.context_items ?? []).filter(item => item.kind === 'file' || item.kind === 'note');
  // RAG datasets are global, but for now we'll just show a placeholder if we don't have a list of them
  const rag: any[] = []; 

  const list = tab === "attached" ? attached : rag;

  return (
    <section className="pane">
      <div className="pane-head">
        <div className="pane-title">
          <h2>Sources</h2>
          <span className="count">{attached.length + rag.length}</span>
        </div>
      </div>

      <div className="sources-subnav">
        <button className={tab === "attached" ? "active" : ""} onClick={() => setTab("attached")}>
          Attached <span style={{opacity:0.6,marginLeft:2,fontFamily:'var(--font-mono)',fontSize:10}}>{attached.length}</span>
        </button>
        <button className={tab === "rag" ? "active" : ""} onClick={() => setTab("rag")}>
          RAG & web <span style={{opacity:0.6,marginLeft:2,fontFamily:'var(--font-mono)',fontSize:10}}>{rag.length}</span>
        </button>
      </div>

      <div className="pane-body">
        <div className="src-group">{tab === "attached" ? "For this draft" : "Connected datasets"}</div>
        {list.map((s, idx) => {
          const isFile = s.kind === 'file';
          const kind = isFile ? (s.filename?.endsWith('.pdf') ? 'pdf' : 'docx') : 'note';
          const title = isFile ? s.filename : 'Project Note';
          const meta = isFile ? `${(s.size_bytes / 1024).toFixed(1)} KB` : `${s.text.length} chars`;

          const isCited = isFile && s.chunks?.some((c: ReferenceChunk) => citedChunkIds.has(c.id));

          return (
            <div
              key={idx}
              className={"src " + (isCited ? "cited" : "")}
            >
              <div className="src-head">
                <span className={"src-kind " + kind}>{kind}</span>
                {isCited && <span className="kbd-hint" style={{ color: 'var(--accent)', borderColor: 'var(--accent)' }}>CITED</span>}
              </div>
              <div className="src-title">{title}</div>
              <div className="src-meta">
                <span>{meta}</span>
              </div>
            </div>
          );
        })}

      </div>
    </section>
  );
}

import { useState, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type ProjectRecord, type DraftRecord, type TemplateRecord, type ReferenceChunk } from '../../lib/db/schema';
import type { DraftParagraph, PriorSectionSummary } from '../../lib/draft/types';
import { useAuth } from '../../lib/state/auth';
import { createLLMClient } from '../../lib/provider/factory';
import { draftSection, summarizeDraft } from '../../lib/draft/drafter';
import { critiqueDraft, formatRevisionNotes } from '../../lib/draft/critique';
import { getContextItems, renderNotesBlock } from '../../lib/project/context';
import { toast } from '../../lib/state/toast';
import { loadSettings } from '../../lib/settings/store';
import { V2ExportModal } from './V2ExportModal';
import { assembleProjectFromDrafts, type AssembleProjectResult } from '../../lib/export/downloadAssembled';
import { AssembledDocxPreview } from '../AssembledDocxPreview';

interface V2DraftPaneProps {
  project: ProjectRecord;
}

export function V2DraftPane({ project }: V2DraftPaneProps) {
  const [showExport, setShowExport] = useState(false);
  const [previewItem, setPreviewItem] = useState<AssembleProjectResult | null>(null);

  const drafts = useLiveQuery(
    () => db.drafts.where('project_id').equals(project.id).toArray(),
    [project.id]
  );
  const templates = useLiveQuery(
    () => db.templates.where('id').anyOf(project.template_ids).toArray(),
    [project.template_ids]
  );

  if (!drafts || !templates) return <div className="pane">Loading drafts…</div>;

  const sections = templates.flatMap(t => 
    t.schema_json.sections.map(s => ({
      ...s,
      template_id: t.id,
      draft: drafts.find(d => d.template_id === t.id && d.section_id === s.id)
    }))
  );

  const allValidationIssues = drafts?.flatMap(d => d.validation_issues ?? []) ?? [];

  const handlePreview = async () => {
    try {
      const results = await assembleProjectFromDrafts(project, templates);
      if (results.length > 0) {
        setPreviewItem(results[0]!);
      } else {
        toast.info('No drafts ready for preview.');
      }
    } catch (err) {
      toast.error(`Preview failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <section className="pane">
      <div className="draft-head">
        <div className="draft-title">
          <span className="draft-name">{project.name}.docx</span>
          <span className="draft-status done"><span className="dot"/>{drafts.length} / {sections.length} sections</span>
        </div>
        <div className="pane-actions">
           <button className="btn" onClick={handlePreview}>Preview</button>
           <button className="btn btn-primary" onClick={() => setShowExport(true)}>Export ▾</button>
        </div>
      </div>

      <div className="draft-toc">
        {sections.map(s => (
          <button key={`${s.template_id}-${s.id}`}
            className={"toc-chip " + (s.draft ? (s.draft.validation_issues?.length ? "warn" : "done") : "queued")}
            onClick={() => { const el = document.getElementById(`sec-${s.id}`); if(el) el.scrollIntoView({behavior:'smooth', block:'start'}); }}>
            <span className="dot" />
            §{s.id} {s.name}
          </button>
        ))}
      </div>

      <div className="pane-body" style={{background: 'var(--surface)'}}>
        <div className="draft-doc">
          <header className="doc-header">
            <div className="doc-eyebrow">{project.mode === 'freeform' ? 'Freeform Draft' : 'Template-based Draft'}</div>
            <h1 className="doc-title">{project.name}</h1>
          </header>

          {sections.map(s => (
            <Section 
              key={`${s.template_id}-${s.id}`} 
              project={project} 
              template={templates.find(t => t.id === s.template_id)!}
              section={s} 
              draft={s.draft}
              allDrafts={drafts}
            />
          ))}

          {allValidationIssues.length > 0 && (
            <div className="doc-section review-summary" style={{ marginTop: 40, border: '1px solid var(--accent)', background: 'var(--paper)' }}>
              <div className="sec-num" style={{ color: 'var(--accent)' }}>Project Review</div>
              <h3>Cross-section Findings</h3>
              <p style={{ fontSize: '0.9em', color: 'var(--ink-4)' }}>The following issues were detected across the entire document:</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 }}>
                {allValidationIssues.map((issue, idx) => (
                  <div key={idx} className="sec-finding">
                    <span className="ico">⚐</span>
                    <div className="txt">{issue}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {showExport && (
        <V2ExportModal 
          project={project} 
          templates={templates} 
          onClose={() => setShowExport(false)} 
        />
      )}

      {previewItem && (
        <div className="command-palette-overlay" onClick={() => setPreviewItem(null)}>
          <div className="command-palette" onClick={e => e.stopPropagation()} style={{ width: '80vw', height: '80vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '12px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--line)' }}>
              <h3 style={{ margin: 0 }}>Preview: {previewItem.template_name}</h3>
              <button className="icon-btn" onClick={() => setPreviewItem(null)}>×</button>
            </div>
            <div style={{ flex: 1, overflow: 'auto', background: '#525659', padding: 20 }}>
              <AssembledDocxPreview blob={previewItem.blob} cacheKey={previewItem.template_id} />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function Section({ project, template, section, draft, allDrafts }: { 
  project: ProjectRecord, 
  template: TemplateRecord,
  section: any, 
  draft?: DraftRecord,
  allDrafts: DraftRecord[]
}) {
  const [busy, setBusy] = useState(false);
  const auth = useAuth();

  const handleFix = async (finding?: string) => {
    if (!auth.apiKey || busy) return;
    setBusy(true);
    try {
      const client = createLLMClient({ 
        provider: auth.provider, 
        baseUrl: auth.baseUrl, 
        apiKey: auth.apiKey 
      });

      const contextItems = getContextItems(project);
      const notesBlock = renderNotesBlock(contextItems);
      const referencesBlock = draft?.prompt_sent?.match(/=== ATTACHED REFERENCES ===[\s\S]*?=== END ATTACHED REFERENCES ===/)?.[0] ?? null;

      const priorSummaries: PriorSectionSummary[] = [];
      for (const depId of section.depends_on ?? []) {
        const depDraft = allDrafts.find(d => d.section_id === depId);
        if (depDraft) {
          priorSummaries.push({
            section_id: depId,
            name: section.name, 
            summary: summarizeDraft(depDraft.paragraphs, undefined)
          });
        }
      }

      const revisionNotes = finding ? formatRevisionNotes([{ 
        severity: 'medium', 
        category: 'other', 
        message: finding 
      }]) : null;

      const settings = await loadSettings();
      const draftingModelOverride = settings?.models.drafting ?? null;

      const result = await draftSection(client, {
        template: template.schema_json,
        section: section,
        project_description: project.description,
        shared_inputs: project.shared_inputs,
        prior_summaries: priorSummaries,
        notes_block: notesBlock,
        references_block: referencesBlock,
        revision_notes_block: revisionNotes,
        options: {
          model: draftingModelOverride ?? undefined
        }
      });

      const criticResult = await critiqueDraft(client, {
        template: template.schema_json,
        section: section,
        draft: result.paragraphs,
        project_description: project.description,
        references_block: referencesBlock,
        template_example: null, 
        prior_summaries: priorSummaries,
        model: settings.models.critic ?? undefined
      });

      if (draft) {
        await db.drafts.put({
          ...draft,
          paragraphs: result.paragraphs,
          validation_issues: criticResult.issues.map(i => i.message),
          generated_at: new Date().toISOString(),
          prompt_sent: result.prompt_sent,
          tokens_in: result.tokens_in + criticResult.tokens_in,
          tokens_out: result.tokens_out + criticResult.tokens_out
        });
      }

      toast.success(`Section §${section.id} updated and re-validated.`);
    } catch (err) {
      toast.error(`Fix failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="doc-section" id={`sec-${section.id}`}>
      <div className="sec-num">§ {section.id} {section.name}</div>
      <h3>{section.name}</h3>
      {draft ? (
        <>
          {draft.paragraphs.map((p, i) => (
            <Paragraph key={i} p={p} project={project} />
          ))}
          {(draft.status === 'drafting' || draft.status === 'pending' || busy) && (
            <p className="drafting-indicator">
              <span className="streaming-caret" />
              <span style={{ marginLeft: 8, color: 'var(--ink-4)', fontSize: '0.9em', fontStyle: 'italic' }}>
                {busy ? 'Re-drafting and validating...' : 'AI is drafting this section...'}
              </span>
            </p>
          )}
          {draft.status === 'error' && (
            <div className="error-box">
              <b>Error drafting section:</b> {draft.error}
            </div>
          )}
          {draft.validation_issues && draft.validation_issues.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 }}>
              {draft.validation_issues.map((issue, idx) => (
                <div key={idx} className="sec-finding">
                  <span className="ico">⚐</span>
                  <div className="txt">{issue}</div>
                  <button className="fix" disabled={busy} onClick={() => handleFix(issue)}>
                    {busy ? '...' : 'Fix'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <p style={{color: 'var(--ink-4)', fontStyle: 'italic'}}>No draft yet for this section.</p>
      )}
    </article>
  );
}

function Paragraph({ p, project }: { p: DraftParagraph, project: ProjectRecord }) {
  const text = p.text ?? '';
  const parts = useMemo(() => {
    const res: Array<string | { type: 'cite', id: string }> = [];
    const citeRegex = /\[CITE:\s*(.*?)\]/g;
    let lastIdx = 0;
    let match;
    while ((match = citeRegex.exec(text)) !== null) {
      if (match.index > lastIdx) {
        res.push(text.slice(lastIdx, match.index));
      }
      res.push({ type: 'cite', id: match[1]! });
      lastIdx = match.index + match[0]!.length;
    }
    if (lastIdx < text.length) {
      res.push(text.slice(lastIdx));
    }
    return res;
  }, [text]);

  const level = p.level ?? 0;
  const content = parts.map((part, i) => {
    if (typeof part === 'string') return part;
    return <Cite key={i} id={part.id} project={project} />;
  });

  switch (p.role) {
    case 'heading': {
      const Tag = (`h${Math.min(level + 3, 5)}`) as 'h3' | 'h4' | 'h5';
      return <Tag>{content}</Tag>;
    }
    case 'bullet':
      return <li style={{ marginLeft: `${level * 20}px` }}>{content}</li>;
    case 'step':
      return <li style={{ marginLeft: `${level * 20}px` }}>{content}</li>;
    default:
      return <p style={{ marginLeft: level > 0 ? `${level * 20}px` : undefined }}>{content}</p>;
  }
}

function Cite({ id, project }: { id: string, project: ProjectRecord }) {
  const [hover, setHover] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  const chunk = useMemo(() => {
    const files = (project.context_items ?? []).filter((i): i is any => i.kind === 'file');
    for (const f of files) {
      if (!f.chunks) continue;
      const found = f.chunks.find((c: ReferenceChunk) => c.id === id);
      if (found) return { chunk: found, filename: f.filename };
    }
    return null;
  }, [project, id]);

  const handleMouseMove = (e: React.MouseEvent) => {
    setPos({ x: e.clientX + 10, y: e.clientY + 10 });
  };

  return (
    <>
      <span 
        className="cite" 
        onMouseEnter={() => setHover(true)} 
        onMouseLeave={() => setHover(false)}
        onMouseMove={handleMouseMove}
      >
        [cite:{id.slice(0, 4)}]
      </span>
      {hover && chunk && (
        <div className="cite-tooltip" style={{ left: pos.x, top: pos.y }}>
          <div style={{ fontWeight: 600, color: 'var(--accent)', fontSize: 10 }}>SOURCE: {chunk.filename}</div>
          <div style={{ marginTop: 4, fontWeight: 600 }}>{chunk.chunk.title}</div>
          <div className="cite-excerpt">{chunk.chunk.text.slice(0, 200)}...</div>
        </div>
      )}
    </>
  );
}

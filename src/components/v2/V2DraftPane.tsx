import { useState, useMemo, useEffect, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type ProjectRecord, type DraftRecord, type TemplateRecord, type ReferenceChunk } from '../../lib/db/schema';
import type { DraftParagraph } from '../../lib/draft/types';
import { useAuth } from '../../lib/state/auth';
import { createLLMClient } from '../../lib/provider/factory';
import { draftAndValidateSection } from '../../lib/draft/draftAndValidateSection';
import { getContextItems } from '../../lib/project/context';
import { toast } from '../../lib/state/toast';
import { loadSettings } from '../../lib/settings/store';
import { V2ExportModal } from './V2ExportModal';
import { Modal } from './Modal';
import { assembleProjectFromDrafts, type AssembleProjectResult } from '../../lib/export/downloadAssembled';
import { AssembledDocxPreview } from '../AssembledDocxPreview';
import { assembleFreeformDocx } from '../../lib/freeform/assemble';
import {
  parseMarkdownToParagraphs,
  paragraphsToMarkdown,
  redraftFreeformSection,
} from '../../lib/freeform/drafter';
import { getFreeformStyle } from '../../lib/freeform/styles';
import { chunkFreeformByH1, type FreeformChunk } from './helpers';

interface V2DraftPaneProps {
  project: ProjectRecord;
}

export function V2DraftPane({ project }: V2DraftPaneProps) {
  if (project.mode === 'freeform') {
    return <FreeformDraftView project={project} />;
  }
  return <TemplateDraftView project={project} />;
}

function TemplateDraftView({ project }: V2DraftPaneProps) {
  const [showExport, setShowExport] = useState(false);
  const [previewItem, setPreviewItem] = useState<AssembleProjectResult | null>(null);
  const [activeSecId, setActiveSecId] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const drafts = useLiveQuery(
    () => db.drafts.where('project_id').equals(project.id).toArray(),
    [project.id]
  );
  const templates = useLiveQuery(
    () => db.templates.where('id').anyOf(project.template_ids).toArray(),
    [project.template_ids]
  );

  const sections = useMemo(() => {
    if (!drafts || !templates) return [];
    return templates.flatMap(t =>
      t.schema_json.sections.map(s => ({
        ...s,
        template_id: t.id,
        draft: drafts.find(d => d.template_id === t.id && d.section_id === s.id)
      }))
    );
  }, [drafts, templates]);

  const sectionIds = useMemo(() => sections.map((s) => s.id), [sections]);

  useEffect(() => {
    if (!bodyRef.current || sectionIds.length === 0) return;
    const root = bodyRef.current;
    const visible = new Map<string, number>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset.secId;
        if (!id) continue;
        if (entry.isIntersecting) {
          visible.set(id, entry.intersectionRatio);
        } else {
          visible.delete(id);
        }
      }
      if (visible.size > 0) {
        const [topId] = [...visible.entries()].sort((a, b) => b[1] - a[1])[0];
        setActiveSecId(topId);
      }
    }, { root, threshold: [0, 0.25, 0.5, 0.75, 1] });

    const els = sectionIds
      .map((id) => root.querySelector(`[data-sec-id="${CSS.escape(id)}"]`))
      .filter((el): el is Element => !!el);
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [sectionIds]);

  if (!drafts || !templates) {
    return (
      <div className="pane">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 20, color: 'var(--ink-3)' }}>
          <span className="spinner-small" />
          <span>Loading drafts…</span>
        </div>
      </div>
    );
  }

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
        {sections.map(s => {
          const state = s.draft ? (s.draft.validation_issues?.length ? "warn" : "done") : "queued";
          const isActive = activeSecId === s.id;
          return (
            <button key={`${s.template_id}-${s.id}`}
              className={"toc-chip " + state + (isActive ? " active" : "")}
              onClick={() => { const el = document.getElementById(`sec-${s.id}`); if(el) el.scrollIntoView({behavior:'smooth', block:'start'}); }}>
              <span className="dot" />
              §{s.id} {s.name}
            </button>
          );
        })}
      </div>

      <div className="pane-body draft-surface" ref={bodyRef}>
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
        <Modal
          onClose={() => setPreviewItem(null)}
          ariaLabel={`Preview: ${previewItem.template_name}`}
          cardStyle={{ width: '80vw', height: '80vh', display: 'flex', flexDirection: 'column' }}
        >
          <div style={{ padding: '12px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--line)' }}>
            <h3 style={{ margin: 0 }}>Preview: {previewItem.template_name}</h3>
            <button className="icon-btn" onClick={() => setPreviewItem(null)} aria-label="Close preview">×</button>
          </div>
          <div className="preview-stage">
            <AssembledDocxPreview blob={previewItem.blob} cacheKey={previewItem.template_id} />
          </div>
        </Modal>
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
        apiKey: auth.apiKey,
      });
      const settings = await loadSettings();

      const result = await draftAndValidateSection({
        client,
        project,
        template,
        section,
        allDrafts,
        settings,
        finding,
        existingPromptSent: draft?.prompt_sent,
      });

      if (draft) {
        await db.drafts.put({
          ...draft,
          paragraphs: result.paragraphs,
          validation_issues: result.validation_issues,
          generated_at: new Date().toISOString(),
          prompt_sent: result.prompt_sent,
          tokens_in: result.tokens_in,
          tokens_out: result.tokens_out,
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
    <article className="doc-section" id={`sec-${section.id}`} data-sec-id={section.id}>
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
        <div style={{ padding: '16px 0' }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 4 }}>
            No draft yet
          </div>
          <div style={{ fontSize: 13, color: 'var(--ink-4)', marginBottom: 8 }}>
            This section hasn't been drafted.
          </div>
          <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>
            Run <strong>✦ Auto-draft</strong> from the chat to generate it.
          </div>
        </div>
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

  const chunk = useMemo(() => {
    const files = (project.context_items ?? []).filter((i): i is any => i.kind === 'file');
    for (const f of files) {
      if (!f.chunks) continue;
      const found = f.chunks.find((c: ReferenceChunk) => c.id === id);
      if (found) return { chunk: found, filename: f.filename };
    }
    return null;
  }, [project, id]);

  const kind = chunk?.filename?.toLowerCase().endsWith('.pdf') ? 'pdf'
    : chunk?.filename?.toLowerCase().endsWith('.docx') ? 'docx'
    : 'ref';

  return (
    <span
      className={"cite" + (hover ? ' active' : '')}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      [{id.slice(0, 4)}]
      {hover && chunk && (
        <span className="cite-hover" role="tooltip">
          <span className="cite-hover-head">
            <span className="cite-hover-kind">{kind}</span>
            <span className="cite-hover-title">{chunk.chunk.title || chunk.filename}</span>
          </span>
          <span className="cite-hover-excerpt" style={{ display: 'block' }}>
            {chunk.chunk.text.slice(0, 240)}{chunk.chunk.text.length > 240 ? '…' : ''}
          </span>
          <span className="cite-hover-meta" style={{ display: 'block' }}>{chunk.filename}</span>
        </span>
      )}
    </span>
  );
}

// ─── Freeform draft view ──────────────────────────────────────────
//
// Renders project.freeform_draft as H1-bounded semantic blocks. Each
// block can be edited as markdown or regenerated via the LLM, and the
// full draft is exported to DOCX on demand — no auto-download.

function FreeformDraftView({ project }: V2DraftPaneProps) {
  const draftParagraphs = project.freeform_draft ?? [];
  const chunks = useMemo(() => chunkFreeformByH1(draftParagraphs), [draftParagraphs]);
  const style = project.freeform_style ? getFreeformStyle(project.freeform_style) : undefined;
  const styleLabel = style?.name ?? 'Freeform';

  const handleExport = async () => {
    if (draftParagraphs.length === 0) {
      toast.info('No draft to export yet — run Auto-draft first.');
      return;
    }
    try {
      const result = await assembleFreeformDocx(draftParagraphs);
      const safeName = project.name.replace(/[^a-z0-9]+/gi, '_').toLowerCase() || 'document';
      const filename = `${safeName}_${Date.now()}.docx`;
      const url = URL.createObjectURL(result.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      toast.success(`Exported ${filename}`);
    } catch (err) {
      toast.error(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <section className="pane">
      <div className="draft-head">
        <div className="draft-title">
          <span className="draft-name">{project.name}.docx</span>
          <span className="draft-status done">
            <span className="dot"/>
            {chunks.length} block{chunks.length === 1 ? '' : 's'} · {styleLabel}
          </span>
        </div>
        <div className="pane-actions">
          <button className="btn btn-primary" disabled={draftParagraphs.length === 0} onClick={handleExport}>
            Export ▾
          </button>
        </div>
      </div>

      {chunks.length > 0 && (
        <div className="draft-toc">
          {chunks.map((c) => (
            <button
              key={c.id}
              className="toc-chip done"
              onClick={() => {
                const el = document.getElementById(`freeform-${c.id}`);
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
            >
              <span className="dot" />
              {c.heading}
            </button>
          ))}
        </div>
      )}

      <div className="pane-body draft-surface">
        <div className="draft-doc">
          <header className="doc-header">
            <div className="doc-eyebrow">{styleLabel}</div>
            <h1 className="doc-title">{project.name}</h1>
          </header>

          {draftParagraphs.length === 0 ? (
            <div className="doc-section" style={{ color: 'var(--ink-4)' }}>
              <p>No draft yet. Click <strong>✦ Auto-draft</strong> to generate the document from your project description and attached context.</p>
            </div>
          ) : (
            chunks.map((chunk) => (
              <FreeformBlock
                key={chunk.id}
                project={project}
                chunk={chunk}
              />
            ))
          )}
        </div>
      </div>
    </section>
  );
}

function FreeformBlock({ project, chunk }: { project: ProjectRecord; chunk: FreeformChunk }) {
  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState(() => paragraphsToMarkdown(chunk.paragraphs));
  const [busy, setBusy] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [showRegen, setShowRegen] = useState(false);
  const auth = useAuth();

  // Re-sync the textarea if the underlying chunk changes (e.g. after
  // a regen of this block or a neighbor shifting indexes).
  useEffect(() => {
    if (!editing) setDraftText(paragraphsToMarkdown(chunk.paragraphs));
  }, [chunk.paragraphs, editing]);

  const replaceChunk = async (newParagraphs: DraftParagraph[]) => {
    const current = project.freeform_draft ?? [];
    const next = [
      ...current.slice(0, chunk.start),
      ...newParagraphs,
      ...current.slice(chunk.end),
    ];
    await db.projects.update(project.id, {
      freeform_draft: next,
      updated_at: new Date().toISOString(),
    });
  };

  const handleSave = async () => {
    setBusy(true);
    try {
      const parsed = parseMarkdownToParagraphs(draftText);
      await replaceChunk(parsed);
      setEditing(false);
      toast.success(`Saved "${chunk.heading}"`);
    } catch (err) {
      toast.error(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = () => {
    setDraftText(paragraphsToMarkdown(chunk.paragraphs));
    setEditing(false);
  };

  const handleRegen = async () => {
    if (!auth.apiKey) {
      toast.error('Connect a provider on the Connection tab first.');
      return;
    }
    const style = project.freeform_style ? getFreeformStyle(project.freeform_style) : undefined;
    if (!style) {
      toast.error('This project has no freeform style — cannot regenerate.');
      return;
    }
    setBusy(true);
    try {
      const client = createLLMClient({
        provider: auth.provider,
        baseUrl: auth.baseUrl,
        apiKey: auth.apiKey,
      });
      const settings = await loadSettings();
      const result = await redraftFreeformSection({
        client,
        style,
        project_description: project.description,
        context_items: getContextItems(project),
        model: settings.models.drafting ?? undefined,
        dataset: project.reference_dataset_names[0],
        live: project.live_search || undefined,
        current_draft: project.freeform_draft ?? [],
        section_heading: chunk.heading,
        instruction: instruction.trim() || undefined,
      });
      if (result.paragraphs.length === 0) {
        toast.error('Regenerate returned no content.');
        return;
      }
      await replaceChunk(result.paragraphs);
      setInstruction('');
      setShowRegen(false);
      toast.success(`Regenerated "${chunk.heading}"`);
    } catch (err) {
      toast.error(`Regenerate failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="doc-section" id={`freeform-${chunk.id}`}>
      <div className="sec-num" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span>{chunk.heading}</span>
        <span style={{ display: 'flex', gap: 6 }}>
          {!editing && (
            <>
              <button className="btn btn-sm" disabled={busy} onClick={() => setEditing(true)}>Edit</button>
              <button className="btn btn-sm" disabled={busy} onClick={() => setShowRegen((v) => !v)}>
                {showRegen ? 'Cancel regen' : 'Regenerate'}
              </button>
            </>
          )}
        </span>
      </div>

      {editing ? (
        <>
          <textarea
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            disabled={busy}
            style={{
              width: '100%',
              minHeight: 240,
              fontFamily: 'var(--font-mono)',
              fontSize: 12.5,
              lineHeight: 1.5,
              padding: 12,
              border: '1px solid var(--line-strong)',
              borderRadius: 6,
              background: 'var(--paper)',
              resize: 'vertical',
            }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={handleSave}>
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button className="btn btn-sm" disabled={busy} onClick={handleCancel}>Cancel</button>
          </div>
        </>
      ) : (
        <>
          {chunk.paragraphs.map((p, i) => (
            <Paragraph key={i} p={p} project={project} />
          ))}
          {showRegen && (
            <div style={{ marginTop: 12, padding: 12, border: '1px solid var(--line)', borderRadius: 6, background: 'var(--paper)' }}>
              <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 6, fontFamily: 'var(--font-mono)' }}>
                Optional instruction — e.g. &quot;tighten&quot;, &quot;add more on budget impact&quot;, &quot;rewrite in past tense&quot;
              </div>
              <textarea
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                disabled={busy}
                rows={2}
                style={{ width: '100%', fontFamily: 'var(--font-sans)', fontSize: 13, padding: 8, border: '1px solid var(--line-strong)', borderRadius: 6, background: 'var(--bg)', resize: 'vertical' }}
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button className="btn btn-accent btn-sm" disabled={busy} onClick={handleRegen}>
                  {busy ? 'Regenerating…' : 'Regenerate block'}
                </button>
                <button className="btn btn-sm" disabled={busy} onClick={() => { setShowRegen(false); setInstruction(''); }}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </article>
  );
}

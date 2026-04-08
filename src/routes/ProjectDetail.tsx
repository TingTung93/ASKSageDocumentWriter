// Single-project view: shared inputs editor, draft trigger, drafted
// section workspace, validation issues, and export. The end-to-end
// drafting + critique + export pipeline lives here.

import { useState, type ChangeEvent, type FormEvent } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type DraftRecord, type ProjectContextFile, type ProjectRecord, type TemplateRecord } from '../lib/db/schema';
import { updateProject } from '../lib/project/helpers';
import { deriveSharedInputFields, type SharedInputField } from '../lib/project/helpers';
import {
  addProjectNote,
  attachProjectFile,
  clearOrphanedFiles,
  getContextItems,
  hasOrphanedV4Files,
  removeContextItem,
} from '../lib/project/context';
import { semanticChunkText } from '../lib/project/chunk';
import { db as dexieDb } from '../lib/db/schema';
import { DropZone } from '../components/DropZone';
import { EmptyState } from '../components/EmptyState';
import { useAuth } from '../lib/state/auth';
import { AskSageClient } from '../lib/asksage/client';
import { draftProject } from '../lib/draft/orchestrator';
import { runValidation } from '../lib/critique';
import { exportProjectAsJson, downloadJsonExport } from '../lib/export';
import type { DraftParagraph } from '../lib/draft/types';
import { loadSettings } from '../lib/settings/store';
import { estimateProjectDrafting, formatTokens, formatUsd } from '../lib/settings/cost';
import { DEFAULT_COST_ASSUMPTIONS } from '../lib/settings/types';
import { toast } from '../lib/state/toast';
import { Spinner } from '../components/Spinner';
import { buildProjectBundle } from '../lib/share/bundle';
import { downloadBundle, bundleFilename } from '../lib/share/download';

export function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const project = useLiveQuery(() => (id ? db.projects.get(id) : undefined), [id]);
  const allTemplates = useLiveQuery(() => db.templates.toArray(), []);
  const drafts = useLiveQuery<DraftRecord[]>(
    () =>
      id
        ? db.drafts.where('project_id').equals(id).toArray()
        : Promise.resolve([] as DraftRecord[]),
    [id],
  );
  const apiKey = useAuth((s) => s.apiKey);
  const baseUrl = useAuth((s) => s.baseUrl);
  const provider = useAuth((s) => s.provider);
  const onAskSage = provider === 'asksage';
  const settings = useLiveQuery(() => loadSettings(), []);
  const draftingModelOverride = settings?.models.drafting ?? null;
  const cost = settings?.cost ?? DEFAULT_COST_ASSUMPTIONS;

  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  if (!id) return <main>Missing project id</main>;
  if (!project) return <main>Loading project…</main>;
  if (!allTemplates) return <main>Loading…</main>;

  const projectTemplates = allTemplates.filter((t) => project.template_ids.includes(t.id));
  const sharedFields = deriveSharedInputFields(projectTemplates);
  const totalSections = projectTemplates.reduce(
    (acc, t) => acc + t.schema_json.sections.length,
    0,
  );
  const draftsBySectionKey = new Map<string, DraftRecord>();
  for (const d of drafts ?? []) draftsBySectionKey.set(`${d.template_id}::${d.section_id}`, d);

  async function onSharedInputChange(key: string, value: string) {
    if (!project) return;
    await updateProject(project.id, {
      shared_inputs: { ...project.shared_inputs, [key]: value },
    });
  }

  async function onStartDrafting() {
    if (!project) return;
    if (!apiKey) {
      setDraftError('Connect on the Connection tab first — drafting needs an Ask Sage API key.');
      return;
    }
    if (!onAskSage) {
      setDraftError(
        'Drafting requires Ask Sage (datasets, file ingest, RAG). OpenRouter mode does not support the project drafting flow — switch providers on the Connection tab.',
      );
      return;
    }
    setDraftError(null);
    setDrafting(true);
    setProgress({ done: 0, total: totalSections });
    // eslint-disable-next-line no-console
    console.info(`[ProjectDetail] starting drafting for project ${project.id}: ${totalSections} sections across ${projectTemplates.length} templates`);
    try {
      const client = new AskSageClient(baseUrl, apiKey);
      let done = 0;
      await draftProject(client, {
        project,
        templates: projectTemplates,
        ...(draftingModelOverride ? { options: { model: draftingModelOverride } } : {}),
        callbacks: {
          onSectionStart: (tpl, sec) => {
            // eslint-disable-next-line no-console
            console.info(`[ProjectDetail] drafting ${tpl.name} :: ${sec.name}`);
          },
          onSectionComplete: (tpl, sec) => {
            done += 1;
            setProgress({ done, total: totalSections });
            // eslint-disable-next-line no-console
            console.info(`[ProjectDetail] complete ${done}/${totalSections}: ${tpl.name} :: ${sec.name}`);
          },
          onSectionError: (tpl, sec, err) => {
            done += 1;
            setProgress({ done, total: totalSections });
            // eslint-disable-next-line no-console
            console.error(`[ProjectDetail] error on ${tpl.name} :: ${sec.name}: ${err.message}`);
            toast.error(`${tpl.name} :: ${sec.name} — ${err.message}`);
          },
        },
      });
      toast.success(`Drafting complete (${totalSections} section${totalSections === 1 ? '' : 's'})`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.error('[ProjectDetail] drafting failed:', err);
      setDraftError(message);
      toast.error(`Drafting failed: ${message}`);
    } finally {
      setDrafting(false);
    }
  }

  function onExport() {
    if (!project) return;
    const payload = exportProjectAsJson(project, projectTemplates, drafts ?? []);
    const safeName = project.name.replace(/[^a-z0-9]+/gi, '_').toLowerCase();
    const filename = `${safeName}-${Date.now()}.json`;
    downloadJsonExport(filename, payload);
    toast.success(`Exported ${filename}`);
  }

  async function onShare(includeDrafts: boolean) {
    if (!project) return;
    try {
      const bundle = await buildProjectBundle(
        project,
        projectTemplates,
        drafts ?? [],
        { includeDrafts },
      );
      const filename = bundleFilename(project.name, 'project');
      downloadBundle(filename, bundle);
      toast.success(
        `Exported ${filename}${includeDrafts ? ' (with drafts)' : ''}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`Share failed: ${message}`);
    }
  }

  return (
    <main>
      <p><Link to="/projects">← Projects</Link></p>
      <h1>{project.name}</h1>
      <p className="note">
        {project.template_ids.length} template{project.template_ids.length === 1 ? '' : 's'} ·
        {' '}{totalSections} section{totalSections === 1 ? '' : 's'} ·
        {' '}updated {new Date(project.updated_at).toLocaleString()}
      </p>
      {project.description && <p>{project.description}</p>}

      {!onAskSage && (
        <div className="error" style={{ marginBottom: 'var(--space-3)' }}>
          <strong>OpenRouter mode — drafting and dataset features disabled.</strong>{' '}
          The project drafting flow needs Ask Sage (RAG, file ingest, dataset
          training). Switch providers on the <Link to="/">Connection</Link> tab
          to draft this project.
        </div>
      )}

      <ProjectTemplatesEditor
        project={project}
        allTemplates={allTemplates}
        currentlySelected={projectTemplates}
      />

      <h2>Shared inputs ({sharedFields.length})</h2>
      {sharedFields.length === 0 && (
        <p className="note">
          No metadata fill regions detected across the selected templates. Drafting will proceed
          using only the project description and reference datasets as ground truth.
        </p>
      )}
      <div>
        {sharedFields.map((f) => (
          <SharedInputControl
            key={f.key}
            field={f}
            value={project.shared_inputs[f.key] ?? ''}
            onChange={(v) => onSharedInputChange(f.key, v)}
          />
        ))}
      </div>

      <ProjectContextSection project={project} />

      <h2>Drafting</h2>
      <label htmlFor="project-live-detail">Web search mode</label>
      <select
        id="project-live-detail"
        value={project.live_search}
        onChange={async (e) => {
          await updateProject(project.id, {
            live_search: Number(e.target.value) as 0 | 1 | 2,
          });
        }}
        style={{ width: '100%', padding: '0.5rem', font: 'inherit', maxWidth: 500 }}
        disabled={drafting}
      >
        <option value={0}>Disabled — no web search, RAG only</option>
        <option value={1}>Google results — inject web hits as references</option>
        <option value={2}>Google + crawl — autonomous market research mode</option>
      </select>
      <p className="note">
        Applies to every drafting call for this project. Mode 2 is the right
        choice for market research / capability survey sections that need
        current outside-document context.
      </p>

      {(() => {
        const est = estimateProjectDrafting(totalSections, cost);
        return (
          <div
            style={{
              background: '#f6f6fa',
              border: '1px solid #ddd',
              borderRadius: 6,
              padding: '0.5rem 0.75rem',
              marginBottom: '0.5rem',
              fontSize: 12,
              color: '#444',
              maxWidth: 500,
            }}
          >
            <strong>Estimated cost</strong>{' '}
            <span className="note">
              ({totalSections} section{totalSections === 1 ? '' : 's'} ·{' '}
              {draftingModelOverride ?? 'default model'})
            </span>
            <div style={{ marginTop: '0.25rem' }}>
              ~{formatTokens(est.tokens_in)} in / ~{formatTokens(est.tokens_out)} out · ~
              {formatTokens(est.tokens_total)} total
              {cost.usd_per_1k_in + cost.usd_per_1k_out > 0 && (
                <> · {formatUsd(est.usd_total)}</>
              )}
            </div>
            <div className="note" style={{ marginTop: '0.25rem' }}>
              Tune assumptions on the <Link to="/settings">Settings</Link> tab.
            </div>
          </div>
        );
      })()}

      <div className="btn-row">
        <button type="button" onClick={onStartDrafting} disabled={drafting || !apiKey}>
          {drafting ? <Spinner light label="Drafting…" /> : 'Draft all sections'}
        </button>
        <button type="button" className="btn-secondary" onClick={() => void onShare(false)}>
          Share project (templates only)
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => void onShare(true)}
          disabled={(drafts ?? []).length === 0}
          title={
            (drafts ?? []).length === 0
              ? 'Draft at least one section first'
              : 'Include all drafted sections in the bundle'
          }
        >
          Share project + drafts
        </button>
        <button type="button" className="btn-ghost" onClick={onExport}>
          Export drafts as JSON
        </button>
      </div>
      <p className="note">
        Share buttons emit an <code>.asdbundle.json</code> file that bundles
        the project, every referenced template, and (optionally) the drafted
        sections. A teammate can drop it on the Projects tab to recreate the
        whole setup. The "Export drafts as JSON" button writes the older
        flat-JSON dump for downstream tooling.
      </p>
      {progress && (
        <p className="note">
          Progress: {progress.done} / {progress.total} sections
        </p>
      )}
      {draftError && <div className="error">{draftError}</div>}

      <h2>Sections</h2>
      {projectTemplates.map((tpl) => (
        <TemplateDraftedSections
          key={tpl.id}
          template={tpl}
          drafts={draftsBySectionKey}
        />
      ))}
    </main>
  );
}

function ProjectTemplatesEditor({
  project,
  allTemplates,
  currentlySelected,
}: {
  project: ProjectRecord;
  allTemplates: TemplateRecord[];
  currentlySelected: TemplateRecord[];
}) {
  const [search, setSearch] = useState('');

  const selectedIds = new Set(project.template_ids);
  const available = allTemplates.filter((t) => !selectedIds.has(t.id));
  const filteredAvailable = available.filter((t) =>
    search.trim()
      ? `${t.name} ${t.filename}`.toLowerCase().includes(search.trim().toLowerCase())
      : true,
  );

  async function onAdd(templateId: string) {
    if (selectedIds.has(templateId)) return;
    try {
      await updateProject(project.id, {
        template_ids: [...project.template_ids, templateId],
      });
      const tpl = allTemplates.find((t) => t.id === templateId);
      toast.success(`Added "${tpl?.name ?? templateId}" to the project`);
    } catch (err) {
      toast.error(`Add failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function onRemove(templateId: string) {
    const next = project.template_ids.filter((id) => id !== templateId);
    try {
      await updateProject(project.id, { template_ids: next });
      const tpl = allTemplates.find((t) => t.id === templateId);
      toast.info(
        `Removed "${tpl?.name ?? templateId}" from the project. Existing drafts for that template are kept on disk but no longer surfaced — re-add the template to see them.`,
      );
    } catch (err) {
      toast.error(`Remove failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return (
    <>
      <h2>
        Templates{' '}
        <span className="badge" style={{ marginLeft: '0.4rem' }}>
          {currentlySelected.length} selected · {available.length} available
        </span>
      </h2>
      <p className="note">
        The set of templates this project will draft. Add or remove freely.
        Removing a template doesn't delete its drafts from disk — they're
        just hidden until you re-add it.
      </p>

      {currentlySelected.length === 0 ? (
        <EmptyState
          title="No templates yet"
          body="Pick at least one template below to enable drafting."
        />
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, marginTop: 'var(--space-2)' }}>
          {currentlySelected.map((t) => (
            <li
              key={t.id}
              className="card"
              style={{
                marginBottom: 'var(--space-2)',
                padding: 'var(--space-2) var(--space-3)',
              }}
            >
              <div className="row" style={{ alignItems: 'center' }}>
                <strong>{t.name}</strong>
                <span className="badge">
                  {t.schema_json.sections.length} section
                  {t.schema_json.sections.length === 1 ? '' : 's'}
                </span>
                {t.schema_json.source.semantic_synthesizer === null && (
                  <span className="badge badge-warning">needs synthesis</span>
                )}
                <span style={{ marginLeft: 'auto' }} />
                <button
                  type="button"
                  className="btn-danger btn-sm"
                  onClick={() => void onRemove(t.id)}
                >
                  remove
                </button>
              </div>
              <div className="note" style={{ marginTop: '0.3rem' }}>
                {t.filename}
              </div>
            </li>
          ))}
        </ul>
      )}

      {available.length > 0 && (
        <details style={{ marginTop: 'var(--space-3)' }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
            Add a template ({available.length} available)
          </summary>
          <div style={{ marginTop: 'var(--space-2)' }}>
            <input
              type="text"
              placeholder="Filter by name or filename…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <ul style={{ listStyle: 'none', padding: 0, marginTop: 'var(--space-2)', maxHeight: 280, overflow: 'auto' }}>
              {filteredAvailable.map((t) => (
                <li
                  key={t.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    padding: 'var(--space-2) var(--space-3)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-sm)',
                    marginBottom: '0.25rem',
                    background: 'var(--color-surface)',
                  }}
                >
                  <strong>{t.name}</strong>
                  <span className="note">{t.filename}</span>
                  <span className="badge">
                    {t.schema_json.sections.length} sec
                  </span>
                  <span style={{ marginLeft: 'auto' }} />
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={() => void onAdd(t.id)}
                  >
                    add
                  </button>
                </li>
              ))}
              {filteredAvailable.length === 0 && (
                <p className="note">No templates match "{search}".</p>
              )}
            </ul>
          </div>
        </details>
      )}
      {available.length === 0 && currentlySelected.length > 0 && (
        <p className="note">
          All your templates are in this project. Ingest more on the{' '}
          <Link to="/templates">Templates</Link> tab.
        </p>
      )}
    </>
  );
}

function SharedInputControl({
  field,
  value,
  onChange,
}: {
  field: SharedInputField;
  value: string;
  onChange: (v: string) => void;
}) {
  const id = `field-${field.key}`;
  return (
    <div style={{ marginBottom: '0.5rem' }}>
      <label htmlFor={id}>
        {field.display_name}
        {field.required && <span style={{ color: '#b00' }}> *</span>}
      </label>
      {field.allowed_values && field.allowed_values.length > 0 ? (
        <select
          id={id}
          value={value}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => onChange(e.target.value)}
          style={{ width: '100%', padding: '0.5rem', font: 'inherit' }}
        >
          <option value="">— select —</option>
          {field.allowed_values.map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          type={field.control_type === 'date' ? 'date' : 'text'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      <p className="note">
        Used by {field.template_ids.length} template{field.template_ids.length === 1 ? '' : 's'} · type: {field.control_type}
      </p>
    </div>
  );
}

function TemplateDraftedSections({
  template,
  drafts,
}: {
  template: TemplateRecord;
  drafts: Map<string, DraftRecord>;
}) {
  return (
    <section style={{ marginTop: '1rem', borderTop: '1px solid #ddd', paddingTop: '0.75rem' }}>
      <h3>{template.name}</h3>
      {template.schema_json.sections.length === 0 && (
        <p className="note">No sections in this template's schema. Run synthesis on the Templates tab.</p>
      )}
      {template.schema_json.sections.map((section) => {
        const draft = drafts.get(`${template.id}::${section.id}`);
        const issues = draft && draft.status === 'ready'
          ? runValidation(section, draft.paragraphs)
          : [];
        return (
          <div
            key={section.id}
            style={{
              marginBottom: '0.75rem',
              padding: '0.5rem 0.75rem',
              border: '1px solid #ccd',
              background: '#fafbff',
              borderRadius: 4,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
              <strong>{section.name}</strong>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: '#666' }}>
                {draft ? `${draft.status} · ${draft.tokens_in + draft.tokens_out} tokens` : 'not drafted'}
              </span>
            </div>
            {section.intent && (
              <div className="note">{section.intent}</div>
            )}
            {draft?.status === 'error' && (
              <div className="error">Draft failed: {draft.error}</div>
            )}
            {draft?.status === 'ready' && draft.paragraphs.length > 0 && (
              <DraftParagraphList paragraphs={draft.paragraphs} />
            )}
            {issues.length > 0 && (
              <div style={{ marginTop: '0.5rem', padding: '0.4rem', background: '#fff5e0', border: '1px solid #d4a000', fontSize: 12 }}>
                <strong>Validation issues:</strong>
                <ul style={{ margin: '0.25rem 0 0 1rem', padding: 0 }}>
                  {issues.map((iss, i) => (
                    <li key={i} style={{ color: iss.severity === 'error' ? '#900' : '#860' }}>
                      [{iss.severity}] {iss.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {draft && (draft.prompt_sent || draft.references) && (
              <DraftDiagnostics draft={draft} />
            )}
          </div>
        );
      })}
    </section>
  );
}

/**
 * Per-section diagnostic panel — collapses by default, expands to
 * show the EXACT prompt the LLM saw and the references Ask Sage
 * returned. This is the diagnostic loop we kept needing during the
 * transfusion / SHARP investigation.
 */
/**
 * Mirror of the same helper in lib/draft/orchestrator. Health.mil
 * returns `ret` as a string; swagger v1.56 says object. Handle both.
 */
function extractedTextFromRet(ret: string | Record<string, unknown>): string {
  if (typeof ret === 'string') return ret;
  if (ret && typeof ret === 'object') {
    const maybeText = (ret as { text?: unknown }).text;
    if (typeof maybeText === 'string') return maybeText;
    const maybeContent = (ret as { content?: unknown }).content;
    if (typeof maybeContent === 'string') return maybeContent;
    try {
      return JSON.stringify(ret);
    } catch {
      return '';
    }
  }
  return '';
}

function DraftDiagnostics({ draft }: { draft: DraftRecord }) {
  const promptChars = draft.prompt_sent?.length ?? 0;
  const refsChars = draft.references?.length ?? 0;
  return (
    <details style={{ marginTop: '0.5rem' }}>
      <summary className="note" style={{ cursor: 'pointer' }}>
        Diagnostics — prompt ({promptChars.toLocaleString()} chars) · references ({refsChars.toLocaleString()} chars) · model {draft.model}
      </summary>
      <div style={{ marginTop: '0.4rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-subtle)' }}>
            PROMPT SENT
          </div>
          <pre
            style={{
              background: 'var(--color-surface-alt)',
              padding: 'var(--space-2)',
              fontSize: 11,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              maxHeight: 360,
              overflow: 'auto',
              margin: 0,
              borderRadius: 'var(--radius-sm)',
            }}
          >
            {draft.prompt_sent || '(no prompt captured)'}
          </pre>
        </div>
        <div>
          <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-subtle)' }}>
            REFERENCES RETURNED BY ASK SAGE
          </div>
          <pre
            style={{
              background: 'var(--color-surface-alt)',
              padding: 'var(--space-2)',
              fontSize: 11,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              maxHeight: 360,
              overflow: 'auto',
              margin: 0,
              borderRadius: 'var(--radius-sm)',
            }}
          >
            {draft.references || '(no references returned)'}
          </pre>
        </div>
      </div>
    </details>
  );
}

function ProjectContextSection({ project }: { project: ProjectRecord }) {
  const items = getContextItems(project);
  const notes = items.filter((i) => i.kind === 'note');
  const files = items.filter((i) => i.kind === 'file');
  const orphaned = hasOrphanedV4Files(project);

  const apiKey = useAuth((s) => s.apiKey);
  const baseUrl = useAuth((s) => s.baseUrl);
  const provider = useAuth((s) => s.provider);
  const onAskSage = provider === 'asksage';

  const totalReferenceBytes = files.reduce(
    (acc, f) => acc + (f.kind === 'file' ? f.size_bytes : 0),
    0,
  );

  const [noteDraft, setNoteDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [attaching, setAttaching] = useState(false);

  // Per-file extraction preview cache. Lives in component state for the
  // session — not persisted, since the source of truth is the file
  // bytes and the actual draft-time extraction is what matters. This
  // is purely a "show me what Ask Sage will see" diagnostic.
  interface ExtractionPreview {
    chars: number;
    tokens: number | null;
    snippet: string;
    fetchedAt: number;
  }
  const [previews, setPreviews] = useState<Record<string, ExtractionPreview>>({});
  const [previewLoading, setPreviewLoading] = useState<string | null>(null);
  const [chunkingId, setChunkingId] = useState<string | null>(null);

  async function onAttach(file: File) {
    setAttaching(true);
    try {
      const item = await attachProjectFile(project.id, file);
      toast.success(
        `${file.name} attached · ${(item.size_bytes / 1024).toFixed(1)} KB`,
      );
    } catch (err) {
      toast.error(`Attach failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setAttaching(false);
    }
  }

  async function onTestExtraction(fileItem: ProjectContextFile) {
    if (!apiKey || !onAskSage) {
      toast.error('Connect to Ask Sage on the Connection tab first.');
      return;
    }
    setPreviewLoading(fileItem.id);
    try {
      const client = new AskSageClient(baseUrl, apiKey);
      const fileObj = new File([fileItem.bytes], fileItem.filename, {
        type: fileItem.mime_type || 'application/octet-stream',
      });
      const upload = await client.uploadFile(fileObj);
      const text = extractedTextFromRet(upload.ret);
      let tokens: number | null = null;
      try {
        const n = await client.tokenize({ content: text });
        tokens = Number.isFinite(n) ? n : null;
      } catch {
        // Tokenizer is best-effort; the char count is still useful.
      }
      setPreviews((prev) => ({
        ...prev,
        [fileItem.id]: {
          chars: text.length,
          tokens,
          snippet: text.slice(0, 800),
          fetchedAt: Date.now(),
        },
      }));
      toast.success(
        `${fileItem.filename}: ${text.length.toLocaleString()} chars` +
          (tokens !== null ? ` · ${tokens.toLocaleString()} tokens` : ''),
      );
    } catch (err) {
      toast.error(
        `Extraction failed for ${fileItem.filename}: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setPreviewLoading(null);
    }
  }

  async function onSemanticChunk(fileItem: ProjectContextFile) {
    if (!apiKey || !onAskSage) {
      toast.error('Connect to Ask Sage on the Connection tab first.');
      return;
    }
    setChunkingId(fileItem.id);
    try {
      // We need the extracted text to chunk. If we already previewed
      // it, reuse that; otherwise call /server/file once.
      const client = new AskSageClient(baseUrl, apiKey);
      let text = previews[fileItem.id]?.snippet ?? '';
      if (!previews[fileItem.id]) {
        const fileObj = new File([fileItem.bytes], fileItem.filename, {
          type: fileItem.mime_type || 'application/octet-stream',
        });
        const upload = await client.uploadFile(fileObj);
        text = extractedTextFromRet(upload.ret);
      } else {
        // We need the FULL extracted text, not the 800-char snippet
        // we cached for preview. Re-upload to get the full text.
        const fileObj = new File([fileItem.bytes], fileItem.filename, {
          type: fileItem.mime_type || 'application/octet-stream',
        });
        const upload = await client.uploadFile(fileObj);
        text = extractedTextFromRet(upload.ret);
      }
      if (!text || text.trim().length === 0) {
        throw new Error('Ask Sage extracted no text from this file.');
      }
      const chunks = await semanticChunkText(client, text, {
        sourceLabel: fileItem.filename,
      });

      // Persist the chunks onto the file record.
      const proj = await dexieDb.projects.get(project.id);
      if (!proj) throw new Error('Project disappeared');
      const nextItems = (proj.context_items ?? []).map((it) =>
        it.kind === 'file' && it.id === fileItem.id ? { ...it, chunks } : it,
      );
      await dexieDb.projects.put({
        ...proj,
        context_items: nextItems,
        updated_at: new Date().toISOString(),
      });

      const totalChars = chunks.reduce((acc, c) => acc + c.text.length, 0);
      toast.success(
        `${fileItem.filename}: ${chunks.length} semantic chunks · ${totalChars.toLocaleString()} chars`,
      );
    } catch (err) {
      toast.error(
        `Chunking failed for ${fileItem.filename}: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setChunkingId(null);
    }
  }

  // Total token count across all previewed files. Files that haven't
  // been previewed yet contribute null and are excluded from the sum;
  // we tell the user "X of Y files measured" so the partial number
  // isn't misleading.
  const previewedFileIds = Object.keys(previews);
  const totalPreviewedTokens = previewedFileIds.reduce(
    (acc, id) => acc + (previews[id]?.tokens ?? 0),
    0,
  );
  const totalPreviewedChars = previewedFileIds.reduce(
    (acc, id) => acc + (previews[id]?.chars ?? 0),
    0,
  );

  async function onClearOrphans() {
    try {
      await clearOrphanedFiles(project.id);
      toast.success('Cleared orphaned v4 file entries');
    } catch (err) {
      toast.error(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function onPostNote(e: FormEvent) {
    e.preventDefault();
    if (!noteDraft.trim()) return;
    setPosting(true);
    try {
      await addProjectNote(project.id, noteDraft);
      setNoteDraft('');
    } catch (err) {
      toast.error(`Failed to post note: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setPosting(false);
    }
  }

  async function onRemove(itemId: string) {
    try {
      await removeContextItem(project.id, itemId);
    } catch (err) {
      toast.error(`Failed to remove: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return (
    <>
      <h2>
        Project context{' '}
        <span className="badge" style={{ marginLeft: '0.4rem' }}>
          {files.length} file{files.length === 1 ? '' : 's'} · {notes.length} note
          {notes.length === 1 ? '' : 's'}
        </span>
      </h2>
      <p className="note">
        Two grounding mechanisms feed the drafter, both inlined directly into
        every section's prompt:
        <br />· <strong>Notes</strong> — short user-authored guidance (quotes,
        salient characteristics, scope hints). Inlined verbatim.
        <br />· <strong>Files</strong> — reference documents stored locally as
        bytes. Each drafting run uploads them once to <code>/server/file</code>{' '}
        for extraction and inlines the full text into every per-section call.
        No character caps; the model literally sees the source material.
      </p>

      {orphaned && (
        <div className="error" style={{ marginBottom: 'var(--space-3)' }}>
          <strong>Orphaned files from a previous version detected.</strong>
          {'\n\n'}
          This project has file attachments from the v4 train-into-dataset
          flow that no longer have local bytes. Drafting will skip them.
          Re-attach the originals from your local copy, then click below to
          clear the stale entries.
          {'\n\n'}
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => void onClearOrphans()}
          >
            Clear orphaned entries
          </button>
        </div>
      )}

      <h3 style={{ marginTop: 'var(--space-3)' }}>
        Attached files ({files.length})
        {totalReferenceBytes > 0 && (
          <span className="badge" style={{ marginLeft: '0.4rem' }}>
            {(totalReferenceBytes / 1024 / 1024).toFixed(2)} MB on disk
          </span>
        )}
        {previewedFileIds.length > 0 && (
          <span className="badge badge-primary" style={{ marginLeft: '0.4rem' }}>
            {previewedFileIds.length} of {files.length} previewed ·{' '}
            {totalPreviewedTokens > 0
              ? `~${totalPreviewedTokens.toLocaleString()} tokens`
              : `${totalPreviewedChars.toLocaleString()} chars`}
          </span>
        )}
      </h3>
      {files.length > 0 && previewedFileIds.length < files.length && (
        <p className="note">
          Click <strong>test extract</strong> on each file to verify Ask Sage
          can read it and to see the exact token count it'll consume in the
          drafting prompt.
        </p>
      )}
      <DropZone
        accept=".docx,.pdf,.txt,.md,.markdown,.csv,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/pdf,text/plain,text/markdown,text/csv"
        onFile={onAttach}
        disabled={attaching}
        label={
          attaching
            ? 'Storing file…'
            : 'Drop a reference file (DOCX, PDF, TXT, MD, CSV)'
        }
        hint="Files are stored locally as bytes. At draft time, each is uploaded once to /server/file (Ask Sage extracts the text) and the full extracted content is inlined into every per-section prompt. Up to 250 MB per document, 500 MB for audio/video."
      />
      {files.length === 0 ? (
        <EmptyState
          title="No files attached"
          body="Drop reference DOCX/PDF/MD/TXT files above. The drafter will see their full content on every section call."
        />
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, marginTop: 'var(--space-2)' }}>
          {files.map((f) => {
            if (f.kind !== 'file') return null;
            const preview = previews[f.id];
            const isLoading = previewLoading === f.id;
            const isChunking = chunkingId === f.id;
            const chunkCount = f.chunks?.length ?? 0;
            return (
              <li
                key={f.id}
                className="card"
                style={{ marginBottom: 'var(--space-2)', padding: 'var(--space-2) var(--space-3)' }}
              >
                <div className="row" style={{ alignItems: 'center' }}>
                  <strong>{f.filename}</strong>
                  <span className="badge">{(f.size_bytes / 1024).toFixed(1)} KB</span>
                  <span className="badge">{f.mime_type.split('/').pop()}</span>
                  {preview && (
                    <span className="badge badge-success">
                      {preview.chars.toLocaleString()} chars
                      {preview.tokens !== null && ` · ${preview.tokens.toLocaleString()} tok`}
                    </span>
                  )}
                  {chunkCount > 0 ? (
                    <span className="badge badge-primary">
                      {chunkCount} semantic chunk{chunkCount === 1 ? '' : 's'}
                    </span>
                  ) : (
                    <span className="badge">naive chunking</span>
                  )}
                  <span style={{ marginLeft: 'auto' }} />
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    disabled={isLoading || isChunking || !apiKey || !onAskSage}
                    title="Upload to /server/file and tokenize. Useful for verifying Ask Sage can read this file before drafting."
                    onClick={() => void onTestExtraction(f)}
                  >
                    {isLoading ? 'extracting…' : preview ? 're-test' : 'test extract'}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    disabled={isChunking || isLoading || !apiKey || !onAskSage}
                    title="Run an LLM pass to split this file into semantically coherent chunks. Each chunk gets a title and one-sentence summary used for per-section relevance scoring at draft time."
                    onClick={() => void onSemanticChunk(f)}
                  >
                    {isChunking ? 'chunking…' : chunkCount > 0 ? 're-chunk' : 'chunk'}
                  </button>
                  <button
                    type="button"
                    className="btn-danger btn-sm"
                    onClick={() => void onRemove(f.id)}
                  >
                    remove
                  </button>
                </div>
                <div className="note" style={{ marginTop: '0.3rem' }}>
                  Attached {new Date(f.created_at).toLocaleString()}
                  {chunkCount === 0 && (
                    <>
                      {' · '}
                      <em>
                        will fall back to naive paragraph chunking at draft time
                      </em>
                    </>
                  )}
                </div>
                {preview && (
                  <details style={{ marginTop: '0.4rem' }}>
                    <summary className="note" style={{ cursor: 'pointer' }}>
                      Preview first {Math.min(preview.snippet.length, 800).toLocaleString()} chars of extracted text
                    </summary>
                    <pre
                      style={{
                        background: 'var(--color-surface-alt)',
                        padding: 'var(--space-2)',
                        fontSize: 11,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        maxHeight: 200,
                        overflow: 'auto',
                        margin: '0.4rem 0 0',
                        borderRadius: 'var(--radius-sm)',
                      }}
                    >
                      {preview.snippet}
                      {preview.chars > 800 && '\n…'}
                    </pre>
                  </details>
                )}
                {chunkCount > 0 && f.chunks && (
                  <details style={{ marginTop: '0.4rem' }}>
                    <summary className="note" style={{ cursor: 'pointer' }}>
                      View {chunkCount} semantic chunk{chunkCount === 1 ? '' : 's'}
                    </summary>
                    <ul
                      style={{
                        listStyle: 'none',
                        padding: 'var(--space-2)',
                        margin: '0.4rem 0 0',
                        background: 'var(--color-surface-alt)',
                        borderRadius: 'var(--radius-sm)',
                        maxHeight: 280,
                        overflow: 'auto',
                      }}
                    >
                      {f.chunks.map((c) => (
                        <li
                          key={c.id}
                          style={{
                            marginBottom: '0.5rem',
                            paddingBottom: '0.5rem',
                            borderBottom: '1px dashed var(--color-border)',
                          }}
                        >
                          <strong style={{ fontSize: 12 }}>{c.title}</strong>
                          <span className="badge" style={{ marginLeft: '0.4rem' }}>
                            {c.text.length.toLocaleString()} chars
                          </span>
                          {c.summary && (
                            <div className="note" style={{ marginTop: '0.2rem', fontStyle: 'italic' }}>
                              {c.summary}
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <h3 style={{ marginTop: 'var(--space-4)' }}>Chat notes ({notes.length})</h3>
      {notes.length === 0 ? (
        <EmptyState
          title="No notes yet"
          body="Post scope hints, priorities, or any guidance you want the drafter to honor."
        />
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, marginTop: 'var(--space-2)' }}>
          {notes.map((n) =>
            n.kind === 'note' ? (
              <li
                key={n.id}
                className="card"
                style={{ marginBottom: 'var(--space-2)', padding: 'var(--space-2) var(--space-3)' }}
              >
                <div className="row" style={{ alignItems: 'center' }}>
                  <span className="badge badge-primary">{n.role}</span>
                  <span className="muted" style={{ fontSize: 11 }}>
                    {new Date(n.created_at).toLocaleString()}
                  </span>
                  <span style={{ marginLeft: 'auto' }} />
                  <button
                    type="button"
                    className="btn-danger btn-sm"
                    onClick={() => void onRemove(n.id)}
                  >
                    remove
                  </button>
                </div>
                <div style={{ marginTop: '0.3rem', whiteSpace: 'pre-wrap' }}>{n.text}</div>
              </li>
            ) : null,
          )}
        </ul>
      )}
      <form onSubmit={onPostNote} style={{ marginTop: 'var(--space-2)' }}>
        <label htmlFor="context-note">Add a note</label>
        <textarea
          id="context-note"
          value={noteDraft}
          onChange={(e) => setNoteDraft(e.target.value)}
          rows={3}
          placeholder="e.g. Emphasize compliance with DHA Issuance 6025.13 throughout the Inspection section."
          disabled={posting}
        />
        <button type="submit" disabled={posting || !noteDraft.trim()}>
          {posting ? 'Posting…' : 'Post note'}
        </button>
      </form>
    </>
  );
}

function DraftParagraphList({ paragraphs }: { paragraphs: DraftParagraph[] }) {
  return (
    <div style={{ marginTop: '0.5rem' }}>
      {paragraphs.map((p, i) => (
        <div key={i} style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.25rem' }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: '#666',
              minWidth: 60,
              textTransform: 'uppercase',
            }}
          >
            {p.role}
          </span>
          <span style={{ flex: 1 }}>{p.text}</span>
        </div>
      ))}
    </div>
  );
}

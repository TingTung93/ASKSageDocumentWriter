// Single-project view: shared inputs editor, draft trigger, drafted
// section workspace, validation issues, and export. The end-to-end
// drafting + critique + export pipeline lives here.

import { useState, type ChangeEvent, type FormEvent } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type DraftRecord, type ProjectRecord, type TemplateRecord } from '../lib/db/schema';
import { updateProject } from '../lib/project/helpers';
import { deriveSharedInputFields, type SharedInputField } from '../lib/project/helpers';
import {
  addProjectNote,
  attachProjectFile,
  getContextItems,
  removeContextItem,
  setProjectDataset,
  suggestDatasetName,
} from '../lib/project/context';
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
          </div>
        );
      })}
    </section>
  );
}

function ProjectContextSection({ project }: { project: ProjectRecord }) {
  const items = getContextItems(project);
  const notes = items.filter((i) => i.kind === 'note');
  const files = items.filter((i) => i.kind === 'file');
  const apiKey = useAuth((s) => s.apiKey);
  const baseUrl = useAuth((s) => s.baseUrl);
  const datasetName = project.dataset_name ?? '';
  const datasetSet = datasetName.length > 0;

  const [noteDraft, setNoteDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [datasetDraft, setDatasetDraft] = useState(datasetName);
  const [datasetOptions, setDatasetOptions] = useState<string[] | null>(null);
  const [loadingDatasets, setLoadingDatasets] = useState(false);

  async function loadDatasets() {
    if (!apiKey) {
      toast.error('Connect on the Connection tab first.');
      return;
    }
    setLoadingDatasets(true);
    try {
      const client = new AskSageClient(baseUrl, apiKey);
      const list = await client.getServerDatasets();
      setDatasetOptions(list);
      if (list.length === 0) {
        toast.info('Ask Sage returned an empty dataset list.');
      }
    } catch (err) {
      toast.error(`Couldn't list datasets: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoadingDatasets(false);
    }
  }

  async function onSaveDataset() {
    const next = datasetDraft.trim() || null;
    try {
      await setProjectDataset(project.id, next);
      toast.success(next ? `Dataset set to "${next}"` : 'Project dataset cleared');
    } catch (err) {
      toast.error(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function onSuggestName() {
    setDatasetDraft(suggestDatasetName(project.name));
  }

  async function onAttach(file: File) {
    if (!apiKey) {
      toast.error('Connect on the Connection tab first.');
      return;
    }
    if (!datasetSet) {
      toast.error('Set or pick a dataset name above before attaching files.');
      return;
    }
    setAttaching(true);
    try {
      const client = new AskSageClient(baseUrl, apiKey);
      const item = await attachProjectFile(client, project.id, file);
      toast.success(
        `${file.name} uploaded · ${item.extracted_chars.toLocaleString()} chars trained into ${item.trained_into_dataset}`,
      );
    } catch (err) {
      toast.error(`Attach failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setAttaching(false);
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
        Two grounding mechanisms feed the drafter:
        <br />· <strong>Notes</strong> are inlined into every section's prompt verbatim.
        Use them for short scope hints and tone guidance.
        <br />· <strong>Files</strong> are uploaded to Ask Sage via{' '}
        <code>/server/file</code> and trained into this project's owned dataset via{' '}
        <code>/server/train</code>. Drafting then uses{' '}
        <code>/server/query</code>'s RAG against that dataset — no character caps,
        no local extraction.
      </p>

      <h3 style={{ marginTop: 'var(--space-3)' }}>Ask Sage dataset for this project</h3>
      <p className="note">
        Pick or name a dataset to act as this project's RAG corpus. Files
        attached below are trained into it via <code>/server/train</code>. The
        drafter passes this name as <code>dataset</code> on every{' '}
        <code>/server/query</code> call.
      </p>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <label htmlFor="project-dataset">Dataset name</label>
          <input
            id="project-dataset"
            type="text"
            className="mono"
            value={datasetDraft}
            onChange={(e) => setDatasetDraft(e.target.value)}
            placeholder="e.g. asd_diasorin_pws"
            list="project-dataset-options"
          />
          {datasetOptions && (
            <datalist id="project-dataset-options">
              {datasetOptions.map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>
          )}
        </div>
        <button
          type="button"
          className="btn-secondary"
          onClick={onSuggestName}
          title="Generate a slug from the project name"
        >
          suggest
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => void loadDatasets()}
          disabled={loadingDatasets || !apiKey}
          title="GET /server/get-datasets"
        >
          {loadingDatasets ? 'Loading…' : `list (${datasetOptions?.length ?? '?'})`}
        </button>
        <button
          type="button"
          onClick={() => void onSaveDataset()}
          disabled={(datasetDraft.trim() || null) === (datasetName || null)}
        >
          save
        </button>
      </div>
      {datasetSet ? (
        <p className="note">
          Active dataset: <code>{datasetName}</code>
        </p>
      ) : (
        <p className="note" style={{ color: 'var(--color-warning)' }}>
          No dataset set — file attachments are disabled. Save a dataset name first.
        </p>
      )}

      <h3 style={{ marginTop: 'var(--space-4)' }}>Attached files ({files.length})</h3>
      <DropZone
        accept=".docx,.pdf,.txt,.md,.markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/pdf,text/plain,text/markdown"
        onFile={onAttach}
        disabled={attaching || !datasetSet || !apiKey}
        label={
          attaching
            ? 'Uploading and training…'
            : !datasetSet
              ? 'Set a dataset name above first'
              : 'Drop a reference file (DOCX, PDF, TXT, MD)'
        }
        hint="Files go to /server/file (Ask Sage extracts the text), then /server/train into this project's dataset. Up to 250 MB per document, 500 MB for audio/video."
      />
      {files.length === 0 ? (
        <EmptyState title="No files attached" body="Pick a dataset above, then drop a file here." />
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, marginTop: 'var(--space-2)' }}>
          {files.map((f) =>
            f.kind === 'file' ? (
              <li
                key={f.id}
                className="card"
                style={{ marginBottom: 'var(--space-2)', padding: 'var(--space-2) var(--space-3)' }}
              >
                <div className="row" style={{ alignItems: 'center' }}>
                  <strong>{f.filename}</strong>
                  <span className="badge">{(f.size_bytes / 1024).toFixed(1)} KB</span>
                  <span className="badge badge-success">
                    {f.extracted_chars.toLocaleString()} chars
                  </span>
                  <span className="badge badge-primary">{f.trained_into_dataset}</span>
                  <span style={{ marginLeft: 'auto' }} />
                  <button
                    type="button"
                    className="btn-danger btn-sm"
                    title="Removes the local registry entry only — the trained content remains in the Ask Sage dataset (no /server/* delete endpoint exists)."
                    onClick={() => void onRemove(f.id)}
                  >
                    forget
                  </button>
                </div>
                <div className="note" style={{ marginTop: '0.3rem' }}>
                  Attached {new Date(f.created_at).toLocaleString()}
                  {f.embedding_id && ` · embedding ${f.embedding_id}`}
                </div>
              </li>
            ) : null,
          )}
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

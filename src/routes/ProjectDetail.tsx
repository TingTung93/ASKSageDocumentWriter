// Single-project view: shared inputs editor, draft trigger, drafted
// section workspace, validation issues, and export. The end-to-end
// drafting + critique + export pipeline lives here.

import { useState, type ChangeEvent } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type DraftRecord, type TemplateRecord } from '../lib/db/schema';
import { updateProject } from '../lib/project/helpers';
import { deriveSharedInputFields, type SharedInputField } from '../lib/project/helpers';
import { useAuth } from '../lib/state/auth';
import { AskSageClient } from '../lib/asksage/client';
import { draftProject } from '../lib/draft/orchestrator';
import { runValidation } from '../lib/critique';
import { exportProjectAsJson, downloadJsonExport } from '../lib/export';
import type { DraftParagraph } from '../lib/draft/types';

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
          },
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.error('[ProjectDetail] drafting failed:', err);
      setDraftError(message);
    } finally {
      setDrafting(false);
    }
  }

  function onExport() {
    if (!project) return;
    const payload = exportProjectAsJson(project, projectTemplates, drafts ?? []);
    const safeName = project.name.replace(/[^a-z0-9]+/gi, '_').toLowerCase();
    downloadJsonExport(`${safeName}-${Date.now()}.json`, payload);
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

      <button type="button" onClick={onStartDrafting} disabled={drafting || !apiKey}>
        {drafting ? 'Drafting…' : 'Draft all sections'}
      </button>
      <button
        type="button"
        onClick={onExport}
        style={{ marginLeft: '0.5rem', background: '#666', borderColor: '#666' }}
      >
        Export project as JSON
      </button>
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

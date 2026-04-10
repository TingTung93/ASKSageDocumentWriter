// Project list + create form. Supports two modes:
//   - "template": classic flow — pick DOCX templates, draft per-section
//   - "freeform": pick a document style (white paper, exsum, memo, etc.)
//     and the AI synthesizes context into one cohesive document

import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type ProjectMode } from '../lib/db/schema';
import { createProject } from '../lib/project/helpers';
import { SearchFilter, matchesSearch } from '../components/SearchFilter';
import { EmptyState } from '../components/EmptyState';
import { DropZone } from '../components/DropZone';
import { HelpTip } from '../components/HelpTip';
import { importBundleFromText } from '../lib/share/import';
import { toast } from '../lib/state/toast';
import {
  FREEFORM_STYLES,
  FREEFORM_CATEGORIES,
  getFreeformStyle,
} from '../lib/freeform/styles';

export function Projects() {
  const projects = useLiveQuery(
    () => db.projects.orderBy('updated_at').reverse().toArray(),
    [],
  );
  const templates = useLiveQuery(() => db.templates.toArray(), []);

  const [mode, setMode] = useState<ProjectMode>('template');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<string[]>([]);
  const [freeformStyleId, setFreeformStyleId] = useState('');
  const [datasetNames, setDatasetNames] = useState('');
  const [liveSearch, setLiveSearch] = useState<0 | 1 | 2>(0);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [templatePickerSearch, setTemplatePickerSearch] = useState('');
  const [projectSearch, setProjectSearch] = useState('');
  const [importing, setImporting] = useState(false);
  const navigate = useNavigate();

  const filteredTemplates = useMemo(
    () => (templates ?? []).filter((t) => matchesSearch(t.name, templatePickerSearch)),
    [templates, templatePickerSearch],
  );
  const filteredProjects = useMemo(
    () =>
      (projects ?? []).filter((p) =>
        matchesSearch(`${p.name} ${p.description ?? ''}`, projectSearch),
      ),
    [projects, projectSearch],
  );

  const selectedStyle = freeformStyleId ? getFreeformStyle(freeformStyleId) : null;

  function toggleTemplate(id: string) {
    setSelectedTemplateIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  async function onImportBundle(file: File) {
    if (!file.name.toLowerCase().endsWith('.json')) {
      toast.error('Project bundles must be a .json file.');
      return;
    }
    setImporting(true);
    try {
      const text = await file.text();
      const summary = await importBundleFromText(text);
      if (summary.kind === 'project' && summary.project_id) {
        toast.success(
          `Imported "${summary.display_name}" — ${summary.template_count} template${summary.template_count === 1 ? '' : 's'}${summary.draft_count ? `, ${summary.draft_count} draft${summary.draft_count === 1 ? '' : 's'}` : ''}`,
        );
        navigate(`/projects/${summary.project_id}`);
      } else if (summary.kind === 'template') {
        toast.info(
          `Imported template "${summary.display_name}". Switch to the Templates tab to view it.`,
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`Bundle import failed: ${message}`);
    } finally {
      setImporting(false);
    }
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setCreateError(null);
    if (!name.trim()) {
      setCreateError('Project name is required.');
      return;
    }
    if (mode === 'template' && selectedTemplateIds.length === 0) {
      setCreateError('Pick at least one template.');
      return;
    }
    if (mode === 'freeform' && !freeformStyleId) {
      setCreateError('Pick a document style.');
      return;
    }
    setCreating(true);
    try {
      const datasets = datasetNames
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      const project = await createProject({
        name: name.trim(),
        description: description.trim(),
        template_ids: mode === 'template' ? selectedTemplateIds : [],
        reference_dataset_names: datasets,
        live_search: liveSearch,
        mode,
        freeform_style: mode === 'freeform' ? freeformStyleId : undefined,
      });
      setName('');
      setDescription('');
      setSelectedTemplateIds([]);
      setFreeformStyleId('');
      setDatasetNames('');
      setLiveSearch(0);
      navigate(`/projects/${project.id}`);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  return (
    <main>
      <h1>Projects</h1>
      <p>
        A project is where you bring everything together. You can draft from
        templates (fill in each section of a DOCX) or write a freeform
        document (white paper, executive summary, memo, etc.) from your
        reference material. Either way, the AI does the heavy lifting.
      </p>

      <h2>Import a shared bundle</h2>
      <p className="note">
        Drop a shared bundle file a teammate exported from this tool.
        Project bundles include every referenced template (and optionally
        the drafts), so one import gives you a working setup.
      </p>
      <DropZone
        accept=".json,application/json"
        onFile={onImportBundle}
        disabled={importing}
        label="Drop a project or template bundle here"
        hint="Templates inside the bundle are added as new copies — your existing data is never overwritten."
      />

      <h2>New project</h2>
      <form onSubmit={onCreate}>
        <label htmlFor="project-name">Name</label>
        <input
          id="project-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Diasorin Liaison MDX Maintenance Contract"
        />

        <label htmlFor="project-desc">
          Description{' '}
          <HelpTip>
            Describe what this project is about in a sentence or two.
            The AI uses this to understand the context and produce
            relevant content. The more specific you are, the better
            the output.
          </HelpTip>
        </label>
        <textarea
          id="project-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Describe the purpose, scope, and any key details the AI should know about…"
          rows={3}
          style={{ width: '100%', padding: '0.5rem', font: 'inherit', border: '1px solid #ddd', borderRadius: 4 }}
        />

        {/* ── Mode toggle ─────────────────────────────────────────── */}
        <fieldset style={{ border: 'none', padding: 0, margin: 'var(--space-4) 0 var(--space-2) 0' }}>
          <legend style={{ fontWeight: 600, padding: 0, fontSize: 13 }}>
            How do you want to create this document?
          </legend>
          <div style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 'var(--space-2)' }}>
            <label
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                gap: '0.3rem',
                padding: 'var(--space-3)',
                border: `2px solid ${mode === 'template' ? 'var(--color-primary)' : 'var(--color-border)'}`,
                borderRadius: 'var(--radius-md)',
                background: mode === 'template' ? 'var(--color-primary-soft)' : 'var(--color-surface)',
                cursor: 'pointer',
                fontWeight: 'normal',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <input
                  type="radio"
                  name="mode"
                  value="template"
                  checked={mode === 'template'}
                  onChange={() => setMode('template')}
                  style={{ width: 'auto' }}
                />
                <strong>Draft from templates</strong>
              </span>
              <span className="note">
                Upload a DOCX template and the AI fills in each section.
                Best for PWS, SOW, and other structured documents.
              </span>
            </label>
            <label
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                gap: '0.3rem',
                padding: 'var(--space-3)',
                border: `2px solid ${mode === 'freeform' ? 'var(--color-primary)' : 'var(--color-border)'}`,
                borderRadius: 'var(--radius-md)',
                background: mode === 'freeform' ? 'var(--color-primary-soft)' : 'var(--color-surface)',
                cursor: 'pointer',
                fontWeight: 'normal',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <input
                  type="radio"
                  name="mode"
                  value="freeform"
                  checked={mode === 'freeform'}
                  onChange={() => setMode('freeform')}
                  style={{ width: 'auto' }}
                />
                <strong>Write a document from scratch</strong>
              </span>
              <span className="note">
                Pick a document style (white paper, memo, EXSUM, etc.)
                and the AI writes the whole thing from your description
                and reference material.
              </span>
            </label>
          </div>
        </fieldset>

        {/* ── Template picker (template mode) ─────────────────────── */}
        {mode === 'template' && (
          <>
            <label>Templates ({templates?.length ?? 0} available)</label>
            {(!templates || templates.length === 0) && (
              <EmptyState
                title="No templates yet"
                body={
                  <>
                    Go to the <Link to="/templates">Templates</Link> tab and upload at least one DOCX first.
                  </>
                }
              />
            )}
            {templates && templates.length > 0 && (
              <SearchFilter
                value={templatePickerSearch}
                onChange={setTemplatePickerSearch}
                placeholder="Filter templates…"
              />
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', maxHeight: 200, overflow: 'auto', border: '1px solid #ddd', padding: '0.5rem' }}>
              {filteredTemplates.map((t) => (
                <label key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 400, margin: 0 }}>
                  <input
                    type="checkbox"
                    checked={selectedTemplateIds.includes(t.id)}
                    onChange={() => toggleTemplate(t.id)}
                    style={{ width: 'auto' }}
                  />
                  <span>{t.name}</span>
                  <span className="note" style={{ marginLeft: 'auto' }}>
                    {t.schema_json.sections.length} section
                    {t.schema_json.sections.length === 1 ? '' : 's'}
                    {t.schema_json.source.semantic_synthesizer === null && ' · NEEDS ANALYSIS'}
                  </span>
                </label>
              ))}
            </div>
          </>
        )}

        {/* ── Style picker (freeform mode) ────────────────────────── */}
        {mode === 'freeform' && (
          <>
            <label>Document style</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              {FREEFORM_CATEGORIES.map((cat) => {
                const styles = FREEFORM_STYLES.filter((s) => s.category === cat.id);
                return (
                  <div key={cat.id}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: '0.3rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      {cat.label}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '0.35rem' }}>
                      {styles.map((s) => (
                        <label
                          key={s.id}
                          style={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: '0.4rem',
                            padding: '0.5rem 0.65rem',
                            border: `1px solid ${freeformStyleId === s.id ? 'var(--color-primary)' : 'var(--color-border)'}`,
                            borderRadius: 'var(--radius-sm)',
                            background: freeformStyleId === s.id ? 'var(--color-primary-soft)' : 'var(--color-surface)',
                            cursor: 'pointer',
                            fontWeight: 'normal',
                            margin: 0,
                            fontSize: 13,
                          }}
                        >
                          <input
                            type="radio"
                            name="freeform-style"
                            value={s.id}
                            checked={freeformStyleId === s.id}
                            onChange={() => setFreeformStyleId(s.id)}
                            style={{ width: 'auto', marginTop: '2px' }}
                          />
                          <span>
                            <strong>{s.name}</strong>
                            <br />
                            <span className="note">{s.description}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            {selectedStyle && (
              <div className="panel" style={{ marginTop: 'var(--space-3)' }}>
                <strong>{selectedStyle.name}</strong>
                <span className="note" style={{ marginLeft: '0.5rem' }}>
                  Typical length: {selectedStyle.typical_pages} pages
                </span>
                <div style={{ marginTop: '0.4rem', fontSize: 12 }}>
                  <strong>Outline:</strong>
                  <ol style={{ margin: '0.3rem 0 0', paddingLeft: '1.2rem' }}>
                    {selectedStyle.outline.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ol>
                </div>
              </div>
            )}
          </>
        )}

        {/* ── Dataset & web search (both modes) ───────────────────── */}
        <label htmlFor="project-datasets" style={{ marginTop: 'var(--space-4)' }}>
          Reference dataset names (comma-separated, optional)
        </label>
        <input
          id="project-datasets"
          type="text"
          value={datasetNames}
          onChange={(e) => setDatasetNames(e.target.value)}
          placeholder="e.g. far-clauses, dha-issuances, prior-pws"
        />
        <p className="note">
          These are Ask Sage dataset names you've already set up in the Ask Sage
          portal. When drafting, the tool uses these datasets to pull in relevant
          reference material automatically. Leave empty if you don't have curated
          datasets. Use the <a href="#/datasets">Datasets</a> tab to verify a name
          before using it.
        </p>

        <label htmlFor="project-live">Web search mode</label>
        <select
          id="project-live"
          value={liveSearch}
          onChange={(e) => setLiveSearch(Number(e.target.value) as 0 | 1 | 2)}
          style={{ width: '100%', padding: '0.5rem', font: 'inherit' }}
        >
          <option value={0}>Disabled (default)</option>
          <option value={1}>Google results — include web search results as references</option>
          <option value={2}>Google + crawl — full market research mode</option>
        </select>
        <p className="note">
          Enables live web search during drafting. Mode 2 fetches and reads
          Google results in real time — the right choice for market research,
          contractor capability surveys, and any section that needs current
          information beyond your uploaded documents. Increases cost per section.
        </p>

        <button type="submit" disabled={creating} style={{ fontSize: 14 }}>
          {creating ? 'Creating…' : 'Create project'}
        </button>
        {createError && <div className="error">{createError}</div>}
      </form>

      {/* ── Existing projects ──────────────────────────────────────── */}
      <h2>Existing projects ({projects?.length ?? 0})</h2>
      {projects && projects.length > 0 && (
        <SearchFilter
          value={projectSearch}
          onChange={setProjectSearch}
          placeholder="Filter projects…"
        />
      )}
      {(!projects || projects.length === 0) && (
        <EmptyState
          icon="📋"
          title="No projects yet"
          body={<>Fill out the form above to create your first project. Choose "Draft from templates" for structured documents like a PWS, or "Write from scratch" for white papers, memos, executive summaries, and more.</>}
        />
      )}
      {projects && projects.length > 0 && filteredProjects.length === 0 && (
        <EmptyState title="No matches" body="Try a different search term." />
      )}
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {filteredProjects.map((p) => {
          const projectMode = p.mode ?? 'template';
          const styleName = p.freeform_style ? getFreeformStyle(p.freeform_style)?.name : null;
          return (
            <li key={p.id} style={{ padding: '0.5rem 0.75rem', border: '1px solid #ddd', borderRadius: 4, marginBottom: '0.25rem' }}>
              <Link to={`/projects/${p.id}`} style={{ textDecoration: 'none', color: '#1a1a1a' }}>
                <strong>{p.name}</strong>
                <div className="note">
                  {projectMode === 'freeform' ? (
                    <>
                      <span className="badge" style={{ marginRight: '0.4rem' }}>freeform</span>
                      {styleName ?? p.freeform_style}
                    </>
                  ) : (
                    <>
                      {p.template_ids.length} template{p.template_ids.length === 1 ? '' : 's'}
                    </>
                  )}
                  {' · '}{p.reference_dataset_names.length} dataset
                  {p.reference_dataset_names.length === 1 ? '' : 's'}
                  {' · '}updated {new Date(p.updated_at).toLocaleString()}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </main>
  );
}

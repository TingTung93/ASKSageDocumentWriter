import { useMemo, useRef, useState, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { db, type ProjectMode } from '../../lib/db/schema';
import { FREEFORM_CATEGORIES, FREEFORM_STYLES, getFreeformStyle } from '../../lib/freeform/styles';
import { createProject } from '../../lib/project/helpers';
import { importBundleFromText } from '../../lib/share/import';

interface V2HomeProps {
  onOpenIngest?: () => void;
}

export function V2Home({ onOpenIngest }: V2HomeProps) {
  const navigate = useNavigate();
  const importRef = useRef<HTMLInputElement>(null);
  const projects = useLiveQuery(() => db.projects.orderBy('updated_at').reverse().toArray(), []);
  const templates = useLiveQuery(() => db.templates.orderBy('ingested_at').reverse().toArray(), []);
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [mode, setMode] = useState<ProjectMode>('template');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<string[]>([]);
  const [freeformStyle, setFreeformStyle] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const filteredProjects = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return projects ?? [];
    return (projects ?? []).filter((project) =>
      `${project.name} ${project.description}`.toLocaleLowerCase().includes(query),
    );
  }, [projects, search]);

  const openProject = (id: string) => navigate(`/v2/${id}`);

  async function submitProject(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    if (!name.trim()) {
      setMessage('Enter a project name.');
      return;
    }
    if (mode === 'template' && selectedTemplateIds.length === 0) {
      setMessage('Select at least one template.');
      return;
    }
    if (mode === 'freeform' && !freeformStyle) {
      setMessage('Select a document style.');
      return;
    }
    setBusy(true);
    try {
      const project = await createProject({
        name: name.trim(),
        description: description.trim(),
        template_ids: mode === 'template' ? selectedTemplateIds : [],
        reference_dataset_names: [],
        mode,
        freeform_style: mode === 'freeform' ? freeformStyle : undefined,
      });
      openProject(project.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function importBundle(file: File) {
    setMessage(null);
    if (!file.name.toLocaleLowerCase().endsWith('.json')) {
      setMessage('Choose a project bundle (.json).');
      return;
    }
    setBusy(true);
    try {
      const summary = await importBundleFromText(await file.text());
      if (summary.kind === 'project' && summary.project_id) {
        openProject(summary.project_id);
      } else {
        setMessage(`Imported template “${summary.display_name}”. It is ready for a new project.`);
      }
    } catch (error) {
      setMessage(`Bundle import failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
      if (importRef.current) importRef.current.value = '';
    }
  }

  return (
    <main className="v2-home">
      <div className="v2-home-inner">
        <header className="v2-home-head">
          <div>
            <div className="settings-eyebrow">Workspace</div>
            <h1>What are you working on?</h1>
            <p>Create a document workspace or continue a saved project. Everything stays in this browser.</p>
          </div>
          <div className="v2-home-actions">
            <input
              ref={importRef}
              className="sr-only"
              type="file"
              accept=".json,application/json"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void importBundle(file);
              }}
            />
            <button className="btn" type="button" disabled={busy} onClick={() => importRef.current?.click()}>
              Import bundle
            </button>
            <button className="btn btn-accent" type="button" onClick={() => setShowCreate(true)}>
              New project
            </button>
          </div>
        </header>

        {message && <div className="v2-home-message" role="status">{message}</div>}

        {showCreate && (
          <section className="v2-create-card" aria-labelledby="v2-create-title">
            <div className="v2-create-title-row">
              <div>
                <div className="settings-eyebrow">New workspace</div>
                <h2 id="v2-create-title">Create a project</h2>
              </div>
              <button className="btn" type="button" onClick={() => setShowCreate(false)}>Cancel</button>
            </div>
            <form onSubmit={submitProject}>
              <label htmlFor="v2-project-name">Project name</label>
              <input
                id="v2-project-name"
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Network support acquisition package"
              />
              <label htmlFor="v2-project-description">Purpose and context</label>
              <textarea
                id="v2-project-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Describe the outcome, audience, and important constraints."
                rows={3}
              />

              <fieldset className="v2-mode-picker">
                <legend>Starting point</legend>
                <label className={mode === 'template' ? 'selected' : ''}>
                  <input type="radio" name="v2-mode" checked={mode === 'template'} onChange={() => setMode('template')} />
                  <span><strong>Use DOCX templates</strong><small>Fill structured sections and preserve the source document.</small></span>
                </label>
                <label className={mode === 'freeform' ? 'selected' : ''}>
                  <input type="radio" name="v2-mode" checked={mode === 'freeform'} onChange={() => setMode('freeform')} />
                  <span><strong>Start from a document style</strong><small>Draft a memo, EXSUM, white paper, or other complete document.</small></span>
                </label>
              </fieldset>

              {mode === 'template' ? (
                <div className="v2-template-picker">
                  <div className="v2-picker-label">
                    <span>Templates</span>
                    {onOpenIngest && <button type="button" onClick={onOpenIngest}>Upload a template</button>}
                  </div>
                  {templates === undefined ? (
                    <p>Loading templates…</p>
                  ) : templates.length === 0 ? (
                    <div className="v2-picker-empty">
                      <p>No DOCX templates are available yet.</p>
                      {onOpenIngest && <button className="btn" type="button" onClick={onOpenIngest}>Upload DOCX template</button>}
                    </div>
                  ) : templates.map((template) => (
                    <label key={template.id}>
                      <input
                        type="checkbox"
                        checked={selectedTemplateIds.includes(template.id)}
                        onChange={() => setSelectedTemplateIds((current) =>
                          current.includes(template.id)
                            ? current.filter((id) => id !== template.id)
                            : [...current, template.id],
                        )}
                      />
                      <span>{template.name}<small>{template.schema_json.sections.length} sections · {template.filename}</small></span>
                    </label>
                  ))}
                </div>
              ) : (
                <div className="v2-style-picker">
                  {FREEFORM_CATEGORIES.map((category) => (
                    <div key={category.id}>
                      <h3>{category.label}</h3>
                      <div>
                        {FREEFORM_STYLES.filter((style) => style.category === category.id).map((style) => (
                          <label key={style.id} className={freeformStyle === style.id ? 'selected' : ''}>
                            <input type="radio" name="v2-style" checked={freeformStyle === style.id} onChange={() => setFreeformStyle(style.id)} />
                            <span><strong>{style.name}</strong><small>{style.description}</small></span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="v2-create-submit">
                <button className="btn btn-accent" type="submit" disabled={busy}>
                  {busy ? 'Creating…' : 'Create and open project'}
                </button>
              </div>
            </form>
          </section>
        )}

        <section className="v2-projects" aria-labelledby="v2-projects-title">
          <div className="v2-projects-toolbar">
            <h2 id="v2-projects-title">Recent projects <span>{projects?.length ?? 0}</span></h2>
            <label>
              <span className="sr-only">Search projects</span>
              <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search projects…" />
            </label>
          </div>
          {projects === undefined ? (
            <div className="v2-project-empty" role="status">Loading projects…</div>
          ) : projects.length === 0 ? (
            <div className="v2-project-empty">
              <h3>No projects yet</h3>
              <p>Create a workspace from a DOCX template or choose a freeform document style.</p>
              <button className="btn btn-accent" type="button" onClick={() => setShowCreate(true)}>Create your first project</button>
            </div>
          ) : filteredProjects.length === 0 ? (
            <div className="v2-project-empty">No projects match “{search}”.</div>
          ) : (
            <div className="v2-project-grid">
              {filteredProjects.map((project) => {
                const modeLabel = project.mode === 'freeform'
                  ? getFreeformStyle(project.freeform_style ?? '')?.name ?? 'Freeform'
                  : `${project.template_ids.length} template${project.template_ids.length === 1 ? '' : 's'}`;
                return (
                  <button key={project.id} type="button" className="v2-project-card" onClick={() => openProject(project.id)}>
                    <span className="v2-project-kind">{project.mode === 'freeform' ? 'Freeform' : 'Template project'}</span>
                    <strong>{project.name}</strong>
                    <span className="v2-project-description">{project.description || 'No project description'}</span>
                    <span className="v2-project-meta">{modeLabel} · Updated {new Date(project.updated_at).toLocaleDateString()}</span>
                    <span className="v2-project-open">Open project →</span>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

// Project list + create form. Lets the user create a new project,
// pick which templates to include, name reference datasets, and then
// open the project detail view to fill shared inputs and run drafting.

import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db/schema';
import { createProject } from '../lib/project/helpers';

export function Projects() {
  const projects = useLiveQuery(
    () => db.projects.orderBy('updated_at').reverse().toArray(),
    [],
  );
  const templates = useLiveQuery(() => db.templates.toArray(), []);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<string[]>([]);
  const [datasetNames, setDatasetNames] = useState('');
  const [liveSearch, setLiveSearch] = useState<0 | 1 | 2>(0);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  function toggleTemplate(id: string) {
    setSelectedTemplateIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setCreateError(null);
    if (!name.trim()) {
      setCreateError('Project name is required.');
      return;
    }
    if (selectedTemplateIds.length === 0) {
      setCreateError('Pick at least one template.');
      return;
    }
    setCreating(true);
    try {
      const datasets = datasetNames
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      await createProject({
        name: name.trim(),
        description: description.trim(),
        template_ids: selectedTemplateIds,
        reference_dataset_names: datasets,
        live_search: liveSearch,
      });
      setName('');
      setDescription('');
      setSelectedTemplateIds([]);
      setDatasetNames('');
      setLiveSearch(0);
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
        A project is a set of templates plus shared inputs (CUI banner,
        document number, dates, POC, etc.). Drafting walks each
        template's sections in dependency order, calling Ask Sage with
        per-section prompts and storing the structured output for review
        and export.
      </p>

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

        <label htmlFor="project-desc">Description</label>
        <input
          id="project-desc"
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="One or two sentences about what this project is for"
        />

        <label>Templates ({templates?.length ?? 0} available)</label>
        {(!templates || templates.length === 0) && (
          <p className="note">
            No templates yet. Go to the Templates tab and ingest at least one DOCX first.
          </p>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', maxHeight: 200, overflow: 'auto', border: '1px solid #ddd', padding: '0.5rem' }}>
          {templates?.map((t) => (
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
                {t.schema_json.source.semantic_synthesizer === null && ' · NEEDS SYNTHESIS'}
              </span>
            </label>
          ))}
        </div>

        <label htmlFor="project-datasets">Reference dataset names (comma-separated, optional)</label>
        <input
          id="project-datasets"
          type="text"
          value={datasetNames}
          onChange={(e) => setDatasetNames(e.target.value)}
          placeholder="e.g. far-clauses, dha-issuances, prior-pws"
        />
        <p className="note">
          These are Ask Sage dataset names you've already curated in the Ask Sage
          UI. Drafting passes them as the <code>dataset</code> param so RAG
          injects relevant context. Leave empty if you don't have curated datasets.
          Use the <a href="#/datasets">Datasets</a> tab to verify a name before
          using it.
        </p>

        <label htmlFor="project-live">Web search mode</label>
        <select
          id="project-live"
          value={liveSearch}
          onChange={(e) => setLiveSearch(Number(e.target.value) as 0 | 1 | 2)}
          style={{ width: '100%', padding: '0.5rem', font: 'inherit' }}
        >
          <option value={0}>Disabled (default)</option>
          <option value={1}>Google results — inject web search hits as references</option>
          <option value={2}>Google + crawl — autonomous market research mode</option>
        </select>
        <p className="note">
          Passes Ask Sage's <code>live</code> parameter on every drafting call.
          Mode 2 fetches and crawls Google results in real time and is the
          right choice for market research, contractor capability surveys, and
          any section that needs current outside-document context. Costs more
          tokens per call.
        </p>

        <button type="submit" disabled={creating}>
          {creating ? 'Creating…' : 'Create project'}
        </button>
        {createError && <div className="error">{createError}</div>}
      </form>

      <h2>Existing projects ({projects?.length ?? 0})</h2>
      {(!projects || projects.length === 0) && (
        <p className="note">No projects yet.</p>
      )}
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {projects?.map((p) => (
          <li key={p.id} style={{ padding: '0.5rem 0.75rem', border: '1px solid #ddd', borderRadius: 4, marginBottom: '0.25rem' }}>
            <Link to={`/projects/${p.id}`} style={{ textDecoration: 'none', color: '#1a1a1a' }}>
              <strong>{p.name}</strong>
              <div className="note">
                {p.template_ids.length} template{p.template_ids.length === 1 ? '' : 's'} ·
                {' '}{p.reference_dataset_names.length} reference dataset
                {p.reference_dataset_names.length === 1 ? '' : 's'} ·
                {' '}updated {new Date(p.updated_at).toLocaleString()}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}

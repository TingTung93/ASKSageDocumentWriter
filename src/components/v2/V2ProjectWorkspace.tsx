import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type ProjectRecord, type TemplateRecord } from '../../lib/db/schema';
import { V2SourcesPane } from './V2SourcesPane';
import { V2ChatPane } from './V2ChatPane';
import { V2DraftPane } from './V2DraftPane';
import {
  DraftSelectionProvider,
  useDraftSelection,
} from './drafting/DraftSelectionContext';
import {
  templateSectionSelection,
  type DraftSelectionScope,
} from './drafting/selection';
import { chunkFreeformByH1 } from './helpers';

export function V2ProjectWorkspace() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const project = useLiveQuery(
    async () => (id ? (await db.projects.get(id)) ?? null : null),
    [id],
  );
  const templates = useLiveQuery<TemplateRecord[]>(
    () => project
      ? db.templates.where('id').anyOf(project.template_ids).toArray()
      : Promise.resolve([] as TemplateRecord[]),
    [project?.id, project?.template_ids],
  );

  if (!id) {
    return (
      <div className="workspace-state state-error" role="alert">
        <h2>No project selected</h2>
        <p>Choose a project to open its drafting workspace.</p>
        <button className="btn btn-primary" onClick={() => navigate('/projects')}>Choose a project</button>
      </div>
    );
  }
  if (project === undefined) {
    return (
      <div className="workspace-state state-loading" role="status" aria-live="polite">
        <span className="spinner-small" aria-hidden="true" />
        <div>
          <h2>Opening project</h2>
          <p>Loading the draft, sources, and editing history…</p>
        </div>
      </div>
    );
  }
  if (project === null) {
    return (
      <div className="workspace-state state-error" role="alert">
        <h2>Project not found</h2>
        <p>This project may have been deleted or belongs to another browser profile.</p>
        <button className="btn btn-primary" onClick={() => navigate('/projects')}>
          Back to projects
        </button>
      </div>
    );
  }
  if (templates === undefined) {
    return (
      <div className="workspace-state state-loading" role="status" aria-live="polite">
        <span className="spinner-small" aria-hidden="true" />
        <div>
          <h2>Loading document structure</h2>
          <p>Preparing templates and saved drafts…</p>
        </div>
      </div>
    );
  }

  const scope: DraftSelectionScope = {
    projectId: project.id,
    templates: templates.map((template) => ({
      id: template.id,
      sectionIds: template.schema_json.sections.map((section) => section.id),
    })),
    freeformBlockIds: chunkFreeformByH1(project.freeform_draft ?? []).map((chunk) => chunk.id),
  };

  return (
    <DraftSelectionProvider scope={scope}>
      <WorkspacePanes project={project} templates={templates} />
    </DraftSelectionProvider>
  );
}

function WorkspacePanes({
  project,
  templates,
}: {
  project: ProjectRecord;
  templates: TemplateRecord[];
}) {
  const [supportPane, setSupportPane] = useState<'closed' | 'sources' | 'chat'>('closed');
  const { observeSelection } = useDraftSelection();
  const sectionTargets = useMemo(() => new Map<string, ReturnType<typeof templateSectionSelection>>(
    templates.flatMap((template) => template.schema_json.sections.map((section) => [
      `${template.id}::${section.id}`,
      templateSectionSelection(project.id, template.id, section.id, section.name),
    ] as const)),
  ), [project.id, templates]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.find((entry) => entry.isIntersecting);
        if (!visible) return;
        const element = visible.target as HTMLElement;
        const sectionId = element.dataset.secId;
        const templateId = element.dataset.templateId;
        const key = templateId && sectionId ? `${templateId}::${sectionId}` : null;
        observeSelection(key ? sectionTargets.get(key) ?? null : null);
      },
      { threshold: 0.2 },
    );

    const sections = document.querySelectorAll<HTMLElement>(
      '.doc-section[data-template-id][data-sec-id]',
    );
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [observeSelection, sectionTargets]);

  return (
    <div className={`workspace-stage support-${supportPane}`} data-screen-label="01 Workspace">
      <div className="workspace-pane-tabs" aria-label="Workspace panels">
        <button
          className={supportPane === 'sources' ? 'active' : ''}
          aria-pressed={supportPane === 'sources'}
          onClick={() => setSupportPane((current) => current === 'sources' ? 'closed' : 'sources')}
        >
          Sources
        </button>
        <button
          className={supportPane === 'chat' ? 'active' : ''}
          aria-pressed={supportPane === 'chat'}
          onClick={() => setSupportPane((current) => current === 'chat' ? 'closed' : 'chat')}
        >
          Context notes
        </button>
      </div>
      <div className="panes">
        <V2SourcesPane project={project} />
        <V2ChatPane project={project} />
        <V2DraftPane project={project} />
      </div>
    </div>
  );
}

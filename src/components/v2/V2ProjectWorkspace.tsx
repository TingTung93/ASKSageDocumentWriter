import { useEffect, useMemo } from 'react';
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

  if (!id) return <div>Missing project id</div>;
  if (project === undefined) return <div>Loading project…</div>;
  if (project === null) {
    return (
      <div className="empty-state">
        <h2>Project not found</h2>
        <p>This project may have been deleted or belongs to another browser profile.</p>
        <button className="btn btn-primary" onClick={() => navigate('/projects')}>
          Back to projects
        </button>
      </div>
    );
  }
  if (templates === undefined) return <div>Loading project…</div>;

  const scope: DraftSelectionScope = {
    projectId: project.id,
    templates: templates.map((template) => ({
      id: template.id,
      sectionIds: template.schema_json.sections.map((section) => section.id),
    })),
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
  const { observeSelection } = useDraftSelection();
  const sectionTargets = useMemo(() => new Map(
    templates.flatMap((template) => template.schema_json.sections.map((section) => [
      section.id,
      templateSectionSelection(project.id, template.id, section.id, section.name),
    ] as const)),
  ), [project.id, templates]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.find((entry) => entry.isIntersecting);
        if (!visible) return;
        const sectionId = (visible.target as HTMLElement).dataset.secId;
        observeSelection(sectionId ? sectionTargets.get(sectionId) ?? null : null);
      },
      { threshold: 0.2 },
    );

    const sections = document.querySelectorAll<HTMLElement>('.doc-section[data-sec-id]');
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [observeSelection, sectionTargets]);

  return (
    <div className="panes" data-screen-label="01 Workspace">
      <V2SourcesPane project={project} />
      <V2ChatPane project={project} />
      <V2DraftPane project={project} />
    </div>
  );
}

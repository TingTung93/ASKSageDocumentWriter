import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../lib/db/schema';
import { V2SourcesPane } from './V2SourcesPane';
import { V2ChatPane } from './V2ChatPane';
import { V2DraftPane } from './V2DraftPane';

export function V2ProjectWorkspace() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const project = useLiveQuery(
    async () => (id ? (await db.projects.get(id)) ?? null : null),
    [id],
  );
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.find(e => e.isIntersecting);
        if (visible) {
          setActiveSectionId(visible.target.id.replace('sec-', ''));
        }
      },
      { threshold: 0.2 }
    );

    const sections = document.querySelectorAll('.doc-section');
    sections.forEach(s => observer.observe(s));
    return () => observer.disconnect();
  }, [project]);

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

  return (
    <div className="panes" data-screen-label="01 Workspace">
      <V2SourcesPane project={project} activeSectionId={activeSectionId} />
      <V2ChatPane project={project} />
      <V2DraftPane project={project} />
    </div>
  );
}

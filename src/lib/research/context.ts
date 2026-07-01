import { db, type ProjectContextFile } from '../db/schema';
import type { ResearchPack } from './types';

export async function saveResearchPackToProject(
  projectId: string,
  pack: ResearchPack,
): Promise<ProjectContextFile> {
  const project = await db.projects.get(projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);

  const createdAt = new Date().toISOString();
  const filename = researchPackFilename(pack);
  const bytes = new Blob([pack.markdown], { type: 'text/markdown' });
  const file: ProjectContextFile = {
    kind: 'file',
    id: newId('file'),
    filename,
    mime_type: 'text/markdown',
    size_bytes: bytes.size,
    bytes,
    extracted_text: pack.markdown,
    extracted_at: createdAt,
    created_at: createdAt,
  };

  await db.projects.put({
    ...project,
    research_packs: [...(project.research_packs ?? []), pack],
    context_items: [...(project.context_items ?? []), file],
    updated_at: createdAt,
  });

  return file;
}

function researchPackFilename(pack: ResearchPack): string {
  const date = pack.generated_at.slice(0, 10) || new Date().toISOString().slice(0, 10);
  return `research-pack-${date}.md`;
}

function newId(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e9)}`;
}

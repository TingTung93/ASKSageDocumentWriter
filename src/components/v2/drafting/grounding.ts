import type { ProjectRecord } from '../../../lib/db/schema';
import type { GroundingSourceRef } from '../../../lib/agentic-editing/context/source-scope';

export interface DraftGroundingSource extends GroundingSourceRef {
  promptText?: string;
}

export function projectGroundingSources(project: ProjectRecord): DraftGroundingSource[] {
  const sources: DraftGroundingSource[] = [];
  for (const item of project.context_items ?? []) {
    if (item.kind === 'note') {
      sources.push({
        id: item.id,
        kind: 'project_note',
        label: item.text.slice(0, 48) || 'Project note',
        estimatedCharacters: item.text.length,
        optional: true,
        defaultIncluded: true,
        promptText: item.text,
      });
    } else {
      sources.push({
        id: item.id,
        kind: 'attached_file',
        label: item.filename,
        estimatedCharacters: item.extracted_text?.length ?? item.size_bytes,
        optional: true,
        defaultIncluded: true,
        promptText: item.extracted_text,
      });
    }
  }
  for (const dataset of project.reference_dataset_names) {
    sources.push({
      id: `dataset:${dataset}`,
      kind: 'dataset',
      label: dataset,
      estimatedCharacters: 4_000,
      optional: true,
    });
  }
  for (const pack of project.research_packs ?? []) {
    sources.push({
      id: `research:${pack.id}`,
      kind: 'research_pack',
      label: pack.objective,
      estimatedCharacters: pack.markdown.length,
      optional: true,
      promptText: pack.markdown,
    });
  }
  if (project.live_search) {
    sources.push({
      id: 'live-search',
      kind: 'live_search',
      label: 'Live web search',
      estimatedCharacters: 4_000,
      optional: true,
    });
  }
  return sources;
}

import type { ProjectRecord, DraftRecord, ProjectContextNote } from '../../db/schema';
import type { DraftParagraph } from '../../draft/types';
import type { DraftEditOp } from '../../edit/types';
import type { BodyFillRegion, TemplateSchema } from '../../template/types';
import { sha256 } from '../artifacts';
import {
  validateTemplateSectionProposal,
  type TemplateSectionProposal,
  type TemplateSectionValidation,
} from '../proposal-validation';

export interface SelectedSourceExtract {
  id: string;
  label: string;
  text: string;
}

export interface NeighborSectionSummary {
  sectionId: string;
  name: string;
  summary: string;
}

export interface TemplateSectionSnapshotInput {
  project: ProjectRecord;
  template: TemplateSchema;
  section: BodyFillRegion;
  draft: DraftRecord;
  selectedSources?: SelectedSourceExtract[];
  neighbors?: NeighborSectionSummary[];
  maxContextCharacters?: number;
}

export interface TemplateSectionSnapshot {
  target: {
    kind: 'template_section';
    projectId: string;
    templateId: string;
    sectionId: string;
  };
  project: {
    id: string;
    name: string;
    description: string;
    notes: Array<Pick<ProjectContextNote, 'id' | 'role' | 'text'>>;
  };
  template: {
    id: string;
    name: string;
    version: number;
  };
  section: {
    id: string;
    name: string;
    intent?: string;
    required: boolean;
    targetWords?: [number, number];
    permittedRoles: string[];
    validation?: Record<string, unknown>;
    styleNotes?: string;
  };
  draft: {
    id: string;
    status: DraftRecord['status'];
    paragraphs: DraftParagraph[];
    validationIssues: string[];
  };
  context: {
    sources: SelectedSourceExtract[];
    neighbors: NeighborSectionSummary[];
    includedCharacters: number;
    omitted: Array<{ id: string; reason: 'context_limit' }>;
  };
  baseHash: string;
}

type TargetlessDraftEditOp = DraftEditOp extends infer Operation
  ? Operation extends DraftEditOp
    ? Omit<Operation, 'template_id' | 'section_id'>
    : never
  : never;

/**
 * Captures plain cloned data only. Mutable Dexie records and source blobs never
 * cross the editing-runner boundary.
 */
export async function createTemplateSectionSnapshot(
  input: TemplateSectionSnapshotInput,
): Promise<Readonly<TemplateSectionSnapshot>> {
  assertMatchingIdentity(input);
  const max = input.maxContextCharacters ?? 60_000;
  const bounded = boundContext(input.selectedSources ?? [], input.neighbors ?? [], max);
  const notes = (input.project.context_items ?? [])
    .filter((item): item is ProjectContextNote => item.kind === 'note')
    .map(({ id, role, text }) => ({ id, role, text }));

  const withoutHash: Omit<TemplateSectionSnapshot, 'baseHash'> = {
    target: {
      kind: 'template_section',
      projectId: input.project.id,
      templateId: input.template.id,
      sectionId: input.section.id,
    },
    project: {
      id: input.project.id,
      name: input.project.name,
      description: input.project.description,
      notes,
    },
    template: {
      id: input.template.id,
      name: input.template.name,
      version: input.template.version,
    },
    section: {
      id: input.section.id,
      name: input.section.name,
      ...(input.section.intent ? { intent: input.section.intent } : {}),
      required: input.section.required,
      ...(input.section.target_words ? { targetWords: [...input.section.target_words] } : {}),
      permittedRoles: [...input.section.fill_region.permitted_roles],
      ...(input.section.validation ? { validation: clone(input.section.validation) } : {}),
      ...(input.section.style_notes ? { styleNotes: input.section.style_notes } : {}),
    },
    draft: {
      id: input.draft.id,
      status: input.draft.status,
      paragraphs: clone(input.draft.paragraphs),
      validationIssues: [...(input.draft.validation_issues ?? [])],
    },
    context: bounded,
  };
  const snapshot = {
    ...withoutHash,
    baseHash: await sha256(stableStringify(withoutHash)),
  };
  return deepFreeze(snapshot);
}

export function validateProposalAgainstTemplateSection(
  snapshot: TemplateSectionSnapshot,
  proposal: TemplateSectionProposal,
): TemplateSectionValidation {
  return validateTemplateSectionProposal(snapshot, proposal);
}

export function templateSectionOperation(
  snapshot: TemplateSectionSnapshot,
  operation: TargetlessDraftEditOp,
): DraftEditOp {
  return {
    ...operation,
    template_id: snapshot.target.templateId,
    section_id: snapshot.target.sectionId,
  } as DraftEditOp;
}

function assertMatchingIdentity(input: TemplateSectionSnapshotInput): void {
  if (input.draft.project_id !== input.project.id) {
    throw new Error('Draft does not belong to the selected project.');
  }
  if (input.draft.template_id !== input.template.id) {
    throw new Error('Draft does not belong to the selected template.');
  }
  if (input.draft.section_id !== input.section.id) {
    throw new Error('Draft does not belong to the selected section.');
  }
  if (!input.template.sections.some((section) => section.id === input.section.id)) {
    throw new Error('Selected section is not present in the template.');
  }
}

function boundContext(
  sources: SelectedSourceExtract[],
  neighbors: NeighborSectionSummary[],
  maximum: number,
): TemplateSectionSnapshot['context'] {
  const limit = Math.max(0, maximum);
  let includedCharacters = 0;
  const includedSources: SelectedSourceExtract[] = [];
  const includedNeighbors: NeighborSectionSummary[] = [];
  const omitted: Array<{ id: string; reason: 'context_limit' }> = [];

  for (const entry of [...sources, ...neighbors]) {
    const text = 'text' in entry ? entry.text : entry.summary;
    if (includedCharacters + text.length > limit) {
      omitted.push({ id: 'id' in entry ? entry.id : entry.sectionId, reason: 'context_limit' });
      continue;
    }
    includedCharacters += text.length;
    if ('text' in entry) includedSources.push(clone(entry));
    else includedNeighbors.push(clone(entry));
  }
  return {
    sources: includedSources,
    neighbors: includedNeighbors,
    includedCharacters,
    omitted,
  };
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, nested) => {
    if (!nested || typeof nested !== 'object' || Array.isArray(nested)) return nested;
    return Object.fromEntries(
      Object.entries(nested as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
    );
  });
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  }
  return value;
}

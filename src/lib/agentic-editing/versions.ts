import { db, type DraftRecord, type ProjectRecord } from '../db/schema';
import type { DraftParagraph } from '../draft/types';
import { makeAgentId } from './ids';
import type { DocumentVersionRecord } from './types';

export class StaleVersionError extends Error {
  constructor(
    public readonly expectedVersionId: string | undefined,
    public readonly currentVersionId: string | undefined,
  ) {
    super(
      `Version parent is stale (expected ${expectedVersionId ?? 'no version'}, ` +
      `current ${currentVersionId ?? 'no version'}).`,
    );
    this.name = 'StaleVersionError';
  }
}

export class StaleCanonicalContentError extends Error {
  constructor() {
    super('The canonical draft changed after this proposal was created. Rerun the proposal.');
    this.name = 'StaleCanonicalContentError';
  }
}

export interface CommitTemplateDraftVersionInput {
  draftId: string;
  expectedParentVersionId?: string;
  expectedCanonicalParagraphs?: DraftParagraph[];
  paragraphs: DraftParagraph[];
  sourceTurnId?: string;
  summary: string;
  now?: string;
}

export interface UndoTemplateDraftVersionInput {
  draftId: string;
  expectedParentVersionId: string;
  restoreVersionId: string;
  sourceTurnId?: string;
  summary?: string;
  now?: string;
}

export interface CommitFreeformDraftVersionInput {
  projectId: string;
  expectedParentVersionId?: string;
  expectedCanonicalParagraphs?: DraftParagraph[];
  paragraphs: DraftParagraph[];
  sourceTurnId?: string;
  summary: string;
  now?: string;
}

export interface UndoFreeformDraftVersionInput {
  projectId: string;
  expectedParentVersionId: string;
  restoreVersionId: string;
  sourceTurnId?: string;
  summary?: string;
  now?: string;
}

export interface VersionCommitResult {
  version: DocumentVersionRecord;
  initialVersion?: DocumentVersionRecord;
  draft: DraftRecord;
}

export interface FreeformVersionCommitResult {
  version: DocumentVersionRecord;
  initialVersion?: DocumentVersionRecord;
  project: ProjectRecord & { freeform_draft: DraftParagraph[] };
}

export async function getCurrentAcceptedVersion(
  targetKind: DocumentVersionRecord['target_kind'],
  targetId: string,
): Promise<DocumentVersionRecord | undefined> {
  const versions = await db.document_versions
    .where('target_kind')
    .equals(targetKind)
    .and((row) => row.target_id === targetId && row.status === 'accepted')
    .toArray();
  return findAcceptedLeaf(versions);
}

/**
 * Atomically appends an accepted version and updates the canonical template
 * draft. The first commit lazily records the pre-edit draft as an initial
 * accepted version in the same transaction.
 */
export async function commitTemplateDraftVersion(
  input: CommitTemplateDraftVersionInput,
): Promise<VersionCommitResult> {
  return db.transaction(
    'rw',
    db.drafts,
    db.document_versions,
    db.editing_turns,
    async () => {
      const draft = await requireDraft(input.draftId);
      assertCanonicalContent(input.expectedCanonicalParagraphs, draft.paragraphs);
      const versions = await acceptedVersions('template_draft', input.draftId);
      const current = findAcceptedLeaf(versions);
      assertExpectedParent(input.expectedParentVersionId, current?.id);

      const now = input.now ?? new Date().toISOString();
      let parent = current;
      let initialVersion: DocumentVersionRecord | undefined;
      if (!parent) {
        initialVersion = makeVersion({
          targetId: input.draftId,
          snapshot: draft.paragraphs,
          label: 'Initial draft',
          now,
        });
        await db.document_versions.add(initialVersion);
        parent = initialVersion;
      }

      const version = makeVersion({
        targetId: input.draftId,
        parentVersionId: parent.id,
        sourceTurnId: input.sourceTurnId,
        snapshot: input.paragraphs,
        label: requireSummary(input.summary),
        now,
      });
      const updatedDraft: DraftRecord = {
        ...draft,
        paragraphs: clone(input.paragraphs),
        generated_at: now,
      };
      await db.document_versions.add(version);
      await db.drafts.put(updatedDraft);
      if (input.sourceTurnId) {
        await db.editing_turns.update(input.sourceTurnId, {
          result_version_id: version.id,
          user_decision: 'accepted',
          status: 'completed',
          completed_at: now,
        });
      }
      return {
        version,
        ...(initialVersion ? { initialVersion } : {}),
        draft: updatedDraft,
      };
    },
  );
}

/**
 * Undo is append-only: it restores an earlier snapshot into a new child of the
 * current version. Neither the selected version nor the version being undone
 * is modified or deleted.
 */
export async function undoTemplateDraftVersion(
  input: UndoTemplateDraftVersionInput,
): Promise<VersionCommitResult> {
  return db.transaction(
    'rw',
    db.drafts,
    db.document_versions,
    db.editing_turns,
    async () => {
      const draft = await requireDraft(input.draftId);
      const versions = await acceptedVersions('template_draft', input.draftId);
      const current = findAcceptedLeaf(versions);
      assertExpectedParent(input.expectedParentVersionId, current?.id);
      const restore = versions.find((version) => version.id === input.restoreVersionId);
      if (!restore) throw new Error('Restore version is not an accepted version for this draft.');
      const paragraphs = parseParagraphSnapshot(restore.snapshot_json);
      const now = input.now ?? new Date().toISOString();
      const version = makeVersion({
        targetId: input.draftId,
        parentVersionId: current!.id,
        sourceTurnId: input.sourceTurnId,
        snapshot: paragraphs,
        label: input.summary?.trim() || `Undo to ${restore.label}`,
        now,
      });
      const updatedDraft: DraftRecord = {
        ...draft,
        paragraphs: clone(paragraphs),
        generated_at: now,
      };
      await db.document_versions.add(version);
      await db.drafts.put(updatedDraft);
      if (input.sourceTurnId) {
        await db.editing_turns.update(input.sourceTurnId, {
          result_version_id: version.id,
          user_decision: 'accepted',
          status: 'completed',
          completed_at: now,
        });
      }
      return { version, draft: updatedDraft };
    },
  );
}

/**
 * Atomically appends a freeform document version and updates the project row
 * used by preview and export. The target ID is always ProjectRecord.id.
 */
export async function commitFreeformDraftVersion(
  input: CommitFreeformDraftVersionInput,
): Promise<FreeformVersionCommitResult> {
  return db.transaction(
    'rw',
    db.projects,
    db.document_versions,
    db.editing_turns,
    async () => {
      const project = await requireFreeformProject(input.projectId);
      assertCanonicalContent(input.expectedCanonicalParagraphs, project.freeform_draft);
      const versions = await acceptedVersions('freeform_draft', input.projectId);
      const current = findAcceptedLeaf(versions);
      assertExpectedParent(input.expectedParentVersionId, current?.id);
      const now = input.now ?? new Date().toISOString();
      let parent = current;
      let initialVersion: DocumentVersionRecord | undefined;
      if (!parent) {
        initialVersion = makeFreeformVersion({
          projectId: input.projectId,
          snapshot: project.freeform_draft,
          label: 'Initial draft',
          now,
        });
        await db.document_versions.add(initialVersion);
        parent = initialVersion;
      }
      const version = makeFreeformVersion({
        projectId: input.projectId,
        parentVersionId: parent.id,
        sourceTurnId: input.sourceTurnId,
        snapshot: input.paragraphs,
        label: requireSummary(input.summary),
        now,
      });
      const updatedProject = {
        ...project,
        freeform_draft: clone(input.paragraphs),
        freeform_draft_generated_at: now,
        updated_at: now,
      };
      await db.document_versions.add(version);
      await db.projects.put(updatedProject);
      await completeSourceTurn(input.sourceTurnId, version.id, now);
      return {
        version,
        ...(initialVersion ? { initialVersion } : {}),
        project: updatedProject,
      };
    },
  );
}

export async function undoFreeformDraftVersion(
  input: UndoFreeformDraftVersionInput,
): Promise<FreeformVersionCommitResult> {
  return db.transaction(
    'rw',
    db.projects,
    db.document_versions,
    db.editing_turns,
    async () => {
      const project = await requireFreeformProject(input.projectId);
      const versions = await acceptedVersions('freeform_draft', input.projectId);
      const current = findAcceptedLeaf(versions);
      assertExpectedParent(input.expectedParentVersionId, current?.id);
      const restore = versions.find((version) => version.id === input.restoreVersionId);
      if (!restore) {
        throw new Error('Restore version is not an accepted version for this freeform draft.');
      }
      const paragraphs = parseParagraphSnapshot(restore.snapshot_json);
      const now = input.now ?? new Date().toISOString();
      const version = makeFreeformVersion({
        projectId: input.projectId,
        parentVersionId: current!.id,
        sourceTurnId: input.sourceTurnId,
        snapshot: paragraphs,
        label: input.summary?.trim() || `Undo to ${restore.label}`,
        now,
      });
      const updatedProject = {
        ...project,
        freeform_draft: clone(paragraphs),
        freeform_draft_generated_at: now,
        updated_at: now,
      };
      await db.document_versions.add(version);
      await db.projects.put(updatedProject);
      await completeSourceTurn(input.sourceTurnId, version.id, now);
      return { version, project: updatedProject };
    },
  );
}

export async function listAcceptedVersionLineage(
  targetKind: DocumentVersionRecord['target_kind'],
  targetId: string,
): Promise<DocumentVersionRecord[]> {
  const versions = await acceptedVersions(targetKind, targetId);
  const byId = new Map(versions.map((version) => [version.id, version]));
  const lineage: DocumentVersionRecord[] = [];
  let cursor = findAcceptedLeaf(versions);
  while (cursor) {
    lineage.push(cursor);
    cursor = cursor.parent_version_id ? byId.get(cursor.parent_version_id) : undefined;
  }
  return lineage.reverse();
}

function makeVersion(input: {
  targetId: string;
  parentVersionId?: string;
  sourceTurnId?: string;
  snapshot: DraftParagraph[];
  label: string;
  now: string;
}): DocumentVersionRecord {
  return {
    id: makeAgentId('version'),
    target_kind: 'template_draft',
    target_id: input.targetId,
    ...(input.parentVersionId ? { parent_version_id: input.parentVersionId } : {}),
    ...(input.sourceTurnId ? { source_turn_id: input.sourceTurnId } : {}),
    label: input.label,
    status: 'accepted',
    snapshot_json: JSON.stringify(clone(input.snapshot)),
    created_at: input.now,
  };
}

function makeFreeformVersion(input: {
  projectId: string;
  parentVersionId?: string;
  sourceTurnId?: string;
  snapshot: DraftParagraph[];
  label: string;
  now: string;
}): DocumentVersionRecord {
  return {
    id: makeAgentId('version'),
    target_kind: 'freeform_draft',
    target_id: input.projectId,
    ...(input.parentVersionId ? { parent_version_id: input.parentVersionId } : {}),
    ...(input.sourceTurnId ? { source_turn_id: input.sourceTurnId } : {}),
    label: input.label,
    status: 'accepted',
    snapshot_json: JSON.stringify(clone(input.snapshot)),
    created_at: input.now,
  };
}

async function acceptedVersions(
  targetKind: DocumentVersionRecord['target_kind'],
  targetId: string,
): Promise<DocumentVersionRecord[]> {
  return db.document_versions
    .where('target_kind')
    .equals(targetKind)
    .and((row) => row.target_id === targetId && row.status === 'accepted')
    .toArray();
}

function findAcceptedLeaf(
  versions: DocumentVersionRecord[],
): DocumentVersionRecord | undefined {
  if (!versions.length) return undefined;
  const parentIds = new Set(
    versions.flatMap((version) => version.parent_version_id ? [version.parent_version_id] : []),
  );
  const leaves = versions.filter((version) => !parentIds.has(version.id));
  if (leaves.length !== 1) {
    throw new Error(`Version lineage has ${leaves.length} current accepted versions.`);
  }
  return leaves[0];
}

function assertExpectedParent(expected: string | undefined, current: string | undefined): void {
  if (expected !== current) throw new StaleVersionError(expected, current);
}

function assertCanonicalContent(
  expected: DraftParagraph[] | undefined,
  current: DraftParagraph[],
): void {
  if (expected !== undefined && JSON.stringify(expected) !== JSON.stringify(current)) {
    throw new StaleCanonicalContentError();
  }
}

async function requireDraft(id: string): Promise<DraftRecord> {
  const draft = await db.drafts.get(id);
  if (!draft) throw new Error(`Draft "${id}" was not found.`);
  return draft;
}

async function requireFreeformProject(id: string) {
  const project = await db.projects.get(id);
  if (!project) throw new Error(`Project "${id}" was not found.`);
  if ((project.mode ?? 'template') !== 'freeform' || !project.freeform_draft) {
    throw new Error(`Project "${id}" does not contain a freeform draft.`);
  }
  return project as typeof project & { freeform_draft: DraftParagraph[] };
}

async function completeSourceTurn(
  sourceTurnId: string | undefined,
  versionId: string,
  now: string,
): Promise<void> {
  if (!sourceTurnId) return;
  await db.editing_turns.update(sourceTurnId, {
    result_version_id: versionId,
    user_decision: 'accepted',
    status: 'completed',
    completed_at: now,
  });
}

function parseParagraphSnapshot(value: string): DraftParagraph[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('Version snapshot is not valid JSON.');
  }
  if (!Array.isArray(parsed) || parsed.some((paragraph) =>
    !paragraph || typeof paragraph !== 'object' ||
    typeof (paragraph as { role?: unknown }).role !== 'string' ||
    typeof (paragraph as { text?: unknown }).text !== 'string'
  )) {
    throw new Error('Version snapshot is not a valid draft paragraph array.');
  }
  return clone(parsed as DraftParagraph[]);
}

function requireSummary(value: string): string {
  const summary = value.trim();
  if (!summary) throw new Error('Version summary is required.');
  return summary;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

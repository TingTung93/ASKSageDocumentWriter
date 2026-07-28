import { beforeEach, describe, expect, it } from 'vitest';
import { db, type ProjectRecord } from '../db/schema';
import { paragraphsToMarkdown } from '../freeform/drafter';
import {
  commitFreeformDraftVersion,
  getCurrentAcceptedVersion,
  listAcceptedVersionLineage,
  StaleVersionError,
  undoFreeformDraftVersion,
} from './versions';

const project: ProjectRecord = {
  id: 'freeform-project',
  name: 'Paper',
  description: 'A paper',
  mode: 'freeform',
  freeform_style: 'white_paper',
  freeform_draft: [
    { role: 'heading', level: 0, text: 'Overview' },
    { role: 'body', text: 'Original body.' },
  ],
  template_ids: [],
  reference_dataset_names: [],
  shared_inputs: {},
  model_overrides: {},
  live_search: 0,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

describe('freeform immutable version lineage', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
    await db.projects.add(structuredClone(project));
  });

  it('atomically creates initial and accepted versions using project ID as target', async () => {
    const result = await commitFreeformDraftVersion({
      projectId: project.id,
      paragraphs: [
        { role: 'heading', level: 0, text: 'Overview' },
        { role: 'body', text: 'Accepted body.' },
      ],
      summary: 'Clarify overview',
      now: '2026-01-02T00:00:00.000Z',
    });
    expect(result.initialVersion).toMatchObject({
      target_kind: 'freeform_draft',
      target_id: project.id,
      status: 'accepted',
    });
    expect(result.version.parent_version_id).toBe(result.initialVersion!.id);
    expect((await db.projects.get(project.id))?.freeform_draft?.[1]?.text)
      .toBe('Accepted body.');
  });

  it('rejects stale commits without changing project or lineage', async () => {
    const first = await commitFreeformDraftVersion({
      projectId: project.id,
      paragraphs: [{ role: 'body', text: 'First.' }],
      summary: 'First',
    });
    await expect(commitFreeformDraftVersion({
      projectId: project.id,
      expectedParentVersionId: first.initialVersion!.id,
      paragraphs: [{ role: 'body', text: 'Stale.' }],
      summary: 'Stale',
    })).rejects.toBeInstanceOf(StaleVersionError);
    expect((await db.projects.get(project.id))?.freeform_draft?.[0]?.text).toBe('First.');
    expect(await db.document_versions.count()).toBe(2);
  });

  it('survives reload and exports only the accepted canonical project snapshot', async () => {
    const accepted = await commitFreeformDraftVersion({
      projectId: project.id,
      paragraphs: [
        { role: 'heading', level: 0, text: 'Overview' },
        { role: 'body', text: 'Durable accepted body.' },
      ],
      summary: 'Durable edit',
    });
    await db.close();
    await db.open();
    const reloaded = await db.projects.get(project.id);
    expect(paragraphsToMarkdown(reloaded!.freeform_draft!)).toContain('Durable accepted body.');
    expect((await getCurrentAcceptedVersion('freeform_draft', project.id))?.id)
      .toBe(accepted.version.id);
  });

  it('undoes into a new child and immediately changes export-facing content', async () => {
    const accepted = await commitFreeformDraftVersion({
      projectId: project.id,
      paragraphs: [
        { role: 'heading', level: 0, text: 'Overview' },
        { role: 'body', text: 'Accepted body.' },
      ],
      summary: 'Accept',
    });
    const undo = await undoFreeformDraftVersion({
      projectId: project.id,
      expectedParentVersionId: accepted.version.id,
      restoreVersionId: accepted.initialVersion!.id,
      now: '2026-01-03T00:00:00.000Z',
    });
    const canonical = await db.projects.get(project.id);
    const exported = paragraphsToMarkdown(canonical!.freeform_draft!);
    expect(exported).toContain('Original body.');
    expect(exported).not.toContain('Accepted body.');
    expect(undo.version.parent_version_id).toBe(accepted.version.id);
    expect(await listAcceptedVersionLineage('freeform_draft', project.id)).toHaveLength(3);
    expect(await db.document_versions.count()).toBe(3);
  });

  it('rolls back history when the freeform project is missing', async () => {
    await db.projects.delete(project.id);
    await expect(commitFreeformDraftVersion({
      projectId: project.id,
      paragraphs: [{ role: 'body', text: 'Missing.' }],
      summary: 'Missing',
    })).rejects.toThrow(/not found/i);
    expect(await db.document_versions.count()).toBe(0);
  });
});

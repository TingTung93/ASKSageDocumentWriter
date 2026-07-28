import { beforeEach, describe, expect, it } from 'vitest';
import { db, type DraftRecord } from '../db/schema';
import {
  commitTemplateDraftVersion,
  getCurrentAcceptedVersion,
  listAcceptedVersionLineage,
  StaleVersionError,
  undoTemplateDraftVersion,
} from './versions';

const draft: DraftRecord = {
  id: 'project::template::section',
  project_id: 'project',
  template_id: 'template',
  section_id: 'section',
  paragraphs: [{ role: 'body', text: 'Original text.' }],
  references: '',
  status: 'ready',
  generated_at: '2026-01-01T00:00:00.000Z',
  model: 'test',
  tokens_in: 1,
  tokens_out: 1,
};

describe('immutable draft version lineage', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
    await db.drafts.add(structuredClone(draft));
  });

  it('lazily creates the initial version and atomically accepts an edit', async () => {
    const result = await commitTemplateDraftVersion({
      draftId: draft.id,
      paragraphs: [{ role: 'body', text: 'Accepted text.' }],
      summary: 'Clarify purpose',
      now: '2026-01-02T00:00:00.000Z',
    });
    expect(result.initialVersion).toMatchObject({
      target_kind: 'template_draft',
      target_id: draft.id,
      label: 'Initial draft',
      status: 'accepted',
    });
    expect(result.version.parent_version_id).toBe(result.initialVersion!.id);
    expect((await db.drafts.get(draft.id))?.paragraphs[0]?.text).toBe('Accepted text.');
    expect(await listAcceptedVersionLineage('template_draft', draft.id)).toHaveLength(2);
  });

  it('rejects a stale parent without changing draft or history', async () => {
    const first = await commitTemplateDraftVersion({
      draftId: draft.id,
      paragraphs: [{ role: 'body', text: 'First accepted.' }],
      summary: 'First',
    });
    await expect(commitTemplateDraftVersion({
      draftId: draft.id,
      expectedParentVersionId: first.initialVersion!.id,
      paragraphs: [{ role: 'body', text: 'Stale overwrite.' }],
      summary: 'Stale',
    })).rejects.toBeInstanceOf(StaleVersionError);
    expect((await db.drafts.get(draft.id))?.paragraphs[0]?.text).toBe('First accepted.');
    expect(await db.document_versions.count()).toBe(2);
  });

  it('requires the current parent after the initial commit', async () => {
    const first = await commitTemplateDraftVersion({
      draftId: draft.id,
      paragraphs: [{ role: 'body', text: 'First accepted.' }],
      summary: 'First',
    });
    const second = await commitTemplateDraftVersion({
      draftId: draft.id,
      expectedParentVersionId: first.version.id,
      paragraphs: [{ role: 'body', text: 'Second accepted.' }],
      summary: 'Second',
    });
    expect(second.version.parent_version_id).toBe(first.version.id);
    expect((await getCurrentAcceptedVersion('template_draft', draft.id))?.id)
      .toBe(second.version.id);
  });

  it('undoes by appending a child with the prior exact content', async () => {
    const first = await commitTemplateDraftVersion({
      draftId: draft.id,
      paragraphs: [{ role: 'body', text: 'First accepted.' }],
      summary: 'First',
    });
    const second = await commitTemplateDraftVersion({
      draftId: draft.id,
      expectedParentVersionId: first.version.id,
      paragraphs: [{ role: 'body', text: 'Second accepted.' }],
      summary: 'Second',
    });
    const undo = await undoTemplateDraftVersion({
      draftId: draft.id,
      expectedParentVersionId: second.version.id,
      restoreVersionId: first.version.id,
      now: '2026-01-04T00:00:00.000Z',
    });
    expect(undo.version.parent_version_id).toBe(second.version.id);
    expect(JSON.parse(undo.version.snapshot_json)).toEqual([
      { role: 'body', text: 'First accepted.' },
    ]);
    expect((await db.drafts.get(draft.id))?.paragraphs[0]?.text).toBe('First accepted.');
    expect(await db.document_versions.count()).toBe(4);
    expect(await listAcceptedVersionLineage('template_draft', draft.id)).toHaveLength(4);
  });

  it('supports repeated undo without deleting prior history', async () => {
    const accepted = await commitTemplateDraftVersion({
      draftId: draft.id,
      paragraphs: [{ role: 'body', text: 'Accepted.' }],
      summary: 'Accept',
    });
    const firstUndo = await undoTemplateDraftVersion({
      draftId: draft.id,
      expectedParentVersionId: accepted.version.id,
      restoreVersionId: accepted.initialVersion!.id,
    });
    await undoTemplateDraftVersion({
      draftId: draft.id,
      expectedParentVersionId: firstUndo.version.id,
      restoreVersionId: accepted.version.id,
    });
    expect((await db.drafts.get(draft.id))?.paragraphs[0]?.text).toBe('Accepted.');
    expect(await db.document_versions.count()).toBe(4);
  });

  it('rolls back the version when the canonical draft is missing', async () => {
    await db.drafts.delete(draft.id);
    await expect(commitTemplateDraftVersion({
      draftId: draft.id,
      paragraphs: [{ role: 'body', text: 'No target.' }],
      summary: 'Missing',
    })).rejects.toThrow(/not found/i);
    expect(await db.document_versions.count()).toBe(0);
  });
});

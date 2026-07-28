import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { DocWriterDb } from './schema';

const databaseNames: string[] = [];

afterEach(async () => {
  await Promise.all(databaseNames.splice(0).map((name) => Dexie.delete(name)));
});

describe('IndexedDB project compatibility', () => {
  it('opens a version-8 project without changing its durable data', async () => {
    const name = `asksage-schema-upgrade-${crypto.randomUUID()}`;
    databaseNames.push(name);
    const legacy = new Dexie(name);
    legacy.version(8).stores({
      templates: 'id, name, ingested_at',
      projects: 'id, name, updated_at',
      drafts: 'id, [project_id+template_id+section_id], project_id, generated_at',
      documents: 'id, name, ingested_at',
      audit: '++id, ts, endpoint, ok',
      settings: 'id',
      recipe_runs: 'id, project_id, recipe_id, started_at, status',
    });
    const project = {
      id: 'existing-project',
      name: 'Existing synthetic project',
      description: 'Created before durable editing sessions were added.',
      template_ids: ['existing-template'],
      reference_dataset_names: ['synthetic-references'],
      shared_inputs: { office_symbol: 'TEST-00' },
      model_overrides: { drafting: 'synthetic-model' },
      live_search: 0,
      context_items: [],
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-02T00:00:00.000Z',
    };
    const draft = {
      id: 'existing-project:existing-template:scope',
      project_id: 'existing-project',
      template_id: 'existing-template',
      section_id: 'scope',
      paragraphs: [{ role: 'body', text: 'Previously drafted synthetic content.' }],
      generated_at: '2026-01-02T00:00:00.000Z',
    };

    await legacy.open();
    await legacy.table('projects').put(project);
    await legacy.table('drafts').put(draft);
    legacy.close();

    const current = new DocWriterDb(name);
    await current.open();

    expect(await current.projects.get(project.id)).toEqual(project);
    expect(await current.drafts.get(draft.id)).toEqual(draft);
    expect(current.verno).toBe(9);
    expect(current.editing_sessions).toBeDefined();
    expect(current.document_versions).toBeDefined();

    current.close();
  });
});

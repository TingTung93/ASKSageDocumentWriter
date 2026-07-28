import type { Page } from '@playwright/test';

export interface SyntheticProject {
  id: string;
  name: string;
}

export async function seedProject(page: Page, project: SyntheticProject): Promise<void> {
  await page.evaluate(async (seed) => {
    const request = indexedDB.open('asksage-doc-writer');
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction('projects', 'readwrite');
    transaction.objectStore('projects').put({
      id: seed.id,
      name: seed.name,
      description: 'Synthetic browser-test project',
      mode: 'template',
      template_ids: [],
      reference_dataset_names: [],
      shared_inputs: {},
      model_overrides: {},
      live_search: 0,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    });
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  }, project);
}

export async function configureSyntheticLocalProvider(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const baseUrl = 'http://127.0.0.1:9999/v1';
    sessionStorage.setItem('asksage:provider', 'local_openai');
    sessionStorage.setItem('asksage:baseUrl', baseUrl);
    sessionStorage.setItem('asksage:models', JSON.stringify([{
      id: 'synthetic-model',
      name: 'Synthetic model',
      object: 'model',
      owned_by: 'browser-test',
      created: '0',
      capabilities: { json_output: true, tool_calling: false },
    }]));
    sessionStorage.setItem('asksage:localProbe', JSON.stringify({
      ok: true,
      baseUrl,
      model: 'synthetic-model',
      capabilities: {
        models: true,
        chat: true,
        tools: false,
        jsonOutput: true,
        embeddings: false,
      },
      warnings: [],
    }));
    sessionStorage.setItem('asksage:v2:first-run-dismissed', '1');
  });
}

export async function seedPausedFreeformRun(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const request = indexedDB.open('asksage-doc-writer');
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const now = '2026-01-01T00:00:00.000Z';
    const transaction = database.transaction(['projects', 'recipe_runs'], 'readwrite');
    transaction.objectStore('projects').put({
      id: 'lifecycle-project',
      name: 'Lifecycle project',
      description: 'Create a concise synthetic executive summary.',
      mode: 'freeform',
      freeform_style: 'exsum',
      template_ids: [],
      reference_dataset_names: [],
      shared_inputs: {},
      model_overrides: { drafting: 'synthetic-model' },
      live_search: 0,
      created_at: now,
      updated_at: now,
    });
    transaction.objectStore('recipe_runs').put({
      id: 'lifecycle-project::freeform-document::2026-01-01T00:00:00.000Z',
      project_id: 'lifecycle-project',
      recipe_id: 'freeform-document',
      recipe_name: 'Auto-draft · Lifecycle project',
      started_at: now,
      status: 'paused',
      stage_states: {
        'extract-references': {
          status: 'needs_intervention',
          started_at: now,
          completed_at: now,
          output: { file_extracts: {} },
        },
        'draft-freeform-document': { status: 'pending' },
      },
      total_tokens_in: 0,
      total_tokens_out: 0,
    });
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  });
}

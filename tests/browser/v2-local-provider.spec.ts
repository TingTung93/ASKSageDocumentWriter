import { expect, test } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

test.skip(
  process.env.V2_REAL_LOCAL_PROVIDER !== '1',
  'Set V2_REAL_LOCAL_PROVIDER=1 with Ollama qwen3:0.6b available.',
);

test('real local provider connects and drafts through the production V2 workflow', async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => {
    const baseUrl = 'http://127.0.0.1:11434/v1';
    sessionStorage.setItem('asksage:provider', 'local_openai');
    sessionStorage.setItem('asksage:baseUrl', baseUrl);
    sessionStorage.setItem('asksage:models', JSON.stringify([{
      id: 'qwen3:0.6b',
      name: 'qwen3:0.6b',
      object: 'model',
      owned_by: 'ollama',
      created: '0',
      capabilities: { json_output: true, tool_calling: true },
    }]));
    sessionStorage.setItem('asksage:localProbe', JSON.stringify({
      ok: true,
      baseUrl,
      model: 'qwen3:0.6b',
      capabilities: {
        models: true,
        chat: true,
        tools: true,
        jsonOutput: true,
        embeddings: false,
      },
      warnings: [],
    }));
    sessionStorage.setItem('asksage:v2:first-run-dismissed', '1');
  });

  const artifact = pathToFileURL(resolve('release/index.html')).href;
  await page.goto(`${artifact}#/v2/real-local-provider-project`);
  await expect(page.getByRole('heading', { name: 'Project not found' })).toBeVisible();
  await page.evaluate(async () => {
    const request = indexedDB.open('asksage-doc-writer');
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const now = new Date().toISOString();
    const transaction = database.transaction(['projects', 'settings'], 'readwrite');
    transaction.objectStore('projects').put({
      id: 'real-local-provider-project',
      name: 'Real local provider smoke',
      description: 'Write a very short executive summary confirming local drafting works.',
      mode: 'freeform',
      freeform_style: 'exsum',
      template_ids: [],
      reference_dataset_names: [],
      shared_inputs: {},
      model_overrides: { drafting: 'qwen3:0.6b' },
      live_search: 0,
      created_at: now,
      updated_at: now,
    });
    transaction.objectStore('settings').put({
      id: 'app',
      models: {
        synthesis: 'qwen3:0.6b',
        drafting: 'qwen3:0.6b',
        critic: 'qwen3:0.6b',
        cleanup: 'qwen3:0.6b',
        schema_edit: 'qwen3:0.6b',
      },
      updated_at: now,
    });
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  });
  await page.reload();

  await expect(page.getByText('127.0.0.1:11434')).toBeVisible();
  await page.getByRole('button', { name: /Auto-draft/ }).click();
  await expect(page.locator('.draft-status.done')).toContainText('Executive Summary', {
    timeout: 150_000,
  });
  await expect(page.locator('.doc-section').first()).toBeVisible();
});

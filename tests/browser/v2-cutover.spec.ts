import { expect, test } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import {
  configureSyntheticLocalProvider,
  seedPausedFreeformRun,
  seedProject,
} from './helpers';

test('opening the artifact enters the V2 home and creates a project', async ({ page }) => {
  await page.goto('/#/');
  await expect(page).toHaveURL(/#\/v2$/);
  await expect(page.getByRole('heading', { name: 'What are you working on?' })).toBeVisible();

  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Browser-created project');
  await page.getByLabel('Purpose and context').fill('Synthetic cutover browser coverage.');
  await page.getByText('Start from a document style').click();
  await page.locator('input[name="v2-style"]').first().check();
  await page.getByRole('button', { name: 'Create and open project' }).click();

  await expect(page).toHaveURL(/#\/v2\/[^/?]+$/);
  await expect(page.getByText('Browser-created project', { exact: true }).first()).toBeVisible();
});

test('legacy project link replaces history with the V2 workspace', async ({ page }) => {
  await page.goto('/#/projects/browser-project');
  await expect(page).toHaveURL(/#\/v2\/browser-project$/);
  await expect(page.getByRole('heading', { name: 'Project not found' })).toBeVisible();
});

test('historical Documents URL opens the workflow inside V2 chrome', async ({ page }) => {
  await page.goto('/#/documents');
  await expect(page).toHaveURL(/#\/v2\?view=documents$/);
  await expect(page.getByRole('heading', { name: 'Documents — review & polish' })).toBeVisible();
  await expect(page.getByText('document co-writer')).toBeVisible();

  const surface = page.locator('.v2-classic-surface');
  await expect(surface).toHaveCSS('overflow-y', 'auto');
  await expect(surface).toHaveCSS('min-height', '0px');
  await expect.poll(() => surface.evaluate((element) => {
    const filler = document.createElement('div');
    filler.dataset.scrollProbe = 'true';
    filler.style.height = '2000px';
    element.appendChild(filler);
    element.scrollTop = 500;
    const result = {
      scrollTop: element.scrollTop,
      boundedToViewport: element.getBoundingClientRect().bottom <= window.innerHeight,
    };
    filler.remove();
    element.scrollTop = 0;
    return result;
  })).toMatchObject({
    scrollTop: 500,
    boundedToViewport: true,
  });
});

test('embedded V2 views participate in browser Back and Forward history', async ({ page }) => {
  await page.goto('/#/v2');
  await expect(page.getByRole('heading', { name: 'What are you working on?' })).toBeVisible();

  await page.getByRole('button', { name: 'Library' }).click();
  await expect(page).toHaveURL(/#\/v2\?view=library$/);
  await expect(page.getByRole('heading', { name: 'Templates & sources' })).toBeVisible();

  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page).toHaveURL(/#\/v2\?view=settings$/);
  await expect(page.getByRole('heading', { name: 'Connection & models' })).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/#\/v2\?view=library$/);
  await expect(page.getByRole('heading', { name: 'Templates & sources' })).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/#\/v2$/);
  await expect(page.getByRole('heading', { name: 'What are you working on?' })).toBeVisible();

  await page.goForward();
  await expect(page).toHaveURL(/#\/v2\?view=library$/);
  await expect(page.getByRole('heading', { name: 'Templates & sources' })).toBeVisible();

  await page.goForward();
  await expect(page).toHaveURL(/#\/v2\?view=settings$/);
  await expect(page.getByRole('heading', { name: 'Connection & models' })).toBeVisible();
});

for (const width of [480, 360]) {
  test(`V2 embedded surfaces remain viewport-contained at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 760 });
    for (const route of [
      '/#/v2',
      '/#/v2?view=library',
      '/#/v2?view=audit',
      '/#/v2?view=settings',
      '/#/v2?view=documents',
    ]) {
      await page.goto(route);
      await expect.poll(() => page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }))).toEqual({ clientWidth: width, scrollWidth: width });
    }
  });
}

test('a registered DOCX template appears in the V2 library immediately', async ({ page }) => {
  await page.goto('/#/v2?view=library');
  await expect(page.getByRole('button', { name: /Templates \(0\)/ })).toBeVisible();

  await page.getByRole('button', { name: 'Upload DOCX template' }).click();
  await page.locator('input[type="file"]').setInputFiles('src/test/fixtures/synthetic-memo.docx');
  await expect(page.getByText('Detected structure')).toBeVisible();
  await page.getByRole('button', { name: 'Register template' }).click();

  await expect(page.getByRole('button', { name: /Templates \(1\)/ })).toBeVisible();
  await expect(page.locator('.lib-card:not(.new)')).toHaveCount(1);
});

test('a seeded project opens directly through the production V2 route', async ({ page }) => {
  await page.goto('/#/v2/browser-project');
  await expect(page.getByRole('heading', { name: 'Project not found' })).toBeVisible();
  await seedProject(page, { id: 'browser-project', name: 'Browser Fixture' });
  await page.reload();
  await expect(page.getByText('Browser Fixture', { exact: true }).first()).toBeVisible();
});

test('the single-file artifact boots from file:// with hash routing', async ({ page }) => {
  const artifact = pathToFileURL(resolve('release/index.html')).href;
  await page.goto(`${artifact}#/v2/missing-file-project`);
  await expect(page.getByRole('heading', { name: 'Project not found' })).toBeVisible();
});

test('paused run resumes once, produces a reviewable edit, accepts, and exports', async ({ page }) => {
  await configureSyntheticLocalProvider(page);
  let providerCalls = 0;
  await page.route('http://127.0.0.1:9999/v1/chat/completions', async (route) => {
    providerCalls += 1;
    const body = route.request().postDataJSON() as {
      messages?: Array<{ content?: string }>;
    };
    const prompt = (body.messages ?? []).map((message) => message.content ?? '').join('\n');
    let content: string;
    if (prompt.includes('auditable document-editing planner')) {
      content = JSON.stringify({
        summary: 'Tighten the purpose',
        scope: { sectionIds: ['purpose'], paragraphIds: ['1'], broadDocumentChange: false },
        steps: ['Replace the selected paragraph'],
        requiredContext: [],
        risks: [],
      });
    } else if (prompt.includes('auditable document editor')) {
      const selectedIndex = Number(
        prompt.match(/"targetSelection":\{"kind":"freeform_paragraph"[^}]*"index":(\d+)/)?.[1] ?? 1,
      );
      content = JSON.stringify({
        summary: 'Tightened purpose wording',
        operations: [{
          target: 'draft_paragraphs',
          operation: {
            op: 'replace_paragraph',
            template_id: 'freeform',
            section_id: 'purpose',
            index: selectedIndex,
            text: 'Accepted lifecycle wording.',
          },
        }],
        criterionCoverage: [],
        evidence: [],
        assumptions: [],
        unresolvedQuestions: [],
      });
    } else if (prompt.includes('strict independent reviewer')) {
      content = JSON.stringify({
        verdict: 'repair',
        score: 75,
        criteria: [],
        unsupportedClaims: [],
        structuralRisks: [],
        styleIssues: [],
        repairInstructions: ['Confirm the concise wording before accepting.'],
      });
    } else {
      content = [
        '# Purpose',
        'Original lifecycle wording.',
        '# Key Findings',
        '- The synthetic provider was called once after resume.',
        '# References',
        'No external sources.',
      ].join('\n');
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: `synthetic-${providerCalls}`,
        choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
      }),
    });
  });

  await page.goto('/#/v2/lifecycle-project');
  await expect(page.getByRole('heading', { name: 'Project not found' })).toBeVisible();
  await seedPausedFreeformRun(page);
  await page.reload();

  await expect(page.getByRole('button', { name: /Resume drafting/ })).toBeVisible();
  await page.getByRole('button', { name: /Resume drafting/ }).click();
  await expect(page.getByText('Original lifecycle wording.')).toBeVisible();
  expect(providerCalls).toBe(1);

  await page.locator('.doc-section .sec-num > span').first().click();
  await page.getByLabel('Custom editing instruction').fill('Tighten the purpose.');
  await page.getByRole('button', { name: 'Preview change' }).click();
  await expect(page.getByRole('region', { name: 'Proposed draft change' }))
    .toContainText('Accepted lifecycle wording.');
  await expect(page.getByText(/Review recommended before accepting/)).toBeVisible();
  await expect(page.getByText(/Confirm the concise wording/)).toBeVisible();
  expect(providerCalls).toBe(4);

  await page.getByRole('button', { name: /Accept proposal/ }).click();
  await expect(page.getByText('Accepted lifecycle wording.', { exact: true }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByText('Accepted lifecycle wording.', { exact: true }).first()).toBeVisible();
  expect(providerCalls).toBe(4);

  await page.getByRole('button', { name: /Export/, exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Export to Word' })).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download Word document' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('lifecycle_project.docx');
});

# Ask Sage Research Pack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Ask Sage live-search research workflow that saves cited research packs and attaches them as reusable project reference documents.

**Architecture:** Keep research isolated under `src/lib/research/*`, then add a small panel to `ProjectDetail`. The runner uses the existing `LLMClient.queryJson` surface with `live: 2`; persistence stores `ProjectRecord.research_packs` and a generated Markdown `ProjectContextFile` with cached `extracted_text`.

**Tech Stack:** React 18, TypeScript, Dexie, Vitest, existing Ask Sage provider abstraction.

---

## File Structure

- Create `src/lib/research/types.ts`: `ResearchPack`, `ResearchFinding`, `ResearchCitation`, request/result types.
- Create `src/lib/research/citations.ts`: URL extraction, URL normalization, citation dedupe, validation.
- Create `src/lib/research/citations.test.ts`: unit tests for citation behavior.
- Create `src/lib/research/asksage.ts`: prompt construction and `runAskSageResearch`.
- Create `src/lib/research/asksage.test.ts`: verifies request shape and returned pack normalization.
- Create `src/lib/research/context.ts`: save packs and attach generated Markdown context files.
- Create `src/lib/research/context.test.ts`: verifies project persistence and generated file fields.
- Modify `src/lib/db/schema.ts`: add optional `research_packs?: import('../research/types').ResearchPack[]` to `ProjectRecord`.
- Modify `src/routes/ProjectDetail.tsx`: add panel, state, run handler, pack rendering.
- Modify or create `src/routes/ProjectDetail.test.tsx`: render helper-level UI tests if existing route mocks are practical; otherwise export/test pure helpers from the research panel.
- Rebuild `release/index.html` through `npm run build`.

### Task 1: Research Types and Citation Utilities

**Files:**
- Create: `src/lib/research/types.ts`
- Create: `src/lib/research/citations.ts`
- Test: `src/lib/research/citations.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { dedupeCitations, extractUrls, validateResearchPack } from './citations';
import type { ResearchPack } from './types';

describe('research citations', () => {
  it('extracts URLs and strips trailing punctuation', () => {
    expect(extractUrls('See https://example.mil/report, and https://site.gov/a).')).toEqual([
      'https://example.mil/report',
      'https://site.gov/a',
    ]);
  });

  it('deduplicates citations by normalized URL', () => {
    const out = dedupeCitations([
      { id: 'a', title: 'A', url: 'https://EXAMPLE.mil/report/', source_type: 'model_cited' },
      { id: 'b', title: 'B', url: 'https://example.mil/report', source_type: 'ask_sage_reference' },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ title: 'A', url: 'https://example.mil/report/' });
  });

  it('flags findings without matching citations', () => {
    const pack: ResearchPack = {
      id: 'research_1',
      objective: 'Assess market',
      depth: 'quick',
      generated_at: '2026-07-01T00:00:00.000Z',
      query_plan: ['market search'],
      findings: [{ id: 'finding_1', text: 'Fact', citation_ids: [] }],
      citations: [],
      gaps: [],
      markdown: '# Research Pack',
    };
    expect(validateResearchPack(pack)).toEqual({
      finding_count: 1,
      citation_count: 0,
      uncited_finding_ids: ['finding_1'],
    });
  });
});
```

- [ ] **Step 2: Run test and verify failure**

Run: `npm test -- src/lib/research/citations.test.ts`

Expected: fails because `src/lib/research/*` does not exist.

- [ ] **Step 3: Implement minimal utilities**

Create `types.ts` with `ResearchDepth = 'quick' | 'standard' | 'deep'`, `ResearchCitation`, `ResearchFinding`, `ResearchPack`, `ResearchValidation`, and request types. Create `citations.ts` with `extractUrls`, `normalizeCitationUrl`, `dedupeCitations`, and `validateResearchPack`.

- [ ] **Step 4: Run test and verify pass**

Run: `npm test -- src/lib/research/citations.test.ts`

Expected: all citation tests pass.

### Task 2: Ask Sage Research Runner

**Files:**
- Create: `src/lib/research/asksage.ts`
- Test: `src/lib/research/asksage.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it, vi } from 'vitest';
import { buildResearchPrompt, runAskSageResearch } from './asksage';
import type { LLMClient } from '../provider/types';

describe('Ask Sage research runner', () => {
  it('builds a prompt that requires citations and Markdown', () => {
    const prompt = buildResearchPrompt({
      project_name: 'Cyber project',
      project_description: 'Assess current zero trust guidance.',
      objective: 'Find current guidance',
      focus_questions: 'What changed recently?',
      depth: 'standard',
    });
    expect(prompt).toContain('Return strict JSON');
    expect(prompt).toContain('citation_ids');
    expect(prompt).toContain('Markdown reference pack');
  });

  it('uses Ask Sage live crawl mode and dataset none', async () => {
    const client = {
      capabilities: { fileUpload: true, dataset: true, liveSearch: true },
      queryJson: vi.fn().mockResolvedValue({
        data: {
          query_plan: ['zero trust guidance'],
          findings: [{ text: 'OMB guidance exists', citation_ids: ['c1'] }],
          citations: [{ title: 'OMB', url: 'https://www.whitehouse.gov/omb/', source_type: 'web_result' }],
          gaps: ['Confirm agency-specific policy'],
          markdown: '# Research Pack\n\nFinding.',
        },
        raw: { response: '{}', references: 'https://www.whitehouse.gov/omb/', model: 'm', usage: { prompt_tokens: 1, completion_tokens: 2 } },
      }),
      getModels: vi.fn(),
      query: vi.fn(),
    } as unknown as LLMClient;

    const result = await runAskSageResearch(client, {
      project_name: 'Cyber project',
      project_description: 'Assess current zero trust guidance.',
      objective: 'Find current guidance',
      focus_questions: '',
      depth: 'quick',
      model: 'google-claude-46-sonnet',
    });

    expect(client.queryJson).toHaveBeenCalledWith(expect.objectContaining({
      dataset: 'none',
      live: 2,
      limit_references: 10,
      model: 'google-claude-46-sonnet',
    }));
    expect(result.pack.citations[0].url).toBe('https://www.whitehouse.gov/omb/');
    expect(result.tokens_in).toBe(1);
    expect(result.tokens_out).toBe(2);
  });
});
```

- [ ] **Step 2: Run test and verify failure**

Run: `npm test -- src/lib/research/asksage.test.ts`

Expected: fails because `asksage.ts` does not exist.

- [ ] **Step 3: Implement runner**

Implement `buildResearchPrompt(input)` and `runAskSageResearch(client, input)`. Throw `Research requires a provider with live web search support.` when `client.capabilities.liveSearch` is false. Use `queryJson<ResearchModelOutput>` and normalize missing ids. Extract additional URLs from raw references and Markdown into citation records with `source_type: 'ask_sage_reference'` or `source_type: 'model_cited'`.

- [ ] **Step 4: Run test and verify pass**

Run: `npm test -- src/lib/research/asksage.test.ts`

Expected: Ask Sage runner tests pass.

### Task 3: Save Pack and Attach Generated Reference File

**Files:**
- Modify: `src/lib/db/schema.ts`
- Create: `src/lib/research/context.ts`
- Test: `src/lib/research/context.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { db, type ProjectRecord } from '../db/schema';
import { saveResearchPackToProject } from './context';
import type { ResearchPack } from './types';

const ts = '2026-07-01T00:00:00.000Z';

function project(): ProjectRecord {
  return {
    id: 'p1',
    name: 'Research Project',
    description: 'desc',
    template_ids: [],
    reference_dataset_names: [],
    shared_inputs: {},
    model_overrides: {},
    live_search: 2,
    context_items: [],
    created_at: ts,
    updated_at: ts,
  };
}

describe('saveResearchPackToProject', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
    await db.projects.put(project());
  });

  it('stores the pack and attaches Markdown as an extracted context file', async () => {
    const pack: ResearchPack = {
      id: 'research_abc',
      objective: 'Research current guidance',
      depth: 'standard',
      generated_at: ts,
      query_plan: ['guidance'],
      findings: [],
      citations: [],
      gaps: [],
      markdown: '# Research Pack\n\nUseful content.',
    };

    const saved = await saveResearchPackToProject('p1', pack);
    const updated = await db.projects.get('p1');

    expect(saved.filename).toBe('research-pack-2026-07-01.md');
    expect(updated?.research_packs).toHaveLength(1);
    expect(updated?.context_items?.[0]).toMatchObject({
      kind: 'file',
      filename: 'research-pack-2026-07-01.md',
      mime_type: 'text/markdown',
      extracted_text: pack.markdown,
    });
  });
});
```

- [ ] **Step 2: Run test and verify failure**

Run: `npm test -- src/lib/research/context.test.ts`

Expected: fails because `saveResearchPackToProject` and schema field are missing.

- [ ] **Step 3: Implement persistence**

Add `research_packs?: import('../research/types').ResearchPack[]` to `ProjectRecord`. Implement `saveResearchPackToProject(projectId, pack)` to append the pack and append a `ProjectContextFile` with `bytes: new Blob([pack.markdown], { type: 'text/markdown' })`, `size_bytes: pack.markdown.length`, `extracted_text: pack.markdown`, `extracted_at: new Date().toISOString()`.

- [ ] **Step 4: Run test and verify pass**

Run: `npm test -- src/lib/research/context.test.ts`

Expected: context persistence tests pass.

### Task 4: Project Detail Research Panel

**Files:**
- Modify: `src/routes/ProjectDetail.tsx`
- Create or modify: `src/routes/ProjectDetail.test.tsx`

- [ ] **Step 1: Write failing tests**

Add tests for exported helpers from `ProjectDetail.tsx` if full route rendering is too heavy:

```ts
import { describe, expect, it } from 'vitest';
import { researchDepthLabel, researchPackHasUncitedFindings } from './ProjectDetail';

describe('ProjectDetail research helpers', () => {
  it('labels research depth options', () => {
    expect(researchDepthLabel('quick')).toContain('Quick');
    expect(researchDepthLabel('standard')).toContain('Standard');
    expect(researchDepthLabel('deep')).toContain('Deep');
  });

  it('detects uncited findings', () => {
    expect(researchPackHasUncitedFindings({
      id: 'r1',
      objective: 'obj',
      depth: 'quick',
      generated_at: '2026-07-01T00:00:00.000Z',
      query_plan: [],
      findings: [{ id: 'f1', text: 'Fact', citation_ids: [] }],
      citations: [],
      gaps: [],
      markdown: '# Research',
    })).toBe(true);
  });
});
```

- [ ] **Step 2: Run test and verify failure**

Run: `npm test -- src/routes/ProjectDetail.test.tsx`

Expected: fails because helpers are not exported.

- [ ] **Step 3: Implement UI**

In `ProjectDetail`, add `ResearchPanel` above `ProjectContextSection`. The panel manages objective, focus questions, depth, loading, and error state. Disable the button when no API key or `createLLMClient(...).capabilities.liveSearch` is false. On run, call `runAskSageResearch`, then `saveResearchPackToProject`, then toast success with citation count. Render previous packs from `project.research_packs ?? []`, including citations as links and a warning from `researchPackHasUncitedFindings`.

- [ ] **Step 4: Run test and verify pass**

Run: `npm test -- src/routes/ProjectDetail.test.tsx`

Expected: helper or component tests pass.

### Task 5: Full Verification, Build Artifact, Commit, Push

**Files:**
- Modify generated bundle: `release/index.html`

- [ ] **Step 1: Run targeted research tests**

Run: `npm test -- src/lib/research/citations.test.ts src/lib/research/asksage.test.ts src/lib/research/context.test.ts src/routes/ProjectDetail.test.tsx`

Expected: all targeted tests pass.

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`

Expected: TypeScript exits 0.

- [ ] **Step 3: Run full suite**

Run: `npm test`

Expected: full Vitest suite exits 0.

- [ ] **Step 4: Build release artifact**

Run: `npm run build`

Expected: Vite build exits 0 and updates `release/index.html`.

- [ ] **Step 5: Inspect changes**

Run: `git diff --stat` and `git diff -- src/lib/research src/lib/db/schema.ts src/routes/ProjectDetail.tsx`

Expected: changes match this plan and no unrelated files are modified except generated release output.

- [ ] **Step 6: Commit and push**

Run:

```bash
git add docs/superpowers/plans/2026-07-01-asksage-research-pack.md src/lib/research src/lib/db/schema.ts src/routes/ProjectDetail.tsx src/routes/ProjectDetail.test.tsx release/index.html
git commit -m "feat: add Ask Sage research packs"
git push
```

Expected: commit is created on `main` and pushed to `origin/main`.

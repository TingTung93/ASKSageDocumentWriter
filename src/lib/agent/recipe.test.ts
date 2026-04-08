// Tests for the Phase 5b recipe runner state machine.
//
// These tests exercise the runner ITSELF — stage walking, intervention
// pauses, resume, cancellation, persistence, token roll-up, and provider
// lock — not the PWS recipe or any real Phase 2-5a module. Every stage
// is a synthetic mock that returns a pre-programmed RecipeStageResult.
//
// Persistence is mocked in-process via a stub `recipe_runs` table on
// the global `db` object. The real Dexie v7 bump lives in the
// integrator's schema delta; the runner degrades gracefully when the
// table is absent and these tests add one so load/cancel/list calls
// return real data.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  runRecipe,
  resumeRecipeRun,
  cancelRecipeRun,
  loadRecipeRun,
  loadRecipeRunsForProject,
  registerRecipe,
  __clearRecipeRegistry,
  type Recipe,
  type RecipeStage,
  type RecipeStageResult,
  type RecipeRun,
} from './recipe';
import { db } from '../db/schema';
import type { ProjectRecord, TemplateRecord } from '../db/schema';

// ─── In-memory recipe_runs table stub ────────────────────────────

class InMemoryRecipeRunsTable {
  private rows = new Map<string, RecipeRun>();

  async put(record: RecipeRun): Promise<void> {
    // Deep clone so the runner mutating its local object doesn't
    // retroactively change "persisted" state.
    this.rows.set(record.id, JSON.parse(JSON.stringify(record)));
  }
  async get(id: string): Promise<RecipeRun | undefined> {
    const row = this.rows.get(id);
    return row ? JSON.parse(JSON.stringify(row)) : undefined;
  }
  async toArray(): Promise<RecipeRun[]> {
    return Array.from(this.rows.values()).map((r) => JSON.parse(JSON.stringify(r)));
  }
  where(_field: string) {
    return {
      equals: (value: string) => ({
        toArray: async (): Promise<RecipeRun[]> => {
          const all = await this.toArray();
          return all.filter((r) => r.project_id === value);
        },
      }),
    };
  }
  clear() {
    this.rows.clear();
  }
}

let recipeRunsTable: InMemoryRecipeRunsTable;

beforeEach(() => {
  recipeRunsTable = new InMemoryRecipeRunsTable();
  (db as unknown as { recipe_runs: InMemoryRecipeRunsTable }).recipe_runs = recipeRunsTable;
  __clearRecipeRegistry();
});

// ─── Mock Ask Sage client ────────────────────────────────────────

class MockAskSageClient {
  async uploadFile(): Promise<unknown> {
    return { ret: [] };
  }
  async query(): Promise<unknown> {
    return {};
  }
  async queryJson<T>(): Promise<{ data: T; raw: unknown }> {
    return { data: {} as T, raw: {} };
  }
}

// Bare client that lacks `uploadFile` — used to exercise the provider lock.
class MockOpenRouterClient {
  async query(): Promise<unknown> {
    return {};
  }
  async queryJson<T>(): Promise<{ data: T; raw: unknown }> {
    return { data: {} as T, raw: {} };
  }
}

function fakeClient(): MockAskSageClient {
  return new MockAskSageClient();
}

// ─── Test fixtures ───────────────────────────────────────────────

function fakeProject(): ProjectRecord {
  return {
    id: 'proj_test',
    name: 'Test project',
    description: 'a test project',
    template_ids: [],
    reference_dataset_names: [],
    shared_inputs: {},
    model_overrides: {},
    live_search: 0,
    created_at: '2026-04-07T00:00:00Z',
    updated_at: '2026-04-07T00:00:00Z',
  };
}

function makeStage(
  id: string,
  result: RecipeStageResult,
  opts: { intervention_point?: boolean } = {},
): RecipeStage {
  return {
    id,
    name: `Stage ${id}`,
    description: `test stage ${id}`,
    required: true,
    intervention_point: opts.intervention_point ?? false,
    run: vi.fn(async () => result),
  };
}

function makeRecipe(stages: RecipeStage[], id = 'test-recipe'): Recipe {
  return {
    id,
    name: 'Test recipe',
    description: 'test',
    applies_to: [],
    required_provider: 'asksage',
    estimated_tokens_in: 0,
    estimated_tokens_out: 0,
    stages,
  };
}

// ─── Tests ───────────────────────────────────────────────────────

describe('recipe runner', () => {
  it('runs a 3-stage recipe to completion when all stages return ok', async () => {
    const s1 = makeStage('s1', { kind: 'ok', output: 'a' });
    const s2 = makeStage('s2', { kind: 'ok', output: 'b' });
    const s3 = makeStage('s3', { kind: 'ok', output: 'c' });
    const recipe = makeRecipe([s1, s2, s3]);

    const run = await runRecipe({
      client: fakeClient() as never,
      project: fakeProject(),
      templates: [],
      recipe,
    });

    expect(run.status).toBe('completed');
    expect(run.stage_states.s1.status).toBe('completed');
    expect(run.stage_states.s2.status).toBe('completed');
    expect(run.stage_states.s3.status).toBe('completed');
    expect(run.stage_states.s1.output).toBe('a');
    expect(run.stage_states.s3.output).toBe('c');
    expect(run.completed_at).toBeTruthy();
  });

  it('pauses when a stage returns needs_intervention', async () => {
    const s1 = makeStage('s1', { kind: 'ok', output: 'a' });
    const s2 = makeStage(
      's2',
      { kind: 'needs_intervention', reason: 'check me', output: { foo: 1 } },
      { intervention_point: true },
    );
    const s3 = makeStage('s3', { kind: 'ok', output: 'c' });
    const recipe = makeRecipe([s1, s2, s3]);

    const run = await runRecipe({
      client: fakeClient() as never,
      project: fakeProject(),
      templates: [],
      recipe,
    });

    expect(run.status).toBe('paused');
    expect(run.stage_states.s1.status).toBe('completed');
    expect(run.stage_states.s2.status).toBe('needs_intervention');
    expect(run.stage_states.s2.output).toEqual({ foo: 1 });
    // s3 never ran
    expect(run.stage_states.s3.status).toBe('pending');
    expect(s3.run).not.toHaveBeenCalled();
    expect(run.completed_at).toBeUndefined();
  });

  it('resumeRecipeRun continues from the stage AFTER the paused one', async () => {
    const s1 = makeStage('s1', { kind: 'ok', output: 'a' });
    const s2 = makeStage(
      's2',
      { kind: 'needs_intervention', reason: 'r', output: 'b' },
      { intervention_point: true },
    );
    const s3 = makeStage('s3', { kind: 'ok', output: 'c' });
    const recipe = makeRecipe([s1, s2, s3]);
    registerRecipe(recipe);

    const paused = await runRecipe({
      client: fakeClient() as never,
      project: fakeProject(),
      templates: [],
      recipe,
    });
    expect(paused.status).toBe('paused');

    const resumed = await resumeRecipeRun({
      client: fakeClient() as never,
      project: fakeProject(),
      templates: [],
      run_id: paused.id,
    });

    expect(resumed.status).toBe('completed');
    expect(resumed.stage_states.s2.status).toBe('completed');
    expect(resumed.stage_states.s3.status).toBe('completed');
    // s1 and s2 must not have run again.
    expect(s1.run).toHaveBeenCalledTimes(1);
    expect(s2.run).toHaveBeenCalledTimes(1);
    expect(s3.run).toHaveBeenCalledTimes(1);
  });

  it('catches a thrown stage and records it as failed', async () => {
    const s1 = makeStage('s1', { kind: 'ok', output: null });
    const s2: RecipeStage = {
      id: 's2',
      name: 's2',
      description: '',
      required: true,
      intervention_point: false,
      run: async () => {
        throw new Error('boom');
      },
    };
    const s3 = makeStage('s3', { kind: 'ok', output: null });
    const recipe = makeRecipe([s1, s2, s3]);

    const onError = vi.fn();
    const run = await runRecipe({
      client: fakeClient() as never,
      project: fakeProject(),
      templates: [],
      recipe,
      callbacks: { onError },
    });

    expect(run.status).toBe('failed');
    expect(run.stage_states.s2.status).toBe('failed');
    expect(run.stage_states.s2.error).toBe('boom');
    expect(run.stage_states.s3.status).toBe('pending');
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('persists the run to Dexie and loadRecipeRun retrieves it', async () => {
    const recipe = makeRecipe([makeStage('s1', { kind: 'ok', output: 1 })]);
    const run = await runRecipe({
      client: fakeClient() as never,
      project: fakeProject(),
      templates: [],
      recipe,
    });
    const loaded = await loadRecipeRun(run.id);
    expect(loaded).toBeDefined();
    expect(loaded!.id).toBe(run.id);
    expect(loaded!.status).toBe('completed');
    expect(loaded!.stage_states.s1.status).toBe('completed');
  });

  it('cancelRecipeRun marks the run as cancelled', async () => {
    const s1 = makeStage('s1', { kind: 'ok', output: 1 });
    const s2 = makeStage(
      's2',
      { kind: 'needs_intervention', reason: 'r', output: 2 },
      { intervention_point: true },
    );
    const recipe = makeRecipe([s1, s2]);
    const paused = await runRecipe({
      client: fakeClient() as never,
      project: fakeProject(),
      templates: [],
      recipe,
    });
    expect(paused.status).toBe('paused');

    await cancelRecipeRun(paused.id);
    const loaded = await loadRecipeRun(paused.id);
    expect(loaded!.status).toBe('cancelled');
    expect(loaded!.completed_at).toBeTruthy();
  });

  it('loadRecipeRunsForProject returns runs newest-first', async () => {
    const project = fakeProject();
    const recipe = makeRecipe([makeStage('s1', { kind: 'ok', output: 0 })]);

    const run1 = await runRecipe({
      client: fakeClient() as never,
      project,
      templates: [],
      recipe,
    });
    // Force a later timestamp for the second run.
    await new Promise((r) => setTimeout(r, 5));
    const run2 = await runRecipe({
      client: fakeClient() as never,
      project,
      templates: [],
      recipe: { ...recipe, id: 'test-recipe-2' },
    });

    const all = await loadRecipeRunsForProject(project.id);
    expect(all.length).toBe(2);
    // Newest first: run2 should precede run1.
    expect(all[0]!.id).toBe(run2.id);
    expect(all[1]!.id).toBe(run1.id);
  });

  it('rolls up tokens across stages into the run totals', async () => {
    const s1 = makeStage('s1', {
      kind: 'ok',
      output: null,
      tokens_in: 100,
      tokens_out: 50,
    });
    const s2 = makeStage('s2', {
      kind: 'ok',
      output: null,
      tokens_in: 200,
      tokens_out: 75,
    });
    const s3 = makeStage('s3', {
      kind: 'ok',
      output: null,
      tokens_in: 50,
      tokens_out: 25,
    });
    const recipe = makeRecipe([s1, s2, s3]);

    const run = await runRecipe({
      client: fakeClient() as never,
      project: fakeProject(),
      templates: [],
      recipe,
    });

    expect(run.total_tokens_in).toBe(350);
    expect(run.total_tokens_out).toBe(150);
    expect(run.stage_states.s2.tokens_in).toBe(200);
    expect(run.stage_states.s2.tokens_out).toBe(75);
  });

  it('rejects a recipe whose required_provider does not match the client', async () => {
    const recipe = makeRecipe([makeStage('s1', { kind: 'ok', output: 0 })]);
    recipe.required_provider = 'asksage';
    const badClient = new MockOpenRouterClient();

    await expect(
      runRecipe({
        client: badClient as never,
        project: fakeProject(),
        templates: [] as TemplateRecord[],
        recipe,
      }),
    ).rejects.toThrow(/requires provider "asksage"/);
  });

  it('fires onStageStart / onStageComplete / onRunComplete callbacks in order', async () => {
    const s1 = makeStage('s1', { kind: 'ok', output: 1 });
    const s2 = makeStage('s2', { kind: 'ok', output: 2 });
    const recipe = makeRecipe([s1, s2]);

    const events: string[] = [];
    await runRecipe({
      client: fakeClient() as never,
      project: fakeProject(),
      templates: [],
      recipe,
      callbacks: {
        onStageStart: (s) => events.push(`start:${s.id}`),
        onStageComplete: (s) => events.push(`complete:${s.id}`),
        onRunComplete: () => events.push('runComplete'),
      },
    });

    expect(events).toEqual([
      'start:s1',
      'complete:s1',
      'start:s2',
      'complete:s2',
      'runComplete',
    ]);
  });
});

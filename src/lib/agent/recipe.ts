// recipe.ts — Phase 5b recipe runner state machine.
//
// A "recipe" is a deterministic, named workflow that composes the
// existing agentic primitives (Phase 2 pre-flight, Phase 3 per-section
// critic loop, Phase 4 cross-section review, Phase 5a DOCX assembly)
// into an end-to-end pipeline that produces a finished document from
// a project + templates + references.
//
// This module provides the ORCHESTRATION LAYER only — it doesn't know
// anything about PWS vs J&A vs market research. Concrete recipes live
// in ./recipes/ and are plain data: an ordered list of RecipeStage
// objects each carrying a `run` function that delegates to the right
// phase module.
//
// Design notes:
//
//   - Stop/ask policy is PRE-FLIGHT ONLY (decision B). The runner
//     pauses exactly once — between the pre-flight stage and the
//     drafting stage — and only if that stage returned
//     `needs_intervention`. Once drafting begins, the runner does NOT
//     pause again until completion or failure. This keeps the UX
//     predictable (a single "approve and go" gate).
//
//   - Recipes are PROVIDER-LOCKED. A recipe declares `required_provider`
//     and the runner refuses to start if the supplied client doesn't
//     match. CUI work pins to 'asksage'; the check is a cheap guard
//     against the user accidentally pointing a non-CUI client at a
//     CUI-bound recipe.
//
//   - Every run is persisted to Dexie (table `recipe_runs`, added in a
//     proposed v7 bump). The runner checkpoints after every stage
//     transition so a mid-run refresh doesn't lose state. If the
//     `recipe_runs` table isn't available at runtime (tests, pre-bump
//     environment) persistence is a no-op and the runner still works
//     — the caller just can't resume across reloads.
//
//   - Stages are IDEMPOTENT by contract. Resume simply re-enters the
//     next stage after the pause point; prior stage outputs are read
//     from the persisted `stage_states`.
//
//   - Stages return one of three results: `ok`, `needs_intervention`
//     (pauses the run), or `failed` (aborts the run). Unexpected
//     throws from a stage are caught by the runner and converted to
//     `failed` so a buggy stage can't leave a run half-written.

import type { LLMClient } from '../provider/types';
import type { ProjectRecord, TemplateRecord } from '../db/schema';
import { db } from '../db/schema';
import { type UsageByModel, emptyUsage, mergeUsage } from '../usage';

// ─── Public types ────────────────────────────────────────────────

/** A recipe is a named, ordered sequence of stages with metadata. */
export interface Recipe {
  /** Stable id, kebab-case. */
  id: string;
  /** Display name. */
  name: string;
  /** Free-form description for the UI. */
  description: string;
  /** Document categories this recipe applies to (used for template suggestion). */
  applies_to: string[];
  /** Provider this recipe requires. CUI work pins to 'asksage'. */
  required_provider: 'asksage' | 'openrouter' | 'any';
  /** Rough token estimate for budget enforcement. Sum across all stages. */
  estimated_tokens_in: number;
  estimated_tokens_out: number;
  /** Ordered list of stages. Runner walks them in order. */
  stages: RecipeStage[];
}

export interface RecipeStage {
  /** Stable id within the recipe, kebab-case. */
  id: string;
  /** Display name shown in the progress UI. */
  name: string;
  /** One-line description of what the stage does. */
  description: string;
  /** True if the stage MUST run for the recipe to produce a usable result. */
  required: boolean;
  /**
   * When set, the runner pauses AFTER this stage and surfaces the
   * stage's output to the UI for user confirmation. The user clicks
   * "continue" to advance, or "cancel" to abort.
   */
  intervention_point: boolean;
  /**
   * The stage function. Receives the run context and returns either
   * a success result, a "needs intervention" pause, or an error.
   * Stages must be idempotent — the runner may re-execute on resume.
   */
  run: (ctx: RecipeRunContext) => Promise<RecipeStageResult>;
}

export interface RecipeRunContext {
  client: LLMClient;
  project: ProjectRecord;
  templates: TemplateRecord[];
  /** Snapshot of state from prior stages, keyed by stage id. */
  state: Record<string, unknown>;
  /** Per-stage callbacks the runner forwards from the caller. */
  callbacks?: RecipeRunCallbacks;
}

export type RecipeStageResult =
  | {
      kind: 'ok';
      output: unknown;
      tokens_in?: number;
      tokens_out?: number;
      /** Per-model usage breakdown for THIS stage. Optional for stages
       *  that don't make LLM calls (e.g. assemble-docx). */
      usage_by_model?: UsageByModel;
    }
  | {
      kind: 'needs_intervention';
      reason: string;
      output: unknown;
      tokens_in?: number;
      tokens_out?: number;
      usage_by_model?: UsageByModel;
    }
  | {
      kind: 'failed';
      error: string;
      tokens_in?: number;
      tokens_out?: number;
      usage_by_model?: UsageByModel;
    };

export interface RecipeRunCallbacks {
  onStageStart?: (stage: RecipeStage, index: number, total: number) => void;
  onStageComplete?: (stage: RecipeStage, result: RecipeStageResult) => void;
  onStageProgress?: (
    stage: RecipeStage,
    message: string,
    progress?: { done: number; total: number },
  ) => void;
  onRunComplete?: (run: RecipeRun) => void;
  onError?: (stage: RecipeStage, error: Error) => void;
}

/** Persisted state of a single recipe run. Stored in Dexie. */
export interface RecipeRun {
  /** Composite id: `${project_id}::${recipe_id}::${started_at}`. */
  id: string;
  project_id: string;
  recipe_id: string;
  recipe_name: string;
  started_at: string;
  completed_at?: string;
  /** Status of the run as a whole. */
  status: 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  /** Per-stage status snapshots, keyed by stage id. */
  stage_states: Record<string, RecipeStageState>;
  /** Total tokens consumed across all stages. */
  total_tokens_in: number;
  total_tokens_out: number;
  /**
   * Per-model usage breakdown across every LLM call in the run.
   * Used by the cost rollup in lib/usage.computeRunCost so the UI
   * can apply each model's pricing instead of assuming everything
   * ran on the drafting model. Optional on disk so old persisted
   * runs deserialize without a migration; the runner treats absence
   * as `{}` and the UI hides the per-model panel.
   */
  usage_by_model?: UsageByModel;
}

export interface RecipeStageState {
  status:
    | 'pending'
    | 'running'
    | 'completed'
    | 'needs_intervention'
    | 'failed'
    | 'skipped';
  started_at?: string;
  completed_at?: string;
  /** Output of the stage. Type depends on the stage. Stored verbatim for UI rendering. */
  output?: unknown;
  /** Error message if status === 'failed'. */
  error?: string;
  /** Tokens consumed in this stage. */
  tokens_in?: number;
  tokens_out?: number;
  /** Per-model usage breakdown for this stage. */
  usage_by_model?: UsageByModel;
}

// ─── Dexie persistence shim ──────────────────────────────────────
//
// The `recipe_runs` table is added in a schema v7 bump (see the
// recipe.ts final report). Until the integrator applies that bump,
// `db.recipe_runs` may be undefined. All persistence calls route
// through this helper so missing-table environments (tests, pre-bump)
// don't crash the runner — they just become no-ops and return
// undefined for reads.

interface RecipeRunsTable {
  put(record: RecipeRun): Promise<unknown>;
  get(id: string): Promise<RecipeRun | undefined>;
  toArray(): Promise<RecipeRun[]>;
  where?: (k: string) => {
    equals: (v: string) => { toArray: () => Promise<RecipeRun[]> };
  };
}

function getRecipeRunsTable(): RecipeRunsTable | undefined {
  const table = (db as unknown as { recipe_runs?: RecipeRunsTable }).recipe_runs;
  if (!table) return undefined;
  return table;
}

async function persistRun(run: RecipeRun): Promise<void> {
  const table = getRecipeRunsTable();
  if (!table) return;
  try {
    await table.put(run);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[recipe runner] failed to persist run:', err);
  }
}

// ─── Provider lock ───────────────────────────────────────────────
//
// Recipes declare a `required_provider` so a CUI-bound recipe can
// refuse to run on a non-CUI client. We branch on the client's
// declared `capabilities` instead of `instanceof` checks: an
// AskSageClient advertises fileUpload + dataset + liveSearch; an
// OpenRouterClient advertises none. The capability surface is more
// honest than the class identity (a future provider could implement
// /server/file without being AskSageClient).

function clientSatisfiesProvider(
  client: LLMClient,
  required: Recipe['required_provider'],
): boolean {
  if (required === 'any') return true;
  // Ask-Sage-locked recipes need the full feature set: server-side
  // file extraction AND dataset RAG. A recipe that only needs one of
  // these should declare 'any' and branch internally on capabilities.
  if (required === 'asksage') {
    return client.capabilities.fileUpload && client.capabilities.dataset;
  }
  if (required === 'openrouter') {
    // Openrouter-locked recipe: refuse anything that exposes Ask-Sage-
    // only features. Currently no shipped recipe pins to openrouter;
    // this branch exists so the lock surface stays symmetric.
    return !client.capabilities.fileUpload && !client.capabilities.dataset;
  }
  return false;
}

// ─── Run construction helpers ────────────────────────────────────

function makeRunId(projectId: string, recipeId: string, startedAt: string): string {
  return `${projectId}::${recipeId}::${startedAt}`;
}

function initStageStates(stages: RecipeStage[]): Record<string, RecipeStageState> {
  const out: Record<string, RecipeStageState> = {};
  for (const s of stages) out[s.id] = { status: 'pending' };
  return out;
}

function collectStateSnapshot(run: RecipeRun): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [id, st] of Object.entries(run.stage_states)) {
    if (st.status === 'completed' || st.status === 'needs_intervention') {
      out[id] = st.output;
    }
  }
  return out;
}

// ─── Core walker ─────────────────────────────────────────────────
//
// Shared by runRecipe() and resumeRecipeRun(). Walks `stages` starting
// at `startIndex`, checkpointing the run after each stage transition.
// Returns when the run reaches a terminal status OR pauses for
// intervention.

async function walkStages(args: {
  client: LLMClient;
  project: ProjectRecord;
  templates: TemplateRecord[];
  stages: RecipeStage[];
  startIndex: number;
  run: RecipeRun;
  callbacks?: RecipeRunCallbacks;
}): Promise<RecipeRun> {
  const { client, project, templates, stages, startIndex, callbacks } = args;
  const run = args.run;
  const total = stages.length;

  run.status = 'running';
  await persistRun(run);

  for (let i = startIndex; i < stages.length; i++) {
    const stage = stages[i]!;
    const state = run.stage_states[stage.id] ?? { status: 'pending' };
    state.status = 'running';
    state.started_at = new Date().toISOString();
    run.stage_states[stage.id] = state;
    await persistRun(run);

    callbacks?.onStageStart?.(stage, i, total);

    let result: RecipeStageResult;
    try {
      result = await stage.run({
        client,
        project,
        templates,
        state: collectStateSnapshot(run),
        callbacks,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result = { kind: 'failed', error: msg };
      callbacks?.onError?.(stage, err instanceof Error ? err : new Error(msg));
    }

    // Roll up tokens regardless of result kind.
    if (typeof result.tokens_in === 'number') {
      state.tokens_in = result.tokens_in;
      run.total_tokens_in += result.tokens_in;
    }
    if (typeof result.tokens_out === 'number') {
      state.tokens_out = result.tokens_out;
      run.total_tokens_out += result.tokens_out;
    }
    // Roll up per-model breakdown. Stages that didn't report one
    // (e.g. assemble-docx, or a failure before any LLM call) leave
    // the run total untouched.
    if (result.usage_by_model) {
      state.usage_by_model = result.usage_by_model;
      if (!run.usage_by_model) run.usage_by_model = emptyUsage();
      mergeUsage(run.usage_by_model, result.usage_by_model);
    }

    state.completed_at = new Date().toISOString();

    if (result.kind === 'ok') {
      state.status = 'completed';
      state.output = result.output;
      run.stage_states[stage.id] = state;
      callbacks?.onStageComplete?.(stage, result);
      await persistRun(run);
      continue;
    }

    if (result.kind === 'needs_intervention') {
      state.status = 'needs_intervention';
      state.output = result.output;
      run.stage_states[stage.id] = state;
      run.status = 'paused';
      callbacks?.onStageComplete?.(stage, result);
      await persistRun(run);
      return run;
    }

    // failed
    state.status = 'failed';
    state.error = result.error;
    run.stage_states[stage.id] = state;
    run.status = 'failed';
    run.completed_at = new Date().toISOString();
    callbacks?.onStageComplete?.(stage, result);
    await persistRun(run);
    callbacks?.onRunComplete?.(run);
    return run;
  }

  // Walked every stage with no pause / no failure → completed.
  run.status = 'completed';
  run.completed_at = new Date().toISOString();
  await persistRun(run);
  callbacks?.onRunComplete?.(run);
  return run;
}

// ─── Public API: runRecipe ───────────────────────────────────────

/**
 * Run a recipe end-to-end. Walks stages, checkpoints to Dexie, surfaces
 * progress via callbacks. If a stage returns 'needs_intervention', the
 * runner persists the run with status 'paused' and returns. The caller
 * resumes by calling resumeRecipeRun() with the same run id after the
 * user confirms.
 */
export async function runRecipe(args: {
  client: LLMClient;
  project: ProjectRecord;
  templates: TemplateRecord[];
  recipe: Recipe;
  /**
   * Optional display name override for THIS run. Stored on
   * recipe_runs.recipe_name so the run history reflects what the
   * project actually is, not the generic recipe label. Callers
   * typically pass `Auto-draft · ${project.name}`.
   */
  display_name?: string;
  callbacks?: RecipeRunCallbacks;
}): Promise<RecipeRun> {
  const { client, project, templates, recipe, display_name, callbacks } = args;

  if (!clientSatisfiesProvider(client, recipe.required_provider)) {
    throw new Error(
      `Recipe "${recipe.id}" requires provider "${recipe.required_provider}" but the supplied client does not match.`,
    );
  }

  const started_at = new Date().toISOString();
  const run: RecipeRun = {
    id: makeRunId(project.id, recipe.id, started_at),
    project_id: project.id,
    recipe_id: recipe.id,
    recipe_name: display_name?.trim() || recipe.name,
    started_at,
    status: 'running',
    stage_states: initStageStates(recipe.stages),
    total_tokens_in: 0,
    total_tokens_out: 0,
    usage_by_model: emptyUsage(),
  };

  return walkStages({
    client,
    project,
    templates,
    stages: recipe.stages,
    startIndex: 0,
    run,
    callbacks,
  });
}

// ─── Public API: resumeRecipeRun ─────────────────────────────────

/**
 * Resume a paused recipe run from the next stage after the intervention
 * point. The caller must provide the same recipe definition the run
 * was started with — the runner cannot reconstruct stage closures from
 * persisted state.
 *
 * The recipe is NOT passed explicitly here; instead the runner looks up
 * the run, finds the most-recent `needs_intervention` stage, and calls
 * `resolveRecipe(run.recipe_id)`. Because recipes are plain data in
 * code, the integrator wires the resolver via `registerRecipe` below.
 */
const RECIPE_REGISTRY = new Map<string, Recipe>();

/** Register a recipe so resumeRecipeRun() can reconstruct it by id. */
export function registerRecipe(recipe: Recipe): void {
  RECIPE_REGISTRY.set(recipe.id, recipe);
}

/** Look up a registered recipe by id. */
export function getRegisteredRecipe(id: string): Recipe | undefined {
  return RECIPE_REGISTRY.get(id);
}

/** Clear all registered recipes. Test-only helper. */
export function __clearRecipeRegistry(): void {
  RECIPE_REGISTRY.clear();
}

export async function resumeRecipeRun(args: {
  client: LLMClient;
  project: ProjectRecord;
  templates: TemplateRecord[];
  run_id: string;
  callbacks?: RecipeRunCallbacks;
}): Promise<RecipeRun> {
  const { client, project, templates, run_id, callbacks } = args;

  const existing = await loadRecipeRun(run_id);
  if (!existing) {
    throw new Error(`resumeRecipeRun: no run found with id ${run_id}`);
  }
  if (existing.status === 'completed' || existing.status === 'failed') {
    throw new Error(
      `resumeRecipeRun: run ${run_id} is already in terminal status "${existing.status}"`,
    );
  }
  if (existing.status === 'cancelled') {
    throw new Error(`resumeRecipeRun: run ${run_id} was cancelled and cannot resume`);
  }

  const recipe = RECIPE_REGISTRY.get(existing.recipe_id);
  if (!recipe) {
    throw new Error(
      `resumeRecipeRun: recipe "${existing.recipe_id}" is not registered. Call registerRecipe() before resuming.`,
    );
  }

  // Find the paused stage and advance past it. If nothing is paused
  // (e.g. the run was just `running` when persisted), resume from the
  // first stage that is not yet completed.
  let resumeIndex = -1;
  for (let i = 0; i < recipe.stages.length; i++) {
    const s = recipe.stages[i]!;
    const st = existing.stage_states[s.id];
    if (!st) continue;
    if (st.status === 'needs_intervention') {
      // Mark as completed (user accepted the intervention) and resume
      // from the NEXT stage.
      st.status = 'completed';
      resumeIndex = i + 1;
      break;
    }
  }
  if (resumeIndex === -1) {
    // Fall back: resume from the first non-completed stage.
    for (let i = 0; i < recipe.stages.length; i++) {
      const s = recipe.stages[i]!;
      const st = existing.stage_states[s.id];
      if (!st || st.status !== 'completed') {
        resumeIndex = i;
        break;
      }
    }
  }
  if (resumeIndex === -1 || resumeIndex >= recipe.stages.length) {
    // Nothing left to do — mark completed and return.
    existing.status = 'completed';
    existing.completed_at = new Date().toISOString();
    await persistRun(existing);
    callbacks?.onRunComplete?.(existing);
    return existing;
  }

  return walkStages({
    client,
    project,
    templates,
    stages: recipe.stages,
    startIndex: resumeIndex,
    run: existing,
    callbacks,
  });
}

// ─── Public API: retryRecipeRun ──────────────────────────────────

/**
 * Retry a failed recipe run starting from the failed stage. Resets
 * the failed stage's state to pending and walks forward from there.
 *
 * Use case: a transient stage failure (cross-section review hit a
 * model id that didn't exist on the active provider, the network
 * blipped during chunking) shouldn't force the user to re-run from
 * preflight and burn the tokens of every prior stage. The earlier
 * stages stay in their `completed` state with their persisted
 * outputs intact; only the failed stage and anything downstream is
 * re-executed.
 *
 * Distinct from resumeRecipeRun, which only handles paused (needs-
 * intervention) runs and refuses to touch terminal `failed` runs.
 */
export async function retryRecipeRun(args: {
  client: LLMClient;
  project: ProjectRecord;
  templates: TemplateRecord[];
  run_id: string;
  callbacks?: RecipeRunCallbacks;
}): Promise<RecipeRun> {
  const { client, project, templates, run_id, callbacks } = args;

  const existing = await loadRecipeRun(run_id);
  if (!existing) {
    throw new Error(`retryRecipeRun: no run found with id ${run_id}`);
  }
  if (existing.status === 'cancelled') {
    throw new Error(`retryRecipeRun: run ${run_id} was cancelled and cannot retry`);
  }

  const recipe = RECIPE_REGISTRY.get(existing.recipe_id);
  if (!recipe) {
    throw new Error(
      `retryRecipeRun: recipe "${existing.recipe_id}" is not registered. Call registerRecipe() before retrying.`,
    );
  }

  // Find the failed stage. If none is failed, fall back to the first
  // non-completed stage (e.g. a run that errored mid-walk and never
  // got the failed stage marked).
  let retryIndex = -1;
  for (let i = 0; i < recipe.stages.length; i++) {
    const s = recipe.stages[i]!;
    const st = existing.stage_states[s.id];
    if (st?.status === 'failed') {
      retryIndex = i;
      break;
    }
  }
  if (retryIndex === -1) {
    for (let i = 0; i < recipe.stages.length; i++) {
      const s = recipe.stages[i]!;
      const st = existing.stage_states[s.id];
      if (!st || st.status !== 'completed') {
        retryIndex = i;
        break;
      }
    }
  }
  if (retryIndex === -1 || retryIndex >= recipe.stages.length) {
    throw new Error(
      `retryRecipeRun: no failed or pending stage found in run ${run_id} — nothing to retry.`,
    );
  }

  // Reset the failed stage AND any downstream stages back to pending
  // so the walker re-executes them with fresh state. Earlier stages
  // (that completed successfully) keep their outputs.
  for (let i = retryIndex; i < recipe.stages.length; i++) {
    const s = recipe.stages[i]!;
    existing.stage_states[s.id] = { status: 'pending' };
  }
  existing.status = 'running';
  existing.completed_at = undefined;
  await persistRun(existing);

  return walkStages({
    client,
    project,
    templates,
    stages: recipe.stages,
    startIndex: retryIndex,
    run: existing,
    callbacks,
  });
}

// ─── Public API: cancelRecipeRun ─────────────────────────────────

/** Cancel a paused or running recipe run. Marks the persisted record as 'cancelled'. */
export async function cancelRecipeRun(run_id: string): Promise<void> {
  const existing = await loadRecipeRun(run_id);
  if (!existing) return;
  if (existing.status === 'completed' || existing.status === 'failed') return;
  existing.status = 'cancelled';
  existing.completed_at = new Date().toISOString();
  await persistRun(existing);
}

// ─── Public API: loadRecipeRun ───────────────────────────────────

/** Load a recipe run from Dexie. */
export async function loadRecipeRun(run_id: string): Promise<RecipeRun | undefined> {
  const table = getRecipeRunsTable();
  if (!table) return undefined;
  try {
    return await table.get(run_id);
  } catch {
    return undefined;
  }
}

// ─── Public API: loadRecipeRunsForProject ────────────────────────

/** Load all recipe runs for a project (newest first). */
export async function loadRecipeRunsForProject(
  project_id: string,
): Promise<RecipeRun[]> {
  const table = getRecipeRunsTable();
  if (!table) return [];
  try {
    let rows: RecipeRun[];
    if (table.where) {
      rows = await table.where('project_id').equals(project_id).toArray();
    } else {
      const all = await table.toArray();
      rows = all.filter((r) => r.project_id === project_id);
    }
    // Newest first by started_at.
    rows.sort((a, b) => (a.started_at < b.started_at ? 1 : a.started_at > b.started_at ? -1 : 0));
    return rows;
  } catch {
    return [];
  }
}

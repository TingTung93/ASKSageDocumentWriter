// Single-project view: shared inputs editor, draft trigger, drafted
// section workspace, validation issues, and export. The end-to-end
// drafting + critique + export pipeline lives here.

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type DraftRecord, type ProjectContextFile, type ProjectRecord, type TemplateRecord } from '../lib/db/schema';
import type { BodyFillRegion } from '../lib/template/types';
import { updateProject } from '../lib/project/helpers';
import { deriveSharedInputFields, type SharedInputField } from '../lib/project/helpers';
import {
  addProjectNote,
  attachProjectFile,
  clearOrphanedFiles,
  getContextItems,
  hasOrphanedV4Files,
  removeContextItem,
} from '../lib/project/context';
import { semanticChunkText } from '../lib/project/chunk';
import { db as dexieDb } from '../lib/db/schema';
import {
  applyPlaceholderResolutions,
  scanDraftForPlaceholders,
  uniquePlaceholdersByDescription,
  type PlaceholderOccurrence,
  type PlaceholderResolution,
} from '../lib/draft/placeholders';
import { normalizePlaceholderResolutions } from '../lib/draft/normalize_resolutions';
import { FILL_PLACEHOLDERS_STAGE_ID } from '../lib/agent/recipes/pws';
import { DropZone } from '../components/DropZone';
import { EmptyState } from '../components/EmptyState';
import { useAuth } from '../lib/state/auth';
import { AskSageClient } from '../lib/asksage/client';
import { createLLMClient } from '../lib/provider/factory';
import { extractedTextFromRet } from '../lib/asksage/extract';
import { draftProject } from '../lib/draft/orchestrator';
import { runValidation } from '../lib/critique';
import { exportProjectAsJson, downloadJsonExport } from '../lib/export';
import type { DraftParagraph } from '../lib/draft/types';
import { loadSettings } from '../lib/settings/store';
import {
  actualUsdFromPricing,
  estimateProjectDrafting,
  formatTokens,
  formatUsd,
  resolveModelPricing,
} from '../lib/settings/cost';
import { ASK_SAGE_DEFAULT_DRAFTING_MODEL } from '../lib/provider/resolve_model';
import {
  WEB_SEARCH_USD_PER_RESULT,
  computeRunCost,
  type RunCostBreakdown,
} from '../lib/usage';
import { DEFAULT_COST_ASSUMPTIONS } from '../lib/settings/types';
import { toast } from '../lib/state/toast';
import { Spinner } from '../components/Spinner';
import { ProgressBar } from '../components/ProgressBar';
import { buildProjectBundle } from '../lib/share/bundle';
import { downloadBundle, bundleFilename } from '../lib/share/download';
import {
  cancelRecipeRun,
  loadRecipeRunsForProject,
  resumeRecipeRun,
  retryRecipeRun,
  runRecipe,
  type RecipeRun,
  type RecipeStage,
} from '../lib/agent/recipe';
import { PWS_RECIPE } from '../lib/agent/recipes/pws';
import { FREEFORM_RECIPE } from '../lib/agent/recipes/freeform';
import { getFreeformStyle } from '../lib/freeform/styles';
import { assembleFreeformDocx } from '../lib/freeform/assemble';
import {
  assembleProjectFromDrafts,
  downloadBlob,
  type AssembleProjectResult,
} from '../lib/export/downloadAssembled';
import { AssembledDocxPreview } from '../components/AssembledDocxPreview';

export function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const project = useLiveQuery(() => (id ? db.projects.get(id) : undefined), [id]);
  const allTemplates = useLiveQuery(() => db.templates.toArray(), []);
  const drafts = useLiveQuery<DraftRecord[]>(
    () =>
      id
        ? db.drafts.where('project_id').equals(id).toArray()
        : Promise.resolve([] as DraftRecord[]),
    [id],
  );
  const apiKey = useAuth((s) => s.apiKey);
  const baseUrl = useAuth((s) => s.baseUrl);
  const provider = useAuth((s) => s.provider);
  const availableModels = useAuth((s) => s.models);
  const onAskSage = provider === 'asksage';
  const settings = useLiveQuery(() => loadSettings(), []);
  const draftingModelOverride = settings?.models.drafting ?? null;
  const cost = settings?.cost ?? DEFAULT_COST_ASSUMPTIONS;
  // Resolve the drafting model id the recipe will actually use, then
  // look up its per-token pricing from the auth store's cached
  // /v1/models response. OpenRouter populates `pricing`; Ask Sage
  // does not — so on Ask Sage this returns null and the cost helpers
  // fall back to settings.cost.usd_per_1k_* (the legacy path).
  const effectiveDraftingModelId =
    draftingModelOverride ?? (onAskSage ? ASK_SAGE_DEFAULT_DRAFTING_MODEL : null);
  const draftingPricing = resolveModelPricing(availableModels, effectiveDraftingModelId);

  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  // Agentic recipe runner state. The recipe walks Phase 2-5a stages
  // and pauses at intervention points; the UI surfaces those via the
  // currentRun.status === 'paused' branch below.
  const [currentRun, setCurrentRun] = useState<RecipeRun | null>(null);
  const [recipeRunning, setRecipeRunning] = useState(false);
  const [recipeStageMessage, setRecipeStageMessage] = useState<string | null>(null);

  // Past recipe runs for this project (newest first). useLiveQuery
  // re-fetches whenever the recipe_runs table changes, so the history
  // updates automatically as runs complete.
  const pastRuns = useLiveQuery(
    () => (id ? loadRecipeRunsForProject(id) : Promise.resolve([])),
    [id, currentRun?.id],
  );

  if (!id) return <main>Missing project id</main>;
  if (!project) return <main>Loading project…</main>;
  if (!allTemplates) return <main>Loading…</main>;

  const projectTemplates = allTemplates.filter((t) => project.template_ids.includes(t.id));
  const sharedFields = deriveSharedInputFields(projectTemplates);
  const totalSections = projectTemplates.reduce(
    (acc, t) => acc + t.schema_json.sections.length,
    0,
  );
  const draftsBySectionKey = new Map<string, DraftRecord>();
  for (const d of drafts ?? []) draftsBySectionKey.set(`${d.template_id}::${d.section_id}`, d);

  async function onSharedInputChange(key: string, value: string) {
    if (!project) return;
    // When the user edits a previously auto-filled value, drop the
    // auto-fill metadata for that key — the value is now manual.
    const meta = { ...(project.shared_inputs_meta ?? {}) };
    if (meta[key]) {
      delete meta[key];
    }
    await updateProject(project.id, {
      shared_inputs: { ...project.shared_inputs, [key]: value },
      shared_inputs_meta: meta,
    });
  }

  async function onStartDrafting() {
    if (!project) return;
    if (!apiKey) {
      setDraftError('Connect on the Connection tab first — drafting needs a provider API key.');
      return;
    }
    setDraftError(null);
    setDrafting(true);
    setProgress({ done: 0, total: totalSections });
    // eslint-disable-next-line no-console
    console.info(`[ProjectDetail] starting drafting for project ${project.id}: ${totalSections} sections across ${projectTemplates.length} templates`);
    try {
      const client = createLLMClient({ provider, baseUrl, apiKey });
      let done = 0;
      await draftProject(client, {
        project,
        templates: projectTemplates,
        ...(draftingModelOverride ? { options: { model: draftingModelOverride } } : {}),
        callbacks: {
          onSectionStart: (tpl, sec) => {
            // eslint-disable-next-line no-console
            console.info(`[ProjectDetail] drafting ${tpl.name} :: ${sec.name}`);
          },
          onSectionComplete: (tpl, sec) => {
            done += 1;
            setProgress({ done, total: totalSections });
            // eslint-disable-next-line no-console
            console.info(`[ProjectDetail] complete ${done}/${totalSections}: ${tpl.name} :: ${sec.name}`);
          },
          onSectionError: (tpl, sec, err) => {
            done += 1;
            setProgress({ done, total: totalSections });
            // eslint-disable-next-line no-console
            console.error(`[ProjectDetail] error on ${tpl.name} :: ${sec.name}: ${err.message}`);
            toast.error(`${tpl.name} :: ${sec.name} — ${err.message}`);
          },
        },
      });
      toast.success(`Drafting complete (${totalSections} section${totalSections === 1 ? '' : 's'})`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.error('[ProjectDetail] drafting failed:', err);
      setDraftError(message);
      toast.error(`Drafting failed: ${message}`);
    } finally {
      setDrafting(false);
    }
  }

  function onExport() {
    if (!project) return;
    const payload = exportProjectAsJson(project, projectTemplates, drafts ?? []);
    const safeName = project.name.replace(/[^a-z0-9]+/gi, '_').toLowerCase();
    const filename = `${safeName}-${Date.now()}.json`;
    downloadJsonExport(filename, payload);
    toast.success(`Exported ${filename}`);
  }

  async function onShare(includeDrafts: boolean) {
    if (!project) return;
    try {
      const bundle = await buildProjectBundle(
        project,
        projectTemplates,
        drafts ?? [],
        { includeDrafts },
      );
      const filename = bundleFilename(project.name, 'project');
      downloadBundle(filename, bundle);
      toast.success(
        `Exported ${filename}${includeDrafts ? ' (with drafts)' : ''}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`Share failed: ${message}`);
    }
  }

  // ─── Agentic recipe entry points ─────────────────────────────────

  const isFreeform = (project?.mode ?? 'template') === 'freeform';

  async function onRunRecipe() {
    if (!project) return;
    if (!apiKey) {
      toast.error('Connect a provider on the Connection tab first.');
      return;
    }
    setRecipeRunning(true);
    setCurrentRun(null);
    setRecipeStageMessage(null);
    try {
      const client = createLLMClient({ provider, baseUrl, apiKey });

      // Pick the right recipe based on project mode
      const recipe = isFreeform ? FREEFORM_RECIPE : PWS_RECIPE;

      // Template-mode: filter library to project's templates
      const projectTemplatesForRecipe = isFreeform
        ? []
        : (allTemplates ?? []).filter((t) =>
            project.template_ids.includes(t.id),
          );
      if (!isFreeform && projectTemplatesForRecipe.length === 0) {
        toast.error('No templates attached to this project. Add a template first.');
        setRecipeRunning(false);
        return;
      }
      const run = await runRecipe({
        client,
        project,
        templates: projectTemplatesForRecipe,
        recipe,
        display_name: `Auto-draft · ${project.name || 'Untitled project'}`,
        callbacks: {
          onStageStart: (stage: RecipeStage, index, total) => {
            setRecipeStageMessage(`${index + 1}/${total} · ${stage.name}`);
          },
          onStageProgress: (_stage, message) => {
            setRecipeStageMessage(message);
          },
          onError: (stage, err) => {
            toast.error(`${stage.name}: ${err.message}`);
          },
        },
      });
      setCurrentRun(run);
      if (run.status === 'completed') {
        const totalTokens = run.total_tokens_in + run.total_tokens_out;
        // Per-model cost when the run reported a breakdown; falls
        // back to the legacy single-pricing approximation otherwise.
        let usd: number | null = null;
        if (run.usage_by_model && Object.keys(run.usage_by_model).length > 0) {
          usd = computeRunCost(run.usage_by_model, availableModels).usd_total;
        } else {
          usd = actualUsdFromPricing(run.total_tokens_in, run.total_tokens_out, draftingPricing);
        }
        const usdSuffix = usd !== null ? ` · ${formatUsd(usd)}` : '';
        toast.success(`Auto-draft complete · ${totalTokens.toLocaleString()} units${usdSuffix}`);
      } else if (run.status === 'paused') {
        toast.info('Auto-draft paused for your review — see the panel below');
      } else if (run.status === 'failed') {
        toast.error('Auto-draft failed — check the panel below for details');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`Auto-draft error: ${message}`);
    } finally {
      setRecipeRunning(false);
    }
  }

  async function onResumeRecipe() {
    if (!project || !currentRun) return;
    if (!apiKey) {
      toast.error('Connect a provider on the Connection tab first.');
      return;
    }
    setRecipeRunning(true);
    try {
      const client = createLLMClient({ provider, baseUrl, apiKey });
      const projectTemplates = (allTemplates ?? []).filter((t) =>
        project.template_ids.includes(t.id),
      );
      const run = await resumeRecipeRun({
        client,
        project,
        templates: projectTemplates,
        run_id: currentRun.id,
        callbacks: {
          onStageStart: (stage: RecipeStage, index, total) => {
            setRecipeStageMessage(`${index + 1}/${total} · ${stage.name}`);
          },
          onStageProgress: (_stage, message) => {
            setRecipeStageMessage(message);
          },
        },
      });
      setCurrentRun(run);
      if (run.status === 'completed') {
        toast.success('Auto-draft complete');
      } else if (run.status === 'paused') {
        toast.info('Auto-draft paused again');
      }
    } catch (err) {
      toast.error(`Resume failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRecipeRunning(false);
    }
  }

  async function onCancelRecipe() {
    if (!currentRun) return;
    try {
      await cancelRecipeRun(currentRun.id);
      setCurrentRun({ ...currentRun, status: 'cancelled' });
      toast.info('Auto-draft cancelled');
    } catch (err) {
      toast.error(`Cancel failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function onRetryRecipe() {
    if (!project || !currentRun) return;
    if (!apiKey) {
      toast.error('Connect a provider on the Connection tab first.');
      return;
    }
    setRecipeRunning(true);
    setRecipeStageMessage(null);
    try {
      const client = createLLMClient({ provider, baseUrl, apiKey });
      const projectTemplates = (allTemplates ?? []).filter((t) =>
        project.template_ids.includes(t.id),
      );
      const run = await retryRecipeRun({
        client,
        project,
        templates: projectTemplates,
        run_id: currentRun.id,
        callbacks: {
          onStageStart: (stage: RecipeStage, index, total) => {
            setRecipeStageMessage(`${index + 1}/${total} · ${stage.name}`);
          },
          onStageProgress: (_stage, message) => {
            setRecipeStageMessage(message);
          },
        },
      });
      setCurrentRun(run);
      if (run.status === 'completed') {
        toast.success('Auto-draft complete after retry');
      } else if (run.status === 'failed') {
        toast.error('Auto-draft failed again — check the panel below for details');
      } else if (run.status === 'paused') {
        toast.info('Auto-draft paused for review');
      }
    } catch (err) {
      toast.error(`Retry failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRecipeRunning(false);
    }
  }

  /**
   * Normalize user-typed placeholder values via a single LLM call
   * before they get written to the document AND save the user's
   * answers back to the project as a chat note. The note step
   * preserves user-supplied context across runs — if the user
   * re-runs the recipe (or starts a new draft from this project),
   * the next preflight + metadata batch will see these values in
   * the notes block instead of asking again.
   *
   * Closes over the active provider/baseUrl/apiKey + the project so
   * the panel can stay decoupled from the auth + recipe context.
   *
   * Always returns SOMETHING for every input key — on any failure
   * the helper falls back to the raw values, so a network blip can
   * never lose what the user typed.
   */
  async function handleNormalizeResolutions(
    requests: NormalizationRequest[],
  ): Promise<{ values: Map<string, string>; changed: number }> {
    if (!project || requests.length === 0) {
      return {
        values: new Map(requests.map((r) => [r.input_key, r.raw_value])),
        changed: 0,
      };
    }

    // Step 1 — normalize. Skip the LLM call when there's no auth
    // (the panel still needs SOMETHING to write to Dexie, so fall
    // back to raw values; the note save below still runs).
    let normalized = new Map<string, string>(
      requests.map((r) => [r.input_key, r.raw_value]),
    );
    let changed = 0;
    if (apiKey) {
      try {
        const client = createLLMClient({ provider, baseUrl, apiKey });
        // Pick a representative template name as the "document kind"
        // hint. The lateral-transfer case has one template attached,
        // so this is unambiguous; multi-template projects fall back
        // to a generic label.
        const documentKind = allTemplates
          ? allTemplates
              .filter((t) => project.template_ids.includes(t.id))
              .map((t) => t.name)
              .join(' / ') || 'document'
          : 'document';
        const result = await normalizePlaceholderResolutions({
          client,
          document_kind: documentKind,
          project_subject: project.description ?? '',
          resolutions: requests.map((r) => ({
            key: r.input_key,
            section_name: r.section_name,
            description: r.description,
            raw_value: r.raw_value,
          })),
        });
        normalized = result.normalized;
        changed = result.changed;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[handleNormalizeResolutions] LLM normalize failed; continuing with raw values:', err);
      }
    }

    // Step 2 — save the (normalized) answers back as a project note
    // so subsequent runs can see them. Group by section so the note
    // reads naturally. We persist NORMALIZED values (not raw) because
    // those are what the document actually uses; the raw input was a
    // transient quick-type, not a fact.
    try {
      const bySection = new Map<string, NormalizationRequest[]>();
      for (const r of requests) {
        let bucket = bySection.get(r.section_name);
        if (!bucket) {
          bucket = [];
          bySection.set(r.section_name, bucket);
        }
        bucket.push(r);
      }
      const lines: string[] = [];
      lines.push('User-supplied context for this draft (saved automatically from the fill-placeholders form):');
      for (const [sectionName, bucket] of bySection) {
        lines.push('');
        lines.push(`${sectionName}:`);
        for (const r of bucket) {
          const value = normalized.get(r.input_key) ?? r.raw_value;
          if (!value) continue;
          // Single-line values get rendered inline; multi-line values
          // get a labeled block so the note stays readable.
          if (value.includes('\n')) {
            lines.push(`  - ${r.description}:`);
            for (const line of value.split('\n')) {
              lines.push(`      ${line}`);
            }
          } else {
            lines.push(`  - ${r.description}: ${value}`);
          }
        }
      }
      const noteText = lines.join('\n');
      // addProjectNote no-ops on empty input; harmless either way.
      await addProjectNote(project.id, noteText, 'user');
    } catch (err) {
      // Note save is best-effort — never fail the apply on this.
      // eslint-disable-next-line no-console
      console.warn('[handleNormalizeResolutions] failed to save user answers as project note:', err);
    }

    return { values: normalized, changed };
  }

  // Empty-state detection — drives the onboarding checklist below the
  // header. A project counts as "fresh" when the user hasn't picked a
  // template, hasn't typed a description, and hasn't added any notes
  // or files. Once any of those is satisfied we drop the checklist
  // and show the normal workspace UI.
  const hasTemplate = project.template_ids.length > 0;
  const hasDescription = (project.description ?? '').trim().length > 0;
  const hasContextItems = (project.context_items ?? []).length > 0;
  const isFreshProject = !hasTemplate && !hasDescription && !hasContextItems;

  return (
    <main>
      <p><Link to="/projects">← Projects</Link></p>
      <h1>{project.name}</h1>
      <p className="note">
        {project.template_ids.length} template{project.template_ids.length === 1 ? '' : 's'} ·
        {' '}{totalSections} section{totalSections === 1 ? '' : 's'} ·
        {' '}updated {new Date(project.updated_at).toLocaleString()}
      </p>

      <ProjectDescriptionEditor project={project} />

      {isFreshProject && <FreshProjectChecklist />}

      {!onAskSage && (
        <div className="note" style={{ marginBottom: 'var(--space-3)', padding: '0.5rem 0.75rem', background: '#f6f6fa', border: '1px solid #ddd', borderRadius: 6 }}>
          <strong>OpenRouter mode (non-CUI).</strong>{' '}
          Reference extraction (DOCX, PDF, plain text) runs in the
          browser. Web search is provided by the OpenRouter `web`
          plugin. Named-dataset lookups are unavailable — use the inline
          reference files instead.
        </div>
      )}

      {!isFreeform && (
        <>
          <ProjectTemplatesEditor
            project={project}
            allTemplates={allTemplates}
            currentlySelected={projectTemplates}
          />

          <h2>Shared inputs ({sharedFields.length})</h2>
          {sharedFields.length === 0 && (
            <p className="note">
              No shared document fields detected across the selected templates. Drafting will proceed
              using only the project description and reference datasets as source material.
            </p>
          )}
          <div>
            {sharedFields.map((f) => (
              <SharedInputControl
                key={f.key}
                field={f}
                value={project.shared_inputs[f.key] ?? ''}
                meta={project.shared_inputs_meta?.[f.key]}
                onChange={(v) => onSharedInputChange(f.key, v)}
              />
            ))}
          </div>
        </>
      )}

      {isFreeform && project.freeform_style && (
        <div className="panel" style={{ marginBottom: 'var(--space-3)' }}>
          <strong>Document style:</strong> {getFreeformStyle(project.freeform_style)?.name ?? project.freeform_style}
          <span className="note" style={{ marginLeft: '0.5rem' }}>
            ({getFreeformStyle(project.freeform_style)?.typical_pages ?? '?'} pages typical)
          </span>
        </div>
      )}

      <ProjectContextSection project={project} />

      <h2>Drafting</h2>
      <label htmlFor="project-live-detail">Web search mode</label>
      <select
        id="project-live-detail"
        value={project.live_search}
        onChange={async (e) => {
          await updateProject(project.id, {
            live_search: Number(e.target.value) as 0 | 1 | 2,
          });
        }}
        style={{ width: '100%', padding: '0.5rem', font: 'inherit', maxWidth: 500 }}
        disabled={drafting}
      >
        <option value={0}>Disabled — no web search, datasets only</option>
        <option value={1}>Google results — include web search results as references</option>
        <option value={2}>Google + crawl — full market research mode</option>
      </select>
      <p className="note">
        Applies to every drafting call for this project. Mode 2 is the right
        choice for market research / capability survey sections that need
        current outside-document context.
      </p>

      {(() => {
        const est = estimateProjectDrafting(totalSections, cost, draftingPricing);
        const showUsd = est.usd_source !== 'none';
        // Web search projection: when the project enables live search,
        // every drafted section call rides the OpenRouter web plugin.
        // Mode 1 budgets 5 results, mode 2 budgets 10. Add a fudge of
        // +2 calls for metadata batch + cross-section review.
        const liveMode = project.live_search ?? 0;
        const webResultsPerCall = liveMode === 2 ? 10 : liveMode === 1 ? 5 : 0;
        const webCalls = liveMode > 0 ? totalSections + 2 : 0;
        const projectedWebResults = webCalls * webResultsPerCall;
        const projectedWebUsd = projectedWebResults * WEB_SEARCH_USD_PER_RESULT;
        const showAnyUsd = showUsd || projectedWebUsd > 0;
        const totalProjectedUsd = (showUsd ? est.usd_total : 0) + projectedWebUsd;
        return (
          <div
            style={{
              background: '#f6f6fa',
              border: '1px solid #ddd',
              borderRadius: 6,
              padding: '0.5rem 0.75rem',
              marginBottom: '0.5rem',
              fontSize: 12,
              color: '#444',
              maxWidth: 500,
            }}
          >
            <strong>Estimated cost</strong>{' '}
            <span className="note">
              ({totalSections} section{totalSections === 1 ? '' : 's'} ·{' '}
              {effectiveDraftingModelId ?? 'no model selected'})
            </span>
            <div style={{ marginTop: '0.25rem' }}>
              ~{formatTokens(est.tokens_in)} in / ~{formatTokens(est.tokens_out)} out · ~
              {formatTokens(est.tokens_total)} total
              {showAnyUsd && <> · ~{formatUsd(totalProjectedUsd)}</>}
            </div>
            {projectedWebUsd > 0 && (
              <div className="note" style={{ marginTop: '0.25rem' }}>
                Includes ~{formatUsd(projectedWebUsd)} for ~{projectedWebResults.toLocaleString()} web search results
                ({webCalls} calls × {webResultsPerCall} × ${WEB_SEARCH_USD_PER_RESULT.toFixed(3)})
              </div>
            )}
            <div className="note" style={{ marginTop: '0.25rem' }}>
              {est.usd_source === 'pricing' ? (
                <>Live pricing from OpenRouter ({effectiveDraftingModelId}).</>
              ) : est.usd_source === 'assumptions' ? (
                <>Using <Link to="/settings">Settings</Link> cost assumptions.</>
              ) : !effectiveDraftingModelId ? (
                <>Set a drafting model on the <Link to="/settings">Settings</Link> tab to see a cost estimate.</>
              ) : (
                <>No pricing available for this model. Set $/1k overrides on the <Link to="/settings">Settings</Link> tab if you want a dollar figure.</>
              )}
            </div>
          </div>
        );
      })()}

      <div className="btn-row">
        <button
          type="button"
          onClick={() => void onRunRecipe()}
          disabled={recipeRunning || drafting || !apiKey}
          title={isFreeform
            ? 'Generate the complete document from your description and reference material'
            : 'Run the full auto-draft workflow: gap analysis, drafting with quality review, content review, and final document assembly'}
        >
          {recipeRunning
            ? <Spinner light label={recipeStageMessage ?? 'Running auto-draft…'} />
            : isFreeform
              ? '🤖 Generate document'
              : '🤖 Auto-draft this project'}
        </button>
        {!isFreeform && (
          <button type="button" className="btn-secondary" onClick={onStartDrafting} disabled={drafting || recipeRunning || !apiKey}>
            {drafting ? <Spinner light label="Drafting…" /> : 'Draft sections (manual)'}
          </button>
        )}
        <button type="button" className="btn-secondary" onClick={() => void onShare(false)}>
          Share project (templates only)
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => void onShare(true)}
          disabled={(drafts ?? []).length === 0}
          title={
            (drafts ?? []).length === 0
              ? 'Draft at least one section first'
              : 'Include all drafted sections in the bundle'
          }
        >
          Share project + drafts
        </button>
        <button type="button" className="btn-ghost" onClick={onExport}>
          Export drafts as JSON
        </button>
      </div>
      <p className="note">
        Share buttons emit an <code>.asdbundle.json</code> file that bundles
        the project, every referenced template, and (optionally) the drafted
        sections. A teammate can drop it on the Projects tab to recreate the
        whole setup. The "Export drafts as JSON" button writes the older
        flat-JSON dump for downstream tooling.
      </p>
      {progress && (
        <ProgressBar
          done={progress.done}
          total={progress.total}
          label={`Drafting section ${progress.done} of ${progress.total}`}
        />
      )}
      {draftError && <div className="error">{draftError}</div>}

      {currentRun && (
        <RecipeRunPanel
          run={currentRun}
          onResume={() => void onResumeRecipe()}
          onCancel={() => void onCancelRecipe()}
          onRetry={() => void onRetryRecipe()}
          isRunning={recipeRunning}
          availableModels={availableModels}
          fallbackPricing={draftingPricing}
          fallbackModelId={effectiveDraftingModelId}
          normalizeResolutions={handleNormalizeResolutions}
        />
      )}

      {pastRuns && pastRuns.length > 0 && (
        <RecipeHistoryPanel
          runs={pastRuns}
          currentRunId={currentRun?.id ?? null}
          onLoadRun={(run) => setCurrentRun(run)}
          availableModels={availableModels}
          fallbackPricing={draftingPricing}
        />
      )}

      {/* ── Freeform draft workspace ──────────────────────────────── */}
      {isFreeform && (
        <FreeformDraftPanel project={project} />
      )}

      {/* ── Template draft workspace ──────────────────────────────── */}
      {!isFreeform && (
        <>
          {(drafts ?? []).some((d) => d.status === 'ready') && (
            <AssembledOutputPanel
              project={project}
              templates={projectTemplates}
            />
          )}

          <h2>Sections</h2>
          {projectTemplates.map((tpl) => (
            <TemplateDraftedSections
              key={tpl.id}
              template={tpl}
              drafts={draftsBySectionKey}
              project={project}
            />
          ))}
        </>
      )}
    </main>
  );
}

/**
 * Panel for viewing, exporting, and re-generating freeform drafts.
 * Shown only for projects with mode === 'freeform'.
 */
function FreeformDraftPanel({ project }: { project: ProjectRecord }) {
  const [exporting, setExporting] = useState(false);
  const styleName = project.freeform_style
    ? getFreeformStyle(project.freeform_style)?.name ?? project.freeform_style
    : 'Unknown style';

  const hasDraft = project.freeform_draft && project.freeform_draft.length > 0;
  const sources = project.freeform_draft_sources ?? [];
  const webSources = sources.filter((s) => s.url);
  const fileSources = sources.filter((s) => s.source_type === 'attached_file');
  const otherSources = sources.filter((s) => !s.url && s.source_type !== 'attached_file');

  async function onExportDocx() {
    if (!project.freeform_draft) return;
    setExporting(true);
    try {
      const result = await assembleFreeformDocx(project.freeform_draft);
      const safeName = project.name.replace(/[^a-z0-9]+/gi, '_').toLowerCase();
      const filename = `${safeName}.docx`;
      const url = URL.createObjectURL(result.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      toast.success(`Exported ${filename}`);
    } catch (err) {
      toast.error(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setExporting(false);
    }
  }

  return (
    <section style={{ marginTop: 'var(--space-4)' }}>
      <h2>Document — {styleName}</h2>

      {!hasDraft && (
        <EmptyState
          icon="📄"
          title="No draft yet"
          body={<>Click <strong>"Generate document"</strong> above to create your {styleName}. The AI will use your project description, attached files, datasets, and web search results to write the complete document.</>}
        />
      )}

      {hasDraft && (
        <>
          <div className="btn-row" style={{ marginBottom: 'var(--space-3)' }}>
            <button
              type="button"
              onClick={onExportDocx}
              disabled={exporting}
            >
              {exporting ? 'Exporting…' : 'Download as Word (.docx)'}
            </button>
          </div>

          {/* Draft metadata */}
          <p className="note">
            Generated {project.freeform_draft_generated_at
              ? new Date(project.freeform_draft_generated_at).toLocaleString()
              : '(unknown date)'}
            {project.freeform_draft_model && ` · model: ${project.freeform_draft_model}`}
            {(project.freeform_draft_tokens_in || project.freeform_draft_tokens_out) && (
              <> · {((project.freeform_draft_tokens_in ?? 0) + (project.freeform_draft_tokens_out ?? 0)).toLocaleString()} units used</>
            )}
            {' · '}{project.freeform_draft!.length} paragraphs
          </p>

          {/* Sources panel */}
          {sources.length > 0 && (
            <details style={{ marginTop: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
              <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 14 }}>
                Sources and references ({sources.length})
              </summary>
              <div style={{ marginTop: 'var(--space-2)', fontSize: 13 }}>
                {webSources.length > 0 && (
                  <>
                    <strong>Web sources:</strong>
                    <ul style={{ margin: '0.3rem 0 0.75rem', paddingLeft: '1.2rem' }}>
                      {webSources.map((s, i) => (
                        <li key={i} style={{ marginBottom: '0.25rem' }}>
                          <a href={s.url} target="_blank" rel="noopener noreferrer">{s.url}</a>
                          {s.title !== s.url && <span className="note" style={{ marginLeft: '0.4rem' }}>({s.title})</span>}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {fileSources.length > 0 && (
                  <>
                    <strong>Attached files:</strong>
                    <ul style={{ margin: '0.3rem 0 0.75rem', paddingLeft: '1.2rem' }}>
                      {fileSources.map((s, i) => (
                        <li key={i}>{s.title}</li>
                      ))}
                    </ul>
                  </>
                )}
                {otherSources.length > 0 && (
                  <>
                    <strong>Other references:</strong>
                    <ul style={{ margin: '0.3rem 0 0.75rem', paddingLeft: '1.2rem' }}>
                      {otherSources.map((s, i) => (
                        <li key={i}>{s.title}</li>
                      ))}
                    </ul>
                  </>
                )}
              </div>

              {project.freeform_draft_raw_references && (
                <details style={{ marginTop: '0.5rem' }}>
                  <summary className="note" style={{ cursor: 'pointer' }}>
                    Raw reference data from Ask Sage
                  </summary>
                  <pre style={{
                    background: '#f4f4f4',
                    padding: '0.5rem',
                    fontSize: 11,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    maxHeight: 300,
                    overflow: 'auto',
                    marginTop: '0.3rem',
                  }}>
                    {project.freeform_draft_raw_references}
                  </pre>
                </details>
              )}
            </details>
          )}

          {/* Document preview */}
          <div
            style={{
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              background: '#fff',
              padding: 'var(--space-4)',
              maxHeight: 600,
              overflow: 'auto',
              fontSize: 13,
              lineHeight: 1.65,
            }}
          >
            {project.freeform_draft!.map((p, i) => (
              <FreeformParagraph key={i} paragraph={p} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function FreeformParagraph({ paragraph: p }: { paragraph: import('../lib/draft/types').DraftParagraph }) {
  const level = p.level ?? 0;
  switch (p.role) {
    case 'heading': {
      const Tag = (`h${Math.min(level + 2, 5)}`) as 'h2' | 'h3' | 'h4' | 'h5';
      return <Tag style={{ marginTop: level === 0 ? '1.2rem' : '0.8rem' }}>{p.text}</Tag>;
    }
    case 'bullet':
      return <li style={{ marginLeft: `${level * 1.2}rem`, listStyleType: level === 0 ? 'disc' : 'circle' }}>{p.text}</li>;
    case 'step':
      return <li style={{ marginLeft: `${level * 1.2}rem`, listStyleType: 'decimal' }}>{p.text}</li>;
    case 'quote':
      return <blockquote style={{ borderLeft: '3px solid #ccc', paddingLeft: '0.75rem', color: '#555', fontStyle: 'italic', margin: '0.5rem 0' }}>{p.text}</blockquote>;
    case 'note':
      return <p style={{ background: '#f0f4ff', padding: '0.4rem 0.6rem', borderRadius: 4, fontSize: 12 }}><strong>NOTE:</strong> {p.text}</p>;
    case 'caution':
      return <p style={{ background: '#fff8e0', padding: '0.4rem 0.6rem', borderRadius: 4, fontSize: 12 }}><strong>CAUTION:</strong> {p.text}</p>;
    case 'warning':
      return <p style={{ background: '#fee', padding: '0.4rem 0.6rem', borderRadius: 4, fontSize: 12 }}><strong>WARNING:</strong> {p.text}</p>;
    case 'table_row':
      return null; // Tables would need a table wrapper; skip for preview
    default:
      return <p style={{ margin: '0.4rem 0', marginLeft: level > 0 ? `${level * 1.2}rem` : undefined }}>{p.text}</p>;
  }
}

/**
 * Re-assembles the project's drafts into finished DOCX(s) on demand
 * via lib/export/downloadAssembled.assembleProjectFromDrafts. The
 * assembly is deterministic so we can rebuild from current Dexie
 * state at any time — no dependency on a live recipe run, no stale
 * blob URLs from a previous session, no need for the user to have
 * gone through the auto-draft flow at all. Manual drafters benefit
 * too.
 *
 * For each template the user can: download, or preview inline via
 * docx-preview. Preview is opt-in (one click to expand) so the
 * panel doesn't burn render time on every page load.
 */
function AssembledOutputPanel({
  project,
  templates,
}: {
  project: ProjectRecord;
  templates: TemplateRecord[];
}) {
  const [results, setResults] = useState<AssembleProjectResult[] | null>(null);
  const [assembling, setAssembling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewTemplateId, setPreviewTemplateId] = useState<string | null>(null);

  async function reassemble() {
    setAssembling(true);
    setError(null);
    try {
      const out = await assembleProjectFromDrafts(project, templates);
      setResults(out);
      if (out.length === 0) {
        toast.info('No ready drafts to assemble. Draft at least one section first.');
      } else {
        toast.success(
          `Assembled ${out.length} template${out.length === 1 ? '' : 's'} from current drafts`,
        );
        // Auto-open the inline preview when there's exactly one
        // template — that's the common case (a single memo / policy
        // / packet). With multiple templates we leave the preview
        // collapsed so the user can pick which one to render
        // (rendering all of them at once is expensive).
        if (out.length === 1) {
          setPreviewTemplateId(out[0]!.template_id);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      toast.error(`Assembly failed: ${message}`);
    } finally {
      setAssembling(false);
    }
  }

  function onDownload(r: AssembleProjectResult) {
    downloadBlob(r.blob, r.filename);
    toast.success(`Downloaded ${r.filename}`);
  }

  return (
    <div className="card" style={{ marginTop: 'var(--space-3)', padding: 'var(--space-3)' }}>
      <div className="row" style={{ alignItems: 'center' }}>
        <strong>📄 Assembled output</strong>
        <span className="muted" style={{ fontSize: 12 }}>
          re-assembled from current drafts on demand — works regardless of recipe-run age
        </span>
        <span style={{ marginLeft: 'auto' }} />
        <button
          type="button"
          className={results === null ? '' : 'btn-secondary'}
          onClick={() => void reassemble()}
          disabled={assembling}
        >
          {assembling ? 'Assembling…' : results === null ? 'Assemble drafts → DOCX' : 'Re-assemble'}
        </button>
      </div>

      {error && <div className="error" style={{ marginTop: 'var(--space-2)' }}>{error}</div>}

      {results && results.length === 0 && (
        <p className="note" style={{ marginTop: 'var(--space-2)' }}>
          No ready drafts found. Draft at least one section before assembling.
        </p>
      )}

      {results && results.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, marginTop: 'var(--space-2)' }}>
          {results.map((r) => {
            const isPreviewing = previewTemplateId === r.template_id;
            const summary = r.result;
            return (
              <li
                key={r.template_id}
                style={{
                  marginBottom: 'var(--space-2)',
                  padding: 'var(--space-2) var(--space-3)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--color-surface)',
                }}
              >
                <div className="row" style={{ alignItems: 'center' }}>
                  <strong>{r.template_name}</strong>
                  {summary.total_assembled > 0 && (
                    <span className="badge badge-success">
                      {summary.total_assembled} assembled
                    </span>
                  )}
                  {summary.total_skipped > 0 && (
                    <span className="badge badge-warning">
                      {summary.total_skipped} skipped
                    </span>
                  )}
                  {summary.total_failed > 0 && (
                    <span className="badge badge-danger">
                      {summary.total_failed} failed
                    </span>
                  )}
                  <span style={{ marginLeft: 'auto' }} />
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={() =>
                      setPreviewTemplateId(isPreviewing ? null : r.template_id)
                    }
                  >
                    {isPreviewing ? 'hide preview' : 'preview'}
                  </button>
                  <button
                    type="button"
                    className="btn-sm"
                    onClick={() => onDownload(r)}
                  >
                    download
                  </button>
                </div>
                <div className="note" style={{ marginTop: '0.3rem' }}>
                  {r.filename} · {(r.blob.size / 1024).toFixed(1)} KB
                </div>
                {summary.section_results.some((s) => s.status.kind !== 'assembled' && s.status.kind !== 'skipped_no_draft') && (
                  <details style={{ marginTop: '0.4rem' }}>
                    <summary className="note" style={{ cursor: 'pointer' }}>
                      Section status detail ({summary.section_results.length})
                    </summary>
                    <ul style={{ listStyle: 'none', padding: 'var(--space-2)', margin: '0.4rem 0 0', fontSize: 11 }}>
                      {summary.section_results.map((s) => (
                        <li key={s.section_id} style={{ marginBottom: '0.2rem' }}>
                          <strong>{s.section_name}</strong>{' '}
                          <span className="badge">{s.status.kind}</span>
                          {s.status.kind === 'failed' && (
                            <span style={{ color: 'var(--color-danger)' }}> — {s.status.error}</span>
                          )}
                          {s.status.kind === 'skipped_unsupported_region' && (
                            <span className="muted"> — {s.status.reason}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                {isPreviewing && (
                  <div style={{ marginTop: 'var(--space-2)' }}>
                    <AssembledDocxPreview blob={r.blob} cacheKey={r.template_id} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * Compact list of past recipe runs for the project. Lets the user
 * load any historical run back into the live RecipeRunPanel for
 * inspection. Newest first.
 */
function RecipeHistoryPanel({
  runs,
  currentRunId,
  onLoadRun,
  availableModels,
  fallbackPricing,
}: {
  runs: RecipeRun[];
  currentRunId: string | null;
  onLoadRun: (run: RecipeRun) => void;
  /**
   * Full ModelInfo[] from the auth store. computeRunCost looks up
   * each model id in the run's usage_by_model breakdown and applies
   * its specific pricing — accurate even when stages used different
   * models. Pass null when models haven't been loaded yet.
   */
  availableModels: import('../lib/asksage/types').ModelInfo[] | null;
  /**
   * Fallback pricing for runs persisted before usage_by_model existed
   * — those rows only have total_tokens_in/out and we apply the
   * current drafting model's pricing as a rough estimate. Pass null
   * on Ask Sage to suppress the dollar column entirely.
   */
  fallbackPricing: import('../lib/asksage/types').ModelPricing | null;
}) {
  // Comparison-mode state. The user clicks "compare" to enable
  // multi-select; checkboxes appear next to each run; once two are
  // checked the diff panel renders below the list.
  const [compareMode, setCompareMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      // Cap at 2 — drop the oldest selection when the user adds a third.
      if (prev.length >= 2) return [prev[1]!, id];
      return [...prev, id];
    });
  }

  const selectedRuns = selectedIds
    .map((id) => runs.find((r) => r.id === id))
    .filter((r): r is RecipeRun => !!r);

  return (
    <details className="card" style={{ marginTop: 'var(--space-3)', padding: 'var(--space-2) var(--space-3)' }}>
      <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
        Recipe run history ({runs.length})
      </summary>
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: 'var(--space-2)', alignItems: 'center' }}>
        <button
          type="button"
          className={compareMode ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}
          onClick={() => {
            setCompareMode((prev) => !prev);
            setSelectedIds([]);
          }}
          disabled={runs.length < 2}
          title={runs.length < 2 ? 'Need at least two runs to compare' : 'Pick two runs to compare side-by-side'}
        >
          {compareMode ? 'exit compare' : 'compare runs'}
        </button>
        {compareMode && (
          <span className="muted" style={{ fontSize: 11 }}>
            Pick two runs ({selectedIds.length}/2 selected)
          </span>
        )}
      </div>
      <ul style={{ listStyle: 'none', padding: 0, marginTop: 'var(--space-2)' }}>
        {runs.map((r) => {
          const isCurrent = r.id === currentRunId;
          const isSelectedForCompare = selectedIds.includes(r.id);
          const statusBadge =
            r.status === 'completed'
              ? 'badge-success'
              : r.status === 'failed'
                ? 'badge-danger'
                : r.status === 'paused'
                  ? 'badge-warning'
                  : 'badge';
          return (
            <li
              key={r.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.4rem 0.6rem',
                marginBottom: '0.25rem',
                background: isCurrent
                  ? 'var(--color-primary-soft)'
                  : isSelectedForCompare
                    ? 'var(--color-warning-soft, #fff5e0)'
                    : 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-sm)',
                fontSize: 12,
              }}
            >
              {compareMode && (
                <input
                  type="checkbox"
                  checked={isSelectedForCompare}
                  onChange={() => toggleSelect(r.id)}
                  style={{ width: 'auto', margin: 0 }}
                />
              )}
              <strong>{r.recipe_name}</strong>
              <span className={`badge ${statusBadge}`}>{r.status}</span>
              <span className="muted">{new Date(r.started_at).toLocaleString()}</span>
              <span className="muted">
                {(r.total_tokens_in + r.total_tokens_out).toLocaleString()} tok
              </span>
              {(() => {
                // Prefer the per-model breakdown when present —
                // applies each stage's actual model pricing. Falls
                // back to the legacy single-pricing approximation
                // for runs persisted before usage_by_model existed.
                if (r.usage_by_model && Object.keys(r.usage_by_model).length > 0) {
                  const cost = computeRunCost(r.usage_by_model, availableModels);
                  return cost.usd_total !== null ? (
                    <span className="muted">{formatUsd(cost.usd_total)}</span>
                  ) : null;
                }
                const usd = actualUsdFromPricing(
                  r.total_tokens_in,
                  r.total_tokens_out,
                  fallbackPricing,
                );
                return usd !== null ? (
                  <span className="muted">{formatUsd(usd)}</span>
                ) : null;
              })()}
              <span style={{ marginLeft: 'auto' }} />
              {!compareMode && !isCurrent && (
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={() => onLoadRun(r)}
                >
                  load
                </button>
              )}
              {isCurrent && <span className="badge badge-primary">current</span>}
            </li>
          );
        })}
      </ul>
      {compareMode && selectedRuns.length === 2 && (
        <RecipeRunComparePanel runA={selectedRuns[0]!} runB={selectedRuns[1]!} />
      )}
    </details>
  );
}

/**
 * Side-by-side metrics comparison for two recipe runs. For each
 * stage that appears in either run we render the status, token
 * count, and elapsed duration in a two-column table. Useful for
 * "did this run cost more than the previous one?" debugging.
 *
 * Note: drafts are keyed by section, not by run, so the actual
 * drafted prose isn't snapshot per run — comparing draft text
 * across runs would require a schema change to snapshot drafts as
 * part of stage state. For now we only compare metrics; that's
 * still enough to spot regressions in token use, stage timing, and
 * stage status across runs.
 */
function RecipeRunComparePanel({ runA, runB }: { runA: RecipeRun; runB: RecipeRun }) {
  // Union of stage ids across both runs, preserving stage_states order.
  const allStageIds = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const id of Object.keys(runA.stage_states)) {
      if (!seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
    for (const id of Object.keys(runB.stage_states)) {
      if (!seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
    return out;
  }, [runA, runB]);

  function stageDuration(state: { started_at?: string; completed_at?: string } | undefined): number | null {
    if (!state?.started_at || !state.completed_at) return null;
    const d = Date.parse(state.completed_at) - Date.parse(state.started_at);
    return Number.isFinite(d) && d >= 0 ? d : null;
  }

  function stageTokens(state: { tokens_in?: number; tokens_out?: number } | undefined): number {
    return (state?.tokens_in ?? 0) + (state?.tokens_out ?? 0);
  }

  return (
    <div
      className="panel"
      style={{
        marginTop: 'var(--space-2)',
        padding: 'var(--space-2)',
        background: 'var(--color-surface-alt)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-sm)',
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: '0.4rem' }}>
        Comparing two runs · stage metrics only (draft text comparison
        requires recipe-level snapshotting; not implemented yet)
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
        <thead>
          <tr style={{ textAlign: 'left' }}>
            <th style={{ padding: '0.25rem 0.4rem', borderBottom: '1px solid var(--color-border)' }}>stage</th>
            <th style={{ padding: '0.25rem 0.4rem', borderBottom: '1px solid var(--color-border)' }}>
              {new Date(runA.started_at).toLocaleString()} (A)
            </th>
            <th style={{ padding: '0.25rem 0.4rem', borderBottom: '1px solid var(--color-border)' }}>
              {new Date(runB.started_at).toLocaleString()} (B)
            </th>
            <th style={{ padding: '0.25rem 0.4rem', borderBottom: '1px solid var(--color-border)', textAlign: 'right' }}>
              Δ usage
            </th>
            <th style={{ padding: '0.25rem 0.4rem', borderBottom: '1px solid var(--color-border)', textAlign: 'right' }}>
              Δ duration
            </th>
          </tr>
        </thead>
        <tbody>
          {allStageIds.map((id) => {
            const stA = runA.stage_states[id];
            const stB = runB.stage_states[id];
            const tokA = stageTokens(stA);
            const tokB = stageTokens(stB);
            const durA = stageDuration(stA);
            const durB = stageDuration(stB);
            const tokDelta = tokB - tokA;
            const durDelta = durA !== null && durB !== null ? durB - durA : null;
            return (
              <tr key={id}>
                <td style={{ padding: '0.2rem 0.4rem' }}>
                  <code>{id}</code>
                </td>
                <td style={{ padding: '0.2rem 0.4rem' }}>
                  {stA ? (
                    <>
                      <span className="badge">{stA.status}</span>{' '}
                      {tokA > 0 && <span className="muted">{tokA.toLocaleString()} tok</span>}{' '}
                      {durA !== null && <span className="muted">· {formatDuration(durA)}</span>}
                    </>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td style={{ padding: '0.2rem 0.4rem' }}>
                  {stB ? (
                    <>
                      <span className="badge">{stB.status}</span>{' '}
                      {tokB > 0 && <span className="muted">{tokB.toLocaleString()} tok</span>}{' '}
                      {durB !== null && <span className="muted">· {formatDuration(durB)}</span>}
                    </>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td style={{ padding: '0.2rem 0.4rem', textAlign: 'right', color: tokDelta > 0 ? 'var(--color-danger)' : tokDelta < 0 ? 'var(--color-success)' : undefined }}>
                  {tokDelta > 0 ? '+' : ''}{tokDelta.toLocaleString()}
                </td>
                <td style={{ padding: '0.2rem 0.4rem', textAlign: 'right', color: durDelta !== null && durDelta > 0 ? 'var(--color-danger)' : durDelta !== null && durDelta < 0 ? 'var(--color-success)' : undefined }}>
                  {durDelta !== null ? `${durDelta > 0 ? '+' : ''}${formatDuration(Math.abs(durDelta))}${durDelta < 0 ? ' faster' : durDelta > 0 ? ' slower' : ''}` : '—'}
                </td>
              </tr>
            );
          })}
          <tr style={{ fontWeight: 600, borderTop: '2px solid var(--color-border)' }}>
            <td style={{ padding: '0.3rem 0.4rem' }}>total</td>
            <td style={{ padding: '0.3rem 0.4rem' }}>
              {(runA.total_tokens_in + runA.total_tokens_out).toLocaleString()} tok
            </td>
            <td style={{ padding: '0.3rem 0.4rem' }}>
              {(runB.total_tokens_in + runB.total_tokens_out).toLocaleString()} tok
            </td>
            <td style={{ padding: '0.3rem 0.4rem', textAlign: 'right' }}>
              {(() => {
                const d = runB.total_tokens_in + runB.total_tokens_out - runA.total_tokens_in - runA.total_tokens_out;
                return `${d > 0 ? '+' : ''}${d.toLocaleString()}`;
              })()}
            </td>
            <td style={{ padding: '0.3rem 0.4rem', textAlign: 'right' }}>—</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function RecipeRunPanel({
  run,
  onResume,
  onCancel,
  onRetry,
  isRunning,
  availableModels,
  fallbackPricing,
  fallbackModelId,
  normalizeResolutions,
}: {
  run: RecipeRun;
  onResume: () => void;
  onCancel: () => void;
  onRetry?: () => void;
  isRunning: boolean;
  availableModels: import('../lib/asksage/types').ModelInfo[] | null;
  fallbackPricing: import('../lib/asksage/types').ModelPricing | null;
  fallbackModelId: string | null;
  /** Optional LLM normalizer injected by the parent so user-typed
   *  values get cleaned up before they hit the document. */
  normalizeResolutions?: NormalizeResolutionsFn;
}) {
  const stageEntries = Object.entries(run.stage_states);
  const pausedStage = stageEntries.find(([, s]) => s.status === 'needs_intervention');
  const failedStage = stageEntries.find(([, s]) => s.status === 'failed');
  const totalTokens = run.total_tokens_in + run.total_tokens_out;
  // Prefer the per-model breakdown when the run reported one. Falls
  // back to the legacy single-pricing approximation only for runs
  // persisted before usage_by_model existed.
  const hasBreakdown =
    run.usage_by_model !== undefined && Object.keys(run.usage_by_model).length > 0;
  const breakdown: RunCostBreakdown | null = hasBreakdown
    ? computeRunCost(run.usage_by_model!, availableModels)
    : null;
  const totalUsd = breakdown?.usd_total
    ?? actualUsdFromPricing(run.total_tokens_in, run.total_tokens_out, fallbackPricing);
  const statusColor =
    run.status === 'completed'
      ? 'badge-success'
      : run.status === 'failed'
        ? 'badge-danger'
        : run.status === 'paused'
          ? 'badge-warning'
          : 'badge-primary';

  return (
    <div className="card" style={{ marginTop: 'var(--space-3)', padding: 'var(--space-3)' }}>
      <div className="row" style={{ alignItems: 'center' }}>
        <strong>🤖 Auto-draft run · {run.recipe_name}</strong>
        <span className={`badge ${statusColor}`}>{run.status}</span>
        <span className="badge">{totalTokens.toLocaleString()} units</span>
        {totalUsd !== null && totalUsd !== undefined && (
          <span
            className="badge"
            title={
              breakdown
                ? `${breakdown.per_model.length} model${breakdown.per_model.length === 1 ? '' : 's'} · ${breakdown.web_search_results > 0 ? `${breakdown.web_search_results} web search results · ` : ''}see breakdown below`
                : `Computed from ${fallbackModelId ?? 'fallback'} pricing × total usage`
            }
          >
            {formatUsd(totalUsd)}
          </span>
        )}
        {(() => {
          // Total wall-clock time across the run. We compute it from
          // started_at + completed_at when finished, otherwise from
          // started_at + now so the user can see elapsed time on a
          // running or paused run.
          const startedMs = Date.parse(run.started_at);
          const endMs = run.completed_at
            ? Date.parse(run.completed_at)
            : Date.now();
          const elapsedMs = Math.max(0, endMs - startedMs);
          if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return null;
          return (
            <span className="badge muted" title="Wall-clock time from start to current state">
              {formatDuration(elapsedMs)}
            </span>
          );
        })()}
        <span style={{ marginLeft: 'auto' }} />
        {run.status === 'paused' && (
          <>
            <button
              type="button"
              className="btn-success btn-sm"
              onClick={onResume}
              disabled={isRunning}
            >
              {isRunning ? 'resuming…' : 'continue'}
            </button>
            <button type="button" className="btn-secondary btn-sm" onClick={onCancel}>
              cancel
            </button>
          </>
        )}
        {run.status === 'failed' && onRetry && (
          <button
            type="button"
            className="btn-success btn-sm"
            onClick={onRetry}
            disabled={isRunning}
            title="Reset the failed stage to pending and re-run from there. Earlier stages keep their completed outputs."
          >
            {isRunning ? 'retrying…' : 'retry from failed stage'}
          </button>
        )}
      </div>

      {pausedStage && pausedStage[0] === FILL_PLACEHOLDERS_STAGE_ID ? (
        <PlaceholderInterventionPanel
          stageOutput={pausedStage[1].output as PlaceholderStageOutput}
          onApplied={onResume}
          isRunning={isRunning}
          normalize={normalizeResolutions}
        />
      ) : pausedStage ? (
        <div
          className="panel"
          style={{ marginTop: 'var(--space-2)', borderLeft: '3px solid var(--color-warning)' }}
        >
          <strong>Paused at: {pausedStage[0]}</strong>
          <pre
            style={{
              background: 'var(--color-surface-alt)',
              padding: 'var(--space-2)',
              fontSize: 11,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              maxHeight: 280,
              overflow: 'auto',
              margin: '0.4rem 0 0',
              borderRadius: 'var(--radius-sm)',
            }}
          >
            {JSON.stringify(pausedStage[1].output, null, 2)}
          </pre>
        </div>
      ) : null}

      {failedStage && (
        <div className="error" style={{ marginTop: 'var(--space-2)' }}>
          <strong>Failed at: {failedStage[0]}</strong>
          {'\n'}
          {failedStage[1].error}
        </div>
      )}

      {breakdown && breakdown.per_model.length > 0 && (
        <details style={{ marginTop: 'var(--space-2)' }} open>
          <summary className="note" style={{ cursor: 'pointer' }}>
            Per-model breakdown ({breakdown.per_model.length} model
            {breakdown.per_model.length === 1 ? '' : 's'}
            {breakdown.web_search_results > 0
              ? ` · ${breakdown.web_search_results} web search result${breakdown.web_search_results === 1 ? '' : 's'}`
              : ''}
            )
          </summary>
          <table
            style={{
              width: '100%',
              fontSize: 12,
              marginTop: 'var(--space-2)',
              borderCollapse: 'collapse',
            }}
          >
            <thead>
              <tr style={{ textAlign: 'left', color: '#666' }}>
                <th style={{ padding: '0.25rem 0.5rem' }}>model</th>
                <th style={{ padding: '0.25rem 0.5rem', textAlign: 'right' }}>calls</th>
                <th style={{ padding: '0.25rem 0.5rem', textAlign: 'right' }}>in</th>
                <th style={{ padding: '0.25rem 0.5rem', textAlign: 'right' }}>out</th>
                <th style={{ padding: '0.25rem 0.5rem', textAlign: 'right' }}>web</th>
                <th style={{ padding: '0.25rem 0.5rem', textAlign: 'right' }}>cost</th>
              </tr>
            </thead>
            <tbody>
              {breakdown.per_model.map((row) => (
                <tr key={row.model} style={{ borderTop: '1px solid #eee' }}>
                  <td style={{ padding: '0.25rem 0.5rem', fontFamily: 'monospace' }}>
                    {row.model}
                    {!row.pricing && row.model !== 'unknown' && (
                      <span className="muted" title="No pricing data for this model">
                        {' '}
                        (no pricing)
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '0.25rem 0.5rem', textAlign: 'right' }}>
                    {row.calls.toLocaleString()}
                  </td>
                  <td style={{ padding: '0.25rem 0.5rem', textAlign: 'right' }}>
                    {formatTokens(row.tokens_in)}
                  </td>
                  <td style={{ padding: '0.25rem 0.5rem', textAlign: 'right' }}>
                    {formatTokens(row.tokens_out)}
                  </td>
                  <td style={{ padding: '0.25rem 0.5rem', textAlign: 'right' }}>
                    {row.web_search_results > 0 ? row.web_search_results.toLocaleString() : '—'}
                  </td>
                  <td style={{ padding: '0.25rem 0.5rem', textAlign: 'right' }}>
                    {row.usd_total !== null ? formatUsd(row.usd_total) : '—'}
                  </td>
                </tr>
              ))}
              <tr style={{ borderTop: '2px solid #ccc', fontWeight: 600 }}>
                <td style={{ padding: '0.25rem 0.5rem' }}>total</td>
                <td style={{ padding: '0.25rem 0.5rem', textAlign: 'right' }}>
                  {breakdown.calls.toLocaleString()}
                </td>
                <td style={{ padding: '0.25rem 0.5rem', textAlign: 'right' }}>
                  {formatTokens(breakdown.tokens_in)}
                </td>
                <td style={{ padding: '0.25rem 0.5rem', textAlign: 'right' }}>
                  {formatTokens(breakdown.tokens_out)}
                </td>
                <td style={{ padding: '0.25rem 0.5rem', textAlign: 'right' }}>
                  {breakdown.web_search_results > 0
                    ? breakdown.web_search_results.toLocaleString()
                    : '—'}
                </td>
                <td style={{ padding: '0.25rem 0.5rem', textAlign: 'right' }}>
                  {breakdown.usd_total !== null ? formatUsd(breakdown.usd_total) : '—'}
                </td>
              </tr>
            </tbody>
          </table>
          {breakdown.usd_web > 0 && (
            <div className="note" style={{ marginTop: '0.25rem' }}>
              Web search adds {formatUsd(breakdown.usd_web)} (
              {breakdown.web_search_results} results × ${WEB_SEARCH_USD_PER_RESULT.toFixed(3)}).
            </div>
          )}
        </details>
      )}

      <details style={{ marginTop: 'var(--space-2)' }}>
        <summary className="note" style={{ cursor: 'pointer' }}>
          Stage history ({stageEntries.length})
        </summary>
        <ul style={{ listStyle: 'none', padding: 0, marginTop: 'var(--space-2)' }}>
          {stageEntries.map(([id, state]) => (
            <li
              key={id}
              style={{
                padding: 'var(--space-1) var(--space-2)',
                borderLeft: `3px solid ${stageBorderColor(state.status)}`,
                marginBottom: '0.25rem',
                background: 'var(--color-surface)',
                fontSize: 12,
              }}
            >
              <strong>{id}</strong>{' '}
              <span className="badge">{state.status}</span>
              {state.tokens_in !== undefined && state.tokens_out !== undefined && (
                <span className="muted" style={{ marginLeft: '0.5rem' }}>
                  {(state.tokens_in + state.tokens_out).toLocaleString()} tok
                </span>
              )}
              {(() => {
                if (!state.started_at) return null;
                const startMs = Date.parse(state.started_at);
                const endMs = state.completed_at
                  ? Date.parse(state.completed_at)
                  : state.status === 'running'
                    ? Date.now()
                    : null;
                if (endMs === null || !Number.isFinite(endMs - startMs)) return null;
                const dur = Math.max(0, endMs - startMs);
                if (dur === 0) return null;
                return (
                  <span className="muted" style={{ marginLeft: '0.5rem' }}>
                    {formatDuration(dur)}
                  </span>
                );
              })()}
              {id === 'map-references-to-sections' && state.output ? (
                <MappingStageDiagnostics output={state.output as MappingStageOutputShape} />
              ) : null}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

// ─── Placeholder intervention ────────────────────────────────────

interface PlaceholderOccurrenceWithDraft extends PlaceholderOccurrence {
  draft_id: string;
  template_id: string;
  template_name: string;
  section_id: string;
  section_name: string;
}

interface PlaceholderStageOutput {
  total_placeholders: number;
  occurrences: PlaceholderOccurrenceWithDraft[];
}

/**
 * Form panel that surfaces every [INSERT: ...] placeholder the
 * drafter left in. The user types a natural-language value for each
 * one (deduped by description so two identical placeholders share an
 * input). On Apply we mutate the affected drafts in Dexie via
 * applyPlaceholderResolutions, then call onApplied (the parent's
 * resume handler) to advance the recipe past the intervention point.
 *
 * Skip-all leaves placeholders in place — the assembled DOCX still
 * exports with the literal "[INSERT: ...]" markers, which the user
 * can find-and-replace by hand later.
 */
/**
 * Optional async normalizer the parent injects so user-typed values
 * can be cleaned up by an LLM call before they hit Dexie. The panel
 * passes one request per (input_key) and gets back a map of
 * key → normalized string. When the parent doesn't provide one, the
 * panel uses the raw user values verbatim.
 */
export interface NormalizationRequest {
  input_key: string;
  section_name: string;
  description: string;
  raw_value: string;
}
export type NormalizeResolutionsFn = (
  requests: NormalizationRequest[],
) => Promise<{ values: Map<string, string>; changed: number }>;

function PlaceholderInterventionPanel({
  stageOutput,
  onApplied,
  isRunning,
  normalize,
}: {
  stageOutput: PlaceholderStageOutput;
  onApplied: () => void;
  isRunning: boolean;
  normalize?: NormalizeResolutionsFn;
}) {
  // Group occurrences by draft_id, then by description, so the form
  // shows one input per (draft, description) tuple. Two paragraphs
  // in the same section that say "[INSERT: addressee]" share an
  // input; the same description in a different section is its own
  // input (the user might want different answers).
  const groups = useMemo(() => {
    const byDraft = new Map<string, PlaceholderOccurrenceWithDraft[]>();
    for (const occ of stageOutput.occurrences) {
      let bucket = byDraft.get(occ.draft_id);
      if (!bucket) {
        bucket = [];
        byDraft.set(occ.draft_id, bucket);
      }
      bucket.push(occ);
    }
    const out: Array<{
      draft_id: string;
      template_name: string;
      section_name: string;
      uniques: Array<{
        description: string;
        occurrences: PlaceholderOccurrenceWithDraft[];
        inputKey: string;
      }>;
    }> = [];
    for (const [draftId, bucket] of byDraft) {
      const first = bucket[0]!;
      const uniques = uniquePlaceholdersByDescription(bucket).map((u) => ({
        description: u.description,
        occurrences: u.occurrences as PlaceholderOccurrenceWithDraft[],
        inputKey: `${draftId}::${u.description.toLowerCase()}`,
      }));
      out.push({
        draft_id: draftId,
        template_name: first.template_name,
        section_name: first.section_name,
        uniques,
      });
    }
    return out;
  }, [stageOutput]);

  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function onApply() {
    setBusy(true);
    try {
      // Step 1 — collect every (input_key, raw_value) pair the user
      // filled in, plus the section context the normalizer needs.
      // Build the same indexed view by group so the normalized
      // results can be looked up per input_key in step 3.
      const normalizationRequests: NormalizationRequest[] = [];
      for (const group of groups) {
        for (const u of group.uniques) {
          const raw = (values[u.inputKey] ?? '').trim();
          if (!raw) continue;
          normalizationRequests.push({
            input_key: u.inputKey,
            section_name: group.section_name,
            description: u.description,
            raw_value: raw,
          });
        }
      }

      // Step 2 — pass the raw values through the normalizer (when
      // the parent injected one). The normalizer is expected to
      // ALWAYS return a map with an entry for every input_key,
      // falling back to raw values on any error — so we can rely on
      // it without re-implementing fallback here.
      let resolved: Map<string, string>;
      let changedByNormalizer = 0;
      if (normalize && normalizationRequests.length > 0) {
        try {
          const out = await normalize(normalizationRequests);
          resolved = out.values;
          changedByNormalizer = out.changed;
        } catch (err) {
          // Fall back to raw values rather than aborting the apply.
          // eslint-disable-next-line no-console
          console.warn('[PlaceholderInterventionPanel] normalize failed; using raw values:', err);
          resolved = new Map(normalizationRequests.map((r) => [r.input_key, r.raw_value]));
        }
      } else {
        resolved = new Map(normalizationRequests.map((r) => [r.input_key, r.raw_value]));
      }

      // Step 3 — walk each draft and write the (now possibly
      // normalized) values back to Dexie. One write per draft so a
      // partial failure doesn't lose work on the others.
      let totalApplied = 0;
      let totalSkipped = 0;
      for (const group of groups) {
        const draft = await dexieDb.drafts.get(group.draft_id);
        if (!draft) continue;
        const resolutions: PlaceholderResolution[] = [];
        for (const u of group.uniques) {
          const value = resolved.get(u.inputKey) ?? '';
          if (!value) {
            totalSkipped += u.occurrences.length;
            continue;
          }
          for (const occ of u.occurrences) {
            resolutions.push({
              paragraph_index: occ.paragraph_index,
              cell_index: occ.cell_index,
              start: occ.start,
              end: occ.end,
              value,
            });
          }
        }
        if (resolutions.length === 0) continue;
        const applied = applyPlaceholderResolutions(draft.paragraphs, resolutions);
        await dexieDb.drafts.put({
          ...draft,
          paragraphs: applied.paragraphs,
        });
        totalApplied += applied.applied;
      }

      if (totalApplied > 0) {
        const normalizedNote =
          changedByNormalizer > 0
            ? ` · ${changedByNormalizer} reformatted by LLM`
            : '';
        toast.success(
          `Applied ${totalApplied} placeholder${totalApplied === 1 ? '' : 's'}${totalSkipped > 0 ? ` · ${totalSkipped} left blank` : ''}${normalizedNote}`,
        );
      } else if (totalSkipped > 0) {
        toast.info(`Left ${totalSkipped} placeholder${totalSkipped === 1 ? '' : 's'} in place`);
      }
      onApplied();
    } catch (err) {
      toast.error(`Apply failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  function onSkipAll() {
    onApplied();
  }

  const totalUniques = groups.reduce((acc, g) => acc + g.uniques.length, 0);
  const filledUniques = groups.reduce(
    (acc, g) => acc + g.uniques.filter((u) => (values[u.inputKey] ?? '').trim().length > 0).length,
    0,
  );

  return (
    <div
      className="panel"
      style={{ marginTop: 'var(--space-2)', borderLeft: '3px solid var(--color-warning)', padding: 'var(--space-3)' }}
    >
      <div className="row" style={{ alignItems: 'center', gap: '0.5rem' }}>
        <strong>Fill in missing context</strong>
        <span className="badge badge-warning">
          {filledUniques}/{totalUniques} filled
        </span>
        <span style={{ marginLeft: 'auto' }} />
        <button
          type="button"
          className="btn-success btn-sm"
          onClick={onApply}
          disabled={busy || isRunning}
        >
          {busy || isRunning ? 'applying…' : 'Apply & continue'}
        </button>
        <button
          type="button"
          className="btn-secondary btn-sm"
          onClick={onSkipAll}
          disabled={busy || isRunning}
          title="Leave all placeholders in place — the assembled DOCX will contain literal [INSERT: ...] markers you can find-and-replace later."
        >
          Skip all
        </button>
      </div>
      <p className="muted" style={{ fontSize: 12, margin: '0.4rem 0 0.6rem' }}>
        The drafter left placeholders where it had no way to ground a fact. Type a natural-language value for each
        one and click Apply &amp; continue. Leave a field blank to skip it (the placeholder stays in the assembled DOCX).
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
        {groups.map((group) => (
          <div
            key={group.draft_id}
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              padding: '0.5rem 0.7rem',
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 600 }}>
              {group.section_name}{' '}
              <span className="muted" style={{ fontWeight: 400 }}>
                · {group.template_name}
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', marginTop: '0.4rem' }}>
              {group.uniques.map((u) => (
                <label
                  key={u.inputKey}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: 12 }}
                >
                  <span style={{ flex: '0 0 40%', color: 'var(--color-text-subtle)' }}>
                    {u.description}
                    {u.occurrences.length > 1 && (
                      <span className="muted" style={{ marginLeft: '0.3rem' }}>
                        ×{u.occurrences.length}
                      </span>
                    )}
                  </span>
                  <input
                    type="text"
                    className="input input-sm"
                    style={{ flex: '1 1 auto' }}
                    value={values[u.inputKey] ?? ''}
                    placeholder={`Value for ${u.description}`}
                    onChange={(e) =>
                      setValues((prev) => ({ ...prev, [u.inputKey]: e.target.value }))
                    }
                  />
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Mapping stage diagnostics ───────────────────────────────────

interface MappingStageOutputShape {
  mappings: Array<{
    template_id: string;
    section_id: string;
    matched_chunk_ids: string[];
    estimated_content_words: number;
    drafting_strategy:
      | 'absorb_verbatim'
      | 'summarize'
      | 'expand'
      | 'use_template_only';
    reasoning?: string;
  }>;
  skipped: boolean;
}

/**
 * Per-section diagnostic table for the map-references-to-sections
 * stage. Surfaces what the mapper decided for each section so the
 * user can spot misclassifications ("why did this section get the
 * wrong chunks?") without digging into the JSON. Read directly from
 * the stage's persisted output — no extra LLM call.
 */
function MappingStageDiagnostics({ output }: { output: MappingStageOutputShape }) {
  const mappings = output.mappings ?? [];
  if (mappings.length === 0) {
    return (
      <span className="muted" style={{ marginLeft: '0.5rem', fontStyle: 'italic' }}>
        {output.skipped ? 'skipped (no references)' : 'no mappings'}
      </span>
    );
  }
  return (
    <details style={{ marginTop: '0.4rem' }}>
      <summary className="note" style={{ cursor: 'pointer', fontSize: 11 }}>
        {mappings.length} section mapping{mappings.length === 1 ? '' : 's'}
        {output.skipped ? ' (no references — synthesized fallbacks)' : ''}
      </summary>
      <table
        style={{
          width: '100%',
          marginTop: '0.4rem',
          borderCollapse: 'collapse',
          fontSize: 11,
          background: 'var(--color-surface-alt)',
        }}
      >
        <thead>
          <tr style={{ textAlign: 'left' }}>
            <th style={{ padding: '0.25rem 0.4rem', borderBottom: '1px solid var(--color-border)' }}>
              section
            </th>
            <th style={{ padding: '0.25rem 0.4rem', borderBottom: '1px solid var(--color-border)' }}>
              strategy
            </th>
            <th
              style={{
                padding: '0.25rem 0.4rem',
                borderBottom: '1px solid var(--color-border)',
                textAlign: 'right',
              }}
            >
              est. words
            </th>
            <th
              style={{
                padding: '0.25rem 0.4rem',
                borderBottom: '1px solid var(--color-border)',
                textAlign: 'right',
              }}
            >
              chunks
            </th>
            <th style={{ padding: '0.25rem 0.4rem', borderBottom: '1px solid var(--color-border)' }}>
              reasoning
            </th>
          </tr>
        </thead>
        <tbody>
          {mappings.map((m) => (
            <tr key={`${m.template_id}::${m.section_id}`}>
              <td style={{ padding: '0.2rem 0.4rem', verticalAlign: 'top' }}>
                <code>{m.section_id}</code>
              </td>
              <td style={{ padding: '0.2rem 0.4rem', verticalAlign: 'top' }}>
                <span
                  className="badge"
                  style={{
                    background: strategyColor(m.drafting_strategy),
                    color: 'white',
                    fontSize: 10,
                  }}
                >
                  {m.drafting_strategy}
                </span>
              </td>
              <td style={{ padding: '0.2rem 0.4rem', textAlign: 'right', verticalAlign: 'top' }}>
                {m.estimated_content_words.toLocaleString()}
              </td>
              <td style={{ padding: '0.2rem 0.4rem', textAlign: 'right', verticalAlign: 'top' }}>
                {m.matched_chunk_ids.length}
              </td>
              <td
                style={{
                  padding: '0.2rem 0.4rem',
                  verticalAlign: 'top',
                  color: 'var(--color-text-subtle)',
                }}
              >
                {m.reasoning ?? '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

function strategyColor(strategy: MappingStageOutputShape['mappings'][number]['drafting_strategy']): string {
  switch (strategy) {
    case 'absorb_verbatim':
      return 'var(--color-success, #2d7a3a)';
    case 'summarize':
      return 'var(--color-primary, #2d5aa0)';
    case 'expand':
      return 'var(--color-warning, #a06b1f)';
    case 'use_template_only':
    default:
      return 'var(--color-text-subtle, #666)';
  }
}

/** Format a millisecond duration as a compact human string. */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  const m = Math.floor(s / 60);
  const rs = Math.round(s - m * 60);
  return `${m}m${rs.toString().padStart(2, '0')}s`;
}

function stageBorderColor(status: string): string {
  switch (status) {
    case 'completed':
      return 'var(--color-success)';
    case 'failed':
      return 'var(--color-danger)';
    case 'needs_intervention':
      return 'var(--color-warning)';
    case 'running':
      return 'var(--color-primary)';
    default:
      return 'var(--color-border)';
  }
}

function ProjectTemplatesEditor({
  project,
  allTemplates,
  currentlySelected,
}: {
  project: ProjectRecord;
  allTemplates: TemplateRecord[];
  currentlySelected: TemplateRecord[];
}) {
  const [search, setSearch] = useState('');

  const selectedIds = new Set(project.template_ids);
  const available = allTemplates.filter((t) => !selectedIds.has(t.id));
  const filteredAvailable = available.filter((t) =>
    search.trim()
      ? `${t.name} ${t.filename}`.toLowerCase().includes(search.trim().toLowerCase())
      : true,
  );

  async function onAdd(templateId: string) {
    if (selectedIds.has(templateId)) return;
    try {
      await updateProject(project.id, {
        template_ids: [...project.template_ids, templateId],
      });
      const tpl = allTemplates.find((t) => t.id === templateId);
      toast.success(`Added "${tpl?.name ?? templateId}" to the project`);
    } catch (err) {
      toast.error(`Add failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function onRemove(templateId: string) {
    const next = project.template_ids.filter((id) => id !== templateId);
    try {
      await updateProject(project.id, { template_ids: next });
      const tpl = allTemplates.find((t) => t.id === templateId);
      toast.info(
        `Removed "${tpl?.name ?? templateId}" from the project. Existing drafts for that template are kept on disk but no longer surfaced — re-add the template to see them.`,
      );
    } catch (err) {
      toast.error(`Remove failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return (
    <>
      <h2>
        Templates{' '}
        <span className="badge" style={{ marginLeft: '0.4rem' }}>
          {currentlySelected.length} selected · {available.length} available
        </span>
      </h2>
      <p className="note">
        The set of templates this project will draft. Add or remove freely.
        Removing a template doesn't delete its drafts from disk — they're
        just hidden until you re-add it.
      </p>

      {currentlySelected.length === 0 ? (
        <EmptyState
          title="No templates yet"
          body="Pick at least one template below to enable drafting."
        />
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, marginTop: 'var(--space-2)' }}>
          {currentlySelected.map((t) => (
            <li
              key={t.id}
              className="card"
              style={{
                marginBottom: 'var(--space-2)',
                padding: 'var(--space-2) var(--space-3)',
              }}
            >
              <div className="row" style={{ alignItems: 'center' }}>
                <strong>{t.name}</strong>
                <span className="badge">
                  {t.schema_json.sections.length} section
                  {t.schema_json.sections.length === 1 ? '' : 's'}
                </span>
                {t.schema_json.source.semantic_synthesizer === null && (
                  <span className="badge badge-warning">needs synthesis</span>
                )}
                <span style={{ marginLeft: 'auto' }} />
                <button
                  type="button"
                  className="btn-danger btn-sm"
                  onClick={() => void onRemove(t.id)}
                >
                  remove
                </button>
              </div>
              <div className="note" style={{ marginTop: '0.3rem' }}>
                {t.filename}
              </div>
            </li>
          ))}
        </ul>
      )}

      {available.length > 0 && (
        <details style={{ marginTop: 'var(--space-3)' }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
            Add a template ({available.length} available)
          </summary>
          <div style={{ marginTop: 'var(--space-2)' }}>
            <input
              type="text"
              placeholder="Filter by name or filename…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <ul style={{ listStyle: 'none', padding: 0, marginTop: 'var(--space-2)', maxHeight: 280, overflow: 'auto' }}>
              {filteredAvailable.map((t) => (
                <li
                  key={t.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    padding: 'var(--space-2) var(--space-3)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-sm)',
                    marginBottom: '0.25rem',
                    background: 'var(--color-surface)',
                  }}
                >
                  <strong>{t.name}</strong>
                  <span className="note">{t.filename}</span>
                  <span className="badge">
                    {t.schema_json.sections.length} sec
                  </span>
                  <span style={{ marginLeft: 'auto' }} />
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={() => void onAdd(t.id)}
                  >
                    add
                  </button>
                </li>
              ))}
              {filteredAvailable.length === 0 && (
                <p className="note">No templates match "{search}".</p>
              )}
            </ul>
          </div>
        </details>
      )}
      {available.length === 0 && currentlySelected.length > 0 && (
        <p className="note">
          All your templates are in this project. Upload more on the{' '}
          <Link to="/templates">Templates</Link> tab.
        </p>
      )}
    </>
  );
}

function SharedInputControl({
  field,
  value,
  meta,
  onChange,
}: {
  field: SharedInputField;
  value: string;
  meta?: NonNullable<ProjectRecord['shared_inputs_meta']>[string];
  onChange: (v: string) => void;
}) {
  const id = `field-${field.key}`;
  const isAutoFilled = meta?.source.startsWith('preflight') ?? false;
  const sourceLabel = meta?.source.replace('preflight:', '') ?? null;

  return (
    <div
      style={{
        marginBottom: '0.5rem',
        // Subtle highlight on auto-filled rows so the user's eye is drawn there.
        ...(isAutoFilled
          ? {
              padding: '0.4rem 0.6rem',
              border: '1px solid var(--color-primary)',
              borderLeft: '3px solid var(--color-primary)',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--color-primary-soft)',
            }
          : {}),
      }}
    >
      <label htmlFor={id} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
        <span>{field.display_name}</span>
        {field.required && <span style={{ color: '#b00' }}>*</span>}
        {isAutoFilled && (
          <span
            className="badge badge-primary"
            title={`Auto-filled by the recipe pre-flight (source: ${sourceLabel}${meta?.source_label ? ` — ${meta.source_label}` : ''}${meta?.confidence !== undefined ? `, confidence ${(meta.confidence * 100).toFixed(0)}%` : ''}). Click the field to edit; the badge clears on manual edit.`}
          >
            auto-filled · {sourceLabel}
          </span>
        )}
      </label>
      {field.allowed_values && field.allowed_values.length > 0 ? (
        <select
          id={id}
          value={value}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => onChange(e.target.value)}
          style={{ width: '100%', padding: '0.5rem', font: 'inherit' }}
        >
          <option value="">— select —</option>
          {field.allowed_values.map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          type={field.control_type === 'date' ? 'date' : 'text'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      <p className="note">
        Used by {field.template_ids.length} template{field.template_ids.length === 1 ? '' : 's'} · type: {field.control_type}
        {isAutoFilled && meta?.filled_at && (
          <> · filled {new Date(meta.filled_at).toLocaleString()}</>
        )}
      </p>
    </div>
  );
}

// ─── Project description editor (auto-save) ──────────────────────

/**
 * Editable project description with debounced auto-save. Replaces the
 * legacy static <p> render. Keystrokes update local state immediately;
 * 500ms after the user stops typing we write to Dexie. The "saved" /
 * "saving…" indicator next to the field tells the user their input is
 * persisted (or about to be).
 */
function ProjectDescriptionEditor({ project }: { project: ProjectRecord }) {
  const [text, setText] = useState(project.description ?? '');
  const [status, setStatus] = useState<'idle' | 'pending' | 'saving' | 'saved'>('idle');
  // Track the last value we saved so we don't write the same string
  // again on every blur or remount.
  const lastSavedRef = useRef(project.description ?? '');

  // If the project loads/changes (e.g. on first mount or after an
  // import), sync local state from props.
  useEffect(() => {
    setText(project.description ?? '');
    lastSavedRef.current = project.description ?? '';
    setStatus('idle');
  }, [project.id]);

  // Debounced save. Cancels on every keystroke; runs 500ms after the
  // last edit.
  useEffect(() => {
    if (text === lastSavedRef.current) return;
    setStatus('pending');
    const timer = window.setTimeout(async () => {
      setStatus('saving');
      try {
        await updateProject(project.id, { description: text });
        lastSavedRef.current = text;
        setStatus('saved');
        // Drop the indicator back to idle after a beat so it doesn't
        // shout at the user forever.
        window.setTimeout(() => setStatus('idle'), 1500);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[ProjectDescriptionEditor] save failed:', err);
        setStatus('idle');
      }
    }, 500);
    return () => window.clearTimeout(timer);
  }, [text, project.id]);

  return (
    <div style={{ marginBottom: 'var(--space-3)' }}>
      <label
        htmlFor="project-description-input"
        style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', fontSize: 12, color: 'var(--color-text-subtle)' }}
      >
        <span>Description</span>
        {status === 'pending' && <span className="muted">·</span>}
        {status === 'saving' && <span className="muted">saving…</span>}
        {status === 'saved' && <span style={{ color: 'var(--color-success, #2d7a3a)' }}>saved</span>}
      </label>
      <textarea
        id="project-description-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder="What is this document about? (e.g. 'Lateral transfer of SPC Baumgartner from C Co to B Co, effective 15 April 2026')"
        style={{
          width: '100%',
          padding: '0.5rem 0.6rem',
          font: 'inherit',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-sm)',
          background: 'var(--color-surface)',
          resize: 'vertical',
        }}
      />
    </div>
  );
}

// ─── Empty-state checklist ────────────────────────────────────────

/**
 * Onboarding checklist shown when a project has no templates, no
 * description, and no context items. Replaces the wall of disabled
 * buttons with concrete next steps. Disappears as soon as the user
 * satisfies any one of the conditions.
 */
function FreshProjectChecklist() {
  return (
    <div
      style={{
        marginBottom: 'var(--space-3)',
        padding: 'var(--space-3)',
        background: 'var(--color-primary-soft, #eef3fb)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-sm)',
      }}
    >
      <strong>Get started</strong>
      <ol style={{ margin: '0.5rem 0 0 1.25rem', padding: 0, fontSize: 13 }}>
        <li><strong>Pick a template</strong> from the Templates section below — this gives the document its structure.</li>
        <li>
          <strong>Describe what you're drafting</strong> in the Description field above — one or two
          sentences telling the model what this document is about.
        </li>
        <li>
          <strong>(Optional) Add notes or reference files</strong> below the templates section. Notes
          are user-authored hints; reference files give the drafter substance to absorb.
        </li>
        <li>
          When ready, click <strong>🤖 Auto-draft this project</strong> — the recipe runner will
          handle preflight, drafting, and assembly.
        </li>
      </ol>
    </div>
  );
}

function TemplateDraftedSections({
  template,
  drafts,
  project,
}: {
  template: TemplateRecord;
  drafts: Map<string, DraftRecord>;
  project: ProjectRecord;
}) {
  return (
    <section style={{ marginTop: '1rem', borderTop: '1px solid #ddd', paddingTop: '0.75rem' }}>
      <h3>{template.name}</h3>
      {template.schema_json.sections.length === 0 && (
        <p className="note">No sections in this template's schema. Run synthesis on the Templates tab.</p>
      )}
      {template.schema_json.sections.map((section) => {
        const draft = drafts.get(`${template.id}::${section.id}`);
        return (
          <SectionCard
            key={section.id}
            template={template}
            section={section}
            draft={draft}
            project={project}
          />
        );
      })}
    </section>
  );
}

/**
 * One section row in the project workspace. Combines:
 *   - readout / status badges (token count, placeholder count)
 *   - rendered paragraphs (read-only by default)
 *   - inline editor (toggled via the "edit" button) — writes back to
 *     DraftRecord.paragraphs in Dexie on save, no LLM call
 *   - validation issues
 *   - diagnostics (prompt + chunk-id provenance) when expanded
 */
function SectionCard({
  template,
  section,
  draft,
  project,
}: {
  template: TemplateRecord;
  section: BodyFillRegion;
  draft: DraftRecord | undefined;
  project: ProjectRecord;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [isRedrafting, setIsRedrafting] = useState(false);
  const [showSideBySide, setShowSideBySide] = useState(false);

  const issues = draft && draft.status === 'ready'
    ? runValidation(section, draft.paragraphs)
    : [];

  // Count [INSERT: ...] placeholders so the user can find sections
  // that still need attention at a glance. Computed on every render
  // (cheap — regex over a few hundred chars).
  const placeholderCount = draft && draft.status === 'ready'
    ? scanDraftForPlaceholders(draft.paragraphs).length
    : 0;

  return (
    <div
      style={{
        marginBottom: '0.75rem',
        padding: '0.5rem 0.75rem',
        border: '1px solid #ccd',
        background: '#fafbff',
        borderRadius: 4,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', flexWrap: 'wrap' }}>
        <strong>{section.name}</strong>
        {placeholderCount > 0 && (
          <span
            className="badge"
            style={{ background: 'var(--color-warning, #d4a000)', color: 'white', fontSize: 10 }}
            title={`${placeholderCount} [INSERT: ...] placeholder${placeholderCount === 1 ? '' : 's'} still need to be filled in`}
          >
            {placeholderCount} placeholder{placeholderCount === 1 ? '' : 's'}
          </span>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#666' }}>
          {draft ? `${draft.status} · ${draft.tokens_in + draft.tokens_out} units` : 'not drafted'}
        </span>
        {draft && draft.status === 'ready' && !isEditing && !isRedrafting && (
          <>
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => setShowSideBySide((prev) => !prev)}
              title="Show the template example, the drafted output, and the chunks the section pulled from side-by-side."
            >
              {showSideBySide ? 'hide context' : 'context'}
            </button>
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => setIsEditing(true)}
              title="Edit this section's text in place. Writes back to local storage; does not call the LLM."
            >
              edit
            </button>
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => setIsRedrafting(true)}
              title="Re-run the per-section drafter on this one section with optional revision notes."
            >
              redraft
            </button>
          </>
        )}
      </div>
      {section.intent && (
        <div className="note">{section.intent}</div>
      )}
      {draft?.status === 'error' && (
        <div className="error">Draft failed: {draft.error}</div>
      )}
      {draft?.status === 'ready' && draft.paragraphs.length > 0 && !isEditing && (
        <DraftParagraphList paragraphs={draft.paragraphs} />
      )}
      {draft?.status === 'ready' && isEditing && (
        <SectionInlineEditor
          draft={draft}
          onCancel={() => setIsEditing(false)}
          onSaved={() => setIsEditing(false)}
        />
      )}
      {isRedrafting && (
        <SectionRedraftPanel
          template={template}
          section={section}
          project={project}
          onCancel={() => setIsRedrafting(false)}
          onDone={() => setIsRedrafting(false)}
        />
      )}
      {showSideBySide && draft && draft.status === 'ready' && (
        <SectionSideBySidePanel
          template={template}
          section={section}
          draft={draft}
        />
      )}
      {issues.length > 0 && (
        <div style={{ marginTop: '0.5rem', padding: '0.4rem', background: '#fff5e0', border: '1px solid #d4a000', fontSize: 12 }}>
          <strong>Validation issues:</strong>
          <ul style={{ margin: '0.25rem 0 0 1rem', padding: 0 }}>
            {issues.map((iss, i) => (
              <li key={i} style={{ color: iss.severity === 'error' ? '#900' : '#860' }}>
                [{iss.severity}] {iss.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      {draft && (draft.prompt_sent || draft.references) && (
        <DraftDiagnostics draft={draft} template={template} />
      )}
    </div>
  );
}

/**
 * Per-section redraft form. Renders a small textarea where the user
 * can type revision notes ("make this shorter", "use more formal
 * language", "expand the rationale paragraph"), then re-runs the
 * drafter on JUST this section with the notes inlined as the
 * revision_notes_block. Writes the new draft straight to Dexie.
 *
 * Skips the critic loop and the cross-section review pass — this is
 * a one-shot redraft, not a recipe re-run. The mapping for this
 * section (chunks + drafting strategy) is honored if it exists in
 * the most recent recipe run.
 */
function SectionRedraftPanel({
  template,
  section,
  project,
  onCancel,
  onDone,
}: {
  template: TemplateRecord;
  section: BodyFillRegion;
  project: ProjectRecord;
  onCancel: () => void;
  onDone: () => void;
}) {
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const apiKey = useAuth((s) => s.apiKey);
  const baseUrl = useAuth((s) => s.baseUrl);
  const provider = useAuth((s) => s.provider);

  async function onSubmit() {
    if (!apiKey) {
      toast.error('Connect a provider on the Connection tab first.');
      return;
    }
    setBusy(true);
    try {
      const client = createLLMClient({ provider, baseUrl, apiKey });

      // Re-build the per-section context the drafter expects: parse
      // the template DOCX once for the example slice, then build the
      // references block from whatever chunks the most recent run
      // pinned (or fall back to a fresh selection if nothing is
      // pinned). The redraft prompt gets the same blocks as a normal
      // recipe-driven section call, plus the user's revision notes.
      const { extractParagraphs } = await import('../lib/template/parser');
      const { sliceTemplateExampleForSection } = await import('../lib/draft/template_slice');
      const { selectChunksForSection, renderSelectedChunks } = await import('../lib/project/chunk');
      const { classifySectionSize } = await import('../lib/draft/section_size');
      const { draftSection } = await import('../lib/draft/drafter');
      const { renderNotesBlock } = await import('../lib/project/context');
      const { extractReferencesForRun } = await import('../lib/draft/file_extract');

      const paragraphs = await extractParagraphs(template.docx_bytes);
      const templateExample = sliceTemplateExampleForSection(paragraphs, section);

      const items = (project.context_items ?? []);
      const files = items.filter(
        (i): i is ProjectContextFile => i.kind === 'file',
      );
      const { extractedById } = await extractReferencesForRun({
        client,
        project,
        files,
      });

      const sizeClass = classifySectionSize({
        section,
        template_example: templateExample,
      });
      const selected = selectChunksForSection({
        files,
        extractedById,
        section,
        template_example: templateExample,
        size_class: sizeClass,
      });
      const totalChunkCount = files.reduce(
        (acc, f) => acc + (f.chunks?.length ?? 0),
        0,
      );
      const referencesBlock = renderSelectedChunks(selected, totalChunkCount);
      const notesBlock = renderNotesBlock(items);

      // Format the user's revision notes the same way the critic
      // loop would. Inline as a labeled block immediately after the
      // SUBJECT block in the prompt.
      const userNotesBlock = notes.trim().length > 0
        ? `=== REVISION NOTES (user-supplied) ===\n${notes.trim()}\n=== END REVISION NOTES ===`
        : null;

      const result = await draftSection(client, {
        template: template.schema_json,
        section,
        project_description: project.description,
        shared_inputs: project.shared_inputs,
        prior_summaries: [],
        notes_block: notesBlock,
        references_block: referencesBlock,
        template_example: templateExample,
        revision_notes_block: userNotesBlock,
      });

      const id = `${project.id}::${template.id}::${section.id}`;
      await dexieDb.drafts.put({
        id,
        project_id: project.id,
        template_id: template.id,
        section_id: section.id,
        paragraphs: result.paragraphs,
        references: result.references,
        prompt_sent: result.prompt_sent,
        status: 'ready',
        generated_at: new Date().toISOString(),
        model: result.model,
        tokens_in: result.tokens_in,
        tokens_out: result.tokens_out,
        references_inlined_chars: referencesBlock?.length ?? 0,
        references_inlined_chunks: selected.length,
        references_inlined_chunk_ids: selected.map((c) => c.chunk_id),
      });
      toast.success(
        `Redrafted "${section.name}" · ${(result.tokens_in + result.tokens_out).toLocaleString()} units used`,
      );
      onDone();
    } catch (err) {
      toast.error(`Redraft failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: '0.5rem', padding: '0.5rem', background: '#fff', border: '1px dashed #2d5aa0', borderRadius: 4 }}>
      <label style={{ fontSize: 12, fontWeight: 600 }}>Revision notes (optional)</label>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={3}
        placeholder="e.g. 'Make this paragraph shorter and drop the procedural detail.'"
        style={{
          width: '100%',
          marginTop: '0.3rem',
          padding: '0.4rem 0.5rem',
          font: 'inherit',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-sm)',
          resize: 'vertical',
        }}
      />
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', alignItems: 'center' }}>
        <button type="button" className="btn-success btn-sm" onClick={() => void onSubmit()} disabled={busy}>
          {busy ? 'redrafting…' : 'Redraft this section'}
        </button>
        <button type="button" className="btn-secondary btn-sm" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <span className="muted" style={{ fontSize: 11 }}>
          One LLM call · skips the critic loop · overwrites the current draft.
        </span>
      </div>
    </div>
  );
}

/**
 * Side-by-side context panel for one section. Three columns:
 *   - the template example for THIS section (what the source DOCX
 *     looked like in the same anchor range)
 *   - the drafted output (just the body text, role-tagged)
 *   - the reference chunks the section pulled from (titles + bodies)
 *
 * Reads the chunk metadata from Dexie via the project's context
 * items, keyed by the chunk ids the orchestrator persisted on the
 * draft record. Lazy-loads on expand so a project with dozens of
 * sections doesn't pay the cost up front.
 */
function SectionSideBySidePanel({
  template,
  section,
  draft,
}: {
  template: TemplateRecord;
  section: BodyFillRegion;
  draft: DraftRecord;
}) {
  // Resolve the chunk ids → chunk text via Dexie. Lazy via
  // useLiveQuery so a stale draft (with no chunk ids) just shows an
  // empty panel.
  const inlinedIds = draft.references_inlined_chunk_ids ?? [];
  const chunks = useLiveQuery(async () => {
    if (inlinedIds.length === 0) return [];
    const proj = await dexieDb.projects.get(draft.project_id);
    if (!proj) return [];
    const wanted = new Set(inlinedIds);
    const out: Array<{ id: string; title: string; source_file: string; text: string }> = [];
    for (const item of proj.context_items ?? []) {
      if (item.kind !== 'file') continue;
      for (const c of item.chunks ?? []) {
        if (wanted.has(c.id)) {
          out.push({ id: c.id, title: c.title, source_file: item.filename, text: c.text });
        }
      }
    }
    return out;
  }, [draft.project_id, inlinedIds.join('|')]);

  // Compute the template example slice on demand. Stored on the
  // template DOCX, sliced via the existing helper. We use a state
  // hook because the slice helper is async (it parses the DOCX).
  const [templateExample, setTemplateExample] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { extractParagraphs } = await import('../lib/template/parser');
        const { sliceTemplateExampleForSection } = await import('../lib/draft/template_slice');
        const paragraphs = await extractParagraphs(template.docx_bytes);
        if (cancelled) return;
        setTemplateExample(sliceTemplateExampleForSection(paragraphs, section));
      } catch {
        if (!cancelled) setTemplateExample(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [template.id, section.id]);

  const colStyle: React.CSSProperties = {
    flex: '1 1 0',
    minWidth: 0,
    background: 'var(--color-surface-alt, #f6f6fa)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-sm)',
    padding: '0.5rem',
  };
  const headerStyle: React.CSSProperties = {
    fontSize: 10,
    fontWeight: 600,
    color: 'var(--color-text-subtle)',
    textTransform: 'uppercase',
    marginBottom: '0.3rem',
  };
  const preStyle: React.CSSProperties = {
    fontSize: 11,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    margin: 0,
    maxHeight: 360,
    overflow: 'auto',
  };

  return (
    <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
      <div style={colStyle}>
        <div style={headerStyle}>Template example</div>
        <pre style={preStyle}>{templateExample ?? '(no example available)'}</pre>
      </div>
      <div style={colStyle}>
        <div style={headerStyle}>Drafted output</div>
        <pre style={preStyle}>
          {draft.paragraphs.map((p) => `[${p.role}] ${p.text}`).join('\n')}
        </pre>
      </div>
      <div style={colStyle}>
        <div style={headerStyle}>
          Inlined chunks ({chunks?.length ?? 0})
        </div>
        {(!chunks || chunks.length === 0) && (
          <p className="muted" style={{ fontSize: 11, margin: 0 }}>
            No chunks were inlined into this section's prompt.
          </p>
        )}
        {chunks && chunks.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {chunks.map((c) => (
              <details key={c.id} style={{ background: 'white', borderRadius: 'var(--radius-sm)', padding: '0.3rem 0.4rem' }}>
                <summary style={{ fontSize: 11, cursor: 'pointer' }}>
                  <strong>{c.title}</strong>{' '}
                  <span className="muted">· {c.source_file} · {c.text.length.toLocaleString()} chars</span>
                </summary>
                <pre style={{ ...preStyle, marginTop: '0.3rem' }}>{c.text}</pre>
              </details>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Inline editor for a single drafted section. Shows one input per
 * paragraph (preserving role tags), with save/cancel buttons. Writes
 * back to Dexie on save with no LLM round-trip; the section's role
 * structure is preserved so assembly still maps each paragraph to its
 * template style.
 */
function SectionInlineEditor({
  draft,
  onCancel,
  onSaved,
}: {
  draft: DraftRecord;
  onCancel: () => void;
  onSaved: () => void;
}) {
  // Local working copy. Cancel discards; save writes to Dexie.
  const [working, setWorking] = useState<DraftRecord['paragraphs']>(() =>
    draft.paragraphs.map((p) => ({ ...p })),
  );
  const [busy, setBusy] = useState(false);

  function updateText(idx: number, next: string) {
    setWorking((prev) => prev.map((p, i) => (i === idx ? { ...p, text: next } : p)));
  }

  async function onSave() {
    setBusy(true);
    try {
      await dexieDb.drafts.put({
        ...draft,
        paragraphs: working,
        generated_at: new Date().toISOString(),
      });
      toast.success('Section updated');
      onSaved();
    } catch (err) {
      toast.error(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: '0.5rem', padding: '0.5rem', background: 'white', border: '1px dashed #aac', borderRadius: 4 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
        {working.map((p, idx) => (
          <div key={idx} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
            <span
              className="badge"
              style={{
                fontSize: 10,
                fontFamily: 'monospace',
                flex: '0 0 70px',
                textAlign: 'center',
                marginTop: '0.25rem',
              }}
              title={`role: ${p.role}`}
            >
              {p.role}
            </span>
            <textarea
              value={p.text}
              onChange={(e) => updateText(idx, e.target.value)}
              rows={Math.max(1, Math.ceil(p.text.length / 80))}
              style={{
                flex: '1 1 auto',
                padding: '0.4rem 0.5rem',
                font: 'inherit',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-sm)',
                background: '#fcfcff',
                resize: 'vertical',
              }}
            />
          </div>
        ))}
      </div>
      <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        <button type="button" className="btn-success btn-sm" onClick={() => void onSave()} disabled={busy}>
          {busy ? 'saving…' : 'Save'}
        </button>
        <button type="button" className="btn-secondary btn-sm" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <span className="muted" style={{ fontSize: 11 }}>
          Edits write to local storage only — no LLM call. Use “redraft” for an LLM-driven revision.
        </span>
      </div>
    </div>
  );
}

/**
 * Per-section diagnostic panel — collapses by default, expands to
 * show the EXACT prompt the LLM saw and the references Ask Sage
 * returned. This is the diagnostic loop we kept needing during the
 * transfusion / SHARP investigation.
 */
// extractedTextFromRet now lives in lib/asksage/extract — imported above.

function DraftDiagnostics({
  draft,
  template: _template,
}: {
  draft: DraftRecord;
  template?: TemplateRecord;
}) {
  const promptChars = draft.prompt_sent?.length ?? 0;
  // The legacy `draft.references` field is the dataset-RAG-only
  // response from Ask Sage and is always empty under the inline-
  // references architecture (drafting uses dataset='none' and inlines
  // selected chunks directly into the prompt). The fields the user
  // actually wants to see are the per-section inlined ATTACHED
  // REFERENCES counts written by the orchestrator.
  const inlinedRefsChars = draft.references_inlined_chars ?? 0;
  const inlinedRefsChunks = draft.references_inlined_chunks ?? 0;
  const inlinedChunkIds = draft.references_inlined_chunk_ids ?? [];

  // Resolve chunk ids → chunk metadata via the live project record
  // (we need it via Dexie for chunk titles + source filenames). The
  // section-level diagnostics is on-demand so we look up lazily on
  // expand. For the summary line we just show the count.
  const projectId = draft.project_id;
  const chunkLookup = useLiveQuery(
    async () => (inlinedChunkIds.length > 0 ? loadChunksByIds(projectId, inlinedChunkIds) : new Map()),
    [projectId, inlinedChunkIds.join('|')],
  );

  return (
    <details style={{ marginTop: '0.5rem' }}>
      <summary className="note" style={{ cursor: 'pointer' }}>
        Diagnostics — prompt ({promptChars.toLocaleString()} chars) · inlined refs ({inlinedRefsChunks} chunk{inlinedRefsChunks === 1 ? '' : 's'}, {inlinedRefsChars.toLocaleString()} chars) · model {draft.model}
      </summary>
      {inlinedChunkIds.length > 0 && (
        <div style={{ marginTop: '0.4rem' }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-subtle)' }}>
            INLINED CHUNKS ({inlinedChunkIds.length})
          </div>
          <ul style={{ listStyle: 'none', padding: 0, margin: '0.3rem 0', fontSize: 11 }}>
            {inlinedChunkIds.map((id) => {
              const meta = chunkLookup?.get(id);
              return (
                <li
                  key={id}
                  style={{
                    padding: '0.2rem 0.4rem',
                    borderLeft: '3px solid var(--color-primary, #2d5aa0)',
                    marginBottom: '0.15rem',
                    background: 'var(--color-surface-alt)',
                  }}
                >
                  {meta ? (
                    <>
                      <strong>{meta.title}</strong>
                      <span className="muted"> · {meta.source_file} · {meta.chars.toLocaleString()} chars</span>
                    </>
                  ) : (
                    <code>{id}</code>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <div style={{ marginTop: '0.4rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-subtle)' }}>
            PROMPT SENT
          </div>
          <pre
            style={{
              background: 'var(--color-surface-alt)',
              padding: 'var(--space-2)',
              fontSize: 11,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              maxHeight: 360,
              overflow: 'auto',
              margin: 0,
              borderRadius: 'var(--radius-sm)',
            }}
          >
            {draft.prompt_sent || '(no prompt captured)'}
          </pre>
        </div>
        <div>
          <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-subtle)' }}>
            REFERENCES RETURNED BY ASK SAGE
          </div>
          <pre
            style={{
              background: 'var(--color-surface-alt)',
              padding: 'var(--space-2)',
              fontSize: 11,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              maxHeight: 360,
              overflow: 'auto',
              margin: 0,
              borderRadius: 'var(--radius-sm)',
            }}
          >
            {draft.references || '(no references returned)'}
          </pre>
        </div>
      </div>
    </details>
  );
}

/**
 * Helper used by DraftDiagnostics to look up chunk metadata for the
 * inlined chunk ids. Loads the project from Dexie, walks every
 * file's chunks, and returns a Map<chunk_id, {title, source_file, chars}>.
 * Cheap — Dexie reads are local; the chunk arrays are small.
 */
async function loadChunksByIds(
  projectId: string,
  chunkIds: string[],
): Promise<Map<string, { title: string; source_file: string; chars: number }>> {
  const out = new Map<string, { title: string; source_file: string; chars: number }>();
  if (chunkIds.length === 0) return out;
  const project = await dexieDb.projects.get(projectId);
  if (!project) return out;
  const wanted = new Set(chunkIds);
  for (const item of project.context_items ?? []) {
    if (item.kind !== 'file') continue;
    for (const c of item.chunks ?? []) {
      if (!wanted.has(c.id)) continue;
      out.set(c.id, { title: c.title, source_file: item.filename, chars: c.text.length });
    }
  }
  return out;
}

function ProjectContextSection({ project }: { project: ProjectRecord }) {
  const items = getContextItems(project);
  const notes = items.filter((i) => i.kind === 'note');
  const files = items.filter((i) => i.kind === 'file');
  const orphaned = hasOrphanedV4Files(project);

  const apiKey = useAuth((s) => s.apiKey);
  const baseUrl = useAuth((s) => s.baseUrl);
  const provider = useAuth((s) => s.provider);
  const onAskSage = provider === 'asksage';

  const totalReferenceBytes = files.reduce(
    (acc, f) => acc + (f.kind === 'file' ? f.size_bytes : 0),
    0,
  );

  const [noteDraft, setNoteDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [attaching, setAttaching] = useState(false);

  // Per-file extraction preview cache. Lives in component state for the
  // session — not persisted, since the source of truth is the file
  // bytes and the actual draft-time extraction is what matters. This
  // is purely a "show me what Ask Sage will see" diagnostic.
  interface ExtractionPreview {
    chars: number;
    tokens: number | null;
    snippet: string;
    fetchedAt: number;
  }
  const [previews, setPreviews] = useState<Record<string, ExtractionPreview>>({});
  const [previewLoading, setPreviewLoading] = useState<string | null>(null);
  const [chunkingId, setChunkingId] = useState<string | null>(null);

  async function onAttach(file: File) {
    setAttaching(true);
    let attached: ProjectContextFile | null = null;
    try {
      attached = await attachProjectFile(project.id, file);
      toast.success(
        `${file.name} attached · ${(attached.size_bytes / 1024).toFixed(1)} KB`,
      );
    } catch (err) {
      toast.error(`Attach failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setAttaching(false);
    }

    // Phase 1 (agentic auto-triggers): immediately run /server/file
    // extraction on the new attachment so the user sees the extracted
    // char/token count without having to click "test extract". Only
    // fires when connected to Ask Sage. Chunking stays manual per
    // design decision 5=A — that's a heavier per-file LLM round-trip
    // and shouldn't run until the user is committed to the file.
    // Wrapped so an extraction failure can't break the attach flow.
    if (attached && apiKey && onAskSage) {
      void onTestExtraction(attached);
    }
  }

  async function onTestExtraction(fileItem: ProjectContextFile) {
    if (!apiKey || !onAskSage) {
      toast.error('Connect to Ask Sage on the Connection tab first.');
      return;
    }
    setPreviewLoading(fileItem.id);
    try {
      const client = new AskSageClient(baseUrl, apiKey);
      const fileObj = new File([fileItem.bytes], fileItem.filename, {
        type: fileItem.mime_type || 'application/octet-stream',
      });
      const upload = await client.uploadFile(fileObj);
      const text = extractedTextFromRet(upload.ret);
      let tokens: number | null = null;
      try {
        const n = await client.tokenize({ content: text });
        tokens = Number.isFinite(n) ? n : null;
      } catch {
        // Tokenizer is best-effort; the char count is still useful.
      }
      setPreviews((prev) => ({
        ...prev,
        [fileItem.id]: {
          chars: text.length,
          tokens,
          snippet: text.slice(0, 800),
          fetchedAt: Date.now(),
        },
      }));
      toast.success(
        `${fileItem.filename}: ${text.length.toLocaleString()} chars` +
          (tokens !== null ? ` · ${tokens.toLocaleString()} units` : ''),
      );
    } catch (err) {
      toast.error(
        `Extraction failed for ${fileItem.filename}: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setPreviewLoading(null);
    }
  }

  async function onSemanticChunk(fileItem: ProjectContextFile) {
    if (!apiKey || !onAskSage) {
      toast.error('Connect to Ask Sage on the Connection tab first.');
      return;
    }
    setChunkingId(fileItem.id);
    try {
      // We need the extracted text to chunk. If we already previewed
      // it, reuse that; otherwise call /server/file once.
      const client = new AskSageClient(baseUrl, apiKey);
      let text = previews[fileItem.id]?.snippet ?? '';
      if (!previews[fileItem.id]) {
        const fileObj = new File([fileItem.bytes], fileItem.filename, {
          type: fileItem.mime_type || 'application/octet-stream',
        });
        const upload = await client.uploadFile(fileObj);
        text = extractedTextFromRet(upload.ret);
      } else {
        // We need the FULL extracted text, not the 800-char snippet
        // we cached for preview. Re-upload to get the full text.
        const fileObj = new File([fileItem.bytes], fileItem.filename, {
          type: fileItem.mime_type || 'application/octet-stream',
        });
        const upload = await client.uploadFile(fileObj);
        text = extractedTextFromRet(upload.ret);
      }
      if (!text || text.trim().length === 0) {
        throw new Error('Ask Sage extracted no text from this file.');
      }
      const { chunks } = await semanticChunkText(client, text, {
        sourceLabel: fileItem.filename,
      });

      // Persist the chunks onto the file record.
      const proj = await dexieDb.projects.get(project.id);
      if (!proj) throw new Error('Project disappeared');
      const nextItems = (proj.context_items ?? []).map((it) =>
        it.kind === 'file' && it.id === fileItem.id ? { ...it, chunks } : it,
      );
      await dexieDb.projects.put({
        ...proj,
        context_items: nextItems,
        updated_at: new Date().toISOString(),
      });

      const totalChars = chunks.reduce((acc, c) => acc + c.text.length, 0);
      toast.success(
        `${fileItem.filename}: ${chunks.length} semantic chunks · ${totalChars.toLocaleString()} chars`,
      );
    } catch (err) {
      toast.error(
        `Chunking failed for ${fileItem.filename}: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setChunkingId(null);
    }
  }

  // Total token count across all previewed files. Files that haven't
  // been previewed yet contribute null and are excluded from the sum;
  // we tell the user "X of Y files measured" so the partial number
  // isn't misleading.
  const previewedFileIds = Object.keys(previews);
  const totalPreviewedTokens = previewedFileIds.reduce(
    (acc, id) => acc + (previews[id]?.tokens ?? 0),
    0,
  );
  const totalPreviewedChars = previewedFileIds.reduce(
    (acc, id) => acc + (previews[id]?.chars ?? 0),
    0,
  );

  async function onClearOrphans() {
    try {
      await clearOrphanedFiles(project.id);
      toast.success('Cleared orphaned v4 file entries');
    } catch (err) {
      toast.error(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function onPostNote(e: FormEvent) {
    e.preventDefault();
    if (!noteDraft.trim()) return;
    setPosting(true);
    try {
      await addProjectNote(project.id, noteDraft);
      setNoteDraft('');
    } catch (err) {
      toast.error(`Failed to post note: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setPosting(false);
    }
  }

  async function onRemove(itemId: string) {
    try {
      await removeContextItem(project.id, itemId);
    } catch (err) {
      toast.error(`Failed to remove: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return (
    <>
      <h2>
        Project context{' '}
        <span className="badge" style={{ marginLeft: '0.4rem' }}>
          {files.length} file{files.length === 1 ? '' : 's'} · {notes.length} note
          {notes.length === 1 ? '' : 's'}
        </span>
      </h2>
      <p className="note">
        Two grounding mechanisms feed the drafter, both inlined directly into
        every section's prompt:
        <br />· <strong>Notes</strong> — short user-authored guidance (quotes,
        salient characteristics, scope hints). Inlined verbatim.
        <br />· <strong>Files</strong> — reference documents stored locally as
        bytes. Each drafting run uploads them once to <code>/server/file</code>{' '}
        for extraction and inlines the full text into every per-section call.
        No character caps; the model literally sees the source material.
      </p>

      {orphaned && (
        <div className="error" style={{ marginBottom: 'var(--space-3)' }}>
          <strong>Orphaned files from a previous version detected.</strong>
          {'\n\n'}
          This project has file attachments from the v4 train-into-dataset
          flow that no longer have local bytes. Drafting will skip them.
          Re-attach the originals from your local copy, then click below to
          clear the stale entries.
          {'\n\n'}
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => void onClearOrphans()}
          >
            Clear orphaned entries
          </button>
        </div>
      )}

      <h3 style={{ marginTop: 'var(--space-3)' }}>
        Attached files ({files.length})
        {totalReferenceBytes > 0 && (
          <span className="badge" style={{ marginLeft: '0.4rem' }}>
            {(totalReferenceBytes / 1024 / 1024).toFixed(2)} MB on disk
          </span>
        )}
        {previewedFileIds.length > 0 && (
          <span className="badge badge-primary" style={{ marginLeft: '0.4rem' }}>
            {previewedFileIds.length} of {files.length} previewed ·{' '}
            {totalPreviewedTokens > 0
              ? `~${totalPreviewedTokens.toLocaleString()} units`
              : `${totalPreviewedChars.toLocaleString()} chars`}
          </span>
        )}
      </h3>
      {files.length > 0 && previewedFileIds.length < files.length && (
        <p className="note">
          Click <strong>test extract</strong> on each file to verify Ask Sage
          can read it and to see how much of the drafting budget it'll use.
        </p>
      )}
      <DropZone
        accept=".docx,.pdf,.txt,.md,.markdown,.csv,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/pdf,text/plain,text/markdown,text/csv"
        onFile={onAttach}
        disabled={attaching}
        label={
          attaching
            ? 'Storing file…'
            : 'Drop a reference file (DOCX, PDF, TXT, MD, CSV)'
        }
        hint="Files are stored locally as bytes. At draft time, each is uploaded once to /server/file (Ask Sage extracts the text) and the full extracted content is inlined into every per-section prompt. Up to 250 MB per document, 500 MB for audio/video."
      />
      {files.length === 0 ? (
        <EmptyState
          title="No files attached"
          body="Drop reference DOCX/PDF/MD/TXT files above. The drafter will see their full content on every section call."
        />
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, marginTop: 'var(--space-2)' }}>
          {files.map((f) => {
            if (f.kind !== 'file') return null;
            const preview = previews[f.id];
            const isLoading = previewLoading === f.id;
            const isChunking = chunkingId === f.id;
            const chunkCount = f.chunks?.length ?? 0;
            return (
              <li
                key={f.id}
                className="card"
                style={{ marginBottom: 'var(--space-2)', padding: 'var(--space-2) var(--space-3)' }}
              >
                <div className="row" style={{ alignItems: 'center' }}>
                  <strong>{f.filename}</strong>
                  <span className="badge">{(f.size_bytes / 1024).toFixed(1)} KB</span>
                  <span className="badge">{f.mime_type.split('/').pop()}</span>
                  {preview && (
                    <span className="badge badge-success">
                      {preview.chars.toLocaleString()} chars
                      {preview.tokens !== null && ` · ${preview.tokens.toLocaleString()} tok`}
                    </span>
                  )}
                  {chunkCount > 0 ? (
                    <span className="badge badge-primary">
                      {chunkCount} semantic chunk{chunkCount === 1 ? '' : 's'}
                    </span>
                  ) : (
                    <span className="badge">naive chunking</span>
                  )}
                  <span style={{ marginLeft: 'auto' }} />
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    disabled={isLoading || isChunking || !apiKey || !onAskSage}
                    title="Upload to /server/file and tokenize. Useful for verifying Ask Sage can read this file before drafting."
                    onClick={() => void onTestExtraction(f)}
                  >
                    {isLoading ? 'extracting…' : preview ? 're-test' : 'test extract'}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    disabled={isChunking || isLoading || !apiKey || !onAskSage}
                    title="Run an LLM pass to split this file into semantically coherent chunks. Each chunk gets a title and one-sentence summary used for per-section relevance scoring at draft time."
                    onClick={() => void onSemanticChunk(f)}
                  >
                    {isChunking ? 'chunking…' : chunkCount > 0 ? 're-chunk' : 'chunk'}
                  </button>
                  <button
                    type="button"
                    className="btn-danger btn-sm"
                    onClick={() => void onRemove(f.id)}
                  >
                    remove
                  </button>
                </div>
                <div className="note" style={{ marginTop: '0.3rem' }}>
                  Attached {new Date(f.created_at).toLocaleString()}
                  {chunkCount === 0 && (
                    <>
                      {' · '}
                      <em>
                        will fall back to naive paragraph chunking at draft time
                      </em>
                    </>
                  )}
                </div>
                {preview && (
                  <details style={{ marginTop: '0.4rem' }}>
                    <summary className="note" style={{ cursor: 'pointer' }}>
                      Preview first {Math.min(preview.snippet.length, 800).toLocaleString()} chars of extracted text
                    </summary>
                    <pre
                      style={{
                        background: 'var(--color-surface-alt)',
                        padding: 'var(--space-2)',
                        fontSize: 11,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        maxHeight: 200,
                        overflow: 'auto',
                        margin: '0.4rem 0 0',
                        borderRadius: 'var(--radius-sm)',
                      }}
                    >
                      {preview.snippet}
                      {preview.chars > 800 && '\n…'}
                    </pre>
                  </details>
                )}
                {chunkCount > 0 && f.chunks && (
                  <details style={{ marginTop: '0.4rem' }}>
                    <summary className="note" style={{ cursor: 'pointer' }}>
                      View {chunkCount} semantic chunk{chunkCount === 1 ? '' : 's'}
                    </summary>
                    <ul
                      style={{
                        listStyle: 'none',
                        padding: 'var(--space-2)',
                        margin: '0.4rem 0 0',
                        background: 'var(--color-surface-alt)',
                        borderRadius: 'var(--radius-sm)',
                        maxHeight: 280,
                        overflow: 'auto',
                      }}
                    >
                      {f.chunks.map((c) => (
                        <li
                          key={c.id}
                          style={{
                            marginBottom: '0.5rem',
                            paddingBottom: '0.5rem',
                            borderBottom: '1px dashed var(--color-border)',
                          }}
                        >
                          <strong style={{ fontSize: 12 }}>{c.title}</strong>
                          <span className="badge" style={{ marginLeft: '0.4rem' }}>
                            {c.text.length.toLocaleString()} chars
                          </span>
                          {c.summary && (
                            <div className="note" style={{ marginTop: '0.2rem', fontStyle: 'italic' }}>
                              {c.summary}
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <h3 style={{ marginTop: 'var(--space-4)' }}>Chat notes ({notes.length})</h3>
      {notes.length === 0 ? (
        <EmptyState
          title="No notes yet"
          body="Post scope hints, priorities, or any guidance you want the drafter to honor."
        />
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, marginTop: 'var(--space-2)' }}>
          {notes.map((n) =>
            n.kind === 'note' ? (
              <li
                key={n.id}
                className="card"
                style={{ marginBottom: 'var(--space-2)', padding: 'var(--space-2) var(--space-3)' }}
              >
                <div className="row" style={{ alignItems: 'center' }}>
                  <span className="badge badge-primary">{n.role}</span>
                  <span className="muted" style={{ fontSize: 11 }}>
                    {new Date(n.created_at).toLocaleString()}
                  </span>
                  <span style={{ marginLeft: 'auto' }} />
                  <button
                    type="button"
                    className="btn-danger btn-sm"
                    onClick={() => void onRemove(n.id)}
                  >
                    remove
                  </button>
                </div>
                <div style={{ marginTop: '0.3rem', whiteSpace: 'pre-wrap' }}>{n.text}</div>
              </li>
            ) : null,
          )}
        </ul>
      )}
      <form onSubmit={onPostNote} style={{ marginTop: 'var(--space-2)' }}>
        <label htmlFor="context-note">Add a note</label>
        <textarea
          id="context-note"
          value={noteDraft}
          onChange={(e) => setNoteDraft(e.target.value)}
          rows={3}
          placeholder="e.g. Emphasize compliance with DHA Issuance 6025.13 throughout the Inspection section."
          disabled={posting}
        />
        <button type="submit" disabled={posting || !noteDraft.trim()}>
          {posting ? 'Posting…' : 'Post note'}
        </button>
      </form>
    </>
  );
}

function DraftParagraphList({ paragraphs }: { paragraphs: DraftParagraph[] }) {
  return (
    <div style={{ marginTop: '0.5rem' }}>
      {paragraphs.map((p, i) => (
        <div key={i} style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.25rem' }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: '#666',
              minWidth: 60,
              textTransform: 'uppercase',
            }}
          >
            {p.role}
          </span>
          <span style={{ flex: 1 }}>{p.text}</span>
        </div>
      ))}
    </div>
  );
}

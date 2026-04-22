import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { useAuth } from '../../lib/state/auth';
import { type ProjectRecord, type TemplateRecord } from '../../lib/db/schema';
import { createLLMClient } from '../../lib/provider/factory';
import {
  runRecipe,
  resumeRecipeRun,
  cancelRecipeRun,
  retryRecipeRun,
  type RecipeRun,
  type RecipeStage,
} from '../../lib/agent/recipe';
import { PWS_RECIPE } from '../../lib/agent/recipes/pws';
import { FREEFORM_RECIPE } from '../../lib/agent/recipes/freeform';
import { toast } from '../../lib/state/toast';
import { useLiveQuery } from 'dexie-react-hooks';
import { computeRunCost } from '../../lib/usage';
import { actualUsdFromPricing, resolveModelPricing } from '../../lib/settings/cost';
import { loadSettings } from '../../lib/settings/store';
import { ASK_SAGE_DEFAULT_DRAFTING_MODEL } from '../../lib/provider/resolve_model';

interface RecipeContextValue {
  currentRun: RecipeRun | null;
  isRunning: boolean;
  recipeStageMessage: string | null;
  startRecipe: (project: ProjectRecord, templates: TemplateRecord[]) => Promise<void>;
  resumeRecipe: (project: ProjectRecord, templates: TemplateRecord[]) => Promise<void>;
  cancelRecipe: () => Promise<void>;
  retryRecipe: (project: ProjectRecord, templates: TemplateRecord[]) => Promise<void>;
  setCurrentRun: (run: RecipeRun | null) => void;
}

const RecipeContext = createContext<RecipeContextValue | undefined>(undefined);

export function RecipeProvider({ children }: { children: ReactNode }) {
  const [currentRun, setCurrentRun] = useState<RecipeRun | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [recipeStageMessage, setRecipeStageMessage] = useState<string | null>(null);

  const apiKey = useAuth((s) => s.apiKey);
  const baseUrl = useAuth((s) => s.baseUrl);
  const provider = useAuth((s) => s.provider);
  const availableModels = useAuth((s) => s.models);
  const settings = useLiveQuery(() => loadSettings(), []);

  const onAskSage = provider === 'asksage';
  const draftingModelOverride = settings?.models.drafting ?? null;
  const effectiveDraftingModelId = draftingModelOverride ?? (onAskSage ? ASK_SAGE_DEFAULT_DRAFTING_MODEL : null);
  const draftingPricing = resolveModelPricing(availableModels, effectiveDraftingModelId);

  const startRecipe = useCallback(async (project: ProjectRecord, templates: TemplateRecord[]) => {
    if (!apiKey) {
      toast.error('Connect a provider on the Connection tab first.');
      return;
    }
    setIsRunning(true);
    setCurrentRun(null);
    setRecipeStageMessage(null);
    try {
      const client = createLLMClient({ provider, baseUrl, apiKey });
      const isFreeform = project.mode === 'freeform';
      const recipe = isFreeform ? FREEFORM_RECIPE : PWS_RECIPE;

      const run = await runRecipe({
        client,
        project,
        templates,
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
        let usd: number | null = null;
        if (run.usage_by_model && Object.keys(run.usage_by_model).length > 0) {
          usd = computeRunCost(run.usage_by_model, availableModels).usd_total;
        } else {
          usd = actualUsdFromPricing(run.total_tokens_in, run.total_tokens_out, draftingPricing);
        }
        const usdSuffix = usd !== null ? ` · $${usd.toFixed(2)}` : '';
        toast.success(`Auto-draft complete · ${totalTokens.toLocaleString()} units${usdSuffix}`);
      } else if (run.status === 'paused') {
        toast.info('Auto-draft paused for your review');
      } else if (run.status === 'failed') {
        toast.error('Auto-draft failed');
      }
    } catch (err) {
      toast.error(`Auto-draft error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsRunning(false);
    }
  }, [apiKey, provider, baseUrl, availableModels, draftingPricing]);

  const resumeRecipe = useCallback(async (project: ProjectRecord, templates: TemplateRecord[]) => {
    if (!currentRun || !apiKey) return;
    setIsRunning(true);
    try {
      const client = createLLMClient({ provider, baseUrl, apiKey });
      const run = await resumeRecipeRun({
        client,
        project,
        templates,
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
    } catch (err) {
      toast.error(`Resume failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsRunning(false);
    }
  }, [currentRun, apiKey, provider, baseUrl]);

  const cancelRecipe = useCallback(async () => {
    if (!currentRun) return;
    try {
      await cancelRecipeRun(currentRun.id);
      setCurrentRun({ ...currentRun, status: 'cancelled' });
      toast.info('Auto-draft cancelled');
    } catch (err) {
      toast.error(`Cancel failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [currentRun]);

  const retryRecipe = useCallback(async (project: ProjectRecord, templates: TemplateRecord[]) => {
    if (!currentRun || !apiKey) return;
    setIsRunning(true);
    try {
      const client = createLLMClient({ provider, baseUrl, apiKey });
      const run = await retryRecipeRun({
        client,
        project,
        templates,
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
    } catch (err) {
      toast.error(`Retry failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsRunning(false);
    }
  }, [currentRun, apiKey, provider, baseUrl]);

  return (
    <RecipeContext.Provider value={{
      currentRun,
      isRunning,
      recipeStageMessage,
      startRecipe,
      resumeRecipe,
      cancelRecipe,
      retryRecipe,
      setCurrentRun
    }}>
      {children}
    </RecipeContext.Provider>
  );
}

export function useRecipe() {
  const context = useContext(RecipeContext);
  if (context === undefined) {
    throw new Error('useRecipe must be used within a RecipeProvider');
  }
  return context;
}

// Lightweight wrapper around the Dexie settings table. The store is a
// singleton row keyed by id='app'. Reads merge with defaults so a
// missing field stays harmless after a future schema bump.

import { db } from '../db/schema';
import {
  DEFAULT_COST_ASSUMPTIONS,
  DEFAULT_CRITIC_SETTINGS,
  DEFAULT_MODEL_OVERRIDES,
  DEFAULT_SETTINGS,
  type AppSettings,
  type CostAssumptions,
  type CriticSettings,
  type ModelOverrides,
  type ModelStage,
} from './types';

export async function loadSettings(): Promise<AppSettings> {
  const row = await db.settings.get('app');
  if (!row) return { ...DEFAULT_SETTINGS };
  return {
    id: 'app',
    models: { ...DEFAULT_MODEL_OVERRIDES, ...row.models },
    cost: { ...DEFAULT_COST_ASSUMPTIONS, ...row.cost },
    critic: { ...DEFAULT_CRITIC_SETTINGS, ...(row.critic ?? {}) },
    updated_at: row.updated_at ?? new Date(0).toISOString(),
  };
}

export interface SaveSettingsPatch {
  models?: Partial<ModelOverrides>;
  cost?: Partial<CostAssumptions>;
  critic?: Partial<CriticSettings>;
}

export async function saveSettings(patch: SaveSettingsPatch): Promise<AppSettings> {
  const current = await loadSettings();
  const next: AppSettings = {
    id: 'app',
    models: { ...current.models, ...(patch.models ?? {}) },
    cost: { ...current.cost, ...(patch.cost ?? {}) },
    critic: { ...DEFAULT_CRITIC_SETTINGS, ...current.critic, ...(patch.critic ?? {}) },
    updated_at: new Date().toISOString(),
  };
  await db.settings.put(next);
  return next;
}

export async function setModelOverride(stage: ModelStage, model: string | null): Promise<void> {
  const current = await loadSettings();
  await saveSettings({ models: { ...current.models, [stage]: model } });
}

export async function setCostAssumptions(cost: Partial<CostAssumptions>): Promise<void> {
  await saveSettings({ cost });
}

/**
 * Resolve a model id for a given stage. Order: explicit override → caller default.
 * Caller passes the stage's compiled-in default so this function never needs
 * to know the stage-specific constants.
 */
export function resolveModel(
  overrides: ModelOverrides | null | undefined,
  stage: ModelStage,
  fallback: string,
): string {
  return overrides?.[stage] ?? fallback;
}

/** Convenience: load the override for a single stage. */
export async function getModelOverride(stage: ModelStage): Promise<string | null> {
  const settings = await loadSettings();
  return settings.models[stage];
}

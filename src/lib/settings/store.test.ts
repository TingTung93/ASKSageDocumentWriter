import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadSettings, saveSettings, setModelOverride, setCostAssumptions, resolveModel, getModelOverride } from './store';
import { db } from '../db/schema';
import { DEFAULT_SETTINGS } from './types';

vi.mock('../db/schema', () => ({
  db: {
    settings: {
      get: vi.fn(),
      put: vi.fn()
    }
  }
}));

describe('settings store', () => {
  beforeEach(() => {
    vi.mocked(db.settings.get).mockReset();
    vi.mocked(db.settings.put).mockReset();
  });

  describe('loadSettings', () => {
    it('returns default settings if db is empty', async () => {
      vi.mocked(db.settings.get).mockResolvedValue(undefined);
      const settings = await loadSettings();
      expect(settings.models).toEqual(DEFAULT_SETTINGS.models);
      expect(settings.cost).toEqual(DEFAULT_SETTINGS.cost);
    });

    it('merges stored settings with defaults', async () => {
      vi.mocked(db.settings.get).mockResolvedValue({
        id: 'app',
        models: { drafting: 'custom-model' }
      } as any);
      
      const settings = await loadSettings();
      expect(settings.models.drafting).toBe('custom-model');
      expect(settings.models.critic).toBe(DEFAULT_SETTINGS.models.critic);
      expect(settings.cost).toBeDefined();
    });
  });

  describe('saveSettings', () => {
    it('patches existing settings and updates timestamp', async () => {
      vi.mocked(db.settings.get).mockResolvedValue(undefined); // load defaults
      const saved = await saveSettings({ cost: { chars_per_token: 10 } });
      
      expect(saved.cost.chars_per_token).toBe(10);
      expect(db.settings.put).toHaveBeenCalledWith(saved);
      expect(saved.updated_at).not.toBe(new Date(0).toISOString());
    });
  });

  describe('setModelOverride', () => {
    it('updates a specific model stage', async () => {
      vi.mocked(db.settings.get).mockResolvedValue(undefined);
      await setModelOverride('drafting', 'model-x');
      expect(db.settings.put).toHaveBeenCalledWith(
        expect.objectContaining({
          models: expect.objectContaining({ drafting: 'model-x' })
        })
      );
    });
  });

  describe('setCostAssumptions', () => {
    it('updates cost settings', async () => {
      vi.mocked(db.settings.get).mockResolvedValue(undefined);
      await setCostAssumptions({ usd_per_1k_in: 0.05 });
      expect(db.settings.put).toHaveBeenCalledWith(
        expect.objectContaining({
          cost: expect.objectContaining({ usd_per_1k_in: 0.05 })
        })
      );
    });
  });

  describe('resolveModel', () => {
    it('returns override if present', () => {
      expect(resolveModel({ drafting: 'x', critic: null, cleanup: null, synthesis: null, schema_edit: null }, 'drafting', 'fallback')).toBe('x');
    });

    it('returns fallback if override is missing', () => {
      expect(resolveModel({ drafting: null, critic: null, cleanup: null, synthesis: null, schema_edit: null }, 'drafting', 'fallback')).toBe('fallback');
      expect(resolveModel(null, 'drafting', 'fallback')).toBe('fallback');
    });
  });

  describe('getModelOverride', () => {
    it('returns the model for a stage', async () => {
      vi.mocked(db.settings.get).mockResolvedValue({ id: 'app', models: { drafting: 'test-model' } } as any);
      expect(await getModelOverride('drafting')).toBe('test-model');
    });
  });
});

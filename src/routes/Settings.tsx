// Settings — per-stage model overrides and cost projection assumptions.
// Settings persist in IndexedDB (db.settings, singleton row id='app').
// Empty/blank model fields fall back to the compiled-in default for
// each stage.

import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAuth } from '../lib/state/auth';
import { loadSettings, saveSettings } from '../lib/settings/store';
import { toast } from '../lib/state/toast';
import type { ModelInfo } from '../lib/asksage/types';
import {
  DEFAULT_COST_ASSUMPTIONS,
  DEFAULT_MODEL_OVERRIDES,
  type CostAssumptions,
  type ModelOverrides,
  type ModelStage,
} from '../lib/settings/types';
import { defaultModelFor } from '../lib/provider/factory';
import type { ProviderId } from '../lib/provider/types';
import { EmptyState } from '../components/EmptyState';
import {
  STAGE_REQUIREMENTS,
  validateModelForStage,
} from '../lib/provider/capabilities';

interface StageMeta {
  stage: ModelStage;
  label: string;
  description: string;
  default: string;
}

// Static copy (stage, label, description). Per-stage default is
// derived from the active provider at render time via defaultModelFor —
// keeping it in state here would go stale when the user switches
// providers on the Connection tab.
const STAGE_COPY: Omit<StageMeta, 'default'>[] = [
  {
    stage: 'synthesis',
    label: 'Template analysis',
    description: 'Reads a DOCX template and identifies sections, structure, and writing guidance.',
  },
  {
    stage: 'drafting',
    label: 'Section drafting',
    description: 'Generates content for each section when running a project.',
  },
  {
    stage: 'critic',
    label: 'Quality reviewer',
    description: 'Reviews each drafted section for errors and suggests improvements.',
  },
  {
    stage: 'cleanup',
    label: 'Document cleanup',
    description: 'Reviews and polishes an uploaded DOCX on the Documents page.',
  },
  {
    stage: 'schema_edit',
    label: 'Template refinement',
    description: 'AI-assisted edits to a template\'s section definitions and writing rules.',
  },
];

function stagesFor(provider: ProviderId): StageMeta[] {
  return STAGE_COPY.map((c) => ({ ...c, default: defaultModelFor(provider, c.stage) }));
}

type PricingFilter = 'all' | 'free' | 'paid';

export function Settings() {
  const settings = useLiveQuery(() => loadSettings(), []);
  const apiKey = useAuth((s) => s.apiKey);
  const models = useAuth((s) => s.models);
  const provider = useAuth((s) => s.provider);

  // Pricing filter is session-only — not persisted. Defaults to "all"
  // until the user picks; on OpenRouter most users will want "paid"
  // since the free tier has aggressive rate limits.
  const [pricingFilter, setPricingFilter] = useState<PricingFilter>('all');

  // Compatibility filter is session-only. ON by default — hides
  // OpenRouter models whose advertised context window / modalities /
  // supported parameters can't satisfy the stage requirements. Users
  // who want to override (e.g. to try a model whose metadata is wrong)
  // can flip this off. Has no effect on Ask Sage models because their
  // ModelInfo.capabilities is undefined and the validator passes
  // unknowns through.
  const [compatibilityFilter, setCompatibilityFilter] = useState(true);

  // Surface pricing controls only when at least one model carries
  // pricing data — i.e. when connected via OpenRouter. Ask Sage's
  // /server/get-models doesn't return per-model pricing.
  const hasPricingData = (models ?? []).some((m) => m.pricing !== undefined);
  const filteredModels = useMemo(
    () => filterModelsByPricing(models ?? [], pricingFilter),
    [models, pricingFilter],
  );

  if (!settings) {
    return (
      <main>
        <h1>Settings</h1>
        <p className="note">Loading…</p>
      </main>
    );
  }

  return (
    <main>
      <h1>Settings</h1>
      <p>
        Choose which AI model to use for each step, and adjust cost
        estimates. Your settings are saved locally and persist between
        sessions. Leave a model field blank to use the built-in default.
      </p>

      <h2>AI model preferences</h2>
      {!apiKey && (
        <EmptyState
          title="Not connected"
          body={
            provider === 'openrouter'
              ? 'Connect to OpenRouter on the Connection tab to see the available models in the picker.'
              : 'Connect to Ask Sage on the Connection tab to see the available models in the picker.'
          }
        />
      )}

      {hasPricingData && (
        <PricingFilterControl
          value={pricingFilter}
          onChange={setPricingFilter}
          totalCount={models?.length ?? 0}
          filteredCount={filteredModels.length}
        />
      )}

      {hasPricingData && (
        <CompatibilityFilterControl
          value={compatibilityFilter}
          onChange={setCompatibilityFilter}
        />
      )}

      <ModelOverridesSection
        models={settings.models}
        availableModels={filteredModels}
        compatibilityFilter={compatibilityFilter}
        provider={provider}
      />

      <h2>Quality review loop (automated review)</h2>
      <p className="note">
        When enabled, every drafted section is reviewed by a separate
        AI check before being accepted. If the reviewer finds significant
        issues, the system re-drafts up to the configured number of times
        using the reviewer's feedback. Used by the auto-draft workflow
        and by manual <code>Draft sections</code> runs.
      </p>
      <CriticSettingsSection critic={settings.critic ?? null} />

      <h2>Style consistency review</h2>
      <p className="note">
        After all sections are drafted and reviewed, this step takes one
        more AI pass that examines the WHOLE document's formatting —
        heading levels, table structure, bullet nesting, stray markup,
        and role usage — then applies corrections before the final Word
        document is assembled. Use this when independently-drafted
        sections have produced inconsistent formatting (mixed fonts,
        malformed tables, stray characters). One AI call per project run.
      </p>
      <StyleReviewSettingsSection styleReview={settings.style_review ?? null} />

      <h2>User defaults</h2>
      <p className="note">
        Values that get automatically filled in for every NEW project.
        Use this for information that stays the same across documents —
        your office symbol, signature block, default POC line.
        Field names should match what your templates expect
        (e.g. <code>office_symbol</code>, <code>signature_block</code>,
        <code>poc_line</code>). Existing projects are not changed.
      </p>
      <UserDefaultsSection defaults={settings.user_defaults ?? { shared_inputs: {} }} />

      <h2>Cost projection</h2>
      <p className="note">
        These numbers feed the rough cost estimates shown on the Documents
        and Project Detail pages before you start a review or drafting run.
        They're approximate — adjust them once you have real usage data.
      </p>
      <CostAssumptionsSection cost={settings.cost} />

      <h2>Reset</h2>
      <button
        type="button"
        className="btn-danger"
        onClick={async () => {
          if (!confirm('Reset all settings to defaults?')) return;
          await saveSettings({
            models: { ...DEFAULT_MODEL_OVERRIDES },
            cost: { ...DEFAULT_COST_ASSUMPTIONS },
          });
          toast.success('Settings reset to defaults');
        }}
      >
        Reset to defaults
      </button>
    </main>
  );
}

function UserDefaultsSection({
  defaults,
}: {
  defaults: { shared_inputs: Record<string, string> };
}) {
  // Local working copy. We commit to Dexie on Save so the user can
  // edit multiple keys without each keystroke triggering a write.
  const [rows, setRows] = useState(() =>
    Object.entries(defaults.shared_inputs ?? {}).map(([key, value]) => ({ key, value })),
  );
  const [busy, setBusy] = useState(false);

  // Re-sync from props on changes from outside (e.g. Reset).
  useEffect(() => {
    setRows(Object.entries(defaults.shared_inputs ?? {}).map(([key, value]) => ({ key, value })));
  }, [defaults]);

  function updateRow(idx: number, patch: Partial<{ key: string; value: string }>) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setRows((prev) => [...prev, { key: '', value: '' }]);
  }

  function removeRow(idx: number) {
    setRows((prev) => prev.filter((_, i) => i !== idx));
  }

  async function onSave() {
    setBusy(true);
    try {
      // Normalize: drop blank-key rows, lowercase + snake_case keys,
      // collapse duplicates (last writer wins).
      const out: Record<string, string> = {};
      for (const r of rows) {
        const k = r.key.trim().toLowerCase().replace(/\s+/g, '_');
        if (!k) continue;
        out[k] = r.value;
      }
      await saveSettings({ user_defaults: { shared_inputs: out } });
      toast.success(`Saved ${Object.keys(out).length} default${Object.keys(out).length === 1 ? '' : 's'}`);
    } catch (err) {
      toast.error(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      {rows.length === 0 && (
        <p className="note" style={{ margin: 0 }}>
          No user defaults set yet. Click <strong>Add row</strong> to add one.
        </p>
      )}
      {rows.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          {rows.map((row, idx) => (
            <div
              key={idx}
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
            >
              <input
                type="text"
                value={row.key}
                placeholder="key (e.g. office_symbol)"
                onChange={(e) => updateRow(idx, { key: e.target.value })}
                style={{ flex: '0 0 14rem', padding: '0.4rem 0.5rem', font: 'inherit' }}
              />
              <input
                type="text"
                value={row.value}
                placeholder="value"
                onChange={(e) => updateRow(idx, { value: e.target.value })}
                style={{ flex: '1 1 auto', padding: '0.4rem 0.5rem', font: 'inherit' }}
              />
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => removeRow(idx)}
                title="Remove this row"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
        <button type="button" className="btn-secondary" onClick={addRow}>
          Add row
        </button>
        <button type="button" className="btn-success" onClick={() => void onSave()} disabled={busy}>
          {busy ? 'saving…' : 'Save user defaults'}
        </button>
      </div>
    </div>
  );
}

function ModelOverridesSection({
  models,
  availableModels,
  compatibilityFilter,
  provider,
}: {
  models: ModelOverrides;
  availableModels: ModelInfo[];
  compatibilityFilter: boolean;
  provider: ProviderId;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      {stagesFor(provider).map((meta) => (
        <ModelOverrideRow
          key={meta.stage}
          meta={meta}
          current={models[meta.stage]}
          availableModels={availableModels}
          compatibilityFilter={compatibilityFilter}
        />
      ))}
    </div>
  );
}

function ModelOverrideRow({
  meta,
  current,
  availableModels,
  compatibilityFilter,
}: {
  meta: StageMeta;
  current: string | null;
  availableModels: ModelInfo[];
  compatibilityFilter: boolean;
}) {
  // Local input state so the user can type a free-form id even if it
  // isn't in the connected models list. Saves on blur or button click.
  const [draft, setDraft] = useState(current ?? '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(current ?? '');
  }, [current]);

  // Build the dropdown option list. We always include the stage
  // default and the currently-selected override (even if the
  // pricing/compatibility filters would otherwise hide them) so the
  // row never silently drops an active selection. The compatibility
  // filter is applied per-stage because each stage has different
  // context-window / modality requirements.
  const { options, hiddenIncompatibleCount } = useMemo(() => {
    const byId = new Map<string, ModelInfo>();
    let hidden = 0;
    for (const m of availableModels) {
      if (compatibilityFilter) {
        const verdict = validateModelForStage(m, meta.stage);
        if (!verdict.compatible) {
          hidden += 1;
          continue;
        }
      }
      byId.set(m.id, m);
    }
    // Always pin the stage default and the active override, even if
    // they'd otherwise be filtered out. Better to show a known
    // selection than to drop it silently.
    if (!byId.has(meta.default)) {
      byId.set(meta.default, syntheticModelInfo(meta.default));
    }
    if (current && !byId.has(current)) {
      byId.set(current, syntheticModelInfo(current));
    }
    return {
      options: Array.from(byId.values()).sort((a, b) => a.id.localeCompare(b.id)),
      hiddenIncompatibleCount: hidden,
    };
  }, [availableModels, meta.default, meta.stage, current, compatibilityFilter]);

  const stageReq = STAGE_REQUIREMENTS[meta.stage];

  async function commit(value: string) {
    setSaving(true);
    try {
      const next = value.trim() === '' ? null : value.trim();
      const settings = await loadSettings();
      await saveSettings({ models: { ...settings.models, [meta.stage]: next } });
      toast.success(`${meta.label}: ${next ?? `default (${meta.default})`}`);
    } catch (err) {
      toast.error(`Failed to save: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  }

  function onSelect(e: ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value;
    setDraft(value);
    void commit(value);
  }

  const isOverridden = current !== null;
  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
        <strong>{meta.label}</strong>
        <span className={`badge ${isOverridden ? 'badge-primary' : ''}`}>
          {isOverridden ? 'override' : 'default'}
        </span>
      </div>
      <p className="note" style={{ marginTop: '0.25rem' }}>
        {meta.description}
      </p>
      <p className="note" style={{ marginTop: '0.25rem', fontSize: 11 }}>
        Requires a model with at least {formatTokenFloor(stageReq.min_context_length)} capacity and text generation support.
        {compatibilityFilter && hiddenIncompatibleCount > 0 && (
          <> {hiddenIncompatibleCount.toLocaleString()} incompatible model{hiddenIncompatibleCount === 1 ? '' : 's'} hidden.</>
        )}
      </p>
      <div className="model-override-row">
        <select
          value={draft}
          onChange={onSelect}
          disabled={saving}
        >
          <option value="">default — {meta.default}</option>
          {options.map((m) => (
            <option key={m.id} value={m.id}>
              {formatModelOptionLabel(m)}
            </option>
          ))}
        </select>
        <input
          type="text"
          className="mono"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            if ((draft || null) !== current) void commit(draft);
          }}
          placeholder="Or type a model name…"
          disabled={saving}
        />
      </div>
    </div>
  );
}

// ─── Pricing helpers ──────────────────────────────────────────────

function filterModelsByPricing(models: ModelInfo[], filter: PricingFilter): ModelInfo[] {
  if (filter === 'all') return models;
  if (filter === 'free') return models.filter((m) => m.pricing?.is_free === true);
  // 'paid' — exclude both free models AND models with no pricing data
  // (we don't know the cost so we can't promise they're paid). Ask
  // Sage models will fall out here, which is correct: the filter only
  // appears when at least one model has pricing.
  return models.filter((m) => m.pricing && !m.pricing.is_free);
}

function formatModelOptionLabel(m: ModelInfo): string {
  if (!m.pricing) return m.id;
  if (m.pricing.is_free) return `${m.id} · free`;
  // Render price per 1M tokens — easier to scan than per-token
  // (e.g. "$3.00 / $15.00 per 1M" for Claude 3.5 Sonnet).
  const inPer1M = (m.pricing.prompt_per_token * 1_000_000).toFixed(2);
  const outPer1M = (m.pricing.completion_per_token * 1_000_000).toFixed(2);
  return `${m.id} · $${inPer1M} in / $${outPer1M} out per 1M`;
}

function syntheticModelInfo(id: string): ModelInfo {
  return { id, name: id, object: 'model', owned_by: 'unknown', created: 'na' };
}

function formatTokenFloor(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M tokens`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K tokens`;
  return `${n} tokens`;
}

function CompatibilityFilterControl({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="card" style={{ marginBottom: 'var(--space-3)' }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600 }}>
        <input
          type="checkbox"
          checked={value}
          onChange={(e) => onChange(e.target.checked)}
          style={{ width: 'auto' }}
        />
        Hide incompatible models
      </label>
      <p className="note" style={{ marginTop: '0.4rem', marginBottom: 0 }}>
        Hides OpenRouter models that don't meet the minimum requirements
        for each step (capacity, text support, etc.). All Ask Sage models
        are always shown. Turn this off if you want to try a model whose
        listed specs may be inaccurate.
      </p>
    </div>
  );
}

function PricingFilterControl({
  value,
  onChange,
  totalCount,
  filteredCount,
}: {
  value: PricingFilter;
  onChange: (next: PricingFilter) => void;
  totalCount: number;
  filteredCount: number;
}) {
  return (
    <div className="card" style={{ marginBottom: 'var(--space-3)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
        <strong>Pricing filter</strong>
        <div role="radiogroup" aria-label="Pricing filter" style={{ display: 'flex', gap: '0.75rem' }}>
          <label style={{ fontWeight: 'normal' }}>
            <input
              type="radio"
              name="pricing-filter"
              value="all"
              checked={value === 'all'}
              onChange={() => onChange('all')}
            />{' '}
            All
          </label>
          <label style={{ fontWeight: 'normal' }}>
            <input
              type="radio"
              name="pricing-filter"
              value="free"
              checked={value === 'free'}
              onChange={() => onChange('free')}
            />{' '}
            Free only
          </label>
          <label style={{ fontWeight: 'normal' }}>
            <input
              type="radio"
              name="pricing-filter"
              value="paid"
              checked={value === 'paid'}
              onChange={() => onChange('paid')}
            />{' '}
            Paid only
          </label>
        </div>
        <span className="note">
          Showing {filteredCount.toLocaleString()} of {totalCount.toLocaleString()} models.
        </span>
      </div>
      <p className="note" style={{ marginTop: '0.4rem', marginBottom: 0 }}>
        Free OpenRouter models have strict usage limits and handle less
        content at once — fine for cleanup and refinement, but often too
        slow or limited for full template analysis.
      </p>
    </div>
  );
}

function CriticSettingsSection({
  critic,
}: {
  critic: import('../lib/settings/types').CriticSettings | null;
}) {
  const enabled = critic?.enabled ?? true;
  const strictness = critic?.strictness ?? 'moderate';
  const maxIterations = critic?.max_iterations ?? 2;

  async function update(patch: Partial<import('../lib/settings/types').CriticSettings>) {
    const current = await loadSettings();
    await saveSettings({
      critic: { ...(current.critic ?? { enabled: true, strictness: 'moderate', max_iterations: 2 }), ...patch },
    });
    toast.success('Quality review settings saved');
  }

  return (
    <div className="card" style={{ padding: 'var(--space-3)' }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600 }}>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => void update({ enabled: e.target.checked })}
          style={{ width: 'auto' }}
        />
        Enable quality review loop
      </label>
      <p className="note" style={{ marginTop: '0.4rem' }}>
        When disabled, sections are drafted once and accepted as-is with no review. Saves cost but may miss quality issues in complex sections.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)', marginTop: 'var(--space-3)' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontWeight: 400 }}>
          <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Strictness</span>
          <select
            value={strictness}
            onChange={(e) => void update({ strictness: e.target.value as 'lenient' | 'moderate' | 'strict' })}
            disabled={!enabled}
          >
            <option value="lenient">lenient — flag concrete errors only</option>
            <option value="moderate">moderate — also flag style/structure</option>
            <option value="strict">strict — flag any improvable aspect</option>
          </select>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontWeight: 400 }}>
          <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Max revision iterations</span>
          <select
            value={maxIterations}
            onChange={(e) => void update({ max_iterations: Number(e.target.value) })}
            disabled={!enabled}
          >
            <option value="1">1 — critique once, never revise</option>
            <option value="2">2 — up to 2 revisions per section (default)</option>
            <option value="3">3 — up to 3 revisions per section</option>
          </select>
        </label>
      </div>
      <p className="note" style={{ marginTop: '0.4rem' }}>
        Cost impact: enabling the quality review with default settings adds ~25% to the per-project AI cost in exchange for substantially better output. See the design discussion in the project memory for the full math.
      </p>
    </div>
  );
}

function StyleReviewSettingsSection({
  styleReview,
}: {
  styleReview: import('../lib/settings/types').StyleReviewSettings | null;
}) {
  const enabled = styleReview?.enabled ?? true;
  const maxOps = styleReview?.max_ops ?? 200;

  async function update(patch: Partial<import('../lib/settings/types').StyleReviewSettings>) {
    await saveSettings({ style_review: patch });
    toast.success('Style review settings saved');
  }

  return (
    <div className="card" style={{ padding: 'var(--space-3)' }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600 }}>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => void update({ enabled: e.target.checked })}
          style={{ width: 'auto' }}
        />
        Enable style consistency review
      </label>
      <p className="note" style={{ marginTop: '0.4rem' }}>
        When disabled, the workflow skips this step and goes straight from content review to Word document assembly. Saves cost but may leave inconsistent formatting.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)', marginTop: 'var(--space-3)' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontWeight: 400 }}>
          <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Max corrections per run</span>
          <input
            type="number"
            min={1}
            max={500}
            step={10}
            value={maxOps}
            onChange={(e) => void update({ max_ops: Math.max(1, Number(e.target.value) || 200) })}
            disabled={!enabled}
          />
        </label>
      </div>
      <p className="note" style={{ marginTop: '0.4rem' }}>
        Cost impact: one extra AI call per project run. Cost scales with the total drafted content (the entire document is reviewed in one pass).
      </p>
    </div>
  );
}

function CostAssumptionsSection({ cost }: { cost: CostAssumptions }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem 1rem' }}>
      <CostField
        label="Avg. input units per section"
        field="drafting_tokens_in_per_section"
        value={cost.drafting_tokens_in_per_section}
        hint="Average input sent to the AI per section (prompt + context + references). Higher = more context per call."
      />
      <CostField
        label="Avg. output units per section"
        field="drafting_tokens_out_per_section"
        value={cost.drafting_tokens_out_per_section}
        hint="Average amount of text the AI generates per section."
      />
      <CostField
        label="Characters per unit"
        field="chars_per_token"
        value={cost.chars_per_token}
        step={0.1}
        hint="Approximate characters per AI processing unit. ~4 for English text."
      />
      <CostField
        label="Cleanup instructions overhead"
        field="cleanup_system_prompt_tokens"
        value={cost.cleanup_system_prompt_tokens}
        hint="Fixed cost of the instructions sent with each cleanup batch."
      />
      <CostField
        label="Cleanup overhead per paragraph"
        field="cleanup_paragraph_overhead_tokens"
        value={cost.cleanup_paragraph_overhead_tokens}
        hint="Per-paragraph overhead (numbering, formatting) added to each cleanup batch."
      />
      <CostField
        label="Cleanup output ratio (out / in)"
        field="cleanup_output_ratio"
        value={cost.cleanup_output_ratio}
        step={0.05}
        hint="Expected ratio of AI output to input for cleanup. Lower = fewer edits proposed."
      />
      <CostField
        label="USD per 1k input units"
        field="usd_per_1k_in"
        value={cost.usd_per_1k_in}
        step={0.01}
        hint="Fallback input price when the model has no built-in pricing data (e.g. Ask Sage)."
      />
      <CostField
        label="USD per 1k output units"
        field="usd_per_1k_out"
        value={cost.usd_per_1k_out}
        step={0.01}
        hint="Fallback output price when the model has no built-in pricing data."
      />
    </div>
  );
}

function CostField({
  label,
  field,
  value,
  step,
  hint,
}: {
  label: string;
  field: keyof CostAssumptions;
  value: number;
  step?: number;
  hint?: string;
}) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  async function commit() {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setDraft(String(value));
      return;
    }
    if (parsed === value) return;
    try {
      const settings = await loadSettings();
      const nextCost: CostAssumptions = { ...settings.cost, [field]: parsed };
      await saveSettings({ cost: nextCost });
      toast.success(`${label}: ${parsed}`);
    } catch (err) {
      toast.error(`Failed to save: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontWeight: 400 }}>
      <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{label}</span>
      <input
        type="number"
        min={0}
        step={step ?? 1}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
      />
      {hint && (
        <span style={{ fontSize: 11, color: 'var(--color-text-subtle)', lineHeight: 1.4 }}>
          {hint}
        </span>
      )}
    </label>
  );
}


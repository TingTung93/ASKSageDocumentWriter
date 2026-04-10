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
import { DEFAULT_SYNTHESIS_MODEL } from '../lib/template/synthesis/synthesize';
import { DEFAULT_DRAFTING_MODEL } from '../lib/draft/drafter';
import { DEFAULT_DOCUMENT_EDIT_MODEL } from '../lib/document/edit';
import { DEFAULT_EDIT_MODEL } from '../lib/edit/schema-edit';
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

const STAGES: StageMeta[] = [
  {
    stage: 'synthesis',
    label: 'Template synthesis',
    description: 'One-shot pass that converts a parsed DOCX skeleton into a semantic schema.',
    default: DEFAULT_SYNTHESIS_MODEL,
  },
  {
    stage: 'drafting',
    label: 'Section drafting',
    description: 'Per-section drafting calls during a project run.',
    default: DEFAULT_DRAFTING_MODEL,
  },
  {
    stage: 'critic',
    label: 'Critic',
    description: 'Post-draft validation pass (Phase 4 of the orchestrator).',
    default: DEFAULT_DRAFTING_MODEL,
  },
  {
    stage: 'cleanup',
    label: 'Document cleanup',
    description: 'Inline cleanup pass over an uploaded DOCX in the Documents route.',
    default: DEFAULT_DOCUMENT_EDIT_MODEL,
  },
  {
    stage: 'schema_edit',
    label: 'Schema editing',
    description: 'LLM-assisted edits applied to a template schema.',
    default: DEFAULT_EDIT_MODEL,
  },
];

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
        Per-stage model overrides and cost projection assumptions. Settings
        persist in IndexedDB across sessions. Leave a model field blank to
        fall back to the compiled-in default for that stage.
      </p>

      <h2>Model overrides</h2>
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
      />

      <h2>Critic loop (agentic drafting)</h2>
      <p className="note">
        When enabled, every drafted section is checked by a separate
        critic LLM call before being accepted. If the critic finds
        medium-or-high severity issues, the orchestrator re-drafts up
        to <code>max_iterations</code> times with the critic's feedback
        inlined into the next attempt. Used by the auto-draft recipe
        and by manual <code>Draft sections</code> runs.
      </p>
      <CriticSettingsSection critic={settings.critic ?? null} />

      <h2>Style consistency review</h2>
      <p className="note">
        After every section is drafted and the cross-section content
        review runs, this pass takes one more LLM call that looks at
        the WHOLE document's formatting — role usage, table structure,
        leaked markdown, heading hierarchy, bullet nesting — and emits
        structured fix ops that get applied before DOCX assembly. Use
        this when independently-drafted sections have produced
        inconsistent formatting (mixed fonts, malformed tables, stray
        markdown). One LLM call per project run.
      </p>
      <StyleReviewSettingsSection styleReview={settings.style_review ?? null} />

      <h2>User defaults</h2>
      <p className="note">
        Key/value pairs that get auto-populated into every NEW project's
        shared inputs. Use this for facts that don't change between
        documents — your office symbol, signature block, default POC line.
        Keys should match the shared input field keys your templates emit
        (e.g. <code>office_symbol</code>, <code>signature_block</code>,
        <code>poc_line</code>). Existing projects are unchanged.
      </p>
      <UserDefaultsSection defaults={settings.user_defaults ?? { shared_inputs: {} }} />

      <h2>Cost projection</h2>
      <p className="note">
        These numbers feed the rough token / cost estimates shown on the Documents
        and Project Detail pages before you kick off a long pass. They're not
        exact — tune them once you have real data.
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
}: {
  models: ModelOverrides;
  availableModels: ModelInfo[];
  compatibilityFilter: boolean;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      {STAGES.map((meta) => (
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
        Requires ≥ {formatTokenFloor(stageReq.min_context_length)} context, text in/out, temperature parameter.
        {compatibilityFilter && hiddenIncompatibleCount > 0 && (
          <> {hiddenIncompatibleCount.toLocaleString()} incompatible model{hiddenIncompatibleCount === 1 ? '' : 's'} hidden.</>
        )}
      </p>
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
        <select
          value={draft}
          onChange={onSelect}
          style={{ flex: '0 0 18rem' }}
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
          placeholder="Or type a model id…"
          style={{ flex: 1 }}
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
        Hide models that can't run the selected stage
      </label>
      <p className="note" style={{ marginTop: '0.4rem', marginBottom: 0 }}>
        Filters each per-stage dropdown to OpenRouter models whose
        advertised context window, modalities, and supported parameters
        meet the stage's requirements. Models with no capability metadata
        (e.g. all Ask Sage models) are always shown — the filter is a
        guard rail, not a blocklist. Turn off if you want to try a model
        whose advertised limits look wrong.
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
        Free OpenRouter models have aggressive rate limits and shorter
        context windows — usable for cleanup and refinement passes, often
        too slow or context-limited for full template synthesis.
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
    toast.success('Critic settings saved');
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
        Enable critic loop
      </label>
      <p className="note" style={{ marginTop: '0.4rem' }}>
        When disabled, sections draft once and are accepted as-is (the legacy single-pass behavior). Saves cost but loses quality on tricky sections.
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
        Cost impact: enabling the critic with default settings adds ~25% to the per-project token spend in exchange for substantially better quality. See the design discussion in the project memory for the full math.
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
        When disabled, the recipe runner skips this stage and goes straight from cross-section review to DOCX assembly. Save cost; lose normalization.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)', marginTop: 'var(--space-3)' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontWeight: 400 }}>
          <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Max fix ops per run</span>
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
        Cost impact: one extra LLM call per project run. Token cost scales with the total drafted content (the whole document JSON is sent in one shot).
      </p>
    </div>
  );
}

function CostAssumptionsSection({ cost }: { cost: CostAssumptions }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem 1rem' }}>
      <CostField
        label="Drafting tokens-in per section"
        field="drafting_tokens_in_per_section"
        value={cost.drafting_tokens_in_per_section}
        hint="Average input tokens per section drafting call (prompt + context + references)."
      />
      <CostField
        label="Drafting tokens-out per section"
        field="drafting_tokens_out_per_section"
        value={cost.drafting_tokens_out_per_section}
        hint="Average output tokens the model generates per section."
      />
      <CostField
        label="Characters per token"
        field="chars_per_token"
        value={cost.chars_per_token}
        step={0.1}
        hint="Rough char-to-token ratio for estimating token counts from text length. ~4 for English."
      />
      <CostField
        label="Cleanup system prompt overhead (tokens)"
        field="cleanup_system_prompt_tokens"
        value={cost.cleanup_system_prompt_tokens}
        hint="Fixed token cost of the system prompt sent with each cleanup chunk."
      />
      <CostField
        label="Cleanup framing tokens per paragraph"
        field="cleanup_paragraph_overhead_tokens"
        value={cost.cleanup_paragraph_overhead_tokens}
        hint="Per-paragraph overhead (index labels, formatting) added to each cleanup chunk."
      />
      <CostField
        label="Cleanup output ratio (out / in)"
        field="cleanup_output_ratio"
        value={cost.cleanup_output_ratio}
        step={0.05}
        hint="Expected ratio of output tokens to input tokens for cleanup. Lower = fewer edits proposed."
      />
      <CostField
        label="USD per 1k input tokens"
        field="usd_per_1k_in"
        value={cost.usd_per_1k_in}
        step={0.01}
        hint="Fallback input token price when the model has no per-token pricing data (e.g. Ask Sage)."
      />
      <CostField
        label="USD per 1k output tokens"
        field="usd_per_1k_out"
        value={cost.usd_per_1k_out}
        step={0.01}
        hint="Fallback output token price when the model has no per-token pricing data."
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


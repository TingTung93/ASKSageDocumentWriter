// Settings — per-stage model overrides and cost projection assumptions.
// Settings persist in IndexedDB (db.settings, singleton row id='app').
// Empty/blank model fields fall back to the compiled-in default for
// each stage.

import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAuth } from '../lib/state/auth';
import { loadSettings, saveSettings } from '../lib/settings/store';
import { toast } from '../lib/state/toast';
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

export function Settings() {
  const settings = useLiveQuery(() => loadSettings(), []);
  const apiKey = useAuth((s) => s.apiKey);
  const models = useAuth((s) => s.models);

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
          body="Connect to Ask Sage on the Connection tab to see the available models in the picker."
        />
      )}
      <ModelOverridesSection
        models={settings.models}
        availableModelIds={models?.map((m) => m.id) ?? []}
      />

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

function ModelOverridesSection({
  models,
  availableModelIds,
}: {
  models: ModelOverrides;
  availableModelIds: string[];
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      {STAGES.map((meta) => (
        <ModelOverrideRow
          key={meta.stage}
          meta={meta}
          current={models[meta.stage]}
          availableModelIds={availableModelIds}
        />
      ))}
    </div>
  );
}

function ModelOverrideRow({
  meta,
  current,
  availableModelIds,
}: {
  meta: StageMeta;
  current: string | null;
  availableModelIds: string[];
}) {
  // Local input state so the user can type a free-form id even if it
  // isn't in the connected models list. Saves on blur or button click.
  const [draft, setDraft] = useState(current ?? '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(current ?? '');
  }, [current]);

  const knownIds = useMemo(() => {
    const set = new Set(availableModelIds);
    set.add(meta.default);
    if (current) set.add(current);
    return Array.from(set).sort();
  }, [availableModelIds, meta.default, current]);

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
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
        <select
          value={draft}
          onChange={onSelect}
          style={{ flex: '0 0 14rem' }}
          disabled={saving}
        >
          <option value="">default — {meta.default}</option>
          {knownIds.map((id) => (
            <option key={id} value={id}>
              {id}
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

function CostAssumptionsSection({ cost }: { cost: CostAssumptions }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem 1rem' }}>
      <CostField
        label="Drafting tokens-in per section"
        field="drafting_tokens_in_per_section"
        value={cost.drafting_tokens_in_per_section}
      />
      <CostField
        label="Drafting tokens-out per section"
        field="drafting_tokens_out_per_section"
        value={cost.drafting_tokens_out_per_section}
      />
      <CostField
        label="Characters per token"
        field="chars_per_token"
        value={cost.chars_per_token}
        step={0.1}
      />
      <CostField
        label="Cleanup system prompt overhead (tokens)"
        field="cleanup_system_prompt_tokens"
        value={cost.cleanup_system_prompt_tokens}
      />
      <CostField
        label="Cleanup framing tokens per paragraph"
        field="cleanup_paragraph_overhead_tokens"
        value={cost.cleanup_paragraph_overhead_tokens}
      />
      <CostField
        label="Cleanup output ratio (out / in)"
        field="cleanup_output_ratio"
        value={cost.cleanup_output_ratio}
        step={0.05}
      />
      <CostField
        label="USD per 1k input tokens"
        field="usd_per_1k_in"
        value={cost.usd_per_1k_in}
        step={0.01}
      />
      <CostField
        label="USD per 1k output tokens"
        field="usd_per_1k_out"
        value={cost.usd_per_1k_out}
        step={0.01}
      />
    </div>
  );
}

function CostField({
  label,
  field,
  value,
  step,
}: {
  label: string;
  field: keyof CostAssumptions;
  value: number;
  step?: number;
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
    </label>
  );
}


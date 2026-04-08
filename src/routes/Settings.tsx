// Settings — per-stage model overrides and cost projection assumptions.
// Settings persist in IndexedDB (db.settings, singleton row id='app').
// Empty/blank model fields fall back to the compiled-in default for
// each stage.

import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAuth } from '../lib/state/auth';
import { loadSettings, saveSettings } from '../lib/settings/store';
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
        onClick={async () => {
          if (!confirm('Reset all settings to defaults?')) return;
          await saveSettings({
            models: { ...DEFAULT_MODEL_OVERRIDES },
            cost: { ...DEFAULT_COST_ASSUMPTIONS },
          });
        }}
        style={{ background: '#a33', borderColor: '#a33' }}
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
  const [savedAt, setSavedAt] = useState<number | null>(null);

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
      setSavedAt(Date.now());
    } finally {
      setSaving(false);
    }
  }

  function onSelect(e: ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value;
    setDraft(value);
    void commit(value);
  }

  return (
    <div style={{ border: '1px solid #ddd', borderRadius: 6, padding: '0.75rem 1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '1rem' }}>
        <strong>{meta.label}</strong>
        <span className="note">default: {meta.default}</span>
      </div>
      <p className="note" style={{ marginTop: '0.25rem' }}>
        {meta.description}
      </p>
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
        <select
          value={draft}
          onChange={onSelect}
          style={{ flex: '0 0 14rem', padding: '0.5rem', font: 'inherit' }}
          disabled={saving}
        >
          <option value="">(default — {meta.default})</option>
          {knownIds.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            if ((draft || null) !== current) void commit(draft);
          }}
          placeholder="Or type a model id…"
          style={{ flex: 1 }}
          disabled={saving}
        />
        {savedAt && Date.now() - savedAt < 3000 && (
          <span className="note" style={{ alignSelf: 'center' }}>
            saved
          </span>
        )}
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
        label="Cleanup tokens-in per paragraph"
        field="cleanup_tokens_in_per_paragraph"
        value={cost.cleanup_tokens_in_per_paragraph}
      />
      <CostField
        label="Cleanup tokens-out per paragraph"
        field="cleanup_tokens_out_per_paragraph"
        value={cost.cleanup_tokens_out_per_paragraph}
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
  const [savedAt, setSavedAt] = useState<number | null>(null);

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
    const settings = await loadSettings();
    const nextCost: CostAssumptions = { ...settings.cost, [field]: parsed };
    await saveSettings({ cost: nextCost });
    setSavedAt(Date.now());
  }

  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontWeight: 400 }}>
      <span style={{ fontSize: 12, color: '#555' }}>
        {label}
        {savedAt && Date.now() - savedAt < 3000 && (
          <span className="note" style={{ marginLeft: '0.5rem' }}>
            saved
          </span>
        )}
      </span>
      <input
        type="number"
        min={0}
        step={step ?? 1}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
        style={{ padding: '0.4rem' }}
      />
    </label>
  );
}


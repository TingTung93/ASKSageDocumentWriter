import { useState, useEffect } from 'react';
import { toast } from '../../lib/state/toast';
import { loadSettings, saveSettings } from '../../lib/settings/store';
import { DEFAULT_COST_ASSUMPTIONS, DEFAULT_MODEL_OVERRIDES } from '../../lib/settings/types';
import type { CostAssumptions, CriticSettings, StyleReviewSettings } from '../../lib/settings/types';

export function V2SettingsAdvanced({
  settings,
  onOpenAudit,
}: {
  settings: any;
  onOpenAudit: () => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', marginTop: '1.5rem' }}>
      <CriticCard critic={settings.critic ?? null} />
      <StyleReviewCard styleReview={settings.style_review ?? null} />
      <UserDefaultsCard defaults={settings.user_defaults ?? { shared_inputs: {} }} />
      <CostCard cost={settings.cost ?? DEFAULT_COST_ASSUMPTIONS} />
      
      <div className="s-card">
        <div className="s-head">
          <div>
            <h3>Data management</h3>
            <div className="s-desc">Reset all application settings to their defaults, or view the audit log.</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            type="button"
            className="btn btn-primary"
            style={{ backgroundColor: 'var(--rose)' }}
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
          <button className="btn" onClick={onOpenAudit}>
            Open audit log →
          </button>
        </div>
      </div>
    </div>
  );
}

function CriticCard({ critic }: { critic: CriticSettings | null }) {
  const enabled = critic?.enabled ?? true;
  const strictness = critic?.strictness ?? 'moderate';
  const maxIterations = critic?.max_iterations ?? 2;

  async function update(patch: Partial<CriticSettings>) {
    const current = await loadSettings();
    await saveSettings({
      critic: { ...(current.critic ?? { enabled: true, strictness: 'moderate', max_iterations: 2 }), ...patch },
    });
    toast.success('Quality review settings saved');
  }

  return (
    <div className="s-card">
      <div className="s-head">
        <div>
          <h3>Quality review loop</h3>
          <div className="s-desc">Every drafted section is reviewed by a separate AI check before being accepted.</div>
        </div>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600, marginBottom: '1rem' }}>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => void update({ enabled: e.target.checked })}
          style={{ width: 'auto' }}
        />
        Enable automated review
      </label>
      <div className="s-row two">
        <div className="s-field">
          <label>Strictness</label>
          <select
            value={strictness}
            onChange={(e) => void update({ strictness: e.target.value as any })}
            disabled={!enabled}
            style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--line-strong)', borderRadius: 6, backgroundColor: 'var(--paper)' }}
          >
            <option value="lenient">lenient — flag concrete errors only</option>
            <option value="moderate">moderate — also flag style/structure</option>
            <option value="strict">strict — flag any improvable aspect</option>
          </select>
        </div>
        <div className="s-field">
          <label>Max revision iterations</label>
          <select
            value={maxIterations}
            onChange={(e) => void update({ max_iterations: Number(e.target.value) })}
            disabled={!enabled}
            style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--line-strong)', borderRadius: 6, backgroundColor: 'var(--paper)' }}
          >
            <option value="1">1 — critique once, never revise</option>
            <option value="2">2 — up to 2 revisions per section</option>
            <option value="3">3 — up to 3 revisions per section</option>
          </select>
        </div>
      </div>
    </div>
  );
}

function StyleReviewCard({ styleReview }: { styleReview: StyleReviewSettings | null }) {
  const enabled = styleReview?.enabled ?? true;
  const maxOps = styleReview?.max_ops ?? 200;

  async function update(patch: Partial<StyleReviewSettings>) {
    await saveSettings({ style_review: patch });
    toast.success('Style review settings saved');
  }

  return (
    <div className="s-card">
      <div className="s-head">
        <div>
          <h3>Style consistency review</h3>
          <div className="s-desc">An AI pass that examines the WHOLE document's formatting before final assembly.</div>
        </div>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600, marginBottom: '1rem' }}>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => void update({ enabled: e.target.checked })}
          style={{ width: 'auto' }}
        />
        Enable style review
      </label>
      <div className="s-row two">
        <div className="s-field">
          <label>Max corrections per run</label>
          <input
            type="number"
            min={1}
            max={500}
            step={10}
            value={maxOps}
            onChange={(e) => void update({ max_ops: Math.max(1, Number(e.target.value) || 200) })}
            disabled={!enabled}
            style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--line-strong)', borderRadius: 6, backgroundColor: 'var(--paper)' }}
          />
        </div>
      </div>
    </div>
  );
}

function UserDefaultsCard({ defaults }: { defaults: { shared_inputs: Record<string, string> } }) {
  const [rows, setRows] = useState(() =>
    Object.entries(defaults.shared_inputs ?? {}).map(([key, value]) => ({ key, value }))
  );
  const [busy, setBusy] = useState(false);

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
    <div className="s-card">
      <div className="s-head">
        <div>
          <h3>User defaults</h3>
          <div className="s-desc">Values automatically filled in for every NEW project (e.g., office_symbol, poc_name).</div>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem' }}>
        {rows.map((row, idx) => (
          <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <input
              type="text"
              value={row.key}
              placeholder="key (e.g. office_symbol)"
              onChange={(e) => updateRow(idx, { key: e.target.value })}
              style={{ flex: '0 0 14rem', padding: '8px 12px', border: '1px solid var(--line-strong)', borderRadius: 6, backgroundColor: 'var(--paper)', fontFamily: 'var(--font-mono)', fontSize: 12 }}
            />
            <input
              type="text"
              value={row.value}
              placeholder="value"
              onChange={(e) => updateRow(idx, { value: e.target.value })}
              style={{ flex: '1 1 auto', padding: '8px 12px', border: '1px solid var(--line-strong)', borderRadius: 6, backgroundColor: 'var(--paper)' }}
            />
            <button type="button" className="btn" onClick={() => removeRow(idx)} style={{ padding: '8px' }}>
              ×
            </button>
          </div>
        ))}
        {rows.length === 0 && <div className="hint">No user defaults set yet.</div>}
      </div>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button type="button" className="btn" onClick={addRow}>Add row</button>
        <button type="button" className="btn btn-primary" onClick={() => void onSave()} disabled={busy}>
          {busy ? 'Saving...' : 'Save defaults'}
        </button>
      </div>
    </div>
  );
}

function CostCard({ cost }: { cost: CostAssumptions }) {
  return (
    <div className="s-card">
      <div className="s-head">
        <div>
          <h3>Cost projection</h3>
          <div className="s-desc">Assumptions used to estimate token costs prior to running a project.</div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <CostField label="Avg. input units per section" field="drafting_tokens_in_per_section" value={cost.drafting_tokens_in_per_section} />
        <CostField label="Avg. output units per section" field="drafting_tokens_out_per_section" value={cost.drafting_tokens_out_per_section} />
        <CostField label="Characters per unit" field="chars_per_token" value={cost.chars_per_token} step={0.1} />
        <CostField label="Cleanup instructions overhead" field="cleanup_system_prompt_tokens" value={cost.cleanup_system_prompt_tokens} />
        <CostField label="Cleanup overhead per paragraph" field="cleanup_paragraph_overhead_tokens" value={cost.cleanup_paragraph_overhead_tokens} />
        <CostField label="Cleanup output ratio" field="cleanup_output_ratio" value={cost.cleanup_output_ratio} step={0.05} />
        <CostField label="USD per 1k input units" field="usd_per_1k_in" value={cost.usd_per_1k_in} step={0.01} />
        <CostField label="USD per 1k output units" field="usd_per_1k_out" value={cost.usd_per_1k_out} step={0.01} />
      </div>
    </div>
  );
}

function CostField({ label, field, value, step }: { label: string; field: keyof CostAssumptions; value: number; step?: number }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => { setDraft(String(value)); }, [value]);

  async function commit() {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setDraft(String(value));
      return;
    }
    if (parsed === value) return;
    try {
      const settings = await loadSettings();
      await saveSettings({ cost: { ...settings.cost, [field]: parsed } });
      toast.success(`${label} saved`);
    } catch (err) {
      toast.error(`Failed to save: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return (
    <div className="s-field">
      <label>{label}</label>
      <input
        type="number"
        min={0}
        step={step ?? 1}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
        style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--line-strong)', borderRadius: 6, backgroundColor: 'var(--paper)' }}
      />
    </div>
  );
}

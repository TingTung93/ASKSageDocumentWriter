// Project helpers — derive shared input fields from selected templates
// and provide simple CRUD against Dexie.

import { db, type ProjectRecord, type TemplateRecord } from '../db/schema';
import type { MetadataFillRegion } from '../template/types';
import { loadSettings } from '../settings/store';

export interface SharedInputField {
  /** Unique key across all selected templates (project_input_field) */
  key: string;
  /** First template name where this field appears (for display) */
  display_name: string;
  /** Control hint inherited from the first content control */
  control_type: MetadataFillRegion['control_type'];
  /** Allowed values (e.g. for CUI dropdowns) — union across templates */
  allowed_values?: string[];
  required: boolean;
  /** Templates that need this field */
  template_ids: string[];
}

/**
 * Walk the metadata_fill_regions of every selected template and produce
 * a deduplicated list of input fields the user must fill. Same project
 * field name across multiple templates is collapsed into one entry.
 */
export function deriveSharedInputFields(
  templates: TemplateRecord[],
): SharedInputField[] {
  const byKey = new Map<string, SharedInputField>();
  for (const tpl of templates) {
    for (const m of tpl.schema_json.metadata_fill_regions) {
      const key = m.project_input_field;
      const existing = byKey.get(key);
      if (existing) {
        if (!existing.template_ids.includes(tpl.id)) {
          existing.template_ids.push(tpl.id);
        }
        // Union of allowed values
        if (m.allowed_values) {
          const union = new Set([...(existing.allowed_values ?? []), ...m.allowed_values]);
          existing.allowed_values = Array.from(union);
        }
        existing.required = existing.required || m.required;
      } else {
        byKey.set(key, {
          key,
          display_name: humanizeKey(key),
          control_type: m.control_type,
          allowed_values: m.allowed_values ? [...m.allowed_values] : undefined,
          required: m.required,
          template_ids: [tpl.id],
        });
      }
    }
  }
  return Array.from(byKey.values());
}

function humanizeKey(key: string): string {
  return key
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function newProjectId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `prj_${Date.now()}_${Math.floor(Math.random() * 1e9)}`;
}

export async function createProject(input: {
  name: string;
  description: string;
  template_ids: string[];
  reference_dataset_names: string[];
  live_search?: 0 | 1 | 2;
  mode?: import('../db/schema').ProjectMode;
  freeform_style?: string;
}): Promise<ProjectRecord> {
  const now = new Date().toISOString();
  // Pre-populate shared_inputs from user-level defaults so the user
  // doesn't have to retype the same office symbol / signature block
  // / POC line on every new project. The user_defaults map keys are
  // matched directly against shared input field keys; the metadata
  // batch and per-section drafter pick them up like any other
  // pre-filled value.
  const settings = await loadSettings();
  const userDefaults = settings.user_defaults?.shared_inputs ?? {};
  const seededInputs: Record<string, string> = {};
  for (const [k, v] of Object.entries(userDefaults)) {
    if (typeof v === 'string' && v.trim().length > 0) {
      seededInputs[k] = v;
    }
  }
  const record: ProjectRecord = {
    id: newProjectId(),
    name: input.name,
    description: input.description,
    template_ids: input.template_ids,
    reference_dataset_names: input.reference_dataset_names,
    shared_inputs: seededInputs,
    mode: input.mode ?? 'template',
    freeform_style: input.freeform_style,
    model_overrides: {},
    live_search: input.live_search ?? 0,
    created_at: now,
    updated_at: now,
  };
  await db.projects.put(record);
  return record;
}

export async function updateProject(
  id: string,
  patch: Partial<Omit<ProjectRecord, 'id' | 'created_at'>>,
): Promise<void> {
  const existing = await db.projects.get(id);
  if (!existing) throw new Error(`Project not found: ${id}`);
  await db.projects.put({
    ...existing,
    ...patch,
    updated_at: new Date().toISOString(),
  });
}

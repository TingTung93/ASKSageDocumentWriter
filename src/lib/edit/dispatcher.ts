// Pure functions that apply edit operations to a TemplateSchema or a
// DraftParagraph[] and return a new (immutable) result. Each edit
// returns success/error so the caller can show per-op status.

import type { TemplateSchema, BodyFillRegion } from '../template/types';
import type { DraftParagraph } from '../draft/types';
import type {
  ApplyResult,
  DraftEditOp,
  DraftEditOutput,
  SchemaEditOp,
  SchemaEditOutput,
} from './types';

// ─── Schema dispatcher ─────────────────────────────────────────────

export function applySchemaEdits(
  schema: TemplateSchema,
  output: SchemaEditOutput,
): ApplyResult<TemplateSchema> {
  let working: TemplateSchema = clone(schema);
  const applied: ApplyResult<TemplateSchema>['applied'] = [];

  for (const edit of output.edits) {
    try {
      working = applySchemaEdit(working, edit);
      applied.push({ op: edit.op, success: true });
    } catch (e) {
      applied.push({
        op: edit.op,
        success: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return { result: working, applied };
}

function applySchemaEdit(schema: TemplateSchema, edit: SchemaEditOp): TemplateSchema {
  switch (edit.op) {
    case 'set_section_field': {
      const sections = schema.sections.map((s) => {
        if (s.id !== edit.section_id) return s;
        if (edit.field === 'name') return { ...s, name: edit.value };
        if (edit.field === 'intent') return { ...s, intent: edit.value };
        return s;
      });
      requireSectionExists(schema, edit.section_id);
      return { ...schema, sections };
    }
    case 'set_section_target_words': {
      requireSectionExists(schema, edit.section_id);
      const sections = schema.sections.map((s) =>
        s.id === edit.section_id ? { ...s, target_words: edit.value } : s,
      );
      return { ...schema, sections };
    }
    case 'set_section_depends_on': {
      requireSectionExists(schema, edit.section_id);
      const sections = schema.sections.map((s) =>
        s.id === edit.section_id ? { ...s, depends_on: edit.value } : s,
      );
      return { ...schema, sections };
    }
    case 'set_section_validation': {
      requireSectionExists(schema, edit.section_id);
      const sections = schema.sections.map((s) => {
        if (s.id !== edit.section_id) return s;
        const validation: Record<string, unknown> = { ...(s.validation ?? {}) };
        validation[edit.rule] = edit.value;
        return { ...s, validation };
      });
      return { ...schema, sections };
    }
    case 'remove_section': {
      requireSectionExists(schema, edit.section_id);
      return {
        ...schema,
        sections: schema.sections
          .filter((s) => s.id !== edit.section_id)
          .map((s, i) => ({ ...s, order: i })),
      };
    }
    case 'reorder_sections': {
      const byId = new Map(schema.sections.map((s) => [s.id, s]));
      const reordered: BodyFillRegion[] = [];
      for (const id of edit.new_order) {
        const s = byId.get(id);
        if (!s) throw new Error(`reorder_sections: unknown section_id ${id}`);
        reordered.push({ ...s, order: reordered.length });
        byId.delete(id);
      }
      // Append any sections the LLM forgot, preserving their relative order
      for (const s of schema.sections) {
        if (byId.has(s.id)) {
          reordered.push({ ...s, order: reordered.length });
        }
      }
      return { ...schema, sections: reordered };
    }
    case 'set_style_field': {
      return {
        ...schema,
        style: {
          ...schema.style,
          [edit.field]: edit.value,
        },
      };
    }
    case 'add_banned_phrase': {
      const set = new Set(schema.style.banned_phrases);
      set.add(edit.phrase);
      return { ...schema, style: { ...schema.style, banned_phrases: Array.from(set) } };
    }
    case 'remove_banned_phrase': {
      const next = schema.style.banned_phrases.filter((p) => p !== edit.phrase);
      return { ...schema, style: { ...schema.style, banned_phrases: next } };
    }
    default: {
      const _exhaustive: never = edit;
      throw new Error(`unknown schema edit op: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

function requireSectionExists(schema: TemplateSchema, id: string): void {
  if (!schema.sections.some((s) => s.id === id)) {
    throw new Error(`section_id "${id}" does not exist in schema`);
  }
}

// ─── Draft dispatcher ──────────────────────────────────────────────

export interface DraftLookup {
  /** Returns the current paragraph list for this template+section */
  get(template_id: string, section_id: string): DraftParagraph[] | undefined;
}

export interface DraftEditResult {
  /**
   * Map of "${template_id}::${section_id}" → new paragraph list. Only
   * sections actually touched by an edit appear here. Caller is
   * responsible for persisting them.
   */
  updated: Map<string, DraftParagraph[]>;
  applied: Array<{ op: string; success: boolean; error?: string }>;
}

export function applyDraftEdits(
  output: DraftEditOutput,
  lookup: DraftLookup,
): DraftEditResult {
  const updated = new Map<string, DraftParagraph[]>();
  const applied: DraftEditResult['applied'] = [];

  function key(t: string, s: string): string {
    return `${t}::${s}`;
  }

  function getCurrent(template_id: string, section_id: string): DraftParagraph[] {
    const k = key(template_id, section_id);
    if (updated.has(k)) return updated.get(k)!;
    const fresh = lookup.get(template_id, section_id);
    if (!fresh) throw new Error(`no draft found for ${k}`);
    return fresh;
  }

  for (const edit of output.edits) {
    try {
      const current = getCurrent(edit.template_id, edit.section_id);
      const next = applyOneDraftEdit(current, edit);
      updated.set(key(edit.template_id, edit.section_id), next);
      applied.push({ op: edit.op, success: true });
    } catch (e) {
      applied.push({
        op: edit.op,
        success: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return { updated, applied };
}

function applyOneDraftEdit(
  paragraphs: DraftParagraph[],
  edit: DraftEditOp,
): DraftParagraph[] {
  switch (edit.op) {
    case 'replace_paragraph': {
      if (edit.index < 0 || edit.index >= paragraphs.length) {
        throw new Error(`replace_paragraph: index ${edit.index} out of range`);
      }
      return paragraphs.map((p, i) =>
        i === edit.index ? { ...p, text: edit.text, role: edit.role ?? p.role } : p,
      );
    }
    case 'insert_paragraph': {
      const idx = Math.max(-1, Math.min(paragraphs.length - 1, edit.after_index));
      const next = paragraphs.slice();
      next.splice(idx + 1, 0, { role: edit.role, text: edit.text });
      return next;
    }
    case 'delete_paragraph': {
      if (edit.index < 0 || edit.index >= paragraphs.length) {
        throw new Error(`delete_paragraph: index ${edit.index} out of range`);
      }
      return paragraphs.filter((_, i) => i !== edit.index);
    }
    case 'replace_text_in_section': {
      return paragraphs.map((p) => ({
        ...p,
        text: p.text.split(edit.find).join(edit.replace),
      }));
    }
    default: {
      const _exhaustive: never = edit;
      throw new Error(`unknown draft edit op: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

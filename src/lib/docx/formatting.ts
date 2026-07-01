import type { TemplateSchema } from '../template/types';

export interface FormattingInventory {
  paragraphStyleIds: Set<string>;
  tableStyleIds: Set<string>;
  characterStyleIds: Set<string>;
  listTemplates: Array<{ num_id: number; levels: number[] }>;
  headerFooterParts: string[];
  defaultFont: { family: string | null; size_pt: number | null };
}

export function buildFormattingInventory(schema: TemplateSchema): FormattingInventory {
  const paragraphStyleIds = new Set<string>();
  const tableStyleIds = new Set<string>();
  const characterStyleIds = new Set<string>();

  for (const style of schema.formatting.named_styles) {
    if (style.type === 'paragraph') paragraphStyleIds.add(style.id);
    if (style.type === 'table') tableStyleIds.add(style.id);
    if (style.type === 'character') characterStyleIds.add(style.id);
  }

  return {
    paragraphStyleIds,
    tableStyleIds,
    characterStyleIds,
    listTemplates: schema.formatting.numbering_definitions.map((n) => ({
      num_id: n.id,
      levels: n.levels.map((l) => l.level),
    })),
    headerFooterParts: [
      ...schema.formatting.headers.map((h) => h.part),
      ...schema.formatting.footers.map((f) => f.part),
    ],
    defaultFont: schema.formatting.default_font,
  };
}

export function buildDefaultFormattingInventory(): FormattingInventory {
  return {
    paragraphStyleIds: new Set([
      'Normal',
      'Heading1',
      'Heading2',
      'Heading3',
      'Heading4',
      'ListBullet',
      'ListNumber',
      'Quote',
    ]),
    tableStyleIds: new Set(['TableGrid']),
    characterStyleIds: new Set(),
    listTemplates: [
      { num_id: 1, levels: [0, 1, 2, 3, 4, 5, 6, 7, 8] },
      { num_id: 2, levels: [0, 1, 2, 3, 4, 5, 6, 7, 8] },
    ],
    headerFooterParts: [],
    defaultFont: { family: 'Calibri', size_pt: 11 },
  };
}

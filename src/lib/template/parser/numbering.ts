// Parses word/numbering.xml — extracts numbering definitions (numId →
// abstractNum → levels). DOCX numbering is two-tier: numId is the
// instance you reference from a paragraph; it points at an abstractNumId
// which contains the actual level definitions.

import type { NumberingDefinition, NumberingLevel } from '../types';
import { wAll, wAttr, wAttrInt, wFirst } from './ns';

export function parseNumberingXml(dom: Document): NumberingDefinition[] {
  // Build a map of abstractNumId → levels[]
  const abstracts = new Map<number, NumberingLevel[]>();
  for (const aNum of wAll(dom, 'abstractNum')) {
    const id = wAttrInt(aNum, 'abstractNumId');
    if (id === null) continue;
    abstracts.set(id, parseLevels(aNum));
  }

  // Walk numId entries and resolve them via abstractNumId
  const result: NumberingDefinition[] = [];
  for (const num of wAll(dom, 'num')) {
    const id = wAttrInt(num, 'numId');
    if (id === null) continue;
    const aRef = wFirst(num, 'abstractNumId');
    const aId = wAttrInt(aRef, 'val');
    if (aId === null) continue;
    const levels = abstracts.get(aId) ?? [];
    result.push({ id, abstract_id: aId, levels });
  }
  return result;
}

function parseLevels(aNum: Element): NumberingLevel[] {
  const lvls = wAll(aNum, 'lvl');
  return lvls.map((lvl) => parseLevel(lvl));
}

function parseLevel(lvl: Element): NumberingLevel {
  const level = wAttrInt(lvl, 'ilvl') ?? 0;
  const numFmt = wFirst(lvl, 'numFmt');
  const lvlText = wFirst(lvl, 'lvlText');
  const pPr = wFirst(lvl, 'pPr');
  const ind = pPr ? wFirst(pPr, 'ind') : null;

  return {
    level,
    format: wAttr(numFmt, 'val') ?? 'decimal',
    text: wAttr(lvlText, 'val') ?? `%${level + 1}.`,
    indent_twips: wAttrInt(ind, 'left'),
  };
}

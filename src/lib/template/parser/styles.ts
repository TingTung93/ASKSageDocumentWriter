// Parses word/styles.xml — extracts default font and named style definitions.

import type { DefaultFont, NamedStyle } from '../types';
import { wAll, wAttr, wAttrInt, wFirst } from './ns';

export interface ParsedStyles {
  default_font: DefaultFont;
  named_styles: NamedStyle[];
}

export function parseStylesXml(dom: Document): ParsedStyles {
  return {
    default_font: parseDefaultFont(dom),
    named_styles: parseNamedStyles(dom),
  };
}

function parseDefaultFont(dom: Document): DefaultFont {
  // <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts ... /><w:sz w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults>
  const rPrDefault = wFirst(dom, 'rPrDefault');
  if (!rPrDefault) return { family: null, size_pt: null };
  const rFonts = wFirst(rPrDefault, 'rFonts');
  const sz = wFirst(rPrDefault, 'sz');

  // rFonts has multiple attributes: ascii, hAnsi, eastAsia, cs. Prefer ascii.
  const family =
    wAttr(rFonts, 'ascii') ??
    wAttr(rFonts, 'hAnsi') ??
    wAttr(rFonts, 'cs') ??
    null;

  // sz is in half-points, so divide by 2 for pt
  const halfPoints = wAttrInt(sz, 'val');
  const size_pt = halfPoints !== null ? halfPoints / 2 : null;

  return { family, size_pt };
}

function parseNamedStyles(dom: Document): NamedStyle[] {
  const styles = wAll(dom, 'style');
  return styles
    .map((s) => parseStyle(s))
    .filter((s): s is NamedStyle => s !== null);
}

function parseStyle(el: Element): NamedStyle | null {
  const id = wAttr(el, 'styleId');
  if (!id) return null;
  const typeAttr = wAttr(el, 'type');
  const type = isStyleType(typeAttr) ? typeAttr : 'unknown';

  const nameEl = wFirst(el, 'name');
  const name = wAttr(nameEl, 'val') ?? id;

  const basedOnEl = wFirst(el, 'basedOn');
  const based_on = wAttr(basedOnEl, 'val');

  // outlineLvl lives inside pPr; for paragraph styles only
  const pPr = wFirst(el, 'pPr');
  const outlineLvlEl = pPr ? wFirst(pPr, 'outlineLvl') : null;
  const outline_level = wAttrInt(outlineLvlEl, 'val');

  // numId lives inside pPr/numPr
  const numPr = pPr ? wFirst(pPr, 'numPr') : null;
  const numIdEl = numPr ? wFirst(numPr, 'numId') : null;
  const numbering_id = wAttrInt(numIdEl, 'val');

  return {
    id,
    name,
    type,
    based_on,
    outline_level,
    numbering_id,
  };
}

function isStyleType(v: string | null): v is NamedStyle['type'] {
  return v === 'paragraph' || v === 'character' || v === 'table' || v === 'numbering';
}

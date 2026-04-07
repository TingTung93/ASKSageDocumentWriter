// OOXML namespace URIs used by the parser. Always use the namespace-aware
// DOM methods (getElementsByTagNameNS, getAttributeNS) so we don't depend
// on whether the source DOCX uses a "w:" prefix or some other binding.

export const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
export const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** Shorthand: get elements with the given local name in the wordprocessingml namespace */
export function wAll(scope: ParentNode, local: string): Element[] {
  if (scope instanceof Document) {
    return Array.from(scope.getElementsByTagNameNS(W_NS, local));
  }
  if (scope instanceof Element) {
    return Array.from(scope.getElementsByTagNameNS(W_NS, local));
  }
  return [];
}

/** Get the first w:* descendant with the given local name, or null */
export function wFirst(scope: ParentNode, local: string): Element | null {
  const list = wAll(scope, local);
  return list.length > 0 ? list[0]! : null;
}

/** Get a w:* attribute value */
export function wAttr(el: Element | null, local: string): string | null {
  if (!el) return null;
  return el.getAttributeNS(W_NS, local);
}

/** Parse a numeric w:* attribute, returning null on absence/NaN */
export function wAttrInt(el: Element | null, local: string): number | null {
  const v = wAttr(el, local);
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

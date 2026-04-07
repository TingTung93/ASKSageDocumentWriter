// Detects Word content controls (w:sdt) in word/document.xml and extracts
// their tag, type, and any constraint values (dropdown items, etc.).
//
// Content controls are the cleanest signal we can use because Word lets
// users define them with explicit machine-readable tags. DHA templates
// commonly use them for CUI banners (dropdown), document numbers (text),
// effective dates (date), and approving authorities.

import type { ContentControlType } from '../types';
import { wAll, wAttr, wFirst } from './ns';

export interface ContentControlInfo {
  /** w:sdtPr/w:tag @w:val — the machine identifier */
  tag: string | null;
  /** w:sdtPr/w:alias @w:val — the human label */
  alias: string | null;
  control_type: ContentControlType;
  /** For dropdown/comboBox: the listed values */
  allowed_values: string[];
  /** Heuristic guess: is this a small metadata field or a body region? */
  is_metadata: boolean;
  /** The current text content (default value if user hasn't filled it) */
  current_text: string;
  /** Reference to the underlying element */
  el: Element;
}

export function findContentControls(dom: Document): ContentControlInfo[] {
  return wAll(dom, 'sdt').map((sdt) => parseSdt(sdt));
}

function parseSdt(sdt: Element): ContentControlInfo {
  const sdtPr = wFirst(sdt, 'sdtPr');

  const tagEl = sdtPr ? wFirst(sdtPr, 'tag') : null;
  const tag = wAttr(tagEl, 'val');

  const aliasEl = sdtPr ? wFirst(sdtPr, 'alias') : null;
  const alias = wAttr(aliasEl, 'val');

  const control_type = detectControlType(sdtPr);
  const allowed_values = collectAllowedValues(sdtPr, control_type);

  // The text content of the sdtContent (or the whole sdt as fallback)
  const sdtContent = wFirst(sdt, 'sdtContent');
  const current_text = Array.from(
    (sdtContent ?? sdt).getElementsByTagNameNS(
      'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
      't',
    ),
  )
    .map((t) => t.textContent ?? '')
    .join('');

  // Heuristic: a content control is metadata if its current text is short
  // (< 200 chars) and does not span multiple paragraphs, OR if its type is
  // explicitly a small-value type (dropdown, date, checkbox).
  const paragraphCount = sdtContent
    ? sdtContent.getElementsByTagNameNS(
        'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
        'p',
      ).length
    : 0;
  const isShortText = current_text.length < 200;
  const isStructuredValue =
    control_type === 'dropdown' ||
    control_type === 'combo_box' ||
    control_type === 'date' ||
    control_type === 'checkbox' ||
    control_type === 'picture';
  const is_metadata = isStructuredValue || (isShortText && paragraphCount <= 1);

  return {
    tag,
    alias,
    control_type,
    allowed_values,
    is_metadata,
    current_text,
    el: sdt,
  };
}

function detectControlType(sdtPr: Element | null): ContentControlType {
  if (!sdtPr) return 'unknown';
  // The presence of specific child elements indicates the type
  if (wFirst(sdtPr, 'comboBox')) return 'combo_box';
  if (wFirst(sdtPr, 'dropDownList')) return 'dropdown';
  if (wFirst(sdtPr, 'date')) return 'date';
  if (wFirst(sdtPr, 'checkbox')) return 'checkbox';
  if (wFirst(sdtPr, 'picture')) return 'picture';
  if (wFirst(sdtPr, 'text')) return 'plain_text';
  // If none of the above, it's a default rich text control
  return 'rich_text';
}

function collectAllowedValues(sdtPr: Element | null, type: ContentControlType): string[] {
  if (!sdtPr) return [];
  if (type !== 'dropdown' && type !== 'combo_box') return [];
  const wrapper = wFirst(sdtPr, type === 'dropdown' ? 'dropDownList' : 'comboBox');
  if (!wrapper) return [];
  return wAll(wrapper, 'listItem')
    .map((li) => wAttr(li, 'value') ?? wAttr(li, 'displayText') ?? '')
    .filter((v) => v.length > 0);
}

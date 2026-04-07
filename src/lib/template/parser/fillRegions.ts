// Combines the various detection strategies into a single ordered list
// of fill regions, classified into metadata vs body. Detection priority
// (per PRD §4 Stage 1a):
//   1. Word content controls (w:sdt) — tag-based, machine-readable
//   2. Bookmarks — stable named ranges
//   3. Placeholder text patterns — [INSERT...], {{...}}, <<...>>
//   4. Heading-bounded sections — fallback when nothing else marks intent
//
// Returns metadata regions (filled from project inputs) and body regions
// (drafted by the LLM) as separate arrays for the schema.

import type {
  BodyFillRegion,
  ContentControlType,
  MetadataFillRegion,
  NamedStyle,
} from '../types';
import type { ContentControlInfo } from './contentControls';
import type { ParagraphInfo } from './document';

export interface FillRegions {
  metadata: MetadataFillRegion[];
  body: BodyFillRegion[];
}

interface DetectionContext {
  paragraphs: ParagraphInfo[];
  contentControls: ContentControlInfo[];
  namedStyles: NamedStyle[];
}

export function detectFillRegions(ctx: DetectionContext): FillRegions {
  const metadata: MetadataFillRegion[] = [];
  const bodyFromControls: BodyFillRegion[] = [];

  // ─── Pass 1: content controls ──────────────────────────────────────
  let order = 0;
  for (const cc of ctx.contentControls) {
    if (cc.is_metadata) {
      metadata.push(toMetadataRegion(cc));
    } else {
      bodyFromControls.push(toBodyRegionFromControl(cc, order++, ctx));
    }
  }

  // ─── Pass 2: heading-bounded sections (fallback) ───────────────────
  // Only run this if we found NO body fill regions from content controls,
  // because mixing both would create overlapping regions. In v1 we treat
  // these as alternatives, not complementary.
  let bodyRegions = bodyFromControls;
  if (bodyFromControls.length === 0) {
    bodyRegions = detectHeadingBoundedSections(ctx);
  }

  // ─── Pass 3: whole-document fallback ───────────────────────────────
  // If neither content controls nor headings produced any body regions
  // (typical for memo templates that use a flat single-style layout),
  // create one synthetic section that spans the entire body. The
  // synthesis pass then has at least one section to attach an intent
  // to, and the LLM can describe the document holistically. Better
  // memo-specific detection (numbered sections, "MEMORANDUM FOR" etc.)
  // can be added in a follow-up pass.
  if (bodyRegions.length === 0 && ctx.paragraphs.length > 0) {
    bodyRegions = createWholeBodyFallback(ctx);
  }

  return { metadata, body: bodyRegions };
}

function createWholeBodyFallback(ctx: DetectionContext): BodyFillRegion[] {
  const body_style_id =
    findStyleByName(ctx.namedStyles, ['Body Text', 'BodyText', 'Normal']) ?? null;
  return [
    {
      id: 'document_body',
      name: 'Document body',
      order: 0,
      required: true,
      fill_region: {
        kind: 'heading_bounded',
        heading_text: '',
        heading_style_id: null,
        body_style_id,
        anchor_paragraph_index: -1,
        end_anchor_paragraph_index: ctx.paragraphs.length - 1,
        permitted_roles: ['body', 'bullet', 'step', 'note', 'table'],
      },
    },
  ];
}

function toMetadataRegion(cc: ContentControlInfo): MetadataFillRegion {
  const id = cc.tag ? snakeify(cc.tag) : `metadata_${Math.floor(Math.random() * 1e6)}`;
  return {
    id,
    kind: 'content_control',
    sdt_tag: cc.tag ?? undefined,
    control_type: cc.control_type,
    allowed_values: cc.allowed_values.length > 0 ? cc.allowed_values : undefined,
    project_input_field: id,
    required: true,
  };
}

function toBodyRegionFromControl(
  cc: ContentControlInfo,
  order: number,
  ctx: DetectionContext,
): BodyFillRegion {
  const id = cc.tag ? snakeify(cc.tag) : `body_${order}`;
  const name = cc.alias ?? cc.tag ?? `Section ${order + 1}`;
  // Find the body style by looking at the paragraphs inside the control,
  // if we can — fallback to the first 'normal'/'BodyText' style we know.
  const body_style_id =
    findStyleByName(ctx.namedStyles, ['Body Text', 'BodyText', 'Normal']) ?? null;
  const heading_style_id = findStyleByName(ctx.namedStyles, ['Heading 1', 'Heading1']) ?? null;
  return {
    id,
    name,
    order,
    required: true,
    fill_region: {
      kind: 'content_control',
      sdt_tag: cc.tag ?? '',
      heading_style_id,
      body_style_id,
      numbering_id: null,
      permitted_roles: rolesForControlType(cc.control_type),
    },
  };
}

function detectHeadingBoundedSections(ctx: DetectionContext): BodyFillRegion[] {
  // A heading is a paragraph whose style id maps to a NamedStyle with a
  // numeric outline_level (typically 0..5 for Heading 1..6).
  const headingStyleIds = new Set(
    ctx.namedStyles
      .filter((s) => s.outline_level !== null && s.outline_level <= 2)
      .map((s) => s.id),
  );

  // Special-case: if no styles declare outline_level (jsdom-built fixtures
  // sometimes omit it), fall back to matching style names that begin with
  // "Heading".
  if (headingStyleIds.size === 0) {
    for (const s of ctx.namedStyles) {
      if (/^Heading\s*\d+$/i.test(s.name) || /^Heading\d+$/i.test(s.id)) {
        headingStyleIds.add(s.id);
      }
    }
  }

  const headingIndices: number[] = [];
  for (const p of ctx.paragraphs) {
    if (p.style_id && headingStyleIds.has(p.style_id)) {
      headingIndices.push(p.index);
    }
  }

  if (headingIndices.length === 0) return [];

  const body_style_id =
    findStyleByName(ctx.namedStyles, ['Body Text', 'BodyText', 'Normal']) ?? null;

  const regions: BodyFillRegion[] = [];
  for (let i = 0; i < headingIndices.length; i++) {
    const startIdx = headingIndices[i]!;
    const nextHeadingIdx = headingIndices[i + 1];
    const endIdx =
      nextHeadingIdx !== undefined ? nextHeadingIdx - 1 : ctx.paragraphs.length - 1;
    const headingPara = ctx.paragraphs[startIdx]!;
    const heading_text = headingPara.text || `Section ${i + 1}`;
    const id = snakeify(heading_text);
    const heading_style_id = headingPara.style_id ?? null;

    regions.push({
      id,
      name: heading_text,
      order: i,
      required: true,
      fill_region: {
        kind: 'heading_bounded',
        heading_text,
        heading_style_id,
        body_style_id,
        anchor_paragraph_index: startIdx,
        end_anchor_paragraph_index: endIdx,
        permitted_roles: ['body', 'bullet', 'step', 'note'],
      },
    });
  }
  return regions;
}

function rolesForControlType(t: ContentControlType): string[] {
  switch (t) {
    case 'rich_text':
      return ['body', 'bullet', 'step', 'note'];
    case 'plain_text':
      return ['body'];
    default:
      return ['body'];
  }
}

function findStyleByName(styles: NamedStyle[], candidates: string[]): string | null {
  for (const c of candidates) {
    const hit = styles.find((s) => s.id === c || s.name === c);
    if (hit) return hit.id;
  }
  return null;
}

function snakeify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
}

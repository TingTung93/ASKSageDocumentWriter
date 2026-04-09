// Builds the final TemplateSchema by combining the parser's structural
// half (formatting, named styles, numbering, metadata fill regions) with
// the LLM's authored section list (the body sections and their semantic
// fields, plus the document's overall style block).
//
// This is NOT an enrichment pass — the LLM is the author of the section
// list. Parser-detected sections are discarded in favor of whatever the
// LLM emitted. The LLM's paragraph_range for each section becomes the
// new BodyFillRegion's anchor indices.
//
// If the LLM emits zero sections (failure mode), we fall back to the
// parser's section list so we don't lose work entirely.

import type { BodyFillRegion, NamedStyle, TemplateSchema } from '../types';
import type { LLMSemanticOutput, LLMSemanticSection } from './types';

export interface MergeOptions {
  semantic_synthesizer: string;
  ingested_at?: string;
}

export function mergeSemanticIntoSchema(
  structural: TemplateSchema,
  semantic: LLMSemanticOutput,
  opts: MergeOptions,
): TemplateSchema {
  // document_part sections (page header / page footer regions emitted
  // by the parser) are NEVER authored by the LLM. The synthesis prompt
  // doesn't include the header/footer XML, and the LLM has no way to
  // produce a `kind: 'document_part'` descriptor anyway. Preserve them
  // through the merge so they survive into the assembled docx.
  const docPartSections = structural.sections.filter(
    (s) => s.fill_region.kind === 'document_part',
  );

  const llmAuthored =
    semantic.sections.length > 0
      ? semantic.sections.map((llm, order) =>
          buildSectionFromLLM(llm, order, structural.formatting.named_styles),
        )
      : structural.sections.filter((s) => s.fill_region.kind !== 'document_part');

  // Re-number document_part orders so they sort after the LLM body
  // sections in the project view.
  const renumberedDocParts = docPartSections.map((s, i) => ({
    ...s,
    order: llmAuthored.length + i,
  }));

  const sections = [...llmAuthored, ...renumberedDocParts];

  return {
    ...structural,
    sections,
    style: {
      voice: semantic.style.voice,
      tense: semantic.style.tense,
      register: semantic.style.register,
      jargon_policy: semantic.style.jargon_policy,
      banned_phrases: semantic.style.banned_phrases,
    },
    source: {
      ...structural.source,
      semantic_synthesizer: opts.semantic_synthesizer,
      ingested_at: opts.ingested_at ?? structural.source.ingested_at,
    },
  };
}

function buildSectionFromLLM(
  llm: LLMSemanticSection,
  order: number,
  namedStyles: NamedStyle[],
): BodyFillRegion {
  const body_style_id = findStyleByName(namedStyles, ['Body Text', 'BodyText', 'Normal']);
  const heading_style_id = findStyleByName(namedStyles, ['Heading 1', 'Heading1']);

  const [first, last] = llm.paragraph_range;
  return {
    id: llm.id,
    name: llm.name,
    order,
    required: true,
    fill_region: {
      kind: 'heading_bounded',
      heading_text: llm.name,
      heading_style_id,
      body_style_id,
      // anchor_paragraph_index is the LINE BEFORE the body content. For
      // LLM-authored sections we treat the first paragraph as the
      // section's first content line (no separate "heading" paragraph),
      // so anchor = first - 1 (or -1 if first is 0). The export pipeline
      // can use these to locate the right slice.
      anchor_paragraph_index: Math.max(-1, first - 1),
      end_anchor_paragraph_index: last,
      permitted_roles: ['body', 'bullet', 'step', 'note', 'table'],
    },
    intent: llm.intent,
    target_words: llm.target_words,
    depends_on: llm.depends_on,
    validation: llm.validation as Record<string, unknown> | undefined,
  };
}

function findStyleByName(styles: NamedStyle[], candidates: string[]): string | null {
  for (const c of candidates) {
    const hit = styles.find((s) => s.id === c || s.name === c);
    if (hit) return hit.id;
  }
  return null;
}

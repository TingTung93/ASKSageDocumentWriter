/**
 * Freeform document drafter. Takes a project's description, attached
 * context (notes + file excerpts), and a style profile, then produces
 * a complete document as DraftParagraph[].
 *
 * Unlike the template-based drafter which calls the LLM once per
 * section, this produces the entire document in a single call (or
 * iteratively with the critic loop if enabled).
 */

import type { LLMClient } from '../provider/types';
import type { QueryInput } from '../asksage/types';
import type { DraftParagraph } from '../draft/types';
import type { FreeformStyle } from './styles';
import type { ProjectContextItem } from '../db/schema';
import { DEFAULT_DRAFTING_MODEL } from '../draft/drafter';

export interface FreeformDraftArgs {
  client: LLMClient;
  style: FreeformStyle;
  project_description: string;
  context_items: ProjectContextItem[];
  /** Optional pre-extracted text for files (keyed by context item id) */
  file_extracts?: Map<string, string>;
  /** Model override */
  model?: string;
  /** Dataset name for RAG */
  dataset?: string;
  /** Web search mode */
  live?: 0 | 1 | 2;
  /** RAG reference limit */
  limit_references?: number;
}

export interface FreeformDraftResult {
  paragraphs: DraftParagraph[];
  model: string;
  tokens_in: number;
  tokens_out: number;
  prompt_sent: string;
}

/**
 * Draft a complete freeform document.
 */
export async function draftFreeformDocument(
  args: FreeformDraftArgs,
): Promise<FreeformDraftResult> {
  const {
    client,
    style,
    project_description,
    context_items,
    file_extracts,
    model,
    dataset,
    live,
    limit_references,
  } = args;

  // ── Build context block ──────────────────────────────────────
  const contextParts: string[] = [];

  // Notes
  const notes = context_items.filter((c) => c.kind === 'note');
  if (notes.length > 0) {
    contextParts.push('=== PROJECT NOTES ===');
    for (const note of notes) {
      contextParts.push(`[${note.role}]: ${note.text}`);
    }
  }

  // File extracts
  const files = context_items.filter((c) => c.kind === 'file');
  if (files.length > 0 && file_extracts) {
    const fileTexts: string[] = [];
    for (const f of files) {
      const text = file_extracts.get(f.id);
      if (text) {
        fileTexts.push(`--- ${f.filename} ---\n${text}`);
      }
    }
    if (fileTexts.length > 0) {
      contextParts.push('\n=== ATTACHED REFERENCE FILES ===');
      contextParts.push(fileTexts.join('\n\n'));
    }
  }

  const contextBlock = contextParts.length > 0
    ? contextParts.join('\n')
    : '(No additional context provided. Draft based on the project description above.)';

  // ── Build outline ────────────────────────────────────────────
  const numberedOutline = style.outline
    .map((item, i) => `${i + 1}. ${item}`)
    .join('\n');

  // ── Build system prompt ──────────────────────────────────────
  const systemPrompt = style.system_prompt
    .replace('{{STYLE_NAME}}', style.name)
    .replace('{{OUTLINE}}', numberedOutline)
    .replace('{{TONE}}', style.tone_guidance)
    .replace('{{PROJECT_DESCRIPTION}}', project_description || '(not provided)')
    .replace('{{CONTEXT}}', contextBlock);

  // ── Call LLM ─────────────────────────────────────────────────
  const effectiveModel = model ?? DEFAULT_DRAFTING_MODEL;
  const userMessage = `Write the complete ${style.name} now. Follow the outline exactly and produce publication-ready content.`;

  const queryInput: QueryInput = {
    message: userMessage,
    model: effectiveModel,
    system_prompt: systemPrompt,
    temperature: 0.3,
    usage: true,
    ...(dataset ? { dataset, limit_references: limit_references ?? 6 } : { dataset: 'none' }),
    ...(live ? { live } : {}),
  };

  const response = await client.query(queryInput);

  // ── Parse response into DraftParagraphs ──────────────────────
  const rawText = typeof response.response === 'string'
    ? response.response
    : String(response.response);

  const paragraphs = parseMarkdownToParagraphs(rawText);

  const tokens_in = response.usage?.prompt_tokens ?? 0;
  const tokens_out = response.usage?.completion_tokens ?? 0;

  return {
    paragraphs,
    model: effectiveModel,
    tokens_in,
    tokens_out,
    prompt_sent: systemPrompt,
  };
}

/**
 * Parse a markdown-formatted LLM response into DraftParagraph[].
 * Handles headings (#, ##, ###), bullets (- ), numbered lists (1. ),
 * and body paragraphs.
 */
export function parseMarkdownToParagraphs(markdown: string): DraftParagraph[] {
  const lines = markdown.split('\n');
  const paragraphs: DraftParagraph[] = [];

  // Accumulate table rows
  let inTable = false;
  let tableRows: string[][] = [];

  function flushTable() {
    if (tableRows.length === 0) return;
    for (let i = 0; i < tableRows.length; i++) {
      paragraphs.push({
        role: 'table_row',
        text: tableRows[i].join(' | '),
        cells: tableRows[i],
        is_header: i === 0,
      });
    }
    tableRows = [];
    inTable = false;
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    // Skip empty lines (they're paragraph separators)
    if (line.trim() === '') {
      if (inTable) flushTable();
      continue;
    }

    // Table separator row (---|---|---)
    if (/^\s*\|?\s*[-:]+(\s*\|\s*[-:]+)+\s*\|?\s*$/.test(line)) {
      // Skip the separator, it's just formatting
      continue;
    }

    // Table row
    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      const cells = line
        .split('|')
        .map((c) => c.trim())
        .filter((c) => c.length > 0);
      if (cells.length > 0) {
        inTable = true;
        tableRows.push(cells);
      }
      continue;
    }

    if (inTable) flushTable();

    // Headings
    const headingMatch = line.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length - 1; // # = 0, ## = 1, ### = 2
      paragraphs.push({
        role: 'heading',
        text: stripInlineFormatting(headingMatch[2]),
        level,
      });
      continue;
    }

    // Bullet lists (- or * )
    const bulletMatch = line.match(/^(\s*)[*-]\s+(.+)$/);
    if (bulletMatch) {
      const indent = bulletMatch[1].length;
      const level = Math.floor(indent / 2); // 2 spaces per level
      paragraphs.push({
        role: 'bullet',
        text: stripInlineFormatting(bulletMatch[2]),
        level,
      });
      continue;
    }

    // Numbered lists
    const numberedMatch = line.match(/^(\s*)\d+[.)]\s+(.+)$/);
    if (numberedMatch) {
      const indent = numberedMatch[1].length;
      const level = Math.floor(indent / 2);
      paragraphs.push({
        role: 'step',
        text: stripInlineFormatting(numberedMatch[2]),
        level,
      });
      continue;
    }

    // Blockquotes
    if (line.startsWith('> ')) {
      paragraphs.push({
        role: 'quote',
        text: stripInlineFormatting(line.slice(2)),
      });
      continue;
    }

    // Regular body paragraph
    paragraphs.push({
      role: 'body',
      text: stripInlineFormatting(line.trim()),
    });
  }

  if (inTable) flushTable();

  return paragraphs;
}

/** Strip markdown inline formatting (**bold**, *italic*, etc.) for the text field */
function stripInlineFormatting(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/_(.+?)_/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/~~(.+?)~~/g, '$1');
}

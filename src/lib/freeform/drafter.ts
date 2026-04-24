/**
 * Freeform document drafter. Takes a project's description, attached
 * context (notes + file excerpts), and a style profile, then produces
 * a complete document as DraftParagraph[].
 *
 * Unlike the template-based drafter which calls the LLM once per
 * section, this produces the entire document in a single call (or
 * iteratively with the critic loop if enabled).
 *
 * The drafter instructs the LLM to cite sources inline and include a
 * References section. It also captures the raw `references` field
 * from Ask Sage (RAG + web search grounding) and extracts all URLs
 * from both the LLM output and the Ask Sage references.
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

/** A single extracted source reference */
export interface SourceReference {
  /** The full URL if this is a web source */
  url?: string;
  /** Human-readable title or description */
  title: string;
  /** Where this reference was found: 'llm_output', 'ask_sage_rag', or 'attached_file' */
  source_type: 'llm_output' | 'ask_sage_rag' | 'attached_file';
}

export interface FreeformDraftResult {
  paragraphs: DraftParagraph[];
  model: string;
  tokens_in: number;
  tokens_out: number;
  prompt_sent: string;
  /** Raw references string returned by Ask Sage (RAG + web search) */
  raw_references: string;
  /** All extracted source references (URLs + file citations) */
  sources: SourceReference[];
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
  const attachedFilenames: string[] = [];

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
        attachedFilenames.push(f.filename);
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
  const userMessage = `Write the complete ${style.name} now. Follow the outline exactly, cite all sources inline, and include a References section at the end with full URLs for any web sources used.`;

  async function runQuery(extraInstruction: string | null): Promise<{ rawText: string; rawReferences: string; tokens_in: number; tokens_out: number }> {
    const augmentedMessage = extraInstruction
      ? `${userMessage}\n\nADDITIONAL CONSTRAINT (previous attempt violated this — retry): ${extraInstruction}`
      : userMessage;
    const queryInput: QueryInput = {
      message: augmentedMessage,
      model: effectiveModel,
      system_prompt: systemPrompt,
      temperature: 0.3,
      usage: true,
      ...(dataset ? { dataset, limit_references: limit_references ?? 6 } : { dataset: 'none' }),
      ...(live ? { live } : {}),
    };
    const r = await client.query(queryInput);
    // The LLM completion lives in `message` on both providers.
    // Ask Sage's `/server/query` uses `response` for a status marker
    // ("OK"/"Failed") and `message` for the text; the OpenRouter client
    // mirrors that (hardcoded `response: 'OK'`, content in `message`).
    // Reading `response` here produces a DOCX containing only "OK".
    const rawText = typeof r.message === 'string' && r.message.length > 0
      ? r.message
      : typeof r.response === 'string' ? r.response : String(r.response);
    return {
      rawText,
      rawReferences: r.references ?? '',
      tokens_in: r.usage?.prompt_tokens ?? 0,
      tokens_out: r.usage?.completion_tokens ?? 0,
    };
  }

  let run = await runQuery(null);
  let totalTokensIn = run.tokens_in;
  let totalTokensOut = run.tokens_out;

  const fillerRejection = detectFillerRejection(run.rawText, style.id);
  if (fillerRejection) {
    const retry = await runQuery(fillerRejection);
    totalTokensIn += retry.tokens_in;
    totalTokensOut += retry.tokens_out;
    // Prefer the retry if it's also not worse; otherwise fall back to
    // the original (avoids returning an even worse second pass).
    const retryRejection = detectFillerRejection(retry.rawText, style.id);
    if (!retryRejection) {
      run = retry;
    } else {
      // Keep the better of the two by offender count.
      const firstCount = countFillerOffenses(run.rawText, style.id);
      const retryCount = countFillerOffenses(retry.rawText, style.id);
      if (retryCount < firstCount) run = retry;
    }
  }

  const rawText = run.rawText;
  const rawReferences = run.rawReferences;
  const paragraphs = parseMarkdownToParagraphs(rawText);

  // ── Extract sources ──────────────────────────────────────────
  const sources = extractSources(rawText, rawReferences, attachedFilenames);

  // If Ask Sage returned references that contain URLs not already
  // in the document, append them as an additional sources section
  const ragSources = extractUrlsFromText(rawReferences)
    .filter((url) => !rawText.includes(url));
  if (ragSources.length > 0) {
    // Check if document already ends with a References heading
    const hasRefsSection = paragraphs.some(
      (p) => p.role === 'heading' && /references|sources|bibliography/i.test(p.text),
    );
    if (!hasRefsSection) {
      paragraphs.push({ role: 'heading', text: 'References', level: 1 });
    }
    paragraphs.push({
      role: 'body',
      text: 'Additional sources from reference material search:',
    });
    for (const url of ragSources) {
      paragraphs.push({ role: 'bullet', text: url });
    }
  }

  return {
    paragraphs,
    model: effectiveModel,
    tokens_in: totalTokensIn,
    tokens_out: totalTokensOut,
    prompt_sent: systemPrompt,
    raw_references: rawReferences,
    sources,
  };
}

/**
 * Extract all source references from the LLM output, Ask Sage RAG
 * references, and attached file list. Deduplicates by URL.
 */
function extractSources(
  llmOutput: string,
  ragReferences: string,
  attachedFilenames: string[],
): SourceReference[] {
  const seen = new Set<string>();
  const sources: SourceReference[] = [];

  function addUrl(url: string, title: string, type: SourceReference['source_type']) {
    const key = url.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    sources.push({ url, title, source_type: type });
  }

  function addNonUrl(title: string, type: SourceReference['source_type']) {
    const key = title.toLowerCase().trim();
    if (seen.has(key)) return;
    seen.add(key);
    sources.push({ title, source_type: type });
  }

  // Extract URLs from LLM output
  for (const url of extractUrlsFromText(llmOutput)) {
    addUrl(url, url, 'llm_output');
  }

  // Extract URLs from Ask Sage RAG references
  for (const url of extractUrlsFromText(ragReferences)) {
    addUrl(url, url, 'ask_sage_rag');
  }

  // Extract inline [Source: ...] citations from LLM output
  const citationPattern = /\[Source:\s*([^\]]+)\]/gi;
  let match;
  while ((match = citationPattern.exec(llmOutput)) !== null) {
    const citation = match[1].trim();
    // If it's a URL, skip (already captured above)
    if (/^https?:\/\//i.test(citation)) continue;
    addNonUrl(citation, 'llm_output');
  }

  // Add attached files as sources
  for (const filename of attachedFilenames) {
    addNonUrl(filename, 'attached_file');
  }

  return sources;
}

/** Extract all http/https URLs from a text string */
function extractUrlsFromText(text: string): string[] {
  if (!text) return [];
  // Match URLs — liberal pattern that captures most real-world URLs
  const urlPattern = /https?:\/\/[^\s<>"')\]},;]+/gi;
  const matches = text.match(urlPattern) ?? [];
  // Clean trailing punctuation that's likely not part of the URL
  return [...new Set(matches.map((u) => u.replace(/[.),:;]+$/, '')))];
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
      const level = headingMatch[1].length - 1;
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
      const level = Math.floor(indent / 2);
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

/**
 * Bullet-heavy styles (point paper, award bullets) are ruined by
 * throat-clearing openers and filler verbs. We scan the model's output
 * for those patterns and, if we find enough of them, trigger a single
 * retry with an explicit constraint pointing at the offense.
 *
 * Returns the retry-instruction string if the output should be
 * regenerated, or null to accept it.
 */
export function detectFillerRejection(rawText: string, styleId: string): string | null {
  if (styleId !== 'point_paper' && styleId !== 'award_bullets') return null;

  const offenders = findFillerOffenses(rawText, styleId);
  // Threshold: retry if at least 2 bullets or one of the first two
  // bullets opens with filler. Keeps cost predictable (worst case: one
  // retry) while catching the most visible quality issues.
  const firstTwoOffended = offenders.some((o) => o.bulletIndex < 2);
  if (offenders.length === 0) return null;
  if (!firstTwoOffended && offenders.length < 2) return null;

  const examples = offenders.slice(0, 3).map((o) => `"${o.opener}…"`).join(', ');
  if (styleId === 'point_paper') {
    return `Rewrite every bullet to start with a concrete noun, fact, number, date, or action verb. The previous attempt opened bullets with throat-clearing phrases (${examples}). Those phrases are BANNED. Do not use "This paper", "The purpose of", "In order to", "It is important to note", or any variation. Every bullet must be a quotable line the principal can read aloud.`;
  }
  return `Rewrite every bullet to start with a strong past-tense action verb (Led, Drove, Delivered, Architected, Authored, Spearheaded, Championed, Executed, Mentored, Saved). The previous attempt opened bullets with filler verbs (${examples}). "Was", "Served as", "Responsible for", "Helped", "Assisted", "Performed", "Supported", "Worked on", and "Participated in" are BANNED. Every bullet must include at least one hard metric (dollar amount, count, percentage, or time) and tie to a mission-level outcome.`;
}

export interface FillerOffense {
  bulletIndex: number;
  opener: string;
}

export function findFillerOffenses(rawText: string, styleId: string): FillerOffense[] {
  const bullets = extractBulletOpeners(rawText);
  const banned = styleId === 'point_paper' ? POINT_PAPER_BANNED_OPENERS : AWARD_BANNED_OPENERS;
  const offenses: FillerOffense[] = [];
  bullets.forEach(({ opener }, i) => {
    const lower = opener.toLowerCase();
    for (const pattern of banned) {
      if (lower.startsWith(pattern)) {
        offenses.push({ bulletIndex: i, opener: opener.slice(0, 60) });
        break;
      }
    }
  });
  return offenses;
}

function countFillerOffenses(rawText: string, styleId: string): number {
  return findFillerOffenses(rawText, styleId).length;
}

export function extractBulletOpeners(rawText: string): { opener: string }[] {
  const bullets: { opener: string }[] = [];
  for (const rawLine of rawText.split('\n')) {
    const m = rawLine.match(/^\s*[-*]\s+(.+)$/);
    if (m) {
      // Strip leading markdown emphasis for matching.
      const opener = m[1]!
        .replace(/^\*\*(.+?)\*\*/, '$1')
        .replace(/^__(.+?)__/, '$1')
        .trim();
      bullets.push({ opener });
    }
  }
  return bullets;
}

const POINT_PAPER_BANNED_OPENERS = [
  'this paper',
  'this document',
  'this point paper',
  'this briefing',
  'the purpose of',
  'in order to',
  'it is important to note',
  'it should be noted',
  'it is worth noting',
  'please note',
  'as noted above',
  'as stated',
];

const AWARD_BANNED_OPENERS = [
  'was ',
  'served as',
  'responsible for',
  'helped ',
  'assisted ',
  'performed ',
  'supported ',
  'worked on',
  'worked with',
  'participated in',
  'was responsible for',
  'i ',
  'my ',
];

/**
 * Inverse of parseMarkdownToParagraphs: render DraftParagraph[] back to
 * a markdown string suitable for round-trip editing. Only emits the
 * roles the drafter's parser can round-trip — unknown roles degrade to
 * plain body paragraphs. Inline formatting is not preserved (the parser
 * strips it), so this is a lossy round-trip for emphasis.
 */
export function paragraphsToMarkdown(paragraphs: DraftParagraph[]): string {
  const lines: string[] = [];
  for (const p of paragraphs) {
    const text = p.text ?? '';
    switch (p.role) {
      case 'heading': {
        const level = Math.max(1, Math.min(4, (p.level ?? 0) + 1));
        lines.push(`${'#'.repeat(level)} ${text}`, '');
        break;
      }
      case 'bullet': {
        const indent = '  '.repeat(Math.max(0, p.level ?? 0));
        lines.push(`${indent}- ${text}`);
        break;
      }
      case 'step': {
        const indent = '  '.repeat(Math.max(0, p.level ?? 0));
        lines.push(`${indent}1. ${text}`);
        break;
      }
      case 'quote':
        lines.push(`> ${text}`, '');
        break;
      case 'table_row': {
        const cells = p.cells ?? [text];
        lines.push(`| ${cells.join(' | ')} |`);
        if (p.is_header) {
          lines.push(`| ${cells.map(() => '---').join(' | ')} |`);
        }
        break;
      }
      default:
        lines.push(text, '');
    }
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export interface FreeformSectionRedraftArgs {
  client: LLMClient;
  style: FreeformStyle;
  project_description: string;
  context_items: ProjectContextItem[];
  file_extracts?: Map<string, string>;
  model?: string;
  dataset?: string;
  live?: 0 | 1 | 2;
  limit_references?: number;
  /** The whole current draft, used to give the model full context. */
  current_draft: DraftParagraph[];
  /** Heading text of the section to rewrite (matched case-insensitively). */
  section_heading: string;
  /** Optional extra instruction from the user (e.g. "tighten", "add more detail on X"). */
  instruction?: string;
}

export interface FreeformSectionRedraftResult {
  paragraphs: DraftParagraph[];
  model: string;
  tokens_in: number;
  tokens_out: number;
}

/**
 * Rewrite a single H1 section of an existing freeform draft. The model
 * sees the full current draft for context but is instructed to reply
 * with ONLY the markdown for the target section. Used for per-chunk
 * regen in V2DraftPane.
 */
export async function redraftFreeformSection(
  args: FreeformSectionRedraftArgs,
): Promise<FreeformSectionRedraftResult> {
  const {
    client, style, project_description, context_items, file_extracts,
    model, dataset, live, limit_references,
    current_draft, section_heading, instruction,
  } = args;

  const contextParts: string[] = [];
  const notes = context_items.filter((c) => c.kind === 'note');
  if (notes.length > 0) {
    contextParts.push('=== PROJECT NOTES ===');
    for (const note of notes) contextParts.push(`[${note.role}]: ${note.text}`);
  }
  const files = context_items.filter((c) => c.kind === 'file');
  if (files.length > 0 && file_extracts) {
    const fileTexts: string[] = [];
    for (const f of files) {
      const text = file_extracts.get(f.id);
      if (text) fileTexts.push(`--- ${f.filename} ---\n${text}`);
    }
    if (fileTexts.length > 0) {
      contextParts.push('\n=== ATTACHED REFERENCE FILES ===');
      contextParts.push(fileTexts.join('\n\n'));
    }
  }
  const contextBlock = contextParts.length > 0
    ? contextParts.join('\n')
    : '(No additional context provided.)';

  const numberedOutline = style.outline.map((item, i) => `${i + 1}. ${item}`).join('\n');
  const systemPrompt = style.system_prompt
    .replace('{{STYLE_NAME}}', style.name)
    .replace('{{OUTLINE}}', numberedOutline)
    .replace('{{TONE}}', style.tone_guidance)
    .replace('{{PROJECT_DESCRIPTION}}', project_description || '(not provided)')
    .replace('{{CONTEXT}}', contextBlock);

  const currentMarkdown = paragraphsToMarkdown(current_draft);
  const userMessage =
    `You previously drafted this document:\n\n\`\`\`markdown\n${currentMarkdown}\n\`\`\`\n\n` +
    `Rewrite ONLY the section whose top-level (H1) heading matches "${section_heading}". ` +
    `Keep every other section untouched — do not repeat them in your reply. ` +
    `Reply with ONLY the markdown for the rewritten section, starting with its \`# ${section_heading}\` heading.` +
    (instruction ? `\n\nAdditional instruction: ${instruction}` : '');

  const effectiveModel = model ?? DEFAULT_DRAFTING_MODEL;
  const queryInput: QueryInput = {
    message: userMessage,
    model: effectiveModel,
    system_prompt: systemPrompt,
    temperature: 0.3,
    usage: true,
    ...(dataset ? { dataset, limit_references: limit_references ?? 6 } : { dataset: 'none' }),
    ...(live ? { live } : {}),
  };
  const r = await client.query(queryInput);
  const rawText = typeof r.message === 'string' && r.message.length > 0
    ? r.message
    : typeof r.response === 'string' ? r.response : String(r.response);
  return {
    paragraphs: parseMarkdownToParagraphs(rawText),
    model: effectiveModel,
    tokens_in: r.usage?.prompt_tokens ?? 0,
    tokens_out: r.usage?.completion_tokens ?? 0,
  };
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

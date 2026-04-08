// Asks the LLM to review a finished document and propose surgical
// edits.
//
// Two important properties of this module:
//
//   1. Long documents are walked in SMALL OVERLAPPING WINDOWS so the
//      model can't get lazy and only edit the first chunk it sees.
//      Each window is its own /server/query call; ops are merged
//      into a single result. Empty per-chunk responses are silently
//      absorbed — they are NOT surfaced as toasts or rationale lines.
//
//   2. The cleanup pass can be GROUNDED with reference context: an
//      Ask Sage RAG dataset, web search (live=1|2), and/or attached
//      reference files that get extracted via /server/file and inlined
//      into every chunk's prompt. This mirrors the drafting pipeline.
//
// The model still emits the typed DocumentEditOp catalog. The writer
// validates indices and applies them surgically against the original
// DOCX, preserving every other formatting node.

import type { LLMClient } from '../provider/types';
import type { ParagraphInfo } from '../template/parser';
import type { ProjectContextFile } from '../db/schema';
import { AskSageClient } from '../asksage/client';
import { blobToFile, extractedTextFromRet } from '../asksage/extract';
import type { DocumentEditOp, DocumentEditOutput } from './types';

export const DEFAULT_DOCUMENT_EDIT_MODEL = 'google-claude-46-sonnet';

/**
 * Significant-paragraph window size for the chunked edit pass. Smaller
 * windows force the model to spend attention on every section of the
 * document — large windows let it summarize the body and miss edits
 * past the first ~third. Tune cautiously: too small and you waste
 * tokens on the system prompt + reference block per chunk.
 */
export const EDIT_CHUNK_SIZE = 40;

/**
 * Number of significant paragraphs that overlap between consecutive
 * windows. Gives the model continuity context (so a sentence that
 * spans a chunk boundary still has its lead-in visible) without
 * double-charging too many tokens. Ops on overlapped paragraphs are
 * de-duped at merge time.
 */
export const EDIT_CHUNK_OVERLAP = 5;

/** Per-reference-file character cap (≈2k tokens). */
const REFERENCE_FILE_CAP_CHARS = 8000;

const SYSTEM_PROMPT = `You are a careful editor reviewing a finished government document. Your job is to propose SURGICAL improvements ONLY — fix grammar, tighten wording, correct factual or formal errors, remove redundancy, and clean up obvious typos. You preserve the author's voice and intent and you NEVER rewrite paragraphs that are already clean.

You will be shown a CHUNK of the document at a time. Each paragraph is labeled with its absolute index in the full document (the same indices the writer uses to apply your edits). Even though you only see a window, you MUST still emit edits for any paragraph in this window that needs one — do not defer to "the next chunk" and do not rewrite the chunk wholesale.

You have a TYPED OP CATALOG you can emit. Pick the NARROWEST op for each change so the writer can preserve the maximum amount of surrounding formatting. If only one run inside a paragraph needs changing, use replace_run_text — do NOT replace the whole paragraph.

You output STRICT JSON only — no markdown code fences, no commentary outside the JSON:

{
  "edits": [ <op> , ... ]
}

OP CATALOG (use the narrowest op that does the job):

1. replace_paragraph_text — replace the entire visible text of one paragraph
   { "op": "replace_paragraph_text", "index": <int>, "new_text": "...", "rationale": "..." }

2. replace_run_text — replace the text of ONE run inside a paragraph (preserves bold/italic spans on other runs in the same paragraph). Prefer this over replace_paragraph_text when only part of a paragraph needs changing.
   { "op": "replace_run_text", "paragraph_index": <int>, "run_index": <int>, "new_text": "...", "rationale": "..." }

3. set_run_property — toggle bold / italic / underline / strike on a specific run
   { "op": "set_run_property", "paragraph_index": <int>, "run_index": <int>, "property": "bold" | "italic" | "underline" | "strike", "value": true | false, "rationale": "..." }

4. set_cell_text — replace the visible text of one table cell
   { "op": "set_cell_text", "table_index": <int>, "row_index": <int>, "cell_index": <int>, "new_text": "...", "rationale": "..." }

5. insert_table_row — clone a row and insert a new one after it (preserves the row's formatting / column widths / borders)
   { "op": "insert_table_row", "table_index": <int>, "after_row_index": <int>, "cells": ["cell 1 text", "cell 2 text", ...], "rationale": "..." }

6. delete_table_row — remove a row from a table
   { "op": "delete_table_row", "table_index": <int>, "row_index": <int>, "rationale": "..." }

7. set_content_control_value — update a Word content control by tag (CUI banner, document number, classification, dates, etc. that are stored as <w:sdt> elements)
   { "op": "set_content_control_value", "tag": "<sdt tag>", "value": "...", "rationale": "..." }

8. set_paragraph_style — change a paragraph's style id (e.g., promote a paragraph to a heading)
   { "op": "set_paragraph_style", "index": <int>, "style_id": "<style id>", "rationale": "..." }

9. set_paragraph_alignment — change a paragraph's alignment
   { "op": "set_paragraph_alignment", "index": <int>, "alignment": "left" | "center" | "right" | "justify" | "both", "rationale": "..." }

10. delete_paragraph — remove a paragraph entirely (use sparingly; prefer replacing with corrected text)
    { "op": "delete_paragraph", "index": <int>, "rationale": "..." }

CRITICAL CONSTRAINTS:
- A clean chunk yields { "edits": [] }. Do not invent edits to look productive.
- All paragraph indices MUST refer to the exact integer labels shown in the DOCUMENT CHUNK below. Out-of-range indices are silently dropped.
- ONLY emit edits for paragraphs labeled "[edit]". Paragraphs labeled "[ctx]" are context lines from the previous/next window — read them but do NOT propose edits against them; they will be handled in their own window.
- Prefer replace_run_text over replace_paragraph_text when only part of a paragraph changes — this preserves bold/italic spans elsewhere in the paragraph.
- Do NOT use markdown formatting (**, _, -). Inline formatting is encoded in run properties; use set_run_property to add/remove it.
- Preserve specialized terminology, acronyms, citations, dates, names, and section numbers exactly as written unless they are demonstrably wrong.
- If ATTACHED REFERENCES are provided, they are AUTHORITATIVE for facts, terminology, and citations — prefer the reference's wording over the draft's when they disagree on a verifiable fact.
- Honor the user's instruction — it controls scope and tone of edits.

Return STRICT JSON only.`;

export interface DocumentEditRequest {
  document_name: string;
  paragraphs: ParagraphInfo[];
  /** Free-form user instruction. e.g. "tighten language" or "fix typos only" */
  instruction: string;
  model?: string;
  // ─── grounding context (all optional) ───
  /** Ask Sage RAG dataset name; passed straight to /server/query */
  dataset?: string;
  /** RAG references cap; default 5 when dataset is set, 0 otherwise */
  limit_references?: number;
  /** Web search toggle: 0 off, 1 Google results, 2 Google + crawl */
  live?: 0 | 1 | 2;
  /**
   * Reference files to inline into the prompt as ATTACHED REFERENCES.
   * Each file is uploaded once via /server/file (Ask-Sage-only) and
   * the extracted text is reused for every chunk.
   */
  references?: ProjectContextFile[];
  /** Progress callback fired after each chunk completes. */
  on_chunk_done?: (info: ChunkProgress) => void;
}

export interface ChunkProgress {
  chunk_index: number;
  chunk_count: number;
  ops_emitted: number;
  tokens_in: number;
  tokens_out: number;
}

/** Narrowed paragraph_text op for the legacy UI accept flow. */
export type ReplaceParagraphTextOp = Extract<
  DocumentEditOp,
  { op: 'replace_paragraph_text' }
>;

export interface DocumentEditResponse {
  llm_output: DocumentEditOutput;
  /**
   * Paragraph-text edits whose index exists in the input. The legacy
   * UI accept flow consumes these. Other op types are kept in
   * `all_valid_ops` for callers using the new union-based pipeline.
   */
  valid_edits: ReplaceParagraphTextOp[];
  /** Every op the LLM returned that passed validation, in any shape */
  all_valid_ops: DocumentEditOp[];
  tokens_in: number;
  tokens_out: number;
  model: string;
  /** Concatenated chunk prompts, for the diagnostic "what did the model see" view */
  prompt_sent: string;
  chunk_count: number;
}

export async function requestDocumentEdits(
  client: LLMClient,
  args: DocumentEditRequest,
): Promise<DocumentEditResponse> {
  const model = args.model ?? DEFAULT_DOCUMENT_EDIT_MODEL;

  // 1. Pre-flight: extract attached reference files (Ask-Sage-only).
  //    Re-uploaded once here and reused for every chunk in the run.
  //    Failures are non-fatal — the chunk just won't see that file.
  const referencesBlock = await buildReferencesBlock(client, args.references ?? []);

  // 2. Build chunks. Significant paragraphs only — blank ones are
  //    layout artifacts; we still keep their absolute indices intact
  //    so the writer applies edits to the right place.
  const significant = args.paragraphs.filter((p) => p.text.trim().length > 0);
  const chunks = chunkParagraphs(significant, EDIT_CHUNK_SIZE, EDIT_CHUNK_OVERLAP);

  // 3. Walk chunks sequentially. Per-chunk responses that come back
  //    empty are silently absorbed (no toast, no rationale).
  const allOps: DocumentEditOp[] = [];
  const seenOpKeys = new Set<string>();
  const promptParts: string[] = [];
  let tokensIn = 0;
  let tokensOut = 0;

  const validIndices = new Set(args.paragraphs.map((p) => p.index));

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const message = buildEditMessage({
      document_name: args.document_name,
      instruction: args.instruction,
      chunk,
      chunk_index: i,
      chunk_count: chunks.length,
      total_significant: significant.length,
      total_paragraphs: args.paragraphs.length,
      references_block: referencesBlock,
    });
    promptParts.push(`--- CHUNK ${i + 1} / ${chunks.length} ---\n${message}`);

    const queryInput: Parameters<LLMClient['queryJson']>[0] = {
      message,
      system_prompt: SYSTEM_PROMPT,
      model,
      dataset: args.dataset && args.dataset.length > 0 ? args.dataset : 'none',
      temperature: 0,
      usage: true,
    };
    if (typeof args.limit_references === 'number') {
      queryInput.limit_references = args.limit_references;
    } else if (args.dataset && args.dataset !== 'none') {
      queryInput.limit_references = 5;
    }
    if (typeof args.live === 'number') {
      queryInput.live = args.live;
    }

    let chunkOpsCount = 0;
    let chunkIn = 0;
    let chunkOut = 0;
    try {
      const { data, raw } = await client.queryJson<DocumentEditOutput>(queryInput);
      const ops = (data.edits ?? []).filter((op) =>
        isValidOp(op, validIndices, chunk.editableIndices),
      );
      for (const op of ops) {
        const key = opDedupKey(op);
        if (seenOpKeys.has(key)) continue;
        seenOpKeys.add(key);
        allOps.push(op);
        chunkOpsCount += 1;
      }
      const usage =
        (raw.usage as { prompt_tokens?: number; completion_tokens?: number }) ?? {};
      chunkIn = usage.prompt_tokens ?? 0;
      chunkOut = usage.completion_tokens ?? 0;
      tokensIn += chunkIn;
      tokensOut += chunkOut;
    } catch (err) {
      // Silent absorption per spec: a single chunk failing should not
      // abort the whole pass. Log to console for diagnostics.
      // eslint-disable-next-line no-console
      console.warn(
        `[requestDocumentEdits] chunk ${i + 1}/${chunks.length} failed:`,
        err,
      );
    }

    args.on_chunk_done?.({
      chunk_index: i,
      chunk_count: chunks.length,
      ops_emitted: chunkOpsCount,
      tokens_in: chunkIn,
      tokens_out: chunkOut,
    });
  }

  const valid_edits: ReplaceParagraphTextOp[] = allOps.filter(
    (op): op is ReplaceParagraphTextOp => op.op === 'replace_paragraph_text',
  );

  return {
    llm_output: { edits: allOps },
    valid_edits,
    all_valid_ops: allOps,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    model,
    prompt_sent: promptParts.join('\n\n'),
    chunk_count: chunks.length,
  };
}

// ─── Chunking ─────────────────────────────────────────────────────

interface EditChunk {
  /**
   * The actual paragraph window the model sees (in document order),
   * including overlap context from neighboring chunks.
   */
  paragraphs: ParagraphInfo[];
  /**
   * The subset of paragraph indices in this window that the model is
   * allowed to emit edits against. Overlap rows are read-only context.
   */
  editableIndices: Set<number>;
}

function chunkParagraphs(
  significant: ParagraphInfo[],
  size: number,
  overlap: number,
): EditChunk[] {
  if (significant.length === 0) return [];
  if (significant.length <= size) {
    return [
      {
        paragraphs: significant,
        editableIndices: new Set(significant.map((p) => p.index)),
      },
    ];
  }

  const chunks: EditChunk[] = [];
  const stride = Math.max(1, size - overlap);
  for (let editStart = 0; editStart < significant.length; editStart += stride) {
    const editEnd = Math.min(significant.length, editStart + size);
    // Window includes `overlap` paragraphs of context on each side
    // (when available), but only [editStart, editEnd) is editable.
    const winStart = Math.max(0, editStart - overlap);
    const winEnd = Math.min(significant.length, editEnd + overlap);
    const windowParas = significant.slice(winStart, winEnd);
    const editable = new Set(
      significant.slice(editStart, editEnd).map((p) => p.index),
    );
    chunks.push({ paragraphs: windowParas, editableIndices: editable });
    if (editEnd >= significant.length) break;
  }
  return chunks;
}

// ─── Op validation + dedup ────────────────────────────────────────

function isValidOp(
  op: unknown,
  validIndices: Set<number>,
  editableIndices: Set<number>,
): op is DocumentEditOp {
  if (!op || typeof op !== 'object' || !('op' in op)) return false;
  const o = op as DocumentEditOp;
  switch (o.op) {
    case 'replace_paragraph_text':
    case 'set_paragraph_style':
    case 'set_paragraph_alignment':
    case 'delete_paragraph':
      return (
        typeof o.index === 'number' &&
        validIndices.has(o.index) &&
        editableIndices.has(o.index)
      );
    case 'replace_run_text':
    case 'set_run_property':
      return (
        typeof o.paragraph_index === 'number' &&
        validIndices.has(o.paragraph_index) &&
        editableIndices.has(o.paragraph_index) &&
        typeof o.run_index === 'number' &&
        o.run_index >= 0
      );
    case 'set_cell_text':
    case 'insert_table_row':
    case 'delete_table_row':
    case 'set_content_control_value':
      // Table / sdt ops are not gated by paragraph windows; the writer
      // validates them at apply time.
      return true;
    default:
      return false;
  }
}

/**
 * Stable string key used to de-dup ops emitted in overlapped windows.
 * The same paragraph can appear in two adjacent chunks; if both chunks
 * propose the same edit we keep only the first.
 */
function opDedupKey(op: DocumentEditOp): string {
  switch (op.op) {
    case 'replace_paragraph_text':
      return `rp:${op.index}:${op.new_text}`;
    case 'replace_run_text':
      return `rr:${op.paragraph_index}:${op.run_index}:${op.new_text}`;
    case 'set_run_property':
      return `srp:${op.paragraph_index}:${op.run_index}:${op.property}:${op.value}`;
    case 'set_cell_text':
      return `sct:${op.table_index}:${op.row_index}:${op.cell_index}:${op.new_text}`;
    case 'insert_table_row':
      return `itr:${op.table_index}:${op.after_row_index}:${op.cells.join('|')}`;
    case 'delete_table_row':
      return `dtr:${op.table_index}:${op.row_index}`;
    case 'set_content_control_value':
      return `scc:${op.tag}:${op.value}`;
    case 'set_paragraph_style':
      return `sps:${op.index}:${op.style_id}`;
    case 'set_paragraph_alignment':
      return `spa:${op.index}:${op.alignment}`;
    case 'delete_paragraph':
      return `dp:${op.index}`;
  }
}

// ─── Prompt assembly ──────────────────────────────────────────────

interface BuildEditMessageArgs {
  document_name: string;
  instruction: string;
  chunk: EditChunk;
  chunk_index: number;
  chunk_count: number;
  total_significant: number;
  total_paragraphs: number;
  references_block: string;
}

function buildEditMessage(a: BuildEditMessageArgs): string {
  const lines: string[] = [];
  lines.push(`Document: ${a.document_name}`);
  lines.push(
    `Chunk: ${a.chunk_index + 1} of ${a.chunk_count} · ${a.total_significant} significant paragraphs total · ${a.total_paragraphs} including blanks`,
  );
  lines.push(``);
  lines.push(
    `User instruction: ${a.instruction || '(no specific instruction; perform a general cleanup pass for grammar, language, and obvious errors)'}`,
  );
  lines.push(``);
  if (a.references_block) {
    lines.push(a.references_block);
    lines.push(``);
  }
  lines.push(`=== DOCUMENT CHUNK ===`);
  lines.push(
    `Each line is one paragraph. The format is: <gate>[<index>]<flags> <text>. The gate is "[edit]" for paragraphs you may propose edits against, or "[ctx]" for read-only context paragraphs from the neighboring chunk. Indices are absolute over the full document. Flags appear in {curly braces} only when present and describe formatting context (style id, alignment, indent, list level). Use them to understand the role of the paragraph — e.g. don't rewrite a centered title as left-aligned body text.`,
  );
  lines.push(``);
  for (const p of a.chunk.paragraphs) {
    const gate = a.chunk.editableIndices.has(p.index) ? '[edit]' : '[ctx] ';
    lines.push(`${gate}[${p.index}]${formatParagraphFlags(p)} ${p.text}`);
  }
  lines.push(`=== END DOCUMENT CHUNK ===`);
  lines.push(``);
  lines.push(
    `Return STRICT JSON only with the edits array. Empty edits array is fine if this chunk is already clean.`,
  );

  return lines.join('\n');
}

// ─── Reference files: upload + extract + render ───────────────────

async function buildReferencesBlock(
  client: LLMClient,
  files: ProjectContextFile[],
): Promise<string> {
  if (files.length === 0) return '';
  // /server/file is Ask-Sage-only. If the user is on OpenRouter we
  // bail out — the UI hides the reference uploader on that provider,
  // but defend in depth here too.
  if (!(client instanceof AskSageClient)) {
    // eslint-disable-next-line no-console
    console.warn(
      '[requestDocumentEdits] reference files supplied with a non-AskSage client; ignoring.',
    );
    return '';
  }

  const sections: string[] = [];
  for (const f of files) {
    try {
      const fileObj = blobToFile(f.bytes, f.filename, f.mime_type);
      const upload = await client.uploadFile(fileObj);
      const text = extractedTextFromRet(upload.ret).trim();
      if (!text) continue;
      const truncated =
        text.length > REFERENCE_FILE_CAP_CHARS
          ? text.slice(0, REFERENCE_FILE_CAP_CHARS - 1).trimEnd() + '…'
          : text;
      sections.push(
        `--- ${f.filename} (${truncated.length.toLocaleString()} chars${text.length > REFERENCE_FILE_CAP_CHARS ? ` of ${text.length.toLocaleString()}` : ''}) ---\n${truncated}`,
      );
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[requestDocumentEdits] failed to extract reference ${f.filename}:`,
        err,
      );
    }
  }

  if (sections.length === 0) return '';

  return [
    `=== ATTACHED REFERENCES ===`,
    `The following files were attached by the user as authoritative grounding context. Prefer their wording for facts, terminology, and citations when they disagree with the draft.`,
    ``,
    sections.join('\n\n'),
    `=== END ATTACHED REFERENCES ===`,
  ].join('\n');
}

// ─── Paragraph flag formatting ────────────────────────────────────

function formatParagraphFlags(p: ParagraphInfo): string {
  const flags: string[] = [];
  if (p.style_id) flags.push(`style=${p.style_id}`);
  if (p.alignment && p.alignment !== 'left') flags.push(`align=${p.alignment}`);
  if (p.indent_left_twips && p.indent_left_twips > 0) {
    flags.push(`indent=${twipsToInches(p.indent_left_twips)}in`);
  }
  if (p.indent_first_line_twips && p.indent_first_line_twips > 0) {
    flags.push(`first_line=${twipsToInches(p.indent_first_line_twips)}in`);
  }
  if (p.indent_hanging_twips && p.indent_hanging_twips > 0) {
    flags.push(`hanging=${twipsToInches(p.indent_hanging_twips)}in`);
  }
  if (p.numbering_id !== null) {
    flags.push(`list=${p.numbering_id}.${p.numbering_level ?? 0}`);
  }
  if (p.in_table) flags.push(`in_table`);
  if (p.content_control_tag) flags.push(`sdt=${p.content_control_tag}`);
  return flags.length > 0 ? ` {${flags.join(', ')}}` : '';
}

function twipsToInches(twips: number): string {
  return (twips / 1440).toFixed(2);
}

// Asks the LLM to review a finished document and propose surgical
// edits. The system prompt locks the model to a strict JSON output of
// `replace_paragraph_text` operations indexed against the paragraph
// list we send. The dispatcher applies them to a working state, and
// the writer eventually splices them into the original DOCX bytes.

import type { AskSageClient } from '../asksage/client';
import type { ParagraphInfo } from '../template/parser';
import type { DocumentEditOp, DocumentEditOutput } from './types';

export const DEFAULT_DOCUMENT_EDIT_MODEL = 'google-claude-46-sonnet';

const SYSTEM_PROMPT = `You are a careful editor reviewing a finished government document. Your job is to propose SURGICAL improvements — fix grammar, tighten wording, correct factual or formal errors, remove redundancy, and clean up obvious typos. You preserve the author's voice and intent and you NEVER rewrite paragraphs that are already clean.

You output STRICT JSON only — no markdown code fences, no commentary outside the JSON. Schema:

{
  "edits": [
    {
      "op": "replace_paragraph_text",
      "index": <integer paragraph index from the input>,
      "new_text": "<the cleaned-up paragraph text>",
      "rationale": "<one short sentence explaining what you fixed>"
    }
  ],
  "rationale": "<optional one-sentence summary of the overall edit pass>"
}

CRITICAL CONSTRAINTS:
- Only emit edits for paragraphs that actually need improvement. A "clean" pass on a clean document should return an empty edits array.
- Each edit's "index" MUST refer to a paragraph index from the DOCUMENT BODY block below. Indices that don't exist will be silently dropped.
- new_text replaces the entire paragraph's visible text. Include the full new wording, not a diff.
- Do NOT change paragraph structure (don't merge two paragraphs, don't split one paragraph into two — that requires insert/delete operations not currently supported).
- Do NOT use markdown formatting (no **bold**, no _italic_, no - bullets) — text formatting comes from the paragraph's existing style and is preserved automatically.
- Preserve specialized terminology, acronyms, citations, dates, names, and section numbers exactly as written unless they are demonstrably wrong.
- Honor the user's instruction below — it controls scope and tone of edits.

Return STRICT JSON only.`;

export interface DocumentEditRequest {
  document_name: string;
  paragraphs: ParagraphInfo[];
  /** Free-form user instruction. e.g. "tighten language" or "fix typos only" */
  instruction: string;
  model?: string;
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
  prompt_sent: string;
}

export async function requestDocumentEdits(
  client: AskSageClient,
  args: DocumentEditRequest,
): Promise<DocumentEditResponse> {
  const model = args.model ?? DEFAULT_DOCUMENT_EDIT_MODEL;
  const message = buildEditMessage(args);

  const { data, raw } = await client.queryJson<DocumentEditOutput>({
    message,
    system_prompt: SYSTEM_PROMPT,
    model,
    dataset: 'none',
    temperature: 0,
    usage: true,
  });

  // Defensive: filter to indices that actually exist in the input
  const validIndices = new Set(args.paragraphs.map((p) => p.index));
  const allOps = data.edits ?? [];
  const all_valid_ops: DocumentEditOp[] = allOps.filter((op): op is DocumentEditOp => {
    if (!op || typeof op !== 'object' || !('op' in op)) return false;
    switch (op.op) {
      case 'replace_paragraph_text':
      case 'set_paragraph_style':
      case 'set_paragraph_alignment':
      case 'delete_paragraph':
        return typeof op.index === 'number' && validIndices.has(op.index);
      case 'replace_run_text':
      case 'set_run_property':
        return (
          typeof op.paragraph_index === 'number' &&
          validIndices.has(op.paragraph_index) &&
          typeof op.run_index === 'number' &&
          op.run_index >= 0
        );
      case 'set_cell_text':
      case 'insert_table_row':
      case 'delete_table_row':
      case 'set_content_control_value':
        return true; // table/sdt indices validated at writer time
      default:
        return false;
    }
  });

  const valid_edits: ReplaceParagraphTextOp[] = all_valid_ops.filter(
    (op): op is ReplaceParagraphTextOp => op.op === 'replace_paragraph_text',
  );

  const usage = (raw.usage as { prompt_tokens?: number; completion_tokens?: number }) ?? {};

  return {
    llm_output: data,
    valid_edits,
    all_valid_ops,
    tokens_in: usage.prompt_tokens ?? 0,
    tokens_out: usage.completion_tokens ?? 0,
    model,
    prompt_sent: message,
  };
}

function buildEditMessage(args: DocumentEditRequest): string {
  const { document_name, paragraphs, instruction } = args;
  // Filter to non-empty paragraphs (the LLM doesn't need to see blank
  // ones — the parser keeps them but they're not editable text).
  const significant = paragraphs.filter((p) => p.text.trim().length > 0);

  const lines: string[] = [];
  lines.push(`Document: ${document_name}`);
  lines.push(`Total paragraphs in source: ${paragraphs.length}`);
  lines.push(`Significant (non-empty) paragraphs sent below: ${significant.length}`);
  lines.push(``);
  lines.push(`User instruction: ${instruction || '(no specific instruction; perform a general cleanup pass for grammar, language, and obvious errors)'}`);
  lines.push(``);
  lines.push(`=== DOCUMENT BODY ===`);
  lines.push(
    `Each line is one paragraph. The format is: [<index>] <text>. Only edit paragraphs that need improvement; leave the rest alone.`,
  );
  lines.push(``);
  for (const p of significant) {
    lines.push(`[${p.index}] ${p.text}`);
  }
  lines.push(`=== END DOCUMENT BODY ===`);
  lines.push(``);
  lines.push(`Return STRICT JSON only with the edits array. Empty edits array is fine if the document is already clean.`);

  return lines.join('\n');
}

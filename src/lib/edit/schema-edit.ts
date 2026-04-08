// Asks the LLM to refine a TemplateSchema given a free-form user
// instruction, and applies the resulting edit operations to the
// schema. Saves output tokens dramatically vs full re-synthesis when
// the change is localized (one section's intent, one validation rule,
// banned phrases, etc.).

import type { LLMClient } from '../provider/types';
import type { TemplateSchema } from '../template/types';
import { applySchemaEdits } from './dispatcher';
import type { ApplyResult, SchemaEditOutput } from './types';

export const DEFAULT_EDIT_MODEL = 'google-claude-46-sonnet';

const SYSTEM_PROMPT = `You refine document schemas by emitting precise edit operations. The user gives you a current schema and an instruction. You respond with a STRICT JSON object listing the operations to apply. Do NOT regenerate the entire schema — only emit the minimal set of edits that satisfies the instruction.

Output shape:
{
  "edits": [
    { "op": "<op_name>", ... },
    ...
  ],
  "rationale": "<one short sentence explaining what you changed and why>"
}

Available operations:

  set_section_field
    { "op": "set_section_field", "section_id": "<id>", "field": "name" | "intent", "value": "<text>" }

  set_section_target_words
    { "op": "set_section_target_words", "section_id": "<id>", "value": [<min_int>, <max_int>] }

  set_section_depends_on
    { "op": "set_section_depends_on", "section_id": "<id>", "value": ["<other_section_id>", ...] }

  set_section_validation
    { "op": "set_section_validation", "section_id": "<id>", "rule": "must_mention" | "must_not_mention" | "must_not_exceed_words" | "must_be_at_least_words", "value": ["..."] | <int> }

  remove_section
    { "op": "remove_section", "section_id": "<id>" }

  reorder_sections
    { "op": "reorder_sections", "new_order": ["<id_1>", "<id_2>", ...] }

  set_style_field
    { "op": "set_style_field", "field": "voice" | "tense" | "register" | "jargon_policy", "value": "<text>" }

  add_banned_phrase
    { "op": "add_banned_phrase", "phrase": "<text>" }

  remove_banned_phrase
    { "op": "remove_banned_phrase", "phrase": "<text>" }

CRITICAL CONSTRAINTS:
- All section_id values MUST refer to ids that already exist in the input schema (or, for reorder_sections, the union of existing ids).
- Emit ONLY the operations needed to satisfy the user's instruction. Do not pad with cosmetic changes.
- If the instruction asks for something you cannot express with these operations (e.g. "merge two sections into one"), emit no edits and explain in rationale.
- Return STRICT JSON. No markdown code fences, no commentary outside the JSON.`;

export interface SchemaEditRequest {
  schema: TemplateSchema;
  instruction: string;
  model?: string;
}

export interface SchemaEditResponse {
  /** The new schema with the LLM's edits applied */
  applied: ApplyResult<TemplateSchema>;
  /** Raw LLM output for inspection */
  llm_output: SchemaEditOutput;
  /** Tokens consumed */
  tokens_in: number;
  tokens_out: number;
  /** Model used */
  model: string;
  /** The prompt that was sent (for the audit log) */
  prompt_sent: string;
}

export async function requestSchemaEdits(
  client: LLMClient,
  args: SchemaEditRequest,
): Promise<SchemaEditResponse> {
  const model = args.model ?? DEFAULT_EDIT_MODEL;
  const message = buildSchemaEditMessage(args.schema, args.instruction);

  const { data, raw } = await client.queryJson<SchemaEditOutput>({
    message,
    system_prompt: SYSTEM_PROMPT,
    model,
    dataset: 'none',
    temperature: 0,
    usage: true,
  });

  const applied = applySchemaEdits(args.schema, data);
  const usage = (raw.usage as { prompt_tokens?: number; completion_tokens?: number }) ?? {};

  return {
    applied,
    llm_output: data,
    tokens_in: usage.prompt_tokens ?? 0,
    tokens_out: usage.completion_tokens ?? 0,
    model,
    prompt_sent: message,
  };
}

function buildSchemaEditMessage(schema: TemplateSchema, instruction: string): string {
  // Send a compact version of the schema — the LLM doesn't need
  // formatting or paragraph-level metadata for an edit task. Just the
  // section list and style block.
  const compact = {
    name: schema.name,
    style: schema.style,
    sections: schema.sections.map((s) => ({
      id: s.id,
      name: s.name,
      order: s.order,
      intent: s.intent,
      target_words: s.target_words,
      depends_on: s.depends_on,
      validation: s.validation,
    })),
  };
  return [
    `Template: ${schema.name}`,
    ``,
    `Current schema (compact form — just the editable fields):`,
    JSON.stringify(compact, null, 2),
    ``,
    `User instruction:`,
    instruction,
    ``,
    `Emit the minimal edit operations to satisfy this instruction. Return STRICT JSON only.`,
  ].join('\n');
}

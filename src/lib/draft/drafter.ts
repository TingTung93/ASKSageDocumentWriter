// draftSection — drafts a single section of a template by calling Ask
// Sage with the drafting prompt and parsing the structured paragraph
// output. Pure orchestration; the orchestrator (orchestrator.ts) walks
// the section list in dependency order and calls this for each.

import type { LLMClient } from '../provider/types';
import { resolveDraftingModel } from '../provider/resolve_model';
import type { BodyFillRegion, TemplateSchema } from '../template/types';
import { buildDraftingPrompt } from './prompt';
import type {
  DraftingOptions,
  DraftingResult,
  LLMDraftOutput,
  PriorSectionSummary,
} from './types';
import type { DraftingStrategy } from '../agent/section_mapping';

export const DEFAULT_DRAFTING_MODEL = 'google-claude-46-sonnet';
// Drafting must stick to retrieved + inlined content. The earlier 0.2
// default let the model drift toward training-data priors when the
// prompt didn't have strong subject anchoring.
export const DEFAULT_DRAFTING_TEMPERATURE = 0;

export interface DraftSectionArgs {
  template: TemplateSchema;
  section: BodyFillRegion;
  project_description: string;
  shared_inputs: Record<string, string>;
  prior_summaries: PriorSectionSummary[];
  /**
   * Pre-rendered NOTES block (chat notes only). Built once per draft
   * run by the orchestrator. See lib/project/context.renderNotesBlock.
   */
  notes_block?: string | null;
  /**
   * Pre-rendered ATTACHED REFERENCES block (full text of every file
   * the user attached, extracted via /server/file at the start of the
   * draft run and cached in memory). Same string for every section
   * call in the run.
   */
  references_block?: string | null;
  /**
   * The actual paragraphs of THIS section as they appear in the
   * source template, joined into one string. Sliced from the parsed
   * DOCX by the orchestrator. Tells the model how the section
   * "looks" structurally without baking subject matter.
   */
  template_example?: string | null;
  /**
   * Pre-formatted revision notes from the critic loop. Passed
   * through to the prompt builder which inlines them right after
   * SUBJECT. Null on the first attempt; populated on revision
   * iterations from `formatRevisionNotes(critique.issues)`.
   */
  revision_notes_block?: string | null;
  /**
   * Reference→section mapper outputs forwarded to the prompt
   * builder. See lib/draft/prompt.ts for how they're rendered.
   */
  drafting_strategy?: DraftingStrategy | null;
  effective_word_target?: number | null;
  options?: DraftingOptions;
}

export async function draftSection(
  client: LLMClient,
  args: DraftSectionArgs,
): Promise<DraftingResult> {
  const opts = args.options ?? {};
  const model = await resolveDraftingModel(client, opts.model, 'drafting');
  const temperature = opts.temperature ?? DEFAULT_DRAFTING_TEMPERATURE;

  const prompt = buildDraftingPrompt({
    template: args.template,
    section: args.section,
    project_description: args.project_description,
    shared_inputs: args.shared_inputs,
    prior_summaries: args.prior_summaries,
    notes_block: args.notes_block,
    references_block: args.references_block,
    template_example: args.template_example,
    revision_notes_block: args.revision_notes_block,
    drafting_strategy: args.drafting_strategy,
    effective_word_target: args.effective_word_target,
  });

  // Build the query input. Ask Sage uses dataset/limit_references/live;
  // OpenRouter ignores them but throws if model is missing. We branch
  // on capabilities so the request body stays clean for each provider.
  const queryInput: Parameters<typeof client.query>[0] = {
    message: prompt.message,
    system_prompt: prompt.system_prompt,
    model,
    temperature,
    usage: true,
  };
  if (client.capabilities.dataset) {
    queryInput.dataset = opts.dataset ?? 'none';
    queryInput.limit_references = opts.limit_references ?? 6;
  }
  if (client.capabilities.liveSearch) {
    queryInput.live = opts.live ?? 0;
  }

  // Define the complete suite only for providers that advertise native
  // tool calling. GenAI.mil's STARK schema rejects tools/tool_choice.
  if (client.capabilities.tools) queryInput.tools = [
    {
      type: 'function',
      function: {
        name: 'calculate_math',
        description: 'Evaluates a mathematical expression (e.g. "2 + 2 * 5"). Use this for any budget estimates, pricing tables, or overhead calculations.',
        parameters: {
          type: 'object',
          properties: {
            expression: { type: 'string' }
          },
          required: ['expression']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'query_attached_document',
        description: 'Search through the user-attached reference documents for specific clauses, terms, or topics. Useful when you need a fact not present in your prompt.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'The exact phrase or keyword to search for in the attached references.' }
          },
          required: ['query']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'fetch_url',
        description: 'Fetch the text content of a specific public URL (e.g., a .mil or .gov policy page). Note: Some URLs may be blocked by browser CORS policies.',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', format: 'uri' }
          },
          required: ['url']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'search_project_history',
        description: 'Search the summaries of previously drafted sections in this document to maintain consistency.',
        parameters: {
          type: 'object',
          properties: {
            keyword: { type: 'string' }
          },
          required: ['keyword']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'design_complex_table',
        description: 'Design and format a complex table with nested elements, specific alignments, and structured rows.',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            headers: { type: 'array', items: { type: 'string' } },
            rows: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
            nested_lists: { type: 'boolean' }
          },
          required: ['headers', 'rows']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'apply_advanced_formatting',
        description: 'Apply complex formatting such as deep nesting, multi-level lists, and customized indentation to text blocks.',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string' },
            formatting_type: { type: 'string', enum: ['multi_level_list', 'indented_section', 'nested_structure'] }
          },
          required: ['text', 'formatting_type']
        }
      }
    }
  ];

  let raw: import('../asksage/types').QueryResponse | null = null;
  let text = '';
  const conversation: NonNullable<typeof queryInput.message> = 
    typeof queryInput.message === 'string' 
      ? [{ user: 'me', message: queryInput.message }] 
      : [...queryInput.message];

  // ReAct Tool-Calling Loop
  while (true) {
    queryInput.message = conversation;
    raw = await client.query(queryInput);
    text = (raw.message ?? '').trim();

    if (raw.tool_calls && raw.tool_calls.length > 0) {
      // Echo the model's tool call turn to the history
      conversation.push({
        user: 'gpt',
        message: text,
        tool_calls: raw.tool_calls,
      });

      for (const call of raw.tool_calls) {
        let result = '';
        try {
          const toolArgs = JSON.parse(call.function.arguments);
          if (call.function.name === 'calculate_math') {
            // Scaffold POC: evaluate simple math
            // eslint-disable-next-line no-new-func
            const mathResult = new Function(`return (${toolArgs.expression})`)();
            result = String(mathResult);
          } else if (call.function.name === 'query_attached_document') {
            // Simple keyword search over the references block
            if (!args.references_block) {
              result = 'No references are attached to this section.';
            } else {
              const lines = args.references_block.split('\n');
              const matches = lines.filter((l: string) => l.toLowerCase().includes(String(toolArgs.query).toLowerCase()));
              if (matches.length === 0) {
                result = `No matches found for "${toolArgs.query}" in the attached references.`;
              } else {
                result = `Found ${matches.length} matches. Excerpts:\n` + matches.slice(0, 5).join('\n');
              }
            }
          } else if (call.function.name === 'fetch_url') {
            // Browser fetch (will hit CORS for most domains, but implemented for completeness)
            try {
              const res = await fetch(toolArgs.url);
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              const html = await res.text();
              result = `Fetched ${html.length} bytes (truncated):\n${html.slice(0, 1000)}`;
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              result = `Failed to fetch URL. Browser CORS policy may block cross-origin requests without a proxy. Error: ${msg}`;
            }
          } else if (call.function.name === 'search_project_history') {
            // Search through prior summaries
            if (args.prior_summaries && args.prior_summaries.length > 0) {
              const summaries = args.prior_summaries as PriorSectionSummary[];
              const matches = summaries.filter(s => 
                s.name.toLowerCase().includes(String(toolArgs.keyword).toLowerCase()) || 
                s.summary.toLowerCase().includes(String(toolArgs.keyword).toLowerCase())
              );
              if (matches.length === 0) {
                result = `No prior sections matched "${toolArgs.keyword}".`;
              } else {
                result = matches.map(s => `${s.name}: ${s.summary}`).join('\n');
              }
            } else {
              result = 'No prior sections have been drafted yet.';
            }
          } else if (call.function.name === 'design_complex_table') {
            let tableMd = `### ${toolArgs.title || 'Table'}\n`;
            if (Array.isArray(toolArgs.headers)) {
              tableMd += `| ${toolArgs.headers.join(' | ')} |\n`;
              tableMd += `| ${toolArgs.headers.map(() => '---').join(' | ')} |\n`;
            }
            if (Array.isArray(toolArgs.rows)) {
              for (const row of toolArgs.rows) {
                if (Array.isArray(row)) tableMd += `| ${row.join(' | ')} |\n`;
              }
            }
            if (toolArgs.nested_lists) {
              tableMd += `\n*Note: Contains nested list formatting inside cells.*\n`;
            }
            result = tableMd;
          } else if (call.function.name === 'apply_advanced_formatting') {
            if (toolArgs.formatting_type === 'multi_level_list') {
              result = (toolArgs.text || '').split('\n').map((line: string, i: number) => `${'  '.repeat(i % 3)}- ${line}`).join('\n');
            } else {
              result = `> [Formatted as ${toolArgs.formatting_type}]\n> ${(toolArgs.text || '').replace(/\n/g, '\n> ')}`;
            }
          } else {
            result = `Error: Unknown tool ${call.function.name}`;
          }
        } catch (err) {
          result = `Error executing tool: ${err}`;
        }
        
        conversation.push({
          user: 'tool',
          name: call.function.name,
          tool_call_id: call.id,
          message: result
        });
      }
    } else {
      break;
    }
  }

  const cleaned = stripCodeFence(text);
  let data: LLMDraftOutput;
  try {
    data = JSON.parse(cleaned);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    throw new Error(
      `Drafting response was not parseable JSON (${reason}). Raw response (first 2000 chars):\n${text.slice(0, 2000)}`
    );
  }

  // Defensive: the LLM may sometimes wrap paragraphs in odd shapes.
  // Normalize to an array of {role, text}.
  const paragraphs = Array.isArray(data?.paragraphs)
    ? data.paragraphs.filter(
        (p): p is NonNullable<typeof p> => !!p && typeof p === 'object' && 'role' in p,
      )
    : [];

  const usage = (raw!.usage as { prompt_tokens?: number; completion_tokens?: number }) ?? {};

  return {
    paragraphs,
    references: raw!.references ?? '',
    usage: raw!.usage ?? null,
    prompt_sent: prompt.message,
    model,
    tokens_in: usage.prompt_tokens ?? 0,
    tokens_out: usage.completion_tokens ?? 0,
    web_search_results: raw!.web_search_results,
  };
}

/**
 * Build a short summary of a drafted section's content for use as a
 * prior_summary input to dependent sections. We use the LLM's
 * self_summary if it produced one, otherwise concatenate the first
 * paragraph's text up to ~200 chars.
 */
export function summarizeDraft(
  paragraphs: { role: string; text: string }[],
  llm_self_summary: string | undefined,
): string {
  if (llm_self_summary && llm_self_summary.trim().length > 0) {
    return llm_self_summary.trim().slice(0, 300);
  }
  const first = paragraphs.find((p) => p.text && p.text.trim().length > 0);
  if (!first) return '(empty draft)';
  return first.text.slice(0, 200);
}

function stripCodeFence(text: string): string {
  const fenced = text.match(/^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/i);
  if (fenced) return fenced[1]!.trim();
  return text;
}

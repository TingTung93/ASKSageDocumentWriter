// User-tunable application settings persisted in IndexedDB. Distinct
// from session-only auth state. Drives:
//   - per-stage model overrides (synthesis, drafting, critic, cleanup,
//     schema-edit) — when null, the call site's compiled-in default applies.
//   - cost projection assumptions used to estimate token spend before
//     a drafting or cleanup pass kicks off.

export type ModelStage =
  | 'synthesis'
  | 'drafting'
  | 'critic'
  | 'cleanup'
  | 'schema_edit';

export interface ModelOverrides {
  synthesis: string | null;
  drafting: string | null;
  critic: string | null;
  cleanup: string | null;
  schema_edit: string | null;
}

export interface CostAssumptions {
  /** Estimated input tokens per drafted section */
  drafting_tokens_in_per_section: number;
  /** Estimated output tokens per drafted section */
  drafting_tokens_out_per_section: number;
  /**
   * Average characters per token. ~4 is a reasonable default for English
   * with the GPT/Claude tokenizers; tune downward for code-heavy or
   * acronym-heavy documents.
   */
  chars_per_token: number;
  /**
   * Fixed token overhead for the cleanup system prompt (op catalog,
   * instructions). Roughly 600 for the current prompt.
   */
  cleanup_system_prompt_tokens: number;
  /**
   * Token overhead per paragraph from the `[<index>] ` framing the
   * cleanup pass adds around each line of body text.
   */
  cleanup_paragraph_overhead_tokens: number;
  /**
   * Output-to-input ratio used to estimate cleanup output tokens.
   * Surgical edit passes typically return 10–20% of the input volume
   * because only changed paragraphs are echoed back.
   */
  cleanup_output_ratio: number;
  /** USD per 1k input tokens (display only — Ask Sage isn't billed this way) */
  usd_per_1k_in: number;
  /** USD per 1k output tokens */
  usd_per_1k_out: number;
}

export interface AppSettings {
  /** Singleton id, always 'app' */
  id: 'app';
  models: ModelOverrides;
  cost: CostAssumptions;
  updated_at: string;
}

export const DEFAULT_MODEL_OVERRIDES: ModelOverrides = {
  synthesis: null,
  drafting: null,
  critic: null,
  cleanup: null,
  schema_edit: null,
};

export const DEFAULT_COST_ASSUMPTIONS: CostAssumptions = {
  // Conservative defaults based on typical DHA template sizes. Users
  // can tune these in the Settings route once they have real data.
  drafting_tokens_in_per_section: 4000,
  drafting_tokens_out_per_section: 1500,
  chars_per_token: 4,
  cleanup_system_prompt_tokens: 600,
  cleanup_paragraph_overhead_tokens: 5,
  cleanup_output_ratio: 0.15,
  usd_per_1k_in: 0,
  usd_per_1k_out: 0,
};

export const DEFAULT_SETTINGS: AppSettings = {
  id: 'app',
  models: DEFAULT_MODEL_OVERRIDES,
  cost: DEFAULT_COST_ASSUMPTIONS,
  updated_at: new Date(0).toISOString(),
};

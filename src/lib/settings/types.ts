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

/**
 * Critic loop settings — drives the per-section draft → critique →
 * revise loop in the orchestrator. When `enabled === false`, the
 * loop is bypassed and sections are drafted exactly once (the legacy
 * single-pass behavior).
 */
export type CritiqueStrictness = 'lenient' | 'moderate' | 'strict';

export interface CriticSettings {
  enabled: boolean;
  strictness: CritiqueStrictness;
  /** 0..3. 0 = single-pass critic only, no revisions. */
  max_iterations: number;
  /** Optional model override for the critic call. Defaults to the drafting model. */
  critic_model?: string;
}

/**
 * Style consistency review settings — drives the document-level
 * formatting/style normalization pass that runs between
 * cross-section review and DOCX assembly. The reviewer looks at the
 * whole drafted document JSON and emits structured fix ops to
 * normalize role usage, table structure, leaked markdown, and
 * heading/bullet hierarchy. See lib/draft/style_consistency.ts.
 *
 * Default enabled=true because per-section drafts are independent
 * and almost always benefit from one normalization pass before the
 * assembler runs. Users who want to skip the cost can flip this off.
 */
export interface StyleReviewSettings {
  enabled: boolean;
  /** Optional model override for the review call. Defaults to the drafting model. */
  review_model?: string;
  /** Hard cap on the number of fix ops we will accept from the model. Defaults to 200. */
  max_ops?: number;
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

/**
 * Per-user defaults that get auto-populated into new projects'
 * shared inputs. Most DHA contracting officers have a stable
 * signature block, office symbol, and POC across every memo /
 * packet they draft. Storing these once at the app level means the
 * metadata batch doesn't have to extract them from notes every
 * time. The keys here are matched to the `key` of any
 * `SharedInputField` that derives from the selected templates,
 * case-insensitive — a template field named "office_symbol" will
 * pick up the value stored under `office_symbol` here.
 */
export interface UserDefaults {
  /**
   * Free-form key/value map. Keys are normalized snake_case
   * (office_symbol, signature_block, poc_line, etc). Values are
   * stored verbatim — the metadata batch and the per-section
   * drafter handle final formatting.
   */
  shared_inputs: Record<string, string>;
}

export const DEFAULT_USER_DEFAULTS: UserDefaults = {
  shared_inputs: {},
};

export interface AppSettings {
  /** Singleton id, always 'app' */
  id: 'app';
  models: ModelOverrides;
  cost: CostAssumptions;
  /** Critic loop configuration. Optional for migration compatibility. */
  critic?: CriticSettings;
  /** Style consistency review configuration. Optional for migration compatibility. */
  style_review?: StyleReviewSettings;
  /** User-level defaults that auto-populate new projects. */
  user_defaults?: UserDefaults;
  updated_at: string;
}

export const DEFAULT_MODEL_OVERRIDES: ModelOverrides = {
  synthesis: null,
  drafting: null,
  critic: null,
  cleanup: null,
  schema_edit: null,
};

export const DEFAULT_CRITIC_SETTINGS: CriticSettings = {
  enabled: true,
  strictness: 'moderate',
  max_iterations: 2,
};

export const DEFAULT_STYLE_REVIEW_SETTINGS: StyleReviewSettings = {
  enabled: true,
  max_ops: 200,
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
  critic: DEFAULT_CRITIC_SETTINGS,
  style_review: DEFAULT_STYLE_REVIEW_SETTINGS,
  user_defaults: DEFAULT_USER_DEFAULTS,
  updated_at: new Date(0).toISOString(),
};

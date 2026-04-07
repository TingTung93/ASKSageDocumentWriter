// Wire types for the Phase 1b semantic synthesizer. The LLM (Gemini 2.5
// Flash by default) returns a strict JSON object that conforms to
// LLMSemanticOutput. The merger then folds it into the structural
// TemplateSchema produced by Phase 1a.

export interface LLMSemanticSection {
  /** Must match a section.id from the structural schema */
  id: string;
  /** One-sentence statement of what this section communicates */
  intent: string;
  /** [min, max] target word count for the drafted body */
  target_words: [number, number];
  /** Section ids whose content this section logically requires */
  depends_on: string[];
  /** Optional validation rules */
  validation?: {
    must_mention?: string[];
    must_not_mention?: string[];
    must_not_exceed_words?: number;
    must_be_at_least_words?: number;
  };
}

export interface LLMSemanticStyle {
  voice: string;
  tense: string;
  register: string;
  jargon_policy: string;
  banned_phrases: string[];
}

export interface LLMSemanticOutput {
  style: LLMSemanticStyle;
  sections: LLMSemanticSection[];
}

export interface SynthesisOptions {
  /** Model id to use; defaults to google-gemini-2.5-flash */
  model?: string;
  /** Sampling temperature; default 0 (most deterministic) */
  temperature?: number;
  /** Optional explicit project intent the user supplies */
  user_hint?: string;
}

export interface SynthesisResult {
  /** The merged TemplateSchema with both halves populated */
  schema: import('../types').TemplateSchema;
  /** Raw LLM output for inspection */
  llm_output: LLMSemanticOutput;
  /** Token usage from Ask Sage's response, if reported */
  usage: unknown;
  /** The prompt that was sent (for the audit log) */
  prompt_sent: string;
  /** Model used */
  model: string;
}

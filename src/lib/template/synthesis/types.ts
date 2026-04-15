// Wire types for the Phase 1b semantic synthesizer. The LLM (Gemini 2.5
// Flash by default) returns a strict JSON object that conforms to
// LLMSemanticOutput. The merger then folds it into the structural
// TemplateSchema produced by Phase 1a.

export interface LLMVisualStyle {
  font_family: string | null;
  font_size_pt: number | null;
  alignment: 'left' | 'center' | 'right' | 'justify' | null;
  numbering_convention: 'none' | 'manual_numeric' | 'manual_lettered' | 'ooxml_list' | null;
}

export interface LLMSemanticDocumentPartSlot {
  slot_index: number;
  /** The parser-extracted source_text; echoed back verbatim. Merger rejects mismatches. */
  source_text: string;
  intent: string;
  style_notes: string;
  visual_style: LLMVisualStyle;
}

export interface LLMSemanticDocumentPart {
  part_path: string;
  placement: 'header' | 'footer';
  slots: LLMSemanticDocumentPartSlot[];
}

export interface LLMSemanticSection {
  /** snake_case identifier the LLM picks (e.g. "scope_and_objectives") */
  id: string;
  /** Display name as it should appear in the document (e.g. "1. Scope") */
  name: string;
  /**
   * Inclusive paragraph index range from the FULL TEMPLATE BODY block
   * that constitutes this section. Used by the merger to construct the
   * BodyFillRegion's paragraph anchors.
   */
  paragraph_range: [number, number];
  /** One-sentence statement of what this section communicates */
  intent: string;
  /** [min, max] target word count for the drafted body */
  target_words: [number, number];
  /** Section ids (from this same output list) whose content this section requires */
  depends_on: string[];
  /**
   * Free-form textual conventions for this section — how the drafter should
   * match template voice (e.g. "ALL CAPS section titles only", "numbered
   * list with 1. 2. 3. prefixes").
   */
  style_notes: string;
  /** Structured visual style for the assembler fallback and drafter guidance. */
  visual_style: LLMVisualStyle;
  /** Concrete, verifiable validation rules. Omit if none apply. */
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
  document_parts: LLMSemanticDocumentPart[];
}

export interface SynthesisOptions {
  /** Model id to use; defaults to google-gemini-2.5-flash */
  model?: string;
  /** Sampling temperature; default 0 (most deterministic) */
  temperature?: number;
  /** Optional explicit project intent the user supplies */
  user_hint?: string;
  /**
   * Override the full-body character cap. Default is sized for a 200k
   * context model. Lower it if you're targeting a smaller model.
   */
  body_cap_chars?: number;
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
  /**
   * Diagnostics about how much of the source body fit under the cap.
   * Callers should warn the user if `body_truncated` is true — that
   * means the back of the document was silently dropped.
   */
  body_truncated: boolean;
  body_paragraphs_sent: number;
  body_paragraphs_total: number;
  body_chars_sent: number;
  /**
   * Sections whose intent appears to contain baked-in subject matter
   * (proper nouns, domain-specific acronyms). The new synthesis
   * prompt forbids this, but old synthesizers and edge cases can
   * still slip through. Empty array on a clean synthesis.
   */
  subject_leakage_warnings: SubjectLeakageWarning[];
}

export interface SubjectLeakageWarning {
  section_id: string;
  section_name: string;
  /** The intent text that triggered the warning */
  intent: string;
  /** Specific tokens that look like subject-matter (e.g., "SHARP", "Diasorin") */
  flagged_tokens: string[];
}

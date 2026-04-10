/**
 * Freeform document style definitions. Each style describes a standard
 * government/military/scientific document type and provides the LLM with
 * structural guidance, tone rules, and a section outline. The drafter
 * uses these to produce a complete document from project context alone,
 * with no DOCX template required.
 */

export interface FreeformStyle {
  id: string;
  name: string;
  category: 'administrative' | 'finance' | 'scientific';
  /** One-sentence description shown in the UI */
  description: string;
  /** Typical page range for user expectation-setting */
  typical_pages: string;
  /** Structural outline the LLM follows (sections/headings) */
  outline: string[];
  /** System prompt fragment describing tone, voice, and conventions */
  tone_guidance: string;
  /**
   * Full system prompt template. Placeholders:
   *   {{STYLE_NAME}} — the style's display name
   *   {{OUTLINE}} — the numbered outline (auto-generated from `outline`)
   *   {{TONE}} — the tone_guidance string
   *   {{PROJECT_DESCRIPTION}} — the user's project description
   *   {{CONTEXT}} — assembled notes + reference excerpts
   */
  system_prompt: string;
}

// ─── Shared prompt skeleton ──────────────────────────────────────

const BASE_SYSTEM_PROMPT = `You are a senior government writer producing a {{STYLE_NAME}}.

DOCUMENT STRUCTURE — follow this outline exactly:
{{OUTLINE}}

WRITING RULES:
{{TONE}}
- Write complete, publication-ready prose. Do not leave placeholders, "[INSERT]" markers, or TODO notes.
- Every claim must be grounded in the provided context. If context is insufficient, state what is known and note the gap.
- Use headings, sub-headings, and numbered/bulleted lists where they improve readability.
- Do NOT include a title page or cover sheet — start directly with the first heading.

CITATION AND SOURCING RULES:
- When you use information from the context, reference material, or web search results, cite the source inline using brackets, e.g. [Source: FAR 6.302-1] or [Source: https://example.com/page].
- For web URLs, always include the FULL URL so the reader can verify.
- For reference files, cite by filename, e.g. [Source: prior_pws_2025.docx, Section 3].
- For dataset references, cite by the reference text provided, e.g. [Source: DHA Issuance 6025.01].
- At the END of the document, include a ## References section listing every source you cited, with:
  - Full title or description
  - Full URL if it is a web source
  - Document name and section if it is a file reference
  - Date accessed or publication date if known
- Do NOT fabricate URLs or sources. Only cite material that was actually provided to you or returned by web search. If you cannot find a URL, cite the source by name/description only.

PROJECT DESCRIPTION:
{{PROJECT_DESCRIPTION}}

CONTEXT AND REFERENCE MATERIAL:
{{CONTEXT}}

Produce the complete document now. Use Markdown formatting: # for top-level headings, ## for sub-headings, ### for sub-sub-headings, - for bullets, 1. for numbered items, **bold** for emphasis.`;

// ─── Helper ──────────────────────────────────────────────────────

function makeStyle(
  partial: Omit<FreeformStyle, 'system_prompt'>,
): FreeformStyle {
  return { ...partial, system_prompt: BASE_SYSTEM_PROMPT };
}

// ─── Administrative styles ───────────────────────────────────────

const EXSUM = makeStyle({
  id: 'exsum',
  name: 'Executive Summary (EXSUM)',
  category: 'administrative',
  description: 'Concise overview of a topic, decision, or initiative for senior leadership.',
  typical_pages: '1–2',
  outline: [
    'Purpose / Bottom Line Up Front (BLUF)',
    'Background',
    'Key Findings or Discussion',
    'Recommendation(s)',
    'Way Ahead / Next Steps',
  ],
  tone_guidance: `Use formal government English. Lead with the BLUF — the single most important takeaway — in the first sentence. Be concise: favor short paragraphs and bullet lists. Avoid jargon unless the audience expects it. Write in third person, present tense. Target 1–2 pages.`,
});

const MEMO = makeStyle({
  id: 'memo',
  name: 'Memorandum (Memo)',
  category: 'administrative',
  description: 'Standard office memorandum for internal communication, decisions, or requests.',
  typical_pages: '1–3',
  outline: [
    'MEMORANDUM FOR (addressee)',
    'SUBJECT',
    'Purpose',
    'Background',
    'Discussion',
    'Recommendation / Action Required',
  ],
  tone_guidance: `Use standard DoD/DHA memorandum conventions. Write in formal, direct prose. Third person unless the signatory is speaking ("I recommend…"). Keep paragraphs numbered when there are more than three. Use active voice where possible.`,
});

const INFO_PAPER = makeStyle({
  id: 'info_paper',
  name: 'Information Paper / Issue Paper',
  category: 'administrative',
  description: 'Brief paper presenting facts, analysis, or options on a specific issue.',
  typical_pages: '1–2',
  outline: [
    'Issue',
    'Background',
    'Discussion / Analysis',
    'Options (if applicable)',
    'Recommendation',
    'Coordination',
  ],
  tone_guidance: `Formal government style. Start with a clear one-sentence issue statement. Present facts objectively. If options are discussed, list pros and cons for each. Keep to 1–2 pages. Third person, present tense.`,
});

const POINT_PAPER = makeStyle({
  id: 'point_paper',
  name: 'Point Paper / Talking Points',
  category: 'administrative',
  description: 'Bullet-format briefing aid for meetings, calls, or leadership engagements.',
  typical_pages: '1',
  outline: [
    'Purpose',
    'Key Points',
    'Background (if needed)',
    'Anticipated Questions & Responses',
  ],
  tone_guidance: `Bullet-driven format. Each point should be one sentence or a short clause. Write as if preparing a principal for a meeting — direct, factual, no filler. Use sub-bullets for supporting detail. Keep to a single page.`,
});

const AAR = makeStyle({
  id: 'aar',
  name: 'After Action Report (AAR)',
  category: 'administrative',
  description: 'Structured review of an event, exercise, or operation with lessons learned.',
  typical_pages: '3–10',
  outline: [
    'Executive Summary',
    'Event Overview (who, what, when, where)',
    'Objectives',
    'Summary of Events / Timeline',
    'Observations and Findings',
    'Lessons Learned',
    'Recommendations',
    'Appendices (reference only)',
  ],
  tone_guidance: `Factual, chronological, objective. Describe what was planned, what happened, and what should change. Use past tense for events, present tense for findings and recommendations. Include specific dates, times, and participants where relevant.`,
});

// ─── Finance / Contracting styles ────────────────────────────────

const MARKET_RESEARCH = makeStyle({
  id: 'market_research',
  name: 'Market Research Report',
  category: 'finance',
  description: 'Survey of available sources, vendors, and solutions for an acquisition.',
  typical_pages: '5–15',
  outline: [
    'Purpose and Scope',
    'Background / Requirement Description',
    'Market Research Methodology',
    'Market Survey Results',
    'Analysis of Alternatives',
    'Vendor / Source Summary',
    'Small Business Considerations',
    'Conclusions and Recommendations',
    'References / Sources Consulted',
  ],
  tone_guidance: `Formal acquisition English per FAR Part 10. Be thorough and objective — document sources consulted, methods used, and rationale for conclusions. Include specific vendor names, contract vehicles, and NAICS codes where applicable. Use tables for side-by-side comparisons.`,
});

const JA = makeStyle({
  id: 'ja',
  name: 'Justification & Approval (J&A)',
  category: 'finance',
  description: 'Statutory justification for other-than-full-and-open competition per FAR 6.3.',
  typical_pages: '3–8',
  outline: [
    'Contracting Activity and Description of Action',
    'Description of Supplies or Services',
    'Statutory Authority Cited',
    'Demonstration that the Proposed Contractor Is the Only Responsible Source',
    'Efforts to Obtain Competition / Market Research Summary',
    'Determination of Fair and Reasonable Price',
    'Description of Actions to Remove Barriers to Competition',
    'Period of Performance and Estimated Value',
    'Certifications',
  ],
  tone_guidance: `Formal, legal-style government prose per FAR 6.303-2. Every assertion must be supported by fact. Cite FAR sections by number. Use "shall" for mandatory actions. Write in third person. Be precise about dollar amounts, dates, and contract numbers.`,
});

const ACQ_STRATEGY = makeStyle({
  id: 'acq_strategy',
  name: 'Acquisition Strategy Summary',
  category: 'finance',
  description: 'High-level acquisition approach document summarizing the plan for a procurement.',
  typical_pages: '3–8',
  outline: [
    'Purpose',
    'Background and Requirement',
    'Acquisition Approach',
    'Contract Type and Rationale',
    'Competition Strategy',
    'Source Selection Methodology',
    'Small Business Strategy',
    'Schedule and Milestones',
    'Estimated Cost and Funding',
    'Risk Assessment',
  ],
  tone_guidance: `Formal acquisition English. Address the acquisition as a business decision — explain the "why" behind the chosen approach. Reference applicable FAR/DFARS citations. Use tables for milestones and cost breakdowns.`,
});

const CBA = makeStyle({
  id: 'cba',
  name: 'Cost-Benefit Analysis',
  category: 'finance',
  description: 'Structured comparison of costs vs. benefits for a proposed investment or change.',
  typical_pages: '5–12',
  outline: [
    'Executive Summary',
    'Purpose and Scope',
    'Alternatives Considered',
    'Cost Analysis (per alternative)',
    'Benefit Analysis (per alternative)',
    'Risk Assessment',
    'Sensitivity Analysis (if applicable)',
    'Comparison and Recommendation',
    'Assumptions and Limitations',
  ],
  tone_guidance: `Analytical and objective. Present costs and benefits quantitatively where possible (dollar amounts, FTEs, time savings). Use tables and charts descriptions for comparisons. Clearly state assumptions. Write in third person, present tense for analysis, future tense for projections.`,
});

const SOW_NARRATIVE = makeStyle({
  id: 'sow_narrative',
  name: 'Statement of Work (Narrative SOW)',
  category: 'finance',
  description: 'Narrative-style SOW describing work requirements without a rigid template structure.',
  typical_pages: '5–20',
  outline: [
    'Scope of Work',
    'Background',
    'Objectives',
    'Tasks and Deliverables',
    'Performance Standards and Metrics',
    'Government-Furnished Property / Information',
    'Place and Period of Performance',
    'Applicable Documents and Standards',
    'Quality Assurance',
    'Security Requirements (if applicable)',
  ],
  tone_guidance: `Directive, precise, and unambiguous. Use "shall" for contractor obligations, "will" for government actions, "may" for optional items. Define all acronyms on first use. Number all paragraphs. Reference applicable regulations, standards, and prior contracts where relevant.`,
});

// ─── Scientific / Technical styles ───────────────────────────────

const WHITE_PAPER = makeStyle({
  id: 'white_paper',
  name: 'White Paper',
  category: 'scientific',
  description: 'In-depth report on a specific topic presenting analysis, findings, or a position.',
  typical_pages: '5–20',
  outline: [
    'Abstract / Executive Summary',
    'Introduction and Problem Statement',
    'Background / Literature Context',
    'Analysis / Discussion',
    'Findings',
    'Recommendations / Proposed Solution',
    'Conclusion',
    'References',
  ],
  tone_guidance: `Authoritative but accessible. Write for an informed audience that may not be subject-matter experts. Support claims with evidence and citations. Use formal English, third person, present tense for established facts and past tense for specific studies. Minimize jargon; define technical terms on first use.`,
});

const TECH_REPORT = makeStyle({
  id: 'tech_report',
  name: 'Technical Report',
  category: 'scientific',
  description: 'Detailed technical document presenting methodology, data, results, and analysis.',
  typical_pages: '10–30',
  outline: [
    'Abstract',
    'Introduction',
    'Background / Previous Work',
    'Methodology',
    'Results',
    'Discussion',
    'Conclusions',
    'Recommendations',
    'References',
    'Appendices (reference only)',
  ],
  tone_guidance: `Technical, precise, and evidence-based. Use passive voice where convention dictates ("The sample was tested…") but prefer active voice for clarity. Include specific data, measurements, and procedures. Define abbreviations. Use numbered sections and sub-sections.`,
});

const LIT_REVIEW = makeStyle({
  id: 'lit_review',
  name: 'Literature Review / Annotated Bibliography',
  category: 'scientific',
  description: 'Survey and synthesis of existing research and publications on a topic.',
  typical_pages: '5–15',
  outline: [
    'Introduction and Scope',
    'Search Methodology',
    'Thematic Review of Literature',
    'Gaps in Current Knowledge',
    'Summary and Implications',
    'Bibliography / References',
  ],
  tone_guidance: `Academic but accessible. Organize by theme, not source. Summarize each source's contribution, methodology, and relevance. Identify patterns, contradictions, and gaps across the body of work. Use past tense for individual studies, present tense for established knowledge.`,
});

const SOP = makeStyle({
  id: 'sop',
  name: 'Standard Operating Procedure (SOP)',
  category: 'scientific',
  description: 'Step-by-step instructions for a recurring process or task.',
  typical_pages: '3–10',
  outline: [
    'Purpose',
    'Scope and Applicability',
    'Definitions and Abbreviations',
    'Responsibilities',
    'Procedures (step-by-step)',
    'Safety / Compliance Considerations',
    'Records and Documentation',
    'References',
    'Revision History',
  ],
  tone_guidance: `Direct, imperative, unambiguous. Write procedures as numbered steps starting with an action verb ("Open the…", "Record the…"). Use "shall" for mandatory steps, "should" for recommended steps. Define all terms. Include warnings and cautions before the step they apply to.`,
});

const TRIP_REPORT = makeStyle({
  id: 'trip_report',
  name: 'Trip / Site Visit Report',
  category: 'scientific',
  description: 'Summary of a trip or site visit with observations, findings, and follow-up actions.',
  typical_pages: '2–5',
  outline: [
    'Purpose of Visit',
    'Visit Details (dates, location, participants)',
    'Activities / Itinerary',
    'Observations and Findings',
    'Action Items / Follow-Up',
    'Conclusion',
  ],
  tone_guidance: `Factual and concise. Use past tense for events, present tense for ongoing conditions, future tense for action items. Include specific names, dates, and locations. Organize observations by topic or chronologically. Keep recommendations actionable.`,
});

// ─── Registry ────────────────────────────────────────────────────

export const FREEFORM_STYLES: FreeformStyle[] = [
  // Administrative
  EXSUM,
  MEMO,
  INFO_PAPER,
  POINT_PAPER,
  AAR,
  // Finance / Contracting
  MARKET_RESEARCH,
  JA,
  ACQ_STRATEGY,
  CBA,
  SOW_NARRATIVE,
  // Scientific / Technical
  WHITE_PAPER,
  TECH_REPORT,
  LIT_REVIEW,
  SOP,
  TRIP_REPORT,
];

export const FREEFORM_STYLE_MAP = new Map(
  FREEFORM_STYLES.map((s) => [s.id, s]),
);

export const FREEFORM_CATEGORIES: {
  id: FreeformStyle['category'];
  label: string;
}[] = [
  { id: 'administrative', label: 'Administrative' },
  { id: 'finance', label: 'Finance & Contracting' },
  { id: 'scientific', label: 'Scientific & Technical' },
];

/** Look up a style by id, returns undefined if not found */
export function getFreeformStyle(id: string): FreeformStyle | undefined {
  return FREEFORM_STYLE_MAP.get(id);
}

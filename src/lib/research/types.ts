export type ResearchDepth = 'quick' | 'standard' | 'deep';

export type ResearchCitationSource =
  | 'web_result'
  | 'ask_sage_reference'
  | 'model_cited'
  | 'provider_reference';

export interface ResearchCitation {
  id: string;
  title: string;
  url?: string;
  source_type: ResearchCitationSource;
  excerpt?: string;
  used_by_finding_ids?: string[];
}

export interface ResearchFinding {
  id: string;
  text: string;
  citation_ids: string[];
}

export interface ResearchPack {
  id: string;
  objective: string;
  depth: ResearchDepth;
  generated_at: string;
  query_plan: string[];
  findings: ResearchFinding[];
  citations: ResearchCitation[];
  gaps: string[];
  markdown: string;
  raw_references?: string;
}

export interface ResearchValidation {
  finding_count: number;
  citation_count: number;
  uncited_finding_ids: string[];
}

export interface ResearchRequest {
  project_name: string;
  project_description: string;
  objective: string;
  focus_questions?: string;
  depth: ResearchDepth;
  model?: string;
}

export interface ResearchResult {
  pack: ResearchPack;
  tokens_in: number;
  tokens_out: number;
  model?: string;
}

import Dexie, { type Table } from 'dexie';
import type { TemplateSchema } from '../template/types';
import type { DraftParagraph } from '../draft/types';
import type { StoredEdit } from '../document/types';
import type { AppSettings } from '../settings/types';

// Phase 1a stores template DOCX bytes alongside the parsed schema.
// Phase 1b adds the semantic half. Phase 2 introduces projects and
// drafts. Phase 3 (export) reuses TemplateRecord.docx_bytes as the
// clone-and-mutate skeleton.

export interface TemplateRecord {
  id: string;
  name: string;
  filename: string;
  ingested_at: string;
  /** Original DOCX bytes. The template IS the export skeleton. */
  docx_bytes: Blob;
  /** Structural half from Phase 1a; semantic half added by Phase 1b. */
  schema_json: TemplateSchema;
}

export interface ProjectRecord {
  id: string;
  name: string;
  /** Free-form description of the project's intent (user input) */
  description: string;
  /** TemplateRecord ids included in this project */
  template_ids: string[];
  /** Ask Sage dataset names to use for RAG context during drafting */
  reference_dataset_names: string[];
  /**
   * User-provided values for shared inputs derived from the union of
   * metadata_fill_regions across selected templates. Keys are
   * project_input_field names (e.g. "cui_banner", "document_number").
   */
  shared_inputs: Record<string, string>;
  /** Optional model overrides per stage */
  model_overrides: {
    drafting?: string;
    critic?: string;
  };
  /**
   * Web search mode for drafting calls. Maps to Ask Sage `/server/query`
   * `live` parameter:
   *   0 — disabled (default)
   *   1 — Google results
   *   2 — Google results + crawl (autonomous market research mode)
   */
  live_search: 0 | 1 | 2;
  created_at: string;
  updated_at: string;
}

export interface DraftRecord {
  /** Composite id: `${project_id}::${template_id}::${section_id}` */
  id: string;
  project_id: string;
  template_id: string;
  section_id: string;
  /** Structured paragraph array with role tags; see PRD §6. */
  paragraphs: DraftParagraph[];
  /** Free-form references string returned by Ask Sage from RAG */
  references: string;
  /** Lifecycle state of this draft */
  status: 'pending' | 'drafting' | 'ready' | 'error';
  /** Set when status === 'error' */
  error?: string;
  /** Issues detected by the critic pass (Phase 4) */
  validation_issues?: string[];
  generated_at: string;
  model: string;
  tokens_in: number;
  tokens_out: number;
}

export interface AuditRecord {
  id?: number;
  ts: string;
  endpoint: string;
  model?: string;
  prompt_excerpt: string;
  response_excerpt: string;
  tokens_in?: number;
  tokens_out?: number;
  ms: number;
  ok: boolean;
  error?: string;
}

/**
 * A finished DOCX uploaded for inline cleanup. Distinct from
 * TemplateRecord (which gets parsed into a schema for drafting). The
 * cleanup workflow is: upload → propose edits → preview → export.
 */
export interface DocumentRecord {
  id: string;
  name: string;
  filename: string;
  ingested_at: string;
  /** Original DOCX bytes — never overwritten */
  docx_bytes: Blob;
  /** Total paragraph count from the parser, for display */
  paragraph_count: number;
  /**
   * All edits proposed and accepted for this document. Each entry
   * wraps a typed DocumentEditOp with lifecycle metadata. The export
   * writer feeds the accepted op subset through applyDocumentEdits.
   */
  edits: StoredEdit[];
  /** Last LLM model used for an edit pass */
  last_edit_model?: string;
  /** Cumulative tokens spent on edit passes */
  total_tokens_in: number;
  total_tokens_out: number;
}

class DocWriterDb extends Dexie {
  templates!: Table<TemplateRecord, string>;
  projects!: Table<ProjectRecord, string>;
  drafts!: Table<DraftRecord, string>;
  documents!: Table<DocumentRecord, string>;
  audit!: Table<AuditRecord, number>;
  settings!: Table<AppSettings, string>;

  constructor() {
    super('asksage-doc-writer');
    this.version(1).stores({
      templates: 'id, name, ingested_at',
      projects: 'id, name, updated_at',
      drafts: 'id, [project_id+template_id+section_id], project_id, generated_at',
      audit: '++id, ts, endpoint, ok',
    });
    // v2 adds the documents table for the inline cleanup workflow.
    this.version(2).stores({
      templates: 'id, name, ingested_at',
      projects: 'id, name, updated_at',
      drafts: 'id, [project_id+template_id+section_id], project_id, generated_at',
      documents: 'id, name, ingested_at',
      audit: '++id, ts, endpoint, ok',
    });
    // v3 adds the singleton settings table (per-stage model overrides
    // and cost projection assumptions).
    this.version(3).stores({
      templates: 'id, name, ingested_at',
      projects: 'id, name, updated_at',
      drafts: 'id, [project_id+template_id+section_id], project_id, generated_at',
      documents: 'id, name, ingested_at',
      audit: '++id, ts, endpoint, ok',
      settings: 'id',
    });
  }
}

export const db = new DocWriterDb();

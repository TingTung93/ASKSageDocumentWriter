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

/**
 * A user-attached piece of grounding context for a project. Two flavors:
 *   - "note": a chat-style message (typically guidance from the user
 *     about scope, requirements, or expected emphasis). Inlined verbatim
 *     into the drafting prompt.
 *   - "file": a file the user uploaded to Ask Sage via /server/file and
 *     trained into the project's dedicated dataset via /server/train.
 *     Drafting reaches it via the existing `dataset` parameter on
 *     /server/query — it never touches the prompt body. We store only
 *     the metadata (filename, embedding id, training timestamp) so the
 *     UI can list and de-register attachments.
 *
 * NOTE: prior to v4 the `file` variant inlined extracted plaintext
 * directly into the prompt with arbitrary char caps. That approach was
 * replaced by the train-into-a-dataset flow once we discovered
 * /server/file + /server/train + /server/get-datasets are all on the
 * permissive /server/* surface.
 */
export type ProjectContextItem = ProjectContextNote | ProjectContextFile;

export interface ProjectContextNote {
  kind: 'note';
  id: string;
  role: 'user' | 'assistant';
  text: string;
  created_at: string;
}

export interface ProjectContextFile {
  kind: 'file';
  id: string;
  filename: string;
  /** MIME type or 'unknown' */
  mime_type: string;
  /** Original byte size */
  size_bytes: number;
  /**
   * Original file bytes. Stored locally so re-extraction via
   * /server/file is the source of truth — we don't cache a stale
   * extract. Drafting runs upload these to Ask Sage once per run
   * (cached in memory) and feed the extracted text into every
   * per-section prompt.
   */
  bytes: Blob;
  /**
   * Optional: semantic chunks the user produced via an explicit
   * "chunk semantically" action. When present, the orchestrator
   * selects the most-relevant chunks per section (rather than
   * inlining the whole file). When absent, the orchestrator falls
   * back to naive paragraph-based chunking on the fly. See
   * lib/project/chunk.ts.
   */
  chunks?: ReferenceChunk[];
  /**
   * Cached plaintext from a previous extraction, if any. Populated by
   * the unified extraction helper (lib/draft/file_extract.ts). Two
   * paths fill this:
   *   1. Ask Sage path — text returned from /server/file is cached
   *      here so subsequent runs can skip the upload round-trip.
   *   2. Local path — when the active provider does not support
   *      /server/file (OpenRouter), text comes from
   *      lib/project/local_extract.ts.
   * Always optional. When absent the orchestrator re-extracts.
   */
  extracted_text?: string;
  /** ISO timestamp when extracted_text was last populated. */
  extracted_at?: string;
  /** ISO timestamp when the file was attached */
  created_at: string;
}

/**
 * One semantic chunk of a reference file. The drafter selects a
 * subset of chunks per section (relevance-scored against the section
 * intent + project subject) and inlines only the selected chunks
 * into that section's drafting prompt.
 */
export interface ReferenceChunk {
  id: string;
  /** One-line human-readable label, e.g. "Section 1.2 — Scope of Work" */
  title: string;
  /** One-sentence summary of the chunk's content, used for relevance scoring */
  summary: string;
  /** Verbatim text of the chunk */
  text: string;
  /** Embedding vector from OpenRouter /v1/embeddings (1536 dims). Absent on Ask Sage or legacy chunks. */
  embedding?: number[];
}

/** Project mode: template-driven (classic) or freeform (style-based). */
export type ProjectMode = 'template' | 'freeform';

export interface ProjectRecord {
  id: string;
  name: string;
  /** Free-form description of the project's intent (user input) */
  description: string;
  /**
   * Project mode. 'template' is the classic PWS flow (pick DOCX
   * templates, draft per-section). 'freeform' lets the user pick a
   * document style (white paper, exsum, memo, etc.) and the AI
   * synthesizes context into one cohesive document. Defaults to
   * 'template' for legacy rows that don't have this field.
   */
  mode?: ProjectMode;
  /**
   * Freeform document style id (e.g. 'exsum', 'white_paper').
   * Only meaningful when mode === 'freeform'. References a style
   * definition in lib/freeform/styles.ts.
   */
  freeform_style?: string;
  /**
   * The complete drafted document for freeform projects, stored as
   * DraftParagraph[]. Only populated after a freeform drafting run.
   */
  freeform_draft?: DraftParagraph[];
  /** Model used for the most recent freeform draft */
  freeform_draft_model?: string;
  /** Tokens used by the most recent freeform draft */
  freeform_draft_tokens_in?: number;
  freeform_draft_tokens_out?: number;
  /** ISO timestamp of the most recent freeform draft */
  freeform_draft_generated_at?: string;
  /** Raw references string from Ask Sage (RAG + web search) */
  freeform_draft_raw_references?: string;
  /** Extracted source references (URLs, file citations, etc.) */
  freeform_draft_sources?: import('../freeform/drafter').SourceReference[];
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
  /**
   * Per-key metadata for shared_inputs values. Tracks where the
   * value came from (manual entry vs the agentic auto-fill stage).
   * Used by the UI to show an "auto-filled" badge so the user
   * knows which values to spot-check. Optional for migration safety.
   */
  shared_inputs_meta?: Record<
    string,
    {
      source: 'manual' | 'preflight' | 'preflight:project_subject' | 'preflight:reference_file' | 'preflight:inferred' | 'preflight:default';
      source_label?: string;
      confidence?: number;
      filled_at: string;
    }
  >;
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
  /**
   * Notes and file-attachment metadata for this project. BOTH inline
   * directly into every drafting prompt — notes verbatim, files via
   * an /server/file extraction call at draft time. Files are NOT
   * trained into any dataset by default; for that workflow, the user
   * curates a dataset on the Datasets tab and references it via
   * `reference_dataset_names` for an additional RAG layer.
   */
  context_items?: ProjectContextItem[];
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
  /**
   * The exact prompt body sent to /server/query. Persisted so the
   * Sections view can show "what did the model actually see?" — the
   * single most useful diagnostic when a section drafts off-topic.
   */
  prompt_sent?: string;
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
  // ─── v7: Phase 3 critic loop history ───
  /** Full iteration history from runDraftWithCriticLoop (each iteration = one draft + one critique). */
  critic_iterations?: import('../draft/critique').CriticLoopIteration[];
  /** True if the last critique passed; false if the loop hit max_iterations with issues remaining. */
  critic_converged?: boolean;
  /** Strictness used for this section's critic loop (for diagnostics). */
  critic_strictness?: import('../draft/critique').CritiqueStrictness;
  /**
   * Char count of the ATTACHED REFERENCES block that was inlined into
   * the drafting prompt for this section. The legacy `references`
   * field above is the dataset-RAG-only response from Ask Sage and is
   * always empty under the inline-references architecture; this is
   * the field the diagnostics panel actually wants to show.
   */
  references_inlined_chars?: number;
  /** Number of chunks selected for the inlined references block. */
  references_inlined_chunks?: number;
  /**
   * Chunk ids that the per-section selector pinned for THIS section
   * (after applying the mapper's preferred ids and filling remaining
   * slots by Jaccard score). Persisted so the side-by-side reference
   * panel can render exactly which slices of which files contributed
   * to each drafted section, instead of re-running the selector at
   * view time. Stored as a flat string array; the file id is encoded
   * in the chunk id prefix when needed.
   */
  references_inlined_chunk_ids?: string[];
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
  // ─── v6: cleanup-pass context (Ask-Sage-only) ───
  /**
   * Files attached to this specific document for the cleanup pass.
   * Re-uploaded to /server/file at edit time and inlined into the
   * cleanup prompt as ATTACHED REFERENCES — same shape as project
   * context files so we can share storage helpers.
   */
  reference_files?: ProjectContextFile[];
  /** Optional Ask Sage RAG dataset name for the cleanup pass */
  cleanup_dataset_name?: string;
  /** Web search mode for the cleanup pass (mirrors project.live_search) */
  cleanup_live_search?: 0 | 1 | 2;
  /** RAG references cap forwarded to /server/query (default 5) */
  cleanup_limit_references?: number;
}

class DocWriterDb extends Dexie {
  templates!: Table<TemplateRecord, string>;
  projects!: Table<ProjectRecord, string>;
  drafts!: Table<DraftRecord, string>;
  documents!: Table<DocumentRecord, string>;
  audit!: Table<AuditRecord, number>;
  settings!: Table<AppSettings, string>;
  recipe_runs!: Table<import('../agent/recipe').RecipeRun, string>;

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
    // v4 added project context_items (chat notes + attached file extracts).
    this.version(4).stores({
      templates: 'id, name, ingested_at',
      projects: 'id, name, updated_at',
      drafts: 'id, [project_id+template_id+section_id], project_id, generated_at',
      documents: 'id, name, ingested_at',
      audit: '++id, ts, endpoint, ok',
      settings: 'id',
    });
    // v5 reshapes ProjectContextFile: drops the train-into-dataset
    // fields (extracted_chars, embedding_id, trained_into_dataset) and
    // adds `bytes: Blob` so files are stored locally and re-extracted
    // via /server/file at draft time. Old project rows are normalized
    // at read time by getContextItems(): file entries missing `bytes`
    // are dropped with a one-time toast asking the user to re-attach.
    this.version(5).stores({
      templates: 'id, name, ingested_at',
      projects: 'id, name, updated_at',
      drafts: 'id, [project_id+template_id+section_id], project_id, generated_at',
      documents: 'id, name, ingested_at',
      audit: '++id, ts, endpoint, ok',
      settings: 'id',
    });
    // v6 adds cleanup-pass context to DocumentRecord (reference_files,
    // dataset name, live search mode, references cap). Schema indices
    // are unchanged — these are just new optional fields stored inline
    // on the existing `documents` rows. Bump kept for clarity.
    this.version(6).stores({
      templates: 'id, name, ingested_at',
      projects: 'id, name, updated_at',
      drafts: 'id, [project_id+template_id+section_id], project_id, generated_at',
      documents: 'id, name, ingested_at',
      audit: '++id, ts, endpoint, ok',
      settings: 'id',
    });
    // v7 adds the recipe_runs table for the Phase 5b agentic recipe
    // runner. Rows are composite-keyed by project+recipe+started_at so
    // multiple runs of the same recipe on the same project coexist
    // (one record per run, useful for diagnostics history).
    this.version(7).stores({
      templates: 'id, name, ingested_at',
      projects: 'id, name, updated_at',
      drafts: 'id, [project_id+template_id+section_id], project_id, generated_at',
      documents: 'id, name, ingested_at',
      audit: '++id, ts, endpoint, ok',
      settings: 'id',
      recipe_runs: 'id, project_id, recipe_id, started_at, status',
    });
    // v8 adds freeform project support: mode, freeform_style, and
    // freeform_draft fields on ProjectRecord. No index changes needed —
    // these are optional inline fields on existing project rows.
    // Legacy rows default to mode='template'.
    this.version(8).stores({
      templates: 'id, name, ingested_at',
      projects: 'id, name, updated_at',
      drafts: 'id, [project_id+template_id+section_id], project_id, generated_at',
      documents: 'id, name, ingested_at',
      audit: '++id, ts, endpoint, ok',
      settings: 'id',
      recipe_runs: 'id, project_id, recipe_id, started_at, status',
    });
  }
}

export const db = new DocWriterDb();

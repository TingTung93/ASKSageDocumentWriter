import Dexie, { type Table } from 'dexie';

// Phase 0 baseline. The shape will grow as Phase 1a/1b/2/3 land.
// Each table here corresponds to an artifact category from PRD §7.

export interface TemplateRecord {
  id: string;
  name: string;
  filename: string;
  ingested_at: string;
  /** Original DOCX bytes. The template IS the export skeleton. */
  docx_bytes: Blob;
  /** Loose `unknown` for Phase 0; will be typed as TemplateSchema in Phase 1a. */
  schema_json: unknown;
}

export interface ProjectRecord {
  id: string;
  name: string;
  description: string;
  template_ids: string[];
  reference_dataset_names: string[];
  shared_inputs: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface DraftRecord {
  id: string;
  project_id: string;
  template_id: string;
  section_id: string;
  /** Structured paragraph array with role tags; see PRD §6. */
  paragraphs: unknown;
  references: string;
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

class DocWriterDb extends Dexie {
  templates!: Table<TemplateRecord, string>;
  projects!: Table<ProjectRecord, string>;
  drafts!: Table<DraftRecord, string>;
  audit!: Table<AuditRecord, number>;

  constructor() {
    super('asksage-doc-writer');
    this.version(1).stores({
      templates: 'id, name, ingested_at',
      projects: 'id, name, updated_at',
      drafts: 'id, [project_id+template_id+section_id], project_id, generated_at',
      audit: '++id, ts, endpoint, ok',
    });
  }
}

export const db = new DocWriterDb();

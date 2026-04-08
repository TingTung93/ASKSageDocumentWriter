// Audit writer for Ask Sage API calls. Wraps the AskSageClient so
// every /server/* call is logged to the Dexie audit table with timing,
// token usage, and a short prompt/response excerpt. The Documents,
// Templates, Projects, and Datasets routes all benefit because they
// share the same client wrapper — no per-call instrumentation needed.

import { db, type AuditRecord } from '../db/schema';

export interface AuditEntryInput {
  endpoint: string;
  model?: string;
  prompt_excerpt: string;
  response_excerpt: string;
  tokens_in?: number;
  tokens_out?: number;
  ms: number;
  ok: boolean;
  error?: string;
  /** Free-form context label like "Documents.cleanup" or "Templates.synthesis" */
  source?: string;
}

const MAX_EXCERPT_CHARS = 1500;

function excerpt(s: string | undefined): string {
  if (!s) return '';
  if (s.length <= MAX_EXCERPT_CHARS) return s;
  return s.slice(0, MAX_EXCERPT_CHARS - 1) + '…';
}

export async function writeAuditEntry(input: AuditEntryInput): Promise<void> {
  const record: AuditRecord = {
    ts: new Date().toISOString(),
    endpoint: input.endpoint,
    model: input.model,
    prompt_excerpt: excerpt(input.prompt_excerpt),
    response_excerpt: excerpt(input.response_excerpt),
    tokens_in: input.tokens_in,
    tokens_out: input.tokens_out,
    ms: input.ms,
    ok: input.ok,
    error: input.error,
  };
  // Persist via Dexie auto-increment id
  try {
    await db.audit.add(record);
  } catch (e) {
    // Audit failures must never break the calling code path
    // eslint-disable-next-line no-console
    console.warn('[audit] failed to write entry:', e);
  }
  // Optional source tag is stored as part of the endpoint string
  // suffix when present, so the viewer can filter by it.
  void input.source;
}

/** Convenience: trim a Dexie query result for display */
export async function loadRecentAudit(limit = 200): Promise<AuditRecord[]> {
  return db.audit.orderBy('id').reverse().limit(limit).toArray();
}

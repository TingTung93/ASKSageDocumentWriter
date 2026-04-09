// Unified reference-file extraction for the drafting chain.
//
// Replaces the old `instanceof AskSageClient` guards in
// lib/draft/orchestrator.ts and lib/agent/preflight.ts. The drafting
// chain calls into here once per run, gets back a Map<file_id, text>,
// and feeds the text into per-section prompts the same way regardless
// of which provider is active.
//
// Provider routing:
//
//   - client.capabilities.fileUpload === true  → call /server/file
//     (Ask Sage path; preserves the legacy behavior of getting the
//     server-side extractor's output, which handles PDF/RTF/etc.)
//
//   - client.capabilities.fileUpload === false → extract in-browser
//     via lib/project/local_extract.ts (DOCX + plain-text only;
//     unsupported types degrade to filename-only context)
//
// Both paths cache the result on the ProjectContextFile so a follow-up
// recipe run can skip the work entirely. Cache hits are reported via
// the same callback path as fresh extractions so the UI can still tell
// the user which files were processed.

import type { LLMClient } from '../provider/types';
import type { ProjectContextFile, ProjectRecord } from '../db/schema';
import { blobToFile, extractedTextFromRet } from '../asksage/extract';
import { extractFileLocally, cacheExtractedText } from '../project/local_extract';

/**
 * Minimal subset of AskSageClient.uploadFile we depend on. Lets the
 * helper take an `LLMClient` at the type level and duck-type into the
 * Ask Sage method when capabilities.fileUpload is true.
 */
interface FileUploader {
  uploadFile(file: File): Promise<{ ret: string | Record<string, unknown> }>;
}

export interface ExtractReferencesArgs {
  client: LLMClient;
  project: ProjectRecord;
  files: ProjectContextFile[];
  onStart?: (file: ProjectContextFile) => void;
  onDone?: (file: ProjectContextFile, chars: number, error?: string) => void;
}

export interface ExtractReferencesResult {
  /** Map of file id → extracted text. Empty entries are omitted. */
  extractedById: Map<string, string>;
  /** Files we attempted but couldn't extract (with the error message). */
  failures: Array<{ file_id: string; filename: string; error: string }>;
}

/**
 * Extract reference text for every supplied file using whichever path
 * the active client supports. Idempotent: re-running over a project
 * whose files already have `extracted_text` is a no-op (cache hit).
 */
export async function extractReferencesForRun(
  args: ExtractReferencesArgs,
): Promise<ExtractReferencesResult> {
  const { client, project, files, onStart, onDone } = args;
  const extractedById = new Map<string, string>();
  const failures: Array<{ file_id: string; filename: string; error: string }> = [];

  const useServerSide = client.capabilities.fileUpload;

  for (const f of files) {
    onStart?.(f);

    // Cache hit — skip extraction. Still emits onDone so the UI can
    // count the file as "ready" without distinguishing fresh vs cached.
    if (f.extracted_text && f.extracted_text.trim().length > 0) {
      extractedById.set(f.id, f.extracted_text);
      onDone?.(f, f.extracted_text.length);
      continue;
    }

    if (useServerSide) {
      try {
        const fileObj = blobToFile(f.bytes, f.filename, f.mime_type);
        const upload = await (client as unknown as FileUploader).uploadFile(fileObj);
        const text = extractedTextFromRet(upload.ret);
        if (text && text.trim().length > 0) {
          extractedById.set(f.id, text);
          await cacheExtractedText(project, f.id, text);
          onDone?.(f, text.length);
        } else {
          onDone?.(f, 0, 'server returned empty extraction');
          failures.push({ file_id: f.id, filename: f.filename, error: 'empty extraction' });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // eslint-disable-next-line no-console
        console.error(`[extractReferencesForRun] /server/file failed for ${f.filename}:`, err);
        onDone?.(f, 0, msg);
        failures.push({ file_id: f.id, filename: f.filename, error: msg });
      }
      continue;
    }

    // Local-extraction path. extractFileLocally never throws.
    const local = await extractFileLocally(f);
    if (local.text && local.text.trim().length > 0) {
      extractedById.set(f.id, local.text);
      await cacheExtractedText(project, f.id, local.text);
      onDone?.(f, local.text.length);
    } else {
      const reason = local.error ?? 'no text extracted';
      // eslint-disable-next-line no-console
      console.warn(`[extractReferencesForRun] local extract skipped ${f.filename}: ${reason}`);
      onDone?.(f, 0, reason);
      failures.push({ file_id: f.id, filename: f.filename, error: reason });
    }
  }

  return { extractedById, failures };
}

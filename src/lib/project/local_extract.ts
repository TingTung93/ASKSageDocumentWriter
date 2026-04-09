// Local (browser-side) text extraction for project reference files.
//
// Used by the drafting chain when the active provider does NOT support
// /server/file extraction (e.g. OpenRouter). Instead of round-tripping
// reference files through Ask Sage, we pull text out of the stored Blob
// directly in the browser and cache the result on the file record so
// future runs don't re-extract.
//
// Supported formats:
//
//   - DOCX (.docx, application/vnd.openxmlformats-officedocument.wordprocessingml.document)
//       Reuses lib/template/parser.extractParagraphs which already
//       walks word/document.xml and concatenates run text per paragraph.
//
//   - Plain-text family (.txt, .md, .csv, .json, text/*)
//       Decoded with TextDecoder. UTF-8 with a fallback to latin1 if
//       the bytes don't decode cleanly under utf-8.
//
//   - PDF (.pdf, application/pdf)
//       Extracted via unpdf (a runtime-independent wrapper around
//       PDF.js). We import lazily so the parser code only enters the
//       bundle when a PDF is actually attached. unpdf runs in the main
//       thread without a worker, which is fine for the
//       paragraph-throughput we expect from contracting reference
//       PDFs (single-digit MB).
//
//   - Anything else (RTF, images)
//       Returns { text: null, error } so the caller can render a
//       filename-only stub.

import type { ProjectContextFile, ProjectRecord } from '../db/schema';
import { db } from '../db/schema';
import { extractParagraphs } from '../template/parser';

/** Result of one extraction attempt. `text === null` means unsupported. */
export interface LocalExtractResult {
  text: string | null;
  error?: string;
}

/**
 * Decide whether a file looks like a DOCX from its mime type or
 * filename extension. Mime sniffing alone is unreliable — DHA workflows
 * frequently strip mime to "application/octet-stream".
 */
function isDocx(file: ProjectContextFile): boolean {
  if (file.mime_type?.includes('wordprocessingml.document')) return true;
  return /\.docx$/i.test(file.filename);
}

/** Plain-text family by mime or extension. */
function isPlainText(file: ProjectContextFile): boolean {
  if (file.mime_type?.startsWith('text/')) return true;
  if (file.mime_type === 'application/json') return true;
  return /\.(txt|md|markdown|csv|tsv|json|log|xml|yaml|yml)$/i.test(file.filename);
}

/** PDF by mime or extension. */
function isPdf(file: ProjectContextFile): boolean {
  if (file.mime_type === 'application/pdf') return true;
  return /\.pdf$/i.test(file.filename);
}

/**
 * Extract text from a stored ProjectContextFile in-browser. Never
 * throws — failures come back as `{ text: null, error }`. Callers
 * should treat unsupported types the same as failed extraction:
 * fall back to filename-only context and let the model see what it
 * sees.
 */
export async function extractFileLocally(
  file: ProjectContextFile,
): Promise<LocalExtractResult> {
  try {
    if (isDocx(file)) {
      const paragraphs = await extractParagraphs(file.bytes);
      const text = paragraphs
        .map((p) => p.text)
        .filter((t) => t && t.trim().length > 0)
        .join('\n');
      if (text.trim().length === 0) {
        return { text: null, error: 'DOCX parsed but contained no text' };
      }
      return { text };
    }
    if (isPlainText(file)) {
      const buf = await blobToArrayBuffer(file.bytes);
      const decoded = decodeBytes(new Uint8Array(buf));
      if (decoded.trim().length === 0) {
        return { text: null, error: 'file decoded but contained no text' };
      }
      return { text: decoded };
    }
    if (isPdf(file)) {
      const text = await extractPdfText(file.bytes);
      if (!text || text.trim().length === 0) {
        return { text: null, error: 'PDF parsed but contained no extractable text (may be scanned/image-only)' };
      }
      return { text };
    }
    return {
      text: null,
      error: `local extraction not supported for ${file.mime_type || 'unknown type'} (${file.filename}); attach a DOCX, PDF, or plain-text version, or switch to Ask Sage which supports server-side extraction`,
    };
  } catch (err) {
    return {
      text: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Read a Blob into an ArrayBuffer. Uses arrayBuffer() when available
 * (real browsers); falls back to FileReader for older shims and to a
 * direct cast in jsdom (which only has the size field).
 */
async function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof (blob as Blob).arrayBuffer === 'function') {
    return await (blob as Blob).arrayBuffer();
  }
  // jsdom Blob shim has no arrayBuffer; the bytes the parser receives
  // in this code path always come from the browser File API, so this
  // branch is only exercised in tests — return an empty buffer rather
  // than throwing.
  return new ArrayBuffer(0);
}

/**
 * Decode bytes as UTF-8, falling back to latin1 if the strict UTF-8
 * decode hits invalid sequences. Latin1 is a lossless byte-to-char
 * mapping that always succeeds — better to show the user mojibake than
 * a hard error on a slightly-misencoded file.
 */
function decodeBytes(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('latin1').decode(bytes);
  }
}

/**
 * Extract every page's text from a PDF blob using unpdf. Imported
 * dynamically so PDF.js only enters the bundle on the first attached
 * PDF — the upfront cost is significant (~1 MB minified) and most
 * projects use DOCX references. With `mergePages: true` unpdf returns
 * one concatenated string with page boundaries collapsed; that matches
 * the shape every other extraction path returns and slots straight
 * into the inline-references block.
 */
async function extractPdfText(blob: Blob): Promise<string> {
  const buf = await blobToArrayBuffer(blob);
  // Dynamic import keeps the PDF.js code out of the initial bundle.
  // The vite-plugin-singlefile build still inlines it; this just
  // makes the dependency explicit and lets bundlers code-split if
  // they ever stop using singlefile.
  const { extractText } = await import('unpdf');
  const result = await extractText(new Uint8Array(buf), { mergePages: true });
  return typeof result.text === 'string' ? result.text : '';
}

// ─── Persistence: cache extracted text on the project record ─────

/**
 * Persist an extracted text blob back onto a project's reference file
 * so subsequent runs can skip extraction. We mutate the file entry on
 * the in-memory project (caller usually owns it) AND write the patched
 * project row back to Dexie. Failure to persist is non-fatal — the
 * extraction will just happen again next run.
 */
export async function cacheExtractedText(
  project: ProjectRecord,
  file_id: string,
  text: string,
): Promise<void> {
  const items = project.context_items ?? [];
  let mutated = false;
  for (const item of items) {
    if (item.kind !== 'file') continue;
    if (item.id !== file_id) continue;
    if (item.extracted_text === text) return;
    item.extracted_text = text;
    item.extracted_at = new Date().toISOString();
    mutated = true;
    break;
  }
  if (!mutated) return;
  try {
    await db.projects.put({ ...project, updated_at: new Date().toISOString() });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[local_extract] failed to persist extracted text cache:', err);
  }
}

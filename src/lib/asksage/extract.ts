// Shared helpers for /server/file extraction. Both the drafting
// orchestrator and the document cleanup pipeline upload reference
// files to Ask Sage and need to (a) coerce a stored Blob into a File
// the FormData uploader will accept, and (b) normalize the `ret`
// field, which the health.mil tenant returns as a plaintext string
// even though swagger v1.56 documents it as an object.

/**
 * Wrap a stored Blob as a File so client.uploadFile() can hand it to
 * /server/file via FormData. The Blob lives in IndexedDB and may have
 * been written under a different File constructor than the current
 * window's, so this normalization avoids subtle FormData issues.
 */
export function blobToFile(blob: Blob, filename: string, mime: string): File {
  if (typeof File !== 'undefined') {
    return new File([blob], filename, {
      type: mime || blob.type || 'application/octet-stream',
    });
  }
  // Pseudo-File for jsdom: callers only need name + type + bytes.
  const stub = blob as Blob & { name?: string };
  Object.defineProperty(stub, 'name', { value: filename, configurable: true });
  return stub as unknown as File;
}

/**
 * Best-effort plaintext extraction from /server/file's `ret` field.
 * Health.mil returns a string; swagger v1.56 documents an object with
 * a `text` or `content` key. Falls back to JSON.stringify so the
 * caller still sees something rather than an empty string.
 */
export function extractedTextFromRet(ret: string | Record<string, unknown>): string {
  if (typeof ret === 'string') return ret;
  if (ret && typeof ret === 'object') {
    const maybeText = (ret as { text?: unknown }).text;
    if (typeof maybeText === 'string') return maybeText;
    const maybeContent = (ret as { content?: unknown }).content;
    if (typeof maybeContent === 'string') return maybeContent;
    try {
      return JSON.stringify(ret);
    } catch {
      return '';
    }
  }
  return '';
}

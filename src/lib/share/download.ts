// Browser file-download helper for share bundles. Same pattern as
// lib/export — wraps an object URL in an anchor click. Works on
// file:// origins.

export function downloadBundle(filename: string, payload: unknown): void {
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Build a safe filename from a display name plus a timestamp suffix. */
export function bundleFilename(displayName: string, kind: 'template' | 'project'): string {
  const safe = displayName.replace(/[^a-z0-9]+/gi, '_').toLowerCase().slice(0, 60);
  const ts = new Date().toISOString().slice(0, 10);
  return `${safe}.${kind}.${ts}.asdbundle.json`;
}

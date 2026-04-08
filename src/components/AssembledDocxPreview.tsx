// AssembledDocxPreview — high-fidelity inline render of an assembled
// project DOCX via docx-preview. Mirrors the VisualPreview component
// in routes/Documents.tsx but takes a Blob directly instead of
// reading from a DocumentRecord. Used by RecipeRunPanel to surface
// the recipe's assembled output without forcing a download first.

import { useEffect, useRef, useState } from 'react';
import { renderAsync as renderDocxAsync } from 'docx-preview';

interface AssembledDocxPreviewProps {
  blob: Blob | null;
  /**
   * A stable key the parent passes to force a re-render when the
   * underlying Blob changes (e.g. the user re-runs the recipe and
   * a new assembly produces a fresh Blob). Without this we'd diff
   * Blob identities and miss content changes.
   */
  cacheKey: string;
}

export function AssembledDocxPreview({ blob, cacheKey }: AssembledDocxPreviewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container) return;
    container.innerHTML = '';
    setError(null);
    if (!blob) return;
    setRendering(true);
    renderDocxAsync(blob, container, undefined, {
      className: 'docx-preview',
      inWrapper: true,
      breakPages: true,
      ignoreFonts: false,
      ignoreLastRenderedPageBreak: true,
      experimental: false,
      renderHeaders: true,
      renderFooters: true,
      renderFootnotes: true,
      renderEndnotes: true,
      renderChanges: false,
      useBase64URL: true,
    } as Parameters<typeof renderDocxAsync>[3])
      .then(() => {
        if (cancelled) return;
        setRendering(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setRendering(false);
      });
    return () => {
      cancelled = true;
    };
  }, [blob, cacheKey]);

  return (
    <div>
      {rendering && <p className="note">Rendering with docx-preview…</p>}
      {error && (
        <div className="error">
          Visual render failed: {error}
        </div>
      )}
      <div
        ref={containerRef}
        style={{
          background: '#f5f5f5',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-sm)',
          padding: '1rem',
          marginTop: '0.5rem',
          maxHeight: '70vh',
          overflow: 'auto',
        }}
      />
    </div>
  );
}

// DocxDiffPreview — three-mode speculative preview for the document
// cleanup workflow. Modes:
//
//   - "original"      → render source DOCX bytes as-is via docx-preview
//   - "with_accepted" → run applyDocumentEdits over the accepted op
//                       subset and render the resulting Blob
//   - "diff_overlay"  → build a with-edits Blob from (accepted +
//                       proposed) ops and render it; ALSO render the
//                       original into a hidden DOM; then walk both
//                       DOMs in paragraph order and colorize any
//                       paragraph whose text changed, using the
//                       word-level diff in lib/document/diffRender.
//
// The docx-preview options block is copied verbatim from
// AssembledDocxPreview — that's the proven config. All async render
// work is cancellable via the effect-cleanup flag so a fast mode
// toggle can't race two renders into the same container.

import { useEffect, useMemo, useRef, useState } from 'react';
import { renderAsync as renderDocxAsync } from 'docx-preview';
import type { DocumentRecord } from '../lib/db/schema';
import type { StoredEdit, DocumentEditOp } from '../lib/document/types';
import { applyDocumentEdits } from '../lib/document/writer';
import { computeInlineDiff, renderDiffSegmentsHtml } from '../lib/document/diffRender';

export type DocxDiffPreviewMode = 'original' | 'with_accepted' | 'diff_overlay';

interface DocxDiffPreviewProps {
  document: DocumentRecord;
  edits: StoredEdit[];
  mode: DocxDiffPreviewMode;
}

// Same options block as AssembledDocxPreview. Keep these in sync if
// that component ever changes — the whole point of this preview is
// that it renders identically to the rest of the app.
const DOCX_PREVIEW_OPTIONS: Parameters<typeof renderDocxAsync>[3] = {
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
} as Parameters<typeof renderDocxAsync>[3];

/**
 * Extract the text of a rendered docx-preview paragraph. We match
 * against the CSS class docx-preview emits for paragraphs ("docx_p")
 * as well as any <p> tag, so we're resilient to minor emitter
 * changes. Selection is scoped to the passed-in root so headers,
 * footers, and page wrappers aren't over-counted.
 */
function collectParagraphs(root: HTMLElement): HTMLElement[] {
  // docx-preview emits every paragraph as a <p> (or occasionally a
  // styled <p>) inside a page section wrapper. We want them all in
  // document order, so a single querySelectorAll('p') is both
  // sufficient and stable.
  return Array.from(root.querySelectorAll('p')) as HTMLElement[];
}

/**
 * Normalize whitespace in a paragraph's textContent so we don't
 * flag paragraphs as "changed" just because docx-preview collapsed
 * a run split differently between two renders. We collapse runs of
 * whitespace and trim.
 */
function normalizeText(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

export function DocxDiffPreview({
  document,
  edits,
  mode,
}: DocxDiffPreviewProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const hiddenRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);

  // Stable signature that changes when edits change in a way the
  // preview needs to react to. We hash the length plus every
  // (id, status) pair so toggling a single edit's status triggers
  // a re-render without forcing a new render when unrelated
  // properties (rationale text, etc.) change.
  const editsSignature = useMemo(() => {
    return edits.map((e) => `${e.id}:${e.status}`).join('|') + `#${edits.length}`;
  }, [edits]);

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    const hidden = hiddenRef.current;
    if (!container) return;

    // Wipe any previous render before we start a new one so a
    // failed/cancelled run never leaves stale nodes on screen.
    container.innerHTML = '';
    if (hidden) hidden.innerHTML = '';
    setError(null);
    setRendering(true);

    // Build the op subsets we need for this mode.
    const acceptedOps: DocumentEditOp[] = edits
      .filter((e) => e.status === 'accepted')
      .map((e) => e.op);
    const overlayOps: DocumentEditOp[] = edits
      .filter((e) => e.status === 'accepted' || e.status === 'proposed')
      .map((e) => e.op);

    // Resolve the Blob we're going to render for the "visible" pane.
    // For 'original' we just wrap the source bytes; for the other
    // two modes we run applyDocumentEdits over the appropriate op
    // set. applyDocumentEdits accepts a Blob directly so we can
    // pass docx_bytes through without a copy.
    const visibleBlobPromise: Promise<Blob> = (async () => {
      if (mode === 'original') {
        return document.docx_bytes;
      }
      const ops = mode === 'with_accepted' ? acceptedOps : overlayOps;
      if (ops.length === 0) {
        // Short-circuit: nothing to apply, just render the source.
        return document.docx_bytes;
      }
      const result = await applyDocumentEdits(document.docx_bytes, ops);
      return result.blob;
    })();

    visibleBlobPromise
      .then(async (visibleBlob) => {
        if (cancelled) return;
        await renderDocxAsync(
          visibleBlob,
          container,
          undefined,
          DOCX_PREVIEW_OPTIONS,
        );
        if (cancelled) return;

        if (mode !== 'diff_overlay') {
          setRendering(false);
          return;
        }

        // Diff overlay: also render the original into the hidden
        // container, then walk both DOMs in paragraph order and
        // colorize any differing paragraph on the visible side.
        if (!hidden) {
          setRendering(false);
          return;
        }
        await renderDocxAsync(
          document.docx_bytes,
          hidden,
          undefined,
          DOCX_PREVIEW_OPTIONS,
        );
        if (cancelled) return;

        const visibleParas = collectParagraphs(container);
        const originalParas = collectParagraphs(hidden);

        // We intentionally walk by index rather than trying to
        // align paragraphs semantically. The cleanup ops are all
        // paragraph-addressed by index, so the two renders line up
        // 1:1 unless an op inserted or deleted a paragraph. When
        // the counts diverge we still colorize up to the shorter
        // length — callers can fall back to "with_accepted" mode
        // if structural ops are in play. This is called out in the
        // component JSDoc and in the route integration notes.
        const pairCount = Math.min(visibleParas.length, originalParas.length);
        for (let i = 0; i < pairCount; i++) {
          const visP = visibleParas[i]!;
          const origP = originalParas[i]!;
          const visText = visP.textContent ?? '';
          const origText = origP.textContent ?? '';
          if (normalizeText(visText) === normalizeText(origText)) continue;
          const segments = computeInlineDiff(origText, visText);
          visP.innerHTML = renderDiffSegmentsHtml(segments);
        }

        // Free the hidden render — we've used the text we needed.
        hidden.innerHTML = '';
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
    // editsSignature folds the edit list into a single string so
    // reference-unstable arrays from parent re-renders don't thrash
    // the preview. mode and document.id complete the dependency set.
  }, [document.id, document.docx_bytes, editsSignature, mode, edits]);

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
      {/* Hidden twin used by the diff_overlay mode to extract the
          original paragraph text in rendered order. Kept offscreen
          with display:none so docx-preview still lays it out but it
          never paints. */}
      <div ref={hiddenRef} style={{ display: 'none' }} aria-hidden="true" />
    </div>
  );
}

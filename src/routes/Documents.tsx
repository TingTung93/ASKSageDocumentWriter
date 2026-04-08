// Documents route — upload a finished DOCX, run an LLM cleanup pass,
// review proposed edits side-by-side with the original, accept or
// reject each one, then export a new DOCX with the accepted edits
// applied. The whole workflow lives in this single route file because
// it's small and self-contained.

import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { renderAsync as renderDocxAsync } from 'docx-preview';
import { db, type DocumentRecord, type ProjectContextFile } from '../lib/db/schema';
import {
  parseDocx,
  type HeaderFooterPartContent,
  type ParagraphInfo,
} from '../lib/template/parser';
import { useAuth } from '../lib/state/auth';
import { createLLMClient } from '../lib/provider/factory';
import { requestDocumentEdits } from '../lib/document/edit';
import { applyDocumentEdits } from '../lib/document/writer';
import type { DocumentEditOp, StoredEdit } from '../lib/document/types';
import { computeAnchor } from '../lib/document/anchors';
import { DocxDiffPreview, type DocxDiffPreviewMode } from '../components/DocxDiffPreview';
import { SelectionPopover } from '../components/SelectionPopover';
import { runScopedEdit } from '../lib/document/scopedEdit';
import {
  attachDocumentReference,
  removeDocumentReference,
  updateDocumentCleanupContext,
} from '../lib/document/references';
import { migrateAll, migrateDocumentEdits } from '../lib/document/migrate';
import { DropZone } from '../components/DropZone';
import { SearchFilter, matchesSearch } from '../components/SearchFilter';
import { EmptyState } from '../components/EmptyState';
import { loadSettings } from '../lib/settings/store';
import { estimateDocumentCleanup, formatTokens, formatUsd } from '../lib/settings/cost';
import { DEFAULT_COST_ASSUMPTIONS, type CostAssumptions } from '../lib/settings/types';
import { toast } from '../lib/state/toast';
import { Spinner } from '../components/Spinner';

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `doc_${Date.now()}_${Math.floor(Math.random() * 1e9)}`;
}

export function Documents() {
  const documents = useLiveQuery(
    async () => migrateAll(await db.documents.orderBy('ingested_at').reverse().toArray()),
    [],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const selected = documents?.find((d) => d.id === selectedId) ?? null;

  const filtered = useMemo(
    () => (documents ?? []).filter((d) => matchesSearch(`${d.name} ${d.filename}`, search)),
    [documents, search],
  );

  async function onUpload(file: File) {
    setUploadError(null);
    if (!file.name.toLowerCase().endsWith('.docx')) {
      setUploadError(`Not a DOCX: ${file.name}`);
      return;
    }
    setUploading(true);
    // eslint-disable-next-line no-console
    console.info(`[Documents] uploading ${file.name} (${file.size} bytes)`);
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      const { paragraphs, docx_blob } = await parseDocx(buf, {
        filename: file.name,
        docx_blob_id: 'doc',
      });
      // Count only paragraphs with visible text — empty/whitespace
      // paragraphs are layout artifacts (blank lines for spacing) and
      // are filtered out before being sent to the LLM. Counting them
      // would inflate the cost projection.
      const significantCount = paragraphs.filter((p) => p.text.trim().length > 0).length;
      const record: DocumentRecord = {
        id: newId(),
        name: file.name.replace(/\.docx$/i, ''),
        filename: file.name,
        ingested_at: new Date().toISOString(),
        docx_bytes: docx_blob,
        paragraph_count: significantCount,
        edits: [] as StoredEdit[],
        total_tokens_in: 0,
        total_tokens_out: 0,
      };
      await db.documents.put(record);
      setSelectedId(record.id);
      toast.success(`Loaded ${file.name} (${significantCount} paragraphs)`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.error('[Documents] upload failed:', err);
      setUploadError(message);
      toast.error(`Upload failed: ${message}`);
    } finally {
      setUploading(false);
    }
  }

  async function onDelete(id: string) {
    await db.documents.delete(id);
    if (selectedId === id) setSelectedId(null);
  }

  return (
    <main>
      <h1>Documents — inline cleanup</h1>
      <p>
        Upload a finished DOCX you've already drafted, run it through an LLM
        cleanup pass for grammar / language / correctness, review the proposed
        edits paragraph by paragraph, then export a new DOCX with the accepted
        edits applied. The original file is never overwritten — every export
        produces a fresh copy.
      </p>
      <p className="note">
        This is the right tool when you have a complete document and just want
        it polished. For drafting from scratch from a template, use{' '}
        <Link to="/projects">Projects</Link>.
      </p>

      <DropZone
        accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        onFile={onUpload}
        disabled={uploading}
        label="Drop a DOCX here, or click to choose"
        hint="The original file is preserved; exports are produced as fresh copies."
      />
      {uploading && <p className="note">Parsing…</p>}
      {uploadError && <div className="error">Upload failed: {uploadError}</div>}

      <h2>Stored documents ({documents?.length ?? 0})</h2>
      {documents && documents.length > 0 && (
        <SearchFilter value={search} onChange={setSearch} placeholder="Filter documents…" />
      )}
      {(!documents || documents.length === 0) && (
        <EmptyState
          title="No documents yet"
          body="Drop a DOCX above to begin a cleanup pass."
        />
      )}
      {documents && documents.length > 0 && filtered.length === 0 && (
        <EmptyState title="No matches" body="Try a different search term." />
      )}
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {filtered.map((d) => (
          <li
            key={d.id}
            style={{
              padding: '0.5rem 0.75rem',
              border: '1px solid #ddd',
              borderRadius: 4,
              marginBottom: '0.25rem',
              background: selectedId === d.id ? '#eef' : '#fff',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'baseline',
              gap: '0.5rem',
            }}
            onClick={() => setSelectedId(d.id)}
          >
            <strong>{d.name}</strong>
            <span className="note" style={{ marginLeft: 'auto' }}>
              {d.paragraph_count} paragraphs · {d.edits.length} edit{d.edits.length === 1 ? '' : 's'} ·
              {' '}{(d.total_tokens_in + d.total_tokens_out).toLocaleString()} tokens used
            </span>
            <button
              type="button"
              className="btn-danger btn-sm"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(d.id);
              }}
              style={{ marginLeft: '0.25rem' }}
            >
              delete
            </button>
          </li>
        ))}
      </ul>

      {selected && <DocumentDetail document={selected} />}
    </main>
  );
}

function DocumentDetail({ document: doc }: { document: DocumentRecord }) {
  const apiKey = useAuth((s) => s.apiKey);
  const baseUrl = useAuth((s) => s.baseUrl);
  const provider = useAuth((s) => s.provider);
  const settings = useLiveQuery(() => loadSettings(), []);
  const cleanupModelOverride = settings?.models.cleanup ?? null;
  const cost: CostAssumptions = settings?.cost ?? DEFAULT_COST_ASSUMPTIONS;
  const [instruction, setInstruction] = useState('Review this document for grammar, language, clarity, and obvious errors. Propose surgical edits only — leave clean paragraphs alone.');
  // Phase F (item #4): two-call pre-pass that first identifies which
  // paragraphs need editing, then runs the fix pass narrowed to those
  // paragraphs. Off by default to preserve legacy behavior; flip on
  // for documents where the model is wasting attention scanning clean
  // sections.
  const [usePrepass, setUsePrepass] = useState(false);
  // Phase F (item #2): how many chunks to process in parallel.
  // Default 3 — empirically a good balance between wall-time speedup
  // and rate-limit pressure on the health.mil tenant.
  const [chunkConcurrency, setChunkConcurrency] = useState(3);
  // Phase F (item #5): scoped/targeted edit popover state. The user
  // picks a paragraph range, types an instruction, and the system
  // fires ONE LLM call against that region. Result lands in the same
  // accept/reject queue as the chunked pass.
  const [scopedSelection, setScopedSelection] = useState<number[]>([]);
  const [scopedPopoverOpen, setScopedPopoverOpen] = useState(false);
  const [scopedRunning, setScopedRunning] = useState(false);
  const [scopedRangeText, setScopedRangeText] = useState('');
  const [running, setRunning] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [exportInfo, setExportInfo] = useState<string | null>(null);
  const [paragraphs, setParagraphs] = useState<ParagraphInfo[] | null>(null);
  const [headerParts, setHeaderParts] = useState<HeaderFooterPartContent[]>([]);
  const [footerParts, setFooterParts] = useState<HeaderFooterPartContent[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [chunkProgress, setChunkProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [attachingRef, setAttachingRef] = useState(false);

  const onAskSage = provider === 'asksage';
  const referenceFiles = doc.reference_files ?? [];
  const cleanupDataset = doc.cleanup_dataset_name ?? '';
  const cleanupLive = doc.cleanup_live_search ?? 0;
  const cleanupLimit = doc.cleanup_limit_references ?? (cleanupDataset ? 5 : 0);

  // Prefer the freshly parsed paragraph list (which lets us count
  // significant paragraphs and sum content characters) over the stored
  // paragraph_count, so docs ingested before the empty-paragraph fix
  // still get an accurate estimate without needing a re-upload.
  const { significantParagraphCount, totalChars } = useMemo(() => {
    if (paragraphs) {
      let chars = 0;
      let count = 0;
      for (const p of paragraphs) {
        const trimmed = p.text.trim();
        if (trimmed.length > 0) {
          count += 1;
          chars += trimmed.length;
        }
      }
      return { significantParagraphCount: count, totalChars: chars };
    }
    // No live re-parse yet — fall back to stored count and a rough
    // chars-from-paragraphs guess (50 chars/paragraph).
    return { significantParagraphCount: doc.paragraph_count, totalChars: doc.paragraph_count * 50 };
  }, [paragraphs, doc.paragraph_count]);

  // Rough estimate of how many chars the attached references contribute
  // to every chunk. The on-the-wire cost depends on the actual extracted
  // text length (which we won't know until upload time), so we use a
  // conservative ~3x ratio over the stored byte size as a stand-in.
  const referenceChars = useMemo(
    () => referenceFiles.reduce((acc, f) => acc + Math.min(f.size_bytes * 3, 8000), 0),
    [referenceFiles],
  );
  const cleanupEstimate = useMemo(
    () =>
      estimateDocumentCleanup(significantParagraphCount, totalChars, cost, {
        reference_chars: referenceChars,
      }),
    [significantParagraphCount, totalChars, cost, referenceChars],
  );

  const proposed = doc.edits.filter((e) => e.status === 'proposed');
  const accepted = doc.edits.filter((e) => e.status === 'accepted');

  // Re-parse the stored DOCX whenever the selected document changes so
  // we have paragraphs available for the preview AND for the next edit
  // request (no double-parse).
  useEffect(() => {
    let cancelled = false;
    setParagraphs(null);
    setHeaderParts([]);
    setFooterParts([]);
    setParseError(null);
    parseDocx(doc.docx_bytes, { filename: doc.filename, docx_blob_id: 'preview' })
      .then((res) => {
        if (cancelled) return;
        setParagraphs(res.paragraphs);
        setHeaderParts(res.header_parts);
        setFooterParts(res.footer_parts);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setParseError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [doc.id, doc.docx_bytes, doc.filename]);

  async function onRequestEdits(e: FormEvent) {
    e.preventDefault();
    if (!apiKey) {
      setRequestError('Connect on the Connection tab first.');
      return;
    }
    if (!paragraphs) {
      setRequestError('Document is still parsing. Try again in a moment.');
      return;
    }
    setRequestError(null);
    setRunning(true);
    setChunkProgress(null);
    // eslint-disable-next-line no-console
    console.info(`[DocumentDetail] requesting cleanup edits for ${doc.id}`);
    try {
      const client = createLLMClient({ provider, baseUrl, apiKey });
      const result = await requestDocumentEdits(client, {
        document_name: doc.name,
        paragraphs,
        instruction: instruction.trim(),
        ...(cleanupModelOverride ? { model: cleanupModelOverride } : {}),
        // Grounding context — only Ask Sage supports the file/dataset
        // path; on OpenRouter the UI hides these inputs entirely so we
        // can pass them straight through.
        ...(cleanupDataset ? { dataset: cleanupDataset } : {}),
        ...(cleanupLimit > 0 ? { limit_references: cleanupLimit } : {}),
        ...(cleanupLive ? { live: cleanupLive } : {}),
        ...(onAskSage && referenceFiles.length > 0
          ? { references: referenceFiles }
          : {}),
        chunk_concurrency: chunkConcurrency,
        use_prepass: usePrepass,
        on_chunk_done: (info) =>
          setChunkProgress({ done: info.chunk_index + 1, total: info.chunk_count }),
      });

      // Build a quick lookup from index → original text for diff display
      const originalByIndex = new Map<number, string>();
      for (const p of paragraphs) originalByIndex.set(p.index, p.text);

      // Convert each LLM-proposed op into a StoredEdit, capturing
      // before-state metadata so the diff cards have what they need.
      // Also stamp a content-based anchor on the op so the writer can
      // resolve it independently of integer-index drift caused by
      // earlier structural ops in the same batch.
      const paragraphsByIndex = new Map<number, ParagraphInfo>();
      for (const p of paragraphs) paragraphsByIndex.set(p.index, p);
      const newEdits: StoredEdit[] = result.all_valid_ops.map((op, i) => {
        const id = `prop_${Date.now()}_${i}`;
        const created_at = new Date().toISOString();
        const targetParagraphIndex = targetIndexFor(op);
        const targetParagraph =
          targetParagraphIndex !== null ? paragraphsByIndex.get(targetParagraphIndex) : undefined;
        const opWithAnchor: DocumentEditOp = targetParagraph
          ? { ...op, anchor: computeAnchor(targetParagraph) }
          : op;
        const before_text = beforeTextForOp(opWithAnchor, paragraphs, originalByIndex);
        const before_value = beforeValueForOp(opWithAnchor, paragraphs);
        return {
          id,
          op: opWithAnchor,
          status: 'proposed',
          before_text,
          before_value,
          rationale: opWithAnchor.rationale,
          references_used: opWithAnchor.references_used,
          created_at,
        };
      });

      // Replace any prior proposed edits, keep accepted ones.
      const merged: StoredEdit[] = [
        ...doc.edits.filter((e) => e.status === 'accepted'),
        ...newEdits,
      ];

      const updated: DocumentRecord = {
        ...migrateDocumentEdits(doc),
        edits: merged,
        last_edit_model: result.model,
        total_tokens_in: doc.total_tokens_in + result.tokens_in,
        total_tokens_out: doc.total_tokens_out + result.tokens_out,
      };
      await db.documents.put(updated);
      if (newEdits.length === 0) {
        toast.info('No edits proposed — document looks clean.');
      } else {
        toast.success(
          `${newEdits.length} edit${newEdits.length === 1 ? '' : 's'} proposed (${result.tokens_in.toLocaleString()}+${result.tokens_out.toLocaleString()} tokens)`,
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.error('[DocumentDetail] edit request failed:', err);
      setRequestError(message);
      toast.error(`Cleanup request failed: ${message}`);
    } finally {
      setRunning(false);
      setChunkProgress(null);
    }
  }

  async function onAttachReference(file: File) {
    setAttachingRef(true);
    try {
      await attachDocumentReference(doc.id, file);
      toast.success(`${file.name} attached as reference`);
    } catch (err) {
      toast.error(
        `Attach failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setAttachingRef(false);
    }
  }

  async function onRemoveReference(fileId: string) {
    try {
      await removeDocumentReference(doc.id, fileId);
    } catch (err) {
      toast.error(
        `Remove failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async function onCleanupContextChange(
    patch: Parameters<typeof updateDocumentCleanupContext>[1],
  ) {
    try {
      await updateDocumentCleanupContext(doc.id, patch);
    } catch (err) {
      toast.error(
        `Update failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Item #5 — selection-driven targeted edit. Sends ONE LLM call
   * scoped to a small range of paragraphs (parsed from the user's
   * input), with the user's instruction as the dominant signal.
   * Result ops land in the same accept/reject queue as the chunked
   * pass.
   */
  async function onScopedEdit(instruction: string) {
    if (!apiKey) {
      toast.error('Connect on the Connection tab first.');
      return;
    }
    if (!paragraphs) {
      toast.error('Document is still parsing.');
      return;
    }
    if (scopedSelection.length === 0) {
      toast.error('No paragraph indices in the selection.');
      return;
    }
    setScopedRunning(true);
    try {
      const client = createLLMClient({ provider, baseUrl, apiKey });
      const result = await runScopedEdit(client, {
        all_paragraphs: paragraphs,
        selected_indices: scopedSelection,
        instruction,
      });
      // Build StoredEdits with anchors, same shape as the chunked
      // pass produces. Drop in next to existing proposed/accepted.
      const originalByIndex = new Map<number, string>();
      for (const p of paragraphs) originalByIndex.set(p.index, p.text);
      const paragraphsByIndex = new Map<number, ParagraphInfo>();
      for (const p of paragraphs) paragraphsByIndex.set(p.index, p);
      const newEdits: StoredEdit[] = result.ops.map((op, i) => {
        const id = `scoped_${Date.now()}_${i}`;
        const targetIdx = targetIndexFor(op);
        const targetParagraph =
          targetIdx !== null ? paragraphsByIndex.get(targetIdx) : undefined;
        const opWithAnchor: DocumentEditOp = targetParagraph
          ? { ...op, anchor: computeAnchor(targetParagraph) }
          : op;
        return {
          id,
          op: opWithAnchor,
          status: 'proposed',
          before_text: beforeTextForOp(opWithAnchor, paragraphs, originalByIndex),
          before_value: beforeValueForOp(opWithAnchor, paragraphs),
          rationale: opWithAnchor.rationale,
          references_used: opWithAnchor.references_used,
          created_at: new Date().toISOString(),
        };
      });
      const merged: StoredEdit[] = [...doc.edits, ...newEdits];
      const updated: DocumentRecord = {
        ...doc,
        edits: merged,
        last_edit_model: result.model,
        total_tokens_in: doc.total_tokens_in + result.tokens_in,
        total_tokens_out: doc.total_tokens_out + result.tokens_out,
      };
      await db.documents.put(updated);
      if (newEdits.length === 0) {
        toast.info('Scoped edit returned no changes — region looks clean.');
      } else {
        toast.success(
          `Scoped edit produced ${newEdits.length} proposed edit${newEdits.length === 1 ? '' : 's'}`,
        );
      }
      setScopedPopoverOpen(false);
      setScopedSelection([]);
      setScopedRangeText('');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`Scoped edit failed: ${message}`);
    } finally {
      setScopedRunning(false);
    }
  }

  /**
   * Parse a user-typed paragraph range like "37" or "37-42" or
   * "5,7,9" into an array of unique indices that exist in the
   * current paragraph list. Used by the targeted-fix entry point.
   */
  function parseRangeInput(input: string): number[] {
    if (!paragraphs) return [];
    const validIndices = new Set(paragraphs.map((p) => p.index));
    const out = new Set<number>();
    for (const part of input.split(/[,\s]+/).map((s) => s.trim()).filter((s) => s.length > 0)) {
      const dashMatch = part.match(/^(\d+)-(\d+)$/);
      if (dashMatch) {
        const start = Number(dashMatch[1]);
        const end = Number(dashMatch[2]);
        for (let i = Math.min(start, end); i <= Math.max(start, end); i++) {
          if (validIndices.has(i)) out.add(i);
        }
        continue;
      }
      const single = Number(part);
      if (Number.isFinite(single) && validIndices.has(single)) out.add(single);
    }
    return Array.from(out).sort((a, b) => a - b);
  }

  function onOpenScopedPopover() {
    const indices = parseRangeInput(scopedRangeText);
    if (indices.length === 0) {
      toast.error('Enter at least one valid paragraph index (e.g. "37" or "37-42" or "5,7,9").');
      return;
    }
    setScopedSelection(indices);
    setScopedPopoverOpen(true);
  }

  async function onSetStatus(id: string, status: StoredEdit['status']) {
    const updated: DocumentRecord = {
      ...doc,
      edits: doc.edits.map((e) => (e.id === id ? { ...e, status } : e)),
    };
    await db.documents.put(updated);
  }

  async function onAcceptAll() {
    const proposedCount = doc.edits.filter((e) => e.status === 'proposed').length;
    const updated: DocumentRecord = {
      ...doc,
      edits: doc.edits.map((e) => (e.status === 'proposed' ? { ...e, status: 'accepted' } : e)),
    };
    await db.documents.put(updated);
    if (proposedCount > 0) toast.success(`Accepted ${proposedCount} edit${proposedCount === 1 ? '' : 's'}`);
  }

  async function onRejectAll() {
    const proposedCount = doc.edits.filter((e) => e.status === 'proposed').length;
    const updated: DocumentRecord = {
      ...doc,
      edits: doc.edits.filter((e) => e.status !== 'proposed'),
    };
    await db.documents.put(updated);
    if (proposedCount > 0) toast.info(`Rejected ${proposedCount} proposed edit${proposedCount === 1 ? '' : 's'}`);
  }

  async function onExport() {
    setExportInfo(null);
    // eslint-disable-next-line no-console
    console.info(`[DocumentDetail] exporting ${doc.id} with ${accepted.length} accepted edits`);
    try {
      const ops: DocumentEditOp[] = accepted.map((e) => e.op);
      const result = await applyDocumentEdits(doc.docx_bytes, ops);

      const filename = `${doc.name.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}_cleaned.docx`;
      triggerDownload(result.blob, filename);
      const succeeded = result.applied.filter((a) => a.success).length;
      const failed = result.applied.filter((a) => !a.success);
      const summary =
        `Exported ${succeeded} edit${succeeded === 1 ? '' : 's'}` +
        (failed.length > 0 ? `; ${failed.length} failed: ${failed.map((f) => f.error).join('; ')}` : '');
      setExportInfo(summary);
      if (failed.length === 0) toast.success(`Exported ${filename}`);
      else toast.error(`Exported with ${failed.length} failed edit${failed.length === 1 ? '' : 's'}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setExportInfo(`Export failed: ${message}`);
      toast.error(`Export failed: ${message}`);
    }
  }

  return (
    <section style={{ marginTop: '1.5rem', borderTop: '1px solid #ddd', paddingTop: '1rem' }}>
      <h2>{doc.name}</h2>
      <p className="note">
        {doc.filename} · {significantParagraphCount} paragraphs · ingested{' '}
        {new Date(doc.ingested_at).toLocaleString()}
      </p>

      <h3>Document preview</h3>
      <PreviewTabs
        doc={doc}
        paragraphs={paragraphs}
        headerParts={headerParts}
        footerParts={footerParts}
        parseError={parseError}
      />
      {parseError && <div className="error">Preview parse failed: {parseError}</div>}

      <h3>Cleanup pass</h3>

      <CleanupContextPanel
        onAskSage={onAskSage}
        dataset={cleanupDataset}
        live={cleanupLive}
        limit={cleanupLimit}
        referenceFiles={referenceFiles}
        attaching={attachingRef}
        disabled={running}
        onChange={onCleanupContextChange}
        onAttach={onAttachReference}
        onRemove={onRemoveReference}
      />

      <div
        style={{
          background: '#f6f6fa',
          border: '1px solid #ddd',
          borderRadius: 6,
          padding: '0.5rem 0.75rem',
          marginBottom: '0.5rem',
          fontSize: 12,
          color: '#444',
        }}
      >
        <strong>Estimated cost</strong>{' '}
        <span className="note">
          ({significantParagraphCount} paragraphs ·{' '}
          {cleanupModelOverride ?? 'default model'})
        </span>
        <div style={{ marginTop: '0.25rem' }}>
          ~{formatTokens(cleanupEstimate.tokens_in)} in /{' '}
          ~{formatTokens(cleanupEstimate.tokens_out)} out ·{' '}
          ~{formatTokens(cleanupEstimate.tokens_total)} total
          {cost.usd_per_1k_in + cost.usd_per_1k_out > 0 && (
            <> · {formatUsd(cleanupEstimate.usd_total)}</>
          )}
        </div>
        <div className="note" style={{ marginTop: '0.25rem' }}>
          Tune assumptions on the <a href="#/settings">Settings</a> tab.
        </div>
      </div>
      <form onSubmit={onRequestEdits}>
        <label htmlFor="cleanup-instruction">Instruction</label>
        <textarea
          id="cleanup-instruction"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          rows={3}
          style={{
            width: '100%',
            padding: '0.5rem',
            font: 'inherit',
            fontFamily: 'inherit',
            border: '1px solid #ccc',
            borderRadius: 4,
          }}
          disabled={running || !apiKey}
        />
        <p className="note">
          Examples: <em>"Fix typos and grammar only"</em> · <em>"Tighten the
          language and remove redundant phrases"</em> · <em>"Make the tone more
          formal and consistent"</em> · <em>"Convert active voice to passive
          voice for the procedure section"</em>
        </p>

        <details style={{ marginTop: '0.5rem' }}>
          <summary className="note" style={{ cursor: 'pointer' }}>
            Advanced cleanup options
          </summary>
          <div className="row" style={{ marginTop: '0.4rem', flexWrap: 'wrap', gap: '0.6rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 400, fontSize: 12 }}>
              <input
                type="checkbox"
                checked={usePrepass}
                onChange={(e) => setUsePrepass(e.target.checked)}
                style={{ width: 'auto' }}
                disabled={running}
              />
              Use pre-pass (identify problem paragraphs first, then narrow the fix pass)
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 400, fontSize: 12 }}>
              Chunk concurrency:
              <select
                value={chunkConcurrency}
                onChange={(e) => setChunkConcurrency(Number(e.target.value))}
                style={{ flex: '0 0 5rem' }}
                disabled={running}
              >
                <option value="1">1 (sequential)</option>
                <option value="2">2</option>
                <option value="3">3 (default)</option>
                <option value="5">5</option>
              </select>
            </label>
          </div>
          <p className="note" style={{ marginTop: '0.3rem' }}>
            Pre-pass adds one cheap LLM call per chunk to identify which paragraphs need editing, then narrows the fix pass to those plus a small neighbor window. Total tokens are usually lower than the single-pass approach because the fix pass has less to read. Concurrency controls how many chunks process in parallel.
          </p>
        </details>

        <details style={{ marginTop: '0.5rem' }}>
          <summary className="note" style={{ cursor: 'pointer' }}>
            Targeted fix (one-shot edit on a specific paragraph range)
          </summary>
          <div className="row" style={{ marginTop: '0.4rem', gap: '0.4rem', alignItems: 'center' }}>
            <input
              type="text"
              value={scopedRangeText}
              onChange={(e) => setScopedRangeText(e.target.value)}
              placeholder='e.g. "37" or "37-42" or "5,7,9"'
              style={{ flex: 1, minWidth: 200 }}
              disabled={scopedRunning || running || !apiKey}
            />
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={onOpenScopedPopover}
              disabled={scopedRunning || running || !apiKey || !paragraphs}
            >
              fix this region…
            </button>
          </div>
          <p className="note" style={{ marginTop: '0.3rem' }}>
            Cheaper and faster than the full cleanup pass. The system sends just the selected paragraphs (plus a small context window) to the LLM with a one-line instruction you provide. Result lands in the same accept/reject queue below.
          </p>
        </details>

        <button type="submit" disabled={running || !apiKey}>
          {running ? (
            <Spinner
              light
              label={
                chunkProgress
                  ? `Cleaning chunk ${chunkProgress.done}/${chunkProgress.total}…`
                  : 'Asking the LLM…'
              }
            />
          ) : (
            'Request cleanup edits'
          )}
        </button>
      </form>
      {requestError && <div className="error">Request failed: {requestError}</div>}

      {scopedPopoverOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.2)',
            zIndex: 100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={(e) => {
            // Click outside the popover dismisses
            if (e.target === e.currentTarget) {
              setScopedPopoverOpen(false);
            }
          }}
        >
          <div onClick={(e) => e.stopPropagation()}>
            <SelectionPopover
              anchorTop={0}
              anchorLeft={0}
              selectedIndices={scopedSelection}
              onSubmit={(instr) => void onScopedEdit(instr)}
              onCancel={() => setScopedPopoverOpen(false)}
              loading={scopedRunning}
            />
          </div>
        </div>
      )}

      <h3>
        Proposed edits ({proposed.length}) · Accepted ({accepted.length})
      </h3>
      {proposed.length === 0 && accepted.length === 0 && (
        <p className="note">No edits yet. Click "Request cleanup edits" above.</p>
      )}
      {proposed.length > 0 && (
        <div className="btn-row" style={{ marginBottom: '0.75rem' }}>
          <button type="button" className="btn-success" onClick={onAcceptAll}>
            Accept all proposed
          </button>
          <button type="button" className="btn-secondary" onClick={onRejectAll}>
            Reject all proposed
          </button>
        </div>
      )}

      {[...proposed, ...accepted]
        .sort((a, b) => editAnchorIndex(a) - editAnchorIndex(b))
        .map((e) => (
          <EditCard
            key={e.id}
            edit={e}
            onSetStatus={onSetStatus}
            anchorId={`edit-${editAnchorIndex(e)}`}
          />
        ))}

      <h3>Export</h3>
      <button type="button" onClick={onExport} disabled={accepted.length === 0}>
        Export cleaned DOCX ({accepted.length} edit{accepted.length === 1 ? '' : 's'} applied)
      </button>
      {exportInfo && <p className="note">{exportInfo}</p>}
      <p className="note">
        The original document is never overwritten. The exported file is a
        clone with only the accepted edits spliced into the body. All
        formatting (page setup, styles, numbering, headers/footers, content
        controls) is preserved unchanged.
      </p>
    </section>
  );
}

// ─── Cleanup context panel (dataset / web / reference files) ──────

interface CleanupContextPanelProps {
  onAskSage: boolean;
  dataset: string;
  live: 0 | 1 | 2;
  limit: number;
  referenceFiles: ProjectContextFile[];
  attaching: boolean;
  disabled: boolean;
  onChange: (
    patch: Partial<{
      cleanup_dataset_name: string;
      cleanup_live_search: 0 | 1 | 2;
      cleanup_limit_references: number;
    }>,
  ) => void;
  onAttach: (file: File) => void;
  onRemove: (fileId: string) => void;
}

function CleanupContextPanel(props: CleanupContextPanelProps) {
  const {
    onAskSage,
    dataset,
    live,
    limit,
    referenceFiles,
    attaching,
    disabled,
    onChange,
    onAttach,
    onRemove,
  } = props;
  const [open, setOpen] = useState(referenceFiles.length > 0 || dataset !== '' || live !== 0);

  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      style={{
        marginBottom: '0.75rem',
        border: '1px solid #ddd',
        borderRadius: 6,
        padding: '0.5rem 0.75rem',
        background: '#fafafa',
      }}
    >
      <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
        Context (optional) — RAG dataset · web search · reference files
        {(dataset || live || referenceFiles.length > 0) && (
          <span className="note" style={{ marginLeft: '0.5rem' }}>
            ·{' '}
            {[
              dataset ? `dataset=${dataset}` : null,
              live ? `live=${live}` : null,
              referenceFiles.length > 0
                ? `${referenceFiles.length} reference file${referenceFiles.length === 1 ? '' : 's'}`
                : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        )}
      </summary>

      <p className="note" style={{ marginTop: '0.5rem' }}>
        Anything you set here is sent with every chunk of the document during the
        cleanup pass and used as authoritative grounding context. Reference files
        are uploaded to Ask Sage's <code>/server/file</code> extractor at edit
        time and inlined into the prompt.
      </p>

      {!onAskSage && (
        <div className="note" style={{ marginBottom: '0.5rem' }}>
          You're connected via OpenRouter. RAG datasets and reference-file
          extraction are Ask-Sage-only. Switch providers on the{' '}
          <Link to="/">Connection</Link> tab to use grounding context.
        </div>
      )}

      {onAskSage && (
        <>
          <div style={{ display: 'grid', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <div>
              <label htmlFor="cleanup-dataset" style={{ fontSize: 12 }}>
                Ask Sage RAG dataset
              </label>
              <input
                id="cleanup-dataset"
                type="text"
                value={dataset}
                placeholder="dataset name (leave blank for none)"
                disabled={disabled}
                onChange={(e) =>
                  onChange({ cleanup_dataset_name: e.target.value.trim() })
                }
                style={{
                  width: '100%',
                  padding: '0.4rem',
                  font: 'inherit',
                  border: '1px solid #ccc',
                  borderRadius: 4,
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <div style={{ flex: 1 }}>
                <label htmlFor="cleanup-live" style={{ fontSize: 12 }}>
                  Web search
                </label>
                <select
                  id="cleanup-live"
                  value={live}
                  disabled={disabled}
                  onChange={(e) =>
                    onChange({
                      cleanup_live_search: Number(e.target.value) as 0 | 1 | 2,
                    })
                  }
                  style={{
                    width: '100%',
                    padding: '0.4rem',
                    font: 'inherit',
                  }}
                >
                  <option value={0}>Off</option>
                  <option value={1}>Google results</option>
                  <option value={2}>Google + crawl</option>
                </select>
              </div>
              <div style={{ width: 140 }}>
                <label htmlFor="cleanup-limit" style={{ fontSize: 12 }}>
                  RAG refs cap
                </label>
                <input
                  id="cleanup-limit"
                  type="number"
                  min={0}
                  max={20}
                  value={limit}
                  disabled={disabled || !dataset}
                  onChange={(e) =>
                    onChange({
                      cleanup_limit_references: Math.max(
                        0,
                        Math.min(20, Number(e.target.value) || 0),
                      ),
                    })
                  }
                  style={{
                    width: '100%',
                    padding: '0.4rem',
                    font: 'inherit',
                    border: '1px solid #ccc',
                    borderRadius: 4,
                  }}
                />
              </div>
            </div>
          </div>

          <div style={{ marginTop: '0.5rem' }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: '0.25rem' }}>
              Reference files ({referenceFiles.length})
            </div>
            <DropZone
              accept=".pdf,.docx,.txt,.md,.csv"
              onFile={onAttach}
              disabled={disabled || attaching}
              label={attaching ? 'Uploading…' : 'Drop a reference file here, or click to choose'}
              hint="PDF / DOCX / TXT / MD / CSV. Re-extracted via /server/file on every cleanup run."
            />
            {referenceFiles.length > 0 && (
              <ul style={{ listStyle: 'none', padding: 0, marginTop: '0.4rem' }}>
                {referenceFiles.map((f) => (
                  <li
                    key={f.id}
                    style={{
                      padding: '0.3rem 0.5rem',
                      border: '1px solid #ddd',
                      borderRadius: 4,
                      marginBottom: '0.2rem',
                      background: '#fff',
                      display: 'flex',
                      alignItems: 'center',
                      fontSize: 12,
                    }}
                  >
                    <span>{f.filename}</span>
                    <span className="note" style={{ marginLeft: '0.5rem' }}>
                      {(f.size_bytes / 1024).toFixed(1)} KB
                    </span>
                    <button
                      type="button"
                      className="btn-danger btn-sm"
                      style={{ marginLeft: 'auto' }}
                      disabled={disabled}
                      onClick={() => onRemove(f.id)}
                    >
                      remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </details>
  );
}

// ─── Edit op helpers ──────────────────────────────────────────────

/**
 * Returns the body paragraph index this edit applies to, or null if
 * the edit operates on a non-paragraph element (table cell, content
 * control). Used for highlighting paragraphs in the document preview.
 */
function paragraphAnchorOf(edit: StoredEdit): number | null {
  return targetIndexFor(edit.op);
}

/**
 * Returns the absolute paragraph index a document edit op targets,
 * or null if the op targets a non-paragraph element (table cell,
 * content control). Used both for the inline preview anchor and for
 * stamping a content-based anchor at op-creation time.
 */
function targetIndexFor(op: DocumentEditOp): number | null {
  switch (op.op) {
    case 'replace_paragraph_text':
    case 'set_paragraph_style':
    case 'set_paragraph_alignment':
    case 'delete_paragraph':
    case 'insert_paragraph_after':
    case 'merge_paragraphs':
    case 'split_paragraph':
      return op.index;
    case 'replace_run_text':
    case 'set_run_property':
    case 'set_run_font':
    case 'set_run_color':
    case 'set_paragraph_indent':
    case 'set_paragraph_spacing':
      return op.paragraph_index;
    default:
      return null;
  }
}

/**
 * Anchor paragraph index for an edit, used for sort order in the UI
 * and to scroll the document preview to the right paragraph. Ops that
 * don't have a natural paragraph anchor (table cell, content control)
 * use a high sentinel index so they sort to the end.
 */
function editAnchorIndex(edit: StoredEdit): number {
  const op = edit.op;
  switch (op.op) {
    case 'replace_paragraph_text':
    case 'set_paragraph_style':
    case 'set_paragraph_alignment':
    case 'delete_paragraph':
    case 'insert_paragraph_after':
    case 'merge_paragraphs':
    case 'split_paragraph':
      return op.index;
    case 'replace_run_text':
    case 'set_run_property':
    case 'set_run_font':
    case 'set_run_color':
    case 'set_paragraph_indent':
    case 'set_paragraph_spacing':
      return op.paragraph_index;
    case 'set_cell_text':
      return 1_000_000 + op.table_index * 1000 + op.row_index * 10 + op.cell_index;
    case 'insert_table_row':
    case 'delete_table_row':
      return 1_000_000 + op.table_index * 1000;
    case 'set_content_control_value':
      return 2_000_000;
    default:
      return Number.MAX_SAFE_INTEGER;
  }
}

/**
 * Capture the original text BEFORE an op is applied, for use in the
 * diff card. Only meaningful for text-replacement ops.
 */
function beforeTextForOp(
  op: DocumentEditOp,
  paragraphs: ParagraphInfo[],
  originalByIndex: Map<number, string>,
): string | undefined {
  switch (op.op) {
    case 'replace_paragraph_text':
      return originalByIndex.get(op.index) ?? '';
    case 'replace_run_text': {
      const p = paragraphs.find((x) => x.index === op.paragraph_index);
      const r = p?.runs[op.run_index];
      return r?.text ?? '';
    }
    default:
      return undefined;
  }
}

/**
 * Capture the original toggle value for set_run_property ops so the
 * diff card can show "was on, becoming off" etc.
 */
function beforeValueForOp(
  op: DocumentEditOp,
  paragraphs: ParagraphInfo[],
): boolean | undefined {
  if (op.op !== 'set_run_property') return undefined;
  const p = paragraphs.find((x) => x.index === op.paragraph_index);
  const r = p?.runs[op.run_index];
  if (!r) return undefined;
  switch (op.property) {
    case 'bold':
      return r.bold;
    case 'italic':
      return r.italic;
    case 'underline':
      return r.underline;
    case 'strike':
      return r.strike;
  }
}

/**
 * Short, human-friendly title for an op shown in the EditCard header.
 */
function editTitle(edit: StoredEdit): string {
  const op = edit.op;
  switch (op.op) {
    case 'replace_paragraph_text':
      return `Paragraph #${op.index} — replace text`;
    case 'replace_run_text':
      return `Paragraph #${op.paragraph_index} run #${op.run_index} — replace text`;
    case 'set_run_property':
      return `Paragraph #${op.paragraph_index} run #${op.run_index} — set ${op.property} ${op.value ? 'on' : 'off'}`;
    case 'set_cell_text':
      return `Table ${op.table_index} row ${op.row_index} cell ${op.cell_index} — replace text`;
    case 'insert_table_row':
      return `Table ${op.table_index} — insert row after row ${op.after_row_index}`;
    case 'delete_table_row':
      return `Table ${op.table_index} — delete row ${op.row_index}`;
    case 'set_content_control_value':
      return `Content control [${op.tag}] — set value`;
    case 'set_paragraph_style':
      return `Paragraph #${op.index} — set style to "${op.style_id}"`;
    case 'set_paragraph_alignment':
      return `Paragraph #${op.index} — set alignment to ${op.alignment}`;
    case 'delete_paragraph':
      return `Paragraph #${op.index} — delete`;
    case 'insert_paragraph_after':
      return `Paragraph #${op.index} — insert new paragraph after`;
    case 'merge_paragraphs':
      return `Paragraph #${op.index} — merge with #${op.index + 1}`;
    case 'split_paragraph':
      return `Paragraph #${op.index} — split at "${op.split_at_text.slice(0, 30)}${op.split_at_text.length > 30 ? '…' : ''}"`;
    case 'set_paragraph_indent':
      return `Paragraph #${op.paragraph_index} — set indent`;
    case 'set_paragraph_spacing':
      return `Paragraph #${op.paragraph_index} — set spacing`;
    case 'set_run_font':
      return `Paragraph #${op.paragraph_index} run #${op.run_index} — set font${op.family ? ` ${op.family}` : ''}${op.size_pt ? ` ${op.size_pt}pt` : ''}`;
    case 'set_run_color':
      return `Paragraph #${op.paragraph_index} run #${op.run_index} — set color${op.color ? ` #${op.color}` : ' (clear)'}`;
  }
}

function EditCard({
  edit,
  onSetStatus,
  anchorId,
}: {
  edit: StoredEdit;
  onSetStatus: (id: string, status: StoredEdit['status']) => void;
  anchorId?: string;
}) {
  const isAccepted = edit.status === 'accepted';
  const borderColor = isAccepted ? '#0a0' : '#d4a000';
  const bg = isAccepted ? '#f0fff0' : '#fff8e0';

  return (
    <div
      id={anchorId}
      style={{
        marginBottom: '0.5rem',
        padding: '0.5rem 0.75rem',
        border: `1px solid #ccd`,
        borderLeft: `4px solid ${borderColor}`,
        background: bg,
        borderRadius: 4,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
        <strong style={{ fontSize: 12 }}>{editTitle(edit)}</strong>
        <span
          style={{
            fontSize: 11,
            padding: '0 0.4rem',
            background: borderColor,
            color: '#fff',
            borderRadius: 3,
          }}
        >
          {edit.status}
        </span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: '0.25rem' }}>
          {edit.status === 'proposed' && (
            <>
              <button
                type="button"
                className="btn-success btn-sm"
                onClick={() => onSetStatus(edit.id, 'accepted')}
              >
                accept
              </button>
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => onSetStatus(edit.id, 'rejected')}
              >
                reject
              </button>
            </>
          )}
          {edit.status === 'accepted' && (
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => onSetStatus(edit.id, 'proposed')}
            >
              unaccept
            </button>
          )}
        </span>
      </div>
      <EditBody edit={edit} />
      {edit.rationale && (
        <p className="note" style={{ marginTop: '0.4rem' }}>
          <em>{edit.rationale}</em>
        </p>
      )}
      {edit.references_used && edit.references_used.length > 0 && (
        <CitationList citations={edit.references_used} />
      )}
    </div>
  );
}

/**
 * Render the citations the LLM emitted alongside an edit. Each
 * citation is a small chip showing the source filename + an
 * expandable verbatim excerpt + the model's one-line rationale.
 * Citations are advisory — they're spot-checks for the user, not a
 * load-bearing trust mechanism.
 */
function CitationList({ citations }: { citations: NonNullable<StoredEdit['references_used']> }) {
  return (
    <div style={{ marginTop: '0.4rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
      {citations.map((c, i) => (
        <details
          key={i}
          style={{
            background: 'var(--color-surface-alt)',
            border: '1px solid var(--color-border)',
            borderLeft: '3px solid var(--color-primary)',
            borderRadius: 'var(--radius-sm)',
            padding: '0.3rem 0.5rem',
            fontSize: 11,
          }}
        >
          <summary style={{ cursor: 'pointer' }}>
            📎 cited from <strong>{c.source_filename}</strong>
            {c.rationale && (
              <span style={{ color: 'var(--color-text-muted)', marginLeft: '0.5rem' }}>
                — {c.rationale}
              </span>
            )}
          </summary>
          <pre
            style={{
              marginTop: '0.4rem',
              padding: '0.4rem 0.6rem',
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              maxHeight: 120,
              overflow: 'auto',
            }}
          >
            {c.excerpt}
          </pre>
        </details>
      ))}
    </div>
  );
}

/**
 * Body of an edit card — switches on op kind to render the most
 * useful representation. Text-replacement ops show a side-by-side
 * diff. Property toggles show old → new value. Structural ops show a
 * one-line description.
 */
function EditBody({ edit }: { edit: StoredEdit }) {
  const op = edit.op;
  switch (op.op) {
    case 'replace_paragraph_text':
    case 'replace_run_text':
      return <DiffView before={edit.before_text ?? ''} after={op.new_text} />;
    case 'set_cell_text':
      return <DiffView before={edit.before_text ?? '(unknown)'} after={op.new_text} />;
    case 'set_content_control_value':
      return <DiffView before={edit.before_text ?? '(unknown)'} after={op.value} />;
    case 'set_run_property': {
      const before = edit.before_value === undefined ? '?' : edit.before_value ? 'on' : 'off';
      const after = op.value ? 'on' : 'off';
      return (
        <div style={{ marginTop: '0.4rem', fontSize: 12 }}>
          <strong>{op.property}</strong>: <code>{before}</code> →{' '}
          <code style={{ color: op.value ? '#060' : '#666' }}>{after}</code>
        </div>
      );
    }
    case 'set_paragraph_style':
      return (
        <div style={{ marginTop: '0.4rem', fontSize: 12 }}>
          New style id: <code>{op.style_id}</code>
        </div>
      );
    case 'set_paragraph_alignment':
      return (
        <div style={{ marginTop: '0.4rem', fontSize: 12 }}>
          New alignment: <code>{op.alignment}</code>
        </div>
      );
    case 'delete_paragraph':
      return (
        <div style={{ marginTop: '0.4rem', fontSize: 12, color: '#900' }}>
          Will be removed from the document body.
        </div>
      );
    case 'insert_table_row':
      return (
        <div style={{ marginTop: '0.4rem', fontSize: 12 }}>
          New cells: <code>{op.cells.map((c) => `"${c}"`).join(', ')}</code>
        </div>
      );
    case 'delete_table_row':
      return (
        <div style={{ marginTop: '0.4rem', fontSize: 12, color: '#900' }}>
          Will remove row {op.row_index} from table {op.table_index}.
        </div>
      );
    case 'insert_paragraph_after':
      return (
        <div style={{ marginTop: '0.4rem', fontSize: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: '#666' }}>NEW PARAGRAPH</div>
          <div style={{ background: '#efe', padding: '0.4rem', border: '1px solid #cfc', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {op.new_text}
          </div>
          {op.style_id && (
            <div className="note" style={{ marginTop: '0.25rem' }}>
              Style: <code>{op.style_id}</code>
            </div>
          )}
        </div>
      );
    case 'merge_paragraphs':
      return (
        <div style={{ marginTop: '0.4rem', fontSize: 12 }}>
          Merge paragraph #{op.index} with paragraph #{op.index + 1}.
          {op.separator !== undefined && (
            <> Separator: <code>{op.separator === '' ? '(none)' : `"${op.separator}"`}</code></>
          )}
        </div>
      );
    case 'split_paragraph':
      return (
        <div style={{ marginTop: '0.4rem', fontSize: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: '#666' }}>SPLIT AT</div>
          <div style={{ background: '#f4f4f4', padding: '0.4rem', border: '1px solid #ddd', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'var(--font-mono)' }}>
            {op.split_at_text}
          </div>
        </div>
      );
    case 'set_paragraph_indent':
      return (
        <div style={{ marginTop: '0.4rem', fontSize: 12 }}>
          {op.left_twips !== undefined && (
            <div>left: <code>{op.left_twips === null ? '(clear)' : `${op.left_twips} twips (${(op.left_twips / 1440).toFixed(2)}")`}</code></div>
          )}
          {op.first_line_twips !== undefined && (
            <div>first line: <code>{op.first_line_twips === null ? '(clear)' : `${op.first_line_twips} twips`}</code></div>
          )}
          {op.hanging_twips !== undefined && (
            <div>hanging: <code>{op.hanging_twips === null ? '(clear)' : `${op.hanging_twips} twips`}</code></div>
          )}
        </div>
      );
    case 'set_paragraph_spacing':
      return (
        <div style={{ marginTop: '0.4rem', fontSize: 12 }}>
          {op.before_twips !== undefined && (
            <div>before: <code>{op.before_twips === null ? '(clear)' : `${op.before_twips} twips`}</code></div>
          )}
          {op.after_twips !== undefined && (
            <div>after: <code>{op.after_twips === null ? '(clear)' : `${op.after_twips} twips`}</code></div>
          )}
          {op.line_value !== undefined && (
            <div>line: <code>{op.line_value === null ? '(clear)' : `${op.line_value}${op.line_rule ? ` (${op.line_rule})` : ''}`}</code></div>
          )}
        </div>
      );
    case 'set_run_font':
      return (
        <div style={{ marginTop: '0.4rem', fontSize: 12 }}>
          {op.family !== undefined && (
            <div>family: <code>{op.family === null ? '(clear)' : op.family}</code></div>
          )}
          {op.size_pt !== undefined && (
            <div>size: <code>{op.size_pt === null ? '(clear)' : `${op.size_pt}pt`}</code></div>
          )}
        </div>
      );
    case 'set_run_color':
      return (
        <div style={{ marginTop: '0.4rem', fontSize: 12 }}>
          {op.color !== undefined && (
            <div>
              color:{' '}
              {op.color === null ? (
                <code>(clear)</code>
              ) : (
                <span>
                  <code>#{op.color.replace(/^#/, '')}</code>{' '}
                  <span style={{ display: 'inline-block', width: 12, height: 12, background: `#${op.color.replace(/^#/, '')}`, border: '1px solid #999', verticalAlign: 'middle' }} />
                </span>
              )}
            </div>
          )}
          {op.highlight !== undefined && (
            <div>highlight: <code>{op.highlight === null ? '(clear)' : op.highlight}</code></div>
          )}
        </div>
      );
    default: {
      const _exhaustive: never = op;
      return <div>{JSON.stringify(_exhaustive)}</div>;
    }
  }
}

function DiffView({ before, after }: { before: string; after: string }) {
  return (
    <div style={{ marginTop: '0.4rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', fontSize: 12 }}>
      <div>
        <div style={{ fontSize: 10, fontWeight: 600, color: '#666' }}>BEFORE</div>
        <div style={{ background: '#fee', padding: '0.4rem', border: '1px solid #fcc', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {before}
        </div>
      </div>
      <div>
        <div style={{ fontSize: 10, fontWeight: 600, color: '#666' }}>AFTER</div>
        <div style={{ background: '#efe', padding: '0.4rem', border: '1px solid #cfc', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {after}
        </div>
      </div>
    </div>
  );
}

// ─── Preview tabs ─────────────────────────────────────────────────
//
// Two view modes:
//   Visual    — high-fidelity render via docx-preview. Read-only,
//               looks like Word, includes tables/headers/footers/
//               images/page setup.
//   Editable  — our data-driven render. Lower fidelity but every
//               paragraph is clickable and edit-aware (proposed/
//               accepted highlights, click-to-scroll).
//
// The user defaults to Visual because that's the "looks like the
// real document" experience. They switch to Editable when they want
// to navigate edits paragraph-by-paragraph.

function PreviewTabs({
  doc,
  paragraphs,
  headerParts,
  footerParts,
  parseError,
}: {
  doc: DocumentRecord;
  paragraphs: ParagraphInfo[] | null;
  headerParts: HeaderFooterPartContent[];
  footerParts: HeaderFooterPartContent[];
  parseError: string | null;
}) {
  const [tab, setTab] = useState<'visual' | 'diff' | 'editable'>('visual');
  const [diffMode, setDiffMode] = useState<DocxDiffPreviewMode>('with_accepted');

  return (
    <div>
      <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => setTab('visual')}
          style={{
            margin: 0,
            padding: '0.35rem 0.75rem',
            background: tab === 'visual' ? '#2050a0' : '#ddd',
            color: tab === 'visual' ? '#fff' : '#333',
            borderColor: tab === 'visual' ? '#2050a0' : '#bbb',
            fontWeight: 600,
            fontSize: 12,
          }}
        >
          Visual
        </button>
        <button
          type="button"
          onClick={() => setTab('diff')}
          style={{
            margin: 0,
            padding: '0.35rem 0.75rem',
            background: tab === 'diff' ? '#2050a0' : '#ddd',
            color: tab === 'diff' ? '#fff' : '#333',
            borderColor: tab === 'diff' ? '#2050a0' : '#bbb',
            fontWeight: 600,
            fontSize: 12,
          }}
        >
          Diff preview
        </button>
        <button
          type="button"
          onClick={() => setTab('editable')}
          style={{
            margin: 0,
            padding: '0.35rem 0.75rem',
            background: tab === 'editable' ? '#2050a0' : '#ddd',
            color: tab === 'editable' ? '#fff' : '#333',
            borderColor: tab === 'editable' ? '#2050a0' : '#bbb',
            fontWeight: 600,
            fontSize: 12,
          }}
        >
          Editable
        </button>
      </div>
      <p className="note" style={{ marginTop: 0 }}>
        {tab === 'visual' &&
          'High-fidelity render via docx-preview. Read-only — switch to Diff preview to see proposed edits applied.'}
        {tab === 'diff' &&
          'Speculative render with the LLM-proposed edits applied. Toggle the mode below to compare against the original or to see inline insert/delete coloring.'}
        {tab === 'editable' &&
          'Data-driven render of parsed paragraphs. Lower fidelity but every paragraph is clickable. Accepted edits show the new text in green; proposed edits show the original text in amber.'}
      </p>
      {tab === 'visual' && <VisualPreview doc={doc} />}
      {tab === 'diff' && (
        <div>
          <div className="row" style={{ marginBottom: '0.5rem', gap: '0.4rem' }}>
            <label style={{ fontSize: 12, fontWeight: 600 }}>Mode:</label>
            <select
              value={diffMode}
              onChange={(e) => setDiffMode(e.target.value as DocxDiffPreviewMode)}
              style={{ flex: '0 0 18rem' }}
            >
              <option value="original">Original (no edits)</option>
              <option value="with_accepted">With accepted edits</option>
              <option value="diff_overlay">Diff overlay (accepted + proposed, colorized)</option>
            </select>
          </div>
          <DocxDiffPreview document={doc} edits={doc.edits} mode={diffMode} />
        </div>
      )}
      {tab === 'editable' && (
        <>
          {!paragraphs && !parseError && <p className="note">Parsing for preview…</p>}
          {paragraphs && (
            <DocumentPreview
              paragraphs={paragraphs}
              headerParts={headerParts}
              footerParts={footerParts}
              edits={doc.edits}
            />
          )}
        </>
      )}
    </div>
  );
}

function VisualPreview({ doc }: { doc: DocumentRecord }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container) return;
    container.innerHTML = '';
    setError(null);
    setRendering(true);
    // eslint-disable-next-line no-console
    console.info(`[VisualPreview] rendering ${doc.id} via docx-preview`);
    renderDocxAsync(doc.docx_bytes, container, undefined, {
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
        // eslint-disable-next-line no-console
        console.info(`[VisualPreview] render complete for ${doc.id}`);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        setRendering(false);
        // eslint-disable-next-line no-console
        console.error('[VisualPreview] render failed:', err);
      });
    return () => {
      cancelled = true;
    };
  }, [doc.id, doc.docx_bytes]);

  return (
    <div>
      {rendering && <p className="note">Rendering with docx-preview…</p>}
      {error && (
        <div className="error">
          Visual render failed: {error}
          {'\n\n'}
          Switch to Editable to use the data-driven preview instead.
        </div>
      )}
      <div
        ref={containerRef}
        style={{
          background: '#f5f5f5',
          border: '1px solid #ccc',
          borderRadius: 4,
          padding: '1rem',
          marginBottom: '1rem',
          maxHeight: '70vh',
          overflow: 'auto',
        }}
      />
    </div>
  );
}

// ─── Document preview rendering (data-driven, edit-aware) ─────────
//
// Approximates how the parsed DOCX would look in Word, using the
// per-paragraph properties the parser already extracts (style_name,
// alignment, indent_left_twips, bold, italic, numbering, table). Not
// pixel-perfect — the goal is "readable approximation" so the user can
// see what the document actually contains while reviewing edits.

function DocumentPreview({
  paragraphs,
  headerParts,
  footerParts,
  edits,
}: {
  paragraphs: ParagraphInfo[];
  headerParts: HeaderFooterPartContent[];
  footerParts: HeaderFooterPartContent[];
  edits: StoredEdit[];
}) {
  // Group edits by their anchor paragraph index for the inline preview
  // highlights. Only edits anchored to a specific body paragraph
  // (text replacements, run edits, paragraph structural ops) get
  // highlighted; table/sdt ops are addressed elsewhere.
  const editsByIndex = new Map<number, StoredEdit>();
  for (const e of edits) {
    const idx = paragraphAnchorOf(e);
    if (idx !== null) editsByIndex.set(idx, e);
  }

  function scrollToEdit(index: number) {
    const el = document.getElementById(`edit-${index}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #ccc',
        borderRadius: 4,
        padding: '1.5rem 2rem',
        marginBottom: '1rem',
        maxHeight: '70vh',
        overflow: 'auto',
        fontFamily: '"Times New Roman", Cambria, Georgia, serif',
        fontSize: 14,
        lineHeight: 1.5,
        color: '#1a1a1a',
      }}
    >
      {headerParts.map((hp) => (
        <PartBlock
          key={hp.part}
          label={`HEADER · ${hp.label}`}
          accentColor="#5566aa"
          paragraphs={hp.paragraphs}
        />
      ))}

      {paragraphs.map((p) => (
        <PreviewParagraph
          key={p.index}
          paragraph={p}
          edit={editsByIndex.get(p.index)}
          onClick={() => scrollToEdit(p.index)}
        />
      ))}

      {footerParts.map((fp) => (
        <PartBlock
          key={fp.part}
          label={`FOOTER · ${fp.label}`}
          accentColor="#666"
          paragraphs={fp.paragraphs}
        />
      ))}
    </div>
  );
}

function PartBlock({
  label,
  accentColor,
  paragraphs,
}: {
  label: string;
  accentColor: string;
  paragraphs: ParagraphInfo[];
}) {
  return (
    <div
      style={{
        margin: '0.5rem 0',
        padding: '0.5rem 0.75rem',
        background: '#f5f7fb',
        border: `1px dashed ${accentColor}`,
        borderRadius: 4,
        fontSize: 13,
      }}
    >
      <div
        style={{
          fontFamily: 'ui-monospace, Consolas, monospace',
          fontSize: 10,
          color: accentColor,
          letterSpacing: 0.5,
          marginBottom: '0.4rem',
          fontWeight: 600,
        }}
      >
        {label}
      </div>
      {paragraphs.length === 0 && (
        <div style={{ color: '#888', fontStyle: 'italic', fontSize: 11 }}>
          (no paragraphs in this part)
        </div>
      )}
      {paragraphs.map((p, i) => (
        <PreviewParagraph
          key={`${label}-${i}`}
          paragraph={p}
          edit={undefined}
          onClick={() => undefined}
          inHeaderFooter
        />
      ))}
    </div>
  );
}

function PreviewParagraph({
  paragraph,
  edit,
  onClick,
  inHeaderFooter = false,
}: {
  paragraph: ParagraphInfo;
  edit: StoredEdit | undefined;
  onClick: () => void;
  inHeaderFooter?: boolean;
}) {
  // Determine which text to display: accepted text-replacement edits
  // show the new text; everything else keeps the original. Non-text
  // ops still highlight the paragraph but don't change its display.
  const displayText =
    edit?.status === 'accepted' && edit.op.op === 'replace_paragraph_text'
      ? edit.op.new_text
      : edit?.status === 'accepted' && edit.op.op === 'replace_run_text'
        ? // Reconstruct paragraph text by swapping the targeted run
          paragraph.runs
            .map((r, i) =>
              edit.op.op === 'replace_run_text' && i === edit.op.run_index ? edit.op.new_text : r.text,
            )
            .join('')
        : paragraph.text;

  // Style mapping. We use the parser's style_id to detect headings and
  // approximate sizes. Word uses "heading 1" / "Heading1" / "Heading 1 Char"
  // depending on the template — match them all.
  const styleId = paragraph.style_id ?? '';
  const styleLower = styleId.toLowerCase();
  let headingLevel: number | null = null;
  const m = styleLower.match(/^heading\s*(\d+)/);
  if (m) headingLevel = Math.min(6, Math.max(1, parseInt(m[1]!, 10)));
  const isTitle = styleLower === 'title';
  const isSubtitle = styleLower === 'subtitle';

  // Indent: 1440 twips = 1 inch ≈ 96 px. Word's indent model has three
  // pieces: `left` (whole-block left indent), `firstLine` (additional
  // indent on the first wrapped line), and `hanging` (negative first-line
  // indent — used for bullets and numbered lists). We map the whole-block
  // value to paddingLeft and the first-line delta to text-indent.
  const TWIPS_PER_INCH = 1440;
  const PX_PER_INCH = 96;
  const twipsToPx = (t: number) => Math.round((t / TWIPS_PER_INCH) * PX_PER_INCH);
  const leftTwips = paragraph.indent_left_twips ?? 0;
  const firstLineTwips = paragraph.indent_first_line_twips ?? 0;
  const hangingTwips = paragraph.indent_hanging_twips ?? 0;
  const indentPx = Math.min(96 * 4, twipsToPx(leftTwips));
  // text-indent: positive for firstLine, negative for hanging
  const textIndentPx = firstLineTwips
    ? twipsToPx(firstLineTwips)
    : hangingTwips
      ? -twipsToPx(hangingTwips)
      : 0;

  const alignment: CSSProperties['textAlign'] =
    paragraph.alignment === 'center'
      ? 'center'
      : paragraph.alignment === 'right'
        ? 'right'
        : paragraph.alignment === 'justify' || paragraph.alignment === 'both'
          ? 'justify'
          : 'left';

  // Compose the inline text style. The whole-paragraph wrapper uses
  // pre-wrap so tab and newline characters from <w:tab/>/<w:br/> in
  // the parsed text actually show as visible whitespace.
  const textStyle: CSSProperties = {
    margin: 0,
    paddingLeft: indentPx,
    textIndent: textIndentPx,
    textAlign: alignment,
    fontWeight: paragraph.bold || headingLevel !== null || isTitle ? 700 : 400,
    fontStyle: paragraph.italic ? 'italic' : 'normal',
    whiteSpace: 'pre-wrap',
  };

  if (isTitle) {
    textStyle.fontSize = '1.6em';
  } else if (isSubtitle) {
    textStyle.fontSize = '1.2em';
    textStyle.color = '#555';
  } else if (headingLevel !== null) {
    textStyle.fontSize = `${1.45 - (headingLevel - 1) * 0.15}em`;
    textStyle.marginTop = '0.6em';
    textStyle.marginBottom = '0.2em';
  } else {
    textStyle.marginBottom = '0.45em';
  }

  // Wrapper style — highlights edited paragraphs
  const wrapperBorder =
    edit?.status === 'accepted'
      ? '#0a0'
      : edit?.status === 'proposed'
        ? '#d4a000'
        : 'transparent';
  const wrapperBg =
    edit?.status === 'accepted'
      ? 'rgba(0, 170, 0, 0.06)'
      : edit?.status === 'proposed'
        ? 'rgba(212, 160, 0, 0.08)'
        : 'transparent';

  return (
    <div
      onClick={edit ? onClick : undefined}
      title={edit ? `Click to view edit for paragraph ${paragraph.index}` : undefined}
      style={{
        position: 'relative',
        borderLeft: `3px solid ${wrapperBorder}`,
        background: wrapperBg,
        padding: '0.1rem 0.5rem 0.1rem 0.75rem',
        marginLeft: -8,
        marginBottom: 2,
        cursor: edit ? 'pointer' : 'default',
        borderRadius: 2,
      }}
    >
      <span
        style={{
          position: 'absolute',
          left: -36,
          top: '0.25em',
          fontSize: 10,
          color: '#aaa',
          fontFamily: 'ui-monospace, Consolas, monospace',
          width: 28,
          textAlign: 'right',
        }}
      >
        {paragraph.index}
      </span>
      {paragraph.in_table && (
        <span
          style={{
            display: 'inline-block',
            fontSize: 9,
            background: '#eef',
            color: '#446',
            padding: '0 4px',
            borderRadius: 2,
            marginRight: 4,
            verticalAlign: 'middle',
          }}
        >
          table
        </span>
      )}
      {paragraph.content_control_tag && (
        <span
          style={{
            display: 'inline-block',
            fontSize: 9,
            background: '#fde',
            color: '#933',
            padding: '0 4px',
            borderRadius: 2,
            marginRight: 4,
            verticalAlign: 'middle',
          }}
          title={`Word content control: ${paragraph.content_control_tag}`}
        >
          sdt:{paragraph.content_control_tag}
        </span>
      )}
      {paragraph.numbering_id !== null && (
        <span
          style={{
            display: 'inline-block',
            fontSize: 9,
            background: '#efe',
            color: '#363',
            padding: '0 4px',
            borderRadius: 2,
            marginRight: 4,
            verticalAlign: 'middle',
          }}
        >
          list·{paragraph.numbering_level ?? 0}
        </span>
      )}
      {edit?.status === 'accepted' && (
        <span
          style={{
            display: 'inline-block',
            fontSize: 9,
            background: '#0a0',
            color: '#fff',
            padding: '0 4px',
            borderRadius: 2,
            marginRight: 4,
            verticalAlign: 'middle',
          }}
        >
          ✓ edited
        </span>
      )}
      {edit?.status === 'proposed' && (
        <span
          style={{
            display: 'inline-block',
            fontSize: 9,
            background: '#d4a000',
            color: '#fff',
            padding: '0 4px',
            borderRadius: 2,
            marginRight: 4,
            verticalAlign: 'middle',
          }}
        >
          ? proposed
        </span>
      )}
      {/*
        Empty paragraphs in DOCX are intentional vertical spacing —
        render them as a non-breaking space (single visible blank
        line of normal height) instead of an "(empty)" placeholder.
        Whitespace-only paragraphs (e.g. " ") fall through to the
        same path because we use pre-wrap on the text span.
      */}
      <span style={textStyle}>
        {displayText.length === 0 ? '\u00a0' : displayText}
      </span>
    </div>
  );

  // (return is above; this comment kept for clarity)
  // The wrapper for header/footer paragraphs gets a slightly more
  // compact style — no per-paragraph hover behavior since they
  // aren't editable in v1.
  void inHeaderFooter;
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

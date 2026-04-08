// Documents route — upload a finished DOCX, run an LLM cleanup pass,
// review proposed edits side-by-side with the original, accept or
// reject each one, then export a new DOCX with the accepted edits
// applied. The whole workflow lives in this single route file because
// it's small and self-contained.

import { useState, type ChangeEvent, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type DocumentRecord } from '../lib/db/schema';
import { parseDocx } from '../lib/template/parser';
import { useAuth } from '../lib/state/auth';
import { AskSageClient } from '../lib/asksage/client';
import { requestDocumentEdits } from '../lib/document/edit';
import { exportEditedDocx } from '../lib/document/writer';
import type { ParagraphEdit } from '../lib/document/types';

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `doc_${Date.now()}_${Math.floor(Math.random() * 1e9)}`;
}

export function Documents() {
  const documents = useLiveQuery(
    () => db.documents.orderBy('ingested_at').reverse().toArray(),
    [],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const selected = documents?.find((d) => d.id === selectedId) ?? null;

  async function onUpload(e: ChangeEvent<HTMLInputElement>) {
    setUploadError(null);
    const file = e.target.files?.[0];
    if (!file) return;
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
      const record: DocumentRecord = {
        id: newId(),
        name: file.name.replace(/\.docx$/i, ''),
        filename: file.name,
        ingested_at: new Date().toISOString(),
        docx_bytes: docx_blob,
        paragraph_count: paragraphs.length,
        edits: [],
        total_tokens_in: 0,
        total_tokens_out: 0,
      };
      await db.documents.put(record);
      setSelectedId(record.id);
      // eslint-disable-next-line no-console
      console.info(`[Documents] stored ${record.id} with ${paragraphs.length} paragraphs`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.error('[Documents] upload failed:', err);
      setUploadError(message);
    } finally {
      setUploading(false);
      e.target.value = '';
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

      <label htmlFor="document-input">Upload a DOCX to clean up</label>
      <input
        id="document-input"
        type="file"
        accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        onChange={onUpload}
        disabled={uploading}
      />
      {uploading && <p className="note">Parsing…</p>}
      {uploadError && <div className="error">Upload failed: {uploadError}</div>}

      <h2>Stored documents ({documents?.length ?? 0})</h2>
      {(!documents || documents.length === 0) && (
        <p className="note">No documents yet. Upload one above.</p>
      )}
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {documents?.map((d) => (
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
              onClick={(e) => {
                e.stopPropagation();
                onDelete(d.id);
              }}
              style={{
                marginLeft: '0.25rem',
                background: '#a33',
                borderColor: '#a33',
                padding: '0.25rem 0.5rem',
                fontSize: 11,
              }}
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
  const [instruction, setInstruction] = useState('Review this document for grammar, language, clarity, and obvious errors. Propose surgical edits only — leave clean paragraphs alone.');
  const [running, setRunning] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [exportInfo, setExportInfo] = useState<string | null>(null);

  const proposed = doc.edits.filter((e) => e.status === 'proposed');
  const accepted = doc.edits.filter((e) => e.status === 'accepted');

  async function onRequestEdits(e: FormEvent) {
    e.preventDefault();
    if (!apiKey) {
      setRequestError('Connect on the Connection tab first.');
      return;
    }
    setRequestError(null);
    setRunning(true);
    // eslint-disable-next-line no-console
    console.info(`[DocumentDetail] requesting cleanup edits for ${doc.id}`);
    try {
      // Re-parse from stored bytes to get fresh paragraphs
      const parsed = await parseDocx(doc.docx_bytes, {
        filename: doc.filename,
        docx_blob_id: 'reparse',
      });
      const client = new AskSageClient(baseUrl, apiKey);
      const result = await requestDocumentEdits(client, {
        document_name: doc.name,
        paragraphs: parsed.paragraphs,
        instruction: instruction.trim(),
      });

      // Build a quick lookup from index → original text for diff display
      const originalByIndex = new Map<number, string>();
      for (const p of parsed.paragraphs) originalByIndex.set(p.index, p.text);

      const newEdits: ParagraphEdit[] = result.valid_edits.map((e) => ({
        index: e.index,
        original_text: originalByIndex.get(e.index) ?? '',
        new_text: e.new_text,
        rationale: e.rationale,
        status: 'proposed',
      }));

      // Merge with existing edits — replace any prior 'proposed' entries
      // for the same index, keep accepted ones.
      const keptIndices = new Set(newEdits.map((e) => e.index));
      const merged: ParagraphEdit[] = [
        ...doc.edits.filter((e) => e.status === 'accepted' || !keptIndices.has(e.index)),
        ...newEdits,
      ];

      const updated: DocumentRecord = {
        ...doc,
        edits: merged,
        last_edit_model: result.model,
        total_tokens_in: doc.total_tokens_in + result.tokens_in,
        total_tokens_out: doc.total_tokens_out + result.tokens_out,
      };
      await db.documents.put(updated);
      // eslint-disable-next-line no-console
      console.info(
        `[DocumentDetail] received ${newEdits.length} edits; tokens=${result.tokens_in}+${result.tokens_out}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.error('[DocumentDetail] edit request failed:', err);
      setRequestError(message);
    } finally {
      setRunning(false);
    }
  }

  async function onSetStatus(index: number, status: ParagraphEdit['status']) {
    const updated: DocumentRecord = {
      ...doc,
      edits: doc.edits.map((e) => (e.index === index ? { ...e, status } : e)),
    };
    await db.documents.put(updated);
  }

  async function onAcceptAll() {
    const updated: DocumentRecord = {
      ...doc,
      edits: doc.edits.map((e) => (e.status === 'proposed' ? { ...e, status: 'accepted' } : e)),
    };
    await db.documents.put(updated);
  }

  async function onRejectAll() {
    const updated: DocumentRecord = {
      ...doc,
      edits: doc.edits.filter((e) => e.status !== 'proposed'),
    };
    await db.documents.put(updated);
  }

  async function onExport() {
    setExportInfo(null);
    // eslint-disable-next-line no-console
    console.info(`[DocumentDetail] exporting ${doc.id} with ${accepted.length} accepted edits`);
    try {
      const overrides: Record<number, string> = {};
      for (const e of accepted) overrides[e.index] = e.new_text;
      const result = await exportEditedDocx(doc.docx_bytes, overrides);

      const filename = `${doc.name.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}_cleaned.docx`;
      triggerDownload(result.blob, filename);
      setExportInfo(
        `Exported ${result.applied} edit${result.applied === 1 ? '' : 's'}` +
          (result.skipped.length > 0 ? `; ${result.skipped.length} skipped` : ''),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setExportInfo(`Export failed: ${message}`);
    }
  }

  return (
    <section style={{ marginTop: '1.5rem', borderTop: '1px solid #ddd', paddingTop: '1rem' }}>
      <h2>{doc.name}</h2>
      <p className="note">
        {doc.filename} · {doc.paragraph_count} paragraphs · ingested{' '}
        {new Date(doc.ingested_at).toLocaleString()}
      </p>

      <h3>Cleanup pass</h3>
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
        <button type="submit" disabled={running || !apiKey}>
          {running ? 'Asking the LLM…' : 'Request cleanup edits'}
        </button>
      </form>
      {requestError && <div className="error">Request failed: {requestError}</div>}

      <h3>
        Proposed edits ({proposed.length}) · Accepted ({accepted.length})
      </h3>
      {proposed.length === 0 && accepted.length === 0 && (
        <p className="note">No edits yet. Click "Request cleanup edits" above.</p>
      )}
      {proposed.length > 0 && (
        <div style={{ marginBottom: '0.75rem' }}>
          <button type="button" onClick={onAcceptAll} style={{ background: '#060', borderColor: '#060' }}>
            Accept all proposed
          </button>
          <button
            type="button"
            onClick={onRejectAll}
            style={{ marginLeft: '0.5rem', background: '#666', borderColor: '#666' }}
          >
            Reject all proposed
          </button>
        </div>
      )}

      {[...proposed, ...accepted]
        .sort((a, b) => a.index - b.index)
        .map((e) => (
          <EditCard key={`${e.index}-${e.status}`} edit={e} onSetStatus={onSetStatus} />
        ))}

      <h3>Export</h3>
      <button
        type="button"
        onClick={onExport}
        disabled={accepted.length === 0}
        style={{ background: accepted.length > 0 ? '#2050a0' : '#888' }}
      >
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

function EditCard({
  edit,
  onSetStatus,
}: {
  edit: ParagraphEdit;
  onSetStatus: (index: number, status: ParagraphEdit['status']) => void;
}) {
  const isAccepted = edit.status === 'accepted';
  const borderColor = isAccepted ? '#0a0' : '#d4a000';
  const bg = isAccepted ? '#f0fff0' : '#fff8e0';

  return (
    <div
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
        <strong style={{ fontSize: 12 }}>Paragraph #{edit.index}</strong>
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
                onClick={() => onSetStatus(edit.index, 'accepted')}
                style={{ margin: 0, padding: '0.2rem 0.5rem', fontSize: 11, background: '#060', borderColor: '#060' }}
              >
                accept
              </button>
              <button
                type="button"
                onClick={() => onSetStatus(edit.index, 'rejected')}
                style={{ margin: 0, padding: '0.2rem 0.5rem', fontSize: 11, background: '#666', borderColor: '#666' }}
              >
                reject
              </button>
            </>
          )}
          {edit.status === 'accepted' && (
            <button
              type="button"
              onClick={() => onSetStatus(edit.index, 'proposed')}
              style={{ margin: 0, padding: '0.2rem 0.5rem', fontSize: 11, background: '#666', borderColor: '#666' }}
            >
              unaccept
            </button>
          )}
        </span>
      </div>
      <DiffView before={edit.original_text} after={edit.new_text} />
      {edit.rationale && (
        <p className="note" style={{ marginTop: '0.4rem' }}>
          <em>{edit.rationale}</em>
        </p>
      )}
    </div>
  );
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

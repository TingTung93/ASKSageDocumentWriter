// Documents route — upload a finished DOCX, run an LLM cleanup pass,
// review proposed edits side-by-side with the original, accept or
// reject each one, then export a new DOCX with the accepted edits
// applied. The whole workflow lives in this single route file because
// it's small and self-contained.

import { useEffect, useState, type ChangeEvent, type CSSProperties, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type DocumentRecord } from '../lib/db/schema';
import { parseDocx, type ParagraphInfo } from '../lib/template/parser';
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
  const [paragraphs, setParagraphs] = useState<ParagraphInfo[] | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  const proposed = doc.edits.filter((e) => e.status === 'proposed');
  const accepted = doc.edits.filter((e) => e.status === 'accepted');

  // Re-parse the stored DOCX whenever the selected document changes so
  // we have paragraphs available for the preview AND for the next edit
  // request (no double-parse).
  useEffect(() => {
    let cancelled = false;
    setParagraphs(null);
    setParseError(null);
    parseDocx(doc.docx_bytes, { filename: doc.filename, docx_blob_id: 'preview' })
      .then((res) => {
        if (!cancelled) setParagraphs(res.paragraphs);
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
    // eslint-disable-next-line no-console
    console.info(`[DocumentDetail] requesting cleanup edits for ${doc.id}`);
    try {
      const client = new AskSageClient(baseUrl, apiKey);
      const result = await requestDocumentEdits(client, {
        document_name: doc.name,
        paragraphs,
        instruction: instruction.trim(),
      });

      // Build a quick lookup from index → original text for diff display
      const originalByIndex = new Map<number, string>();
      for (const p of paragraphs) originalByIndex.set(p.index, p.text);

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

      <h3>Document preview</h3>
      <p className="note">
        Approximate rendering of the parsed paragraphs with their styles
        applied. Paragraphs with accepted edits show the new text and a
        green left border. Paragraphs with proposed edits keep the
        original text and show an amber border. Click any highlighted
        paragraph to scroll to its diff card below.
      </p>
      {parseError && <div className="error">Preview parse failed: {parseError}</div>}
      {!paragraphs && !parseError && <p className="note">Parsing for preview…</p>}
      {paragraphs && (
        <DocumentPreview paragraphs={paragraphs} edits={doc.edits} />
      )}

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
          <EditCard
            key={`${e.index}-${e.status}`}
            edit={e}
            onSetStatus={onSetStatus}
            anchorId={`edit-${e.index}`}
          />
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
  anchorId,
}: {
  edit: ParagraphEdit;
  onSetStatus: (index: number, status: ParagraphEdit['status']) => void;
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

// ─── Document preview rendering ───────────────────────────────────
//
// Approximates how the parsed DOCX would look in Word, using the
// per-paragraph properties the parser already extracts (style_name,
// alignment, indent_left_twips, bold, italic, numbering, table). Not
// pixel-perfect — the goal is "readable approximation" so the user can
// see what the document actually contains while reviewing edits.

function DocumentPreview({
  paragraphs,
  edits,
}: {
  paragraphs: ParagraphInfo[];
  edits: ParagraphEdit[];
}) {
  const editsByIndex = new Map<number, ParagraphEdit>();
  for (const e of edits) editsByIndex.set(e.index, e);

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
      {paragraphs.map((p) => (
        <PreviewParagraph
          key={p.index}
          paragraph={p}
          edit={editsByIndex.get(p.index)}
          onClick={() => scrollToEdit(p.index)}
        />
      ))}
    </div>
  );
}

function PreviewParagraph({
  paragraph,
  edit,
  onClick,
}: {
  paragraph: ParagraphInfo;
  edit: ParagraphEdit | undefined;
  onClick: () => void;
}) {
  // Determine which text to display: accepted edits show the new text;
  // proposed and rejected edits keep the original (so the user can see
  // the as-uploaded state until they accept).
  const displayText =
    edit?.status === 'accepted' ? edit.new_text : paragraph.text;

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

  // Indent: 1440 twips = 1 inch ≈ 96 px
  const indentPx = paragraph.indent_left_twips
    ? Math.min(96 * 4, Math.round((paragraph.indent_left_twips / 1440) * 96))
    : 0;

  const alignment: CSSProperties['textAlign'] =
    paragraph.alignment === 'center'
      ? 'center'
      : paragraph.alignment === 'right'
        ? 'right'
        : paragraph.alignment === 'justify' || paragraph.alignment === 'both'
          ? 'justify'
          : 'left';

  // Compose the inline text style
  const textStyle: CSSProperties = {
    margin: 0,
    paddingLeft: indentPx,
    textAlign: alignment,
    fontWeight: paragraph.bold || headingLevel !== null || isTitle ? 700 : 400,
    fontStyle: paragraph.italic ? 'italic' : 'normal',
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
      {displayText.trim().length === 0 ? (
        <span style={{ color: '#bbb', fontStyle: 'italic', fontSize: 11 }}>(empty)</span>
      ) : (
        <span style={textStyle}>{displayText}</span>
      )}
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

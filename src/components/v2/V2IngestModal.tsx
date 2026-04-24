import { useState } from 'react';
import { parseDocx } from '../../lib/template/parser';
import { db, type TemplateRecord } from '../../lib/db/schema';
import { toast } from '../../lib/state/toast';
import { Modal } from './Modal';

interface V2IngestModalProps {
  onClose: () => void;
  onIngested?: (template: TemplateRecord) => void;
}

type Phase = 'drop' | 'parsing' | 'done' | 'error';

interface ParsedSummary {
  template: TemplateRecord;
  wordCount: number;
  placeholderCount: number;
}

function cryptoRandomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `id_${Date.now()}_${Math.floor(Math.random() * 1e9)}`;
}

export function V2IngestModal({ onClose, onIngested }: V2IngestModalProps) {
  const [phase, setPhase] = useState<Phase>('drop');
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hot, setHot] = useState(false);

  const handleFile = async (f: File) => {
    setFile(f);
    setPhase('parsing');
    setError(null);
    try {
      if (!f.name.toLowerCase().endsWith('.docx')) {
        throw new Error('Not a .docx file');
      }
      const buf = new Uint8Array(await f.arrayBuffer());
      const docx_blob_id = `docx://${cryptoRandomId()}`;
      const { schema, docx_blob } = await parseDocx(buf, { filename: f.name, docx_blob_id });
      const template: TemplateRecord = {
        id: schema.id,
        name: schema.name,
        filename: f.name,
        ingested_at: schema.source.ingested_at,
        docx_bytes: docx_blob,
        schema_json: schema,
      };
      const wordCount = schema.sections.reduce((sum, s) => {
        const sample = (s as { example_text?: string }).example_text ?? '';
        return sum + sample.split(/\s+/).filter(Boolean).length;
      }, 0);
      const placeholderCount = schema.sections.filter((s) => (s as { placeholders?: unknown[] }).placeholders?.length).length;
      setParsed({ template, wordCount, placeholderCount });
      setPhase('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('error');
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setHot(false);
    const f = e.dataTransfer.files[0];
    if (f) void handleFile(f);
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) void handleFile(f);
  };

  const handleRegister = async () => {
    if (!parsed) return;
    await db.templates.put(parsed.template);
    toast.success(`Template "${parsed.template.name}" registered · ${parsed.template.schema_json.sections.length} sections`);
    onIngested?.(parsed.template);
    onClose();
  };

  return (
    <Modal onClose={onClose} ariaLabelledBy="v2-ingest-title">
        <div className="modal-head">
          <div className="modal-eye">Template ingest</div>
          <div className="modal-title" id="v2-ingest-title">Add DOCX template</div>
          <div className="modal-sub">Parse structure and placeholders locally — the file never leaves this browser.</div>
        </div>
        <div className="modal-body">
          {phase === 'drop' && (
            <label
              className={"ingest-drop" + (hot ? ' hot' : '')}
              onDragOver={(e) => { e.preventDefault(); setHot(true); }}
              onDragLeave={() => setHot(false)}
              onDrop={onDrop}
            >
              <div className="ic">⬆</div>
              <div className="ln1">Drop a .docx file here</div>
              <div className="ln2">or click to browse · parsed locally</div>
              <input type="file" accept=".docx" style={{ display: 'none' }} onChange={onFileChange} />
            </label>
          )}
          {phase === 'parsing' && file && (
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-2)' }}>
              Parsing {file.name} ({(file.size / 1024).toFixed(0)} KB)…
            </div>
          )}
          {phase === 'done' && parsed && (
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 12 }}>
                <div className="usage-stat"><div className="k">Sections</div><div className="v">{parsed.template.schema_json.sections.length}</div></div>
                <div className="usage-stat"><div className="k">Placeholders</div><div className="v">{parsed.placeholderCount}</div></div>
                <div className="usage-stat"><div className="k">Words</div><div className="v">{parsed.wordCount.toLocaleString()}</div></div>
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Detected structure
              </div>
              <div className="parsed-preview">
                {parsed.template.schema_json.sections.length === 0 && (
                  <div style={{ fontSize: 12, color: 'var(--ink-3)', padding: 10 }}>
                    No headings found — template will be single-section.
                  </div>
                )}
                {parsed.template.schema_json.sections.slice(0, 20).map((s, i) => (
                  <div key={i} className="parsed-section">
                    <span className="pnum">§{i + 1}</span>
                    <span className="ptitle">{s.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {phase === 'error' && (
            <div style={{ padding: 14, background: 'var(--rose-soft)', border: '1px solid oklch(0.88 0.05 25)', borderRadius: 8, color: 'var(--rose)', fontSize: 12.5 }}>
              Couldn't parse this file: {error}. Make sure it's a valid .docx (Word 2007+).
            </div>
          )}
        </div>
        <div className="modal-foot">
          <span className="left">
            {phase === 'done' && parsed ? 'Structure looks good' : phase === 'parsing' ? 'Parsing locally — no upload' : 'Local · no upload'}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={onClose}>Cancel</button>
            {phase === 'done' && (
              <button className="btn btn-primary" onClick={handleRegister}>Register template</button>
            )}
          </div>
        </div>
    </Modal>
  );
}

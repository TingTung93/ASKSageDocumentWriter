import { useState, type ChangeEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type TemplateRecord } from '../lib/db/schema';
import { parseDocx } from '../lib/template/parser';
import type { TemplateSchema } from '../lib/template/types';

// Phase 1a UI: drop a DOCX file → parser produces structural schema →
// row in the local template library → click to view the schema.

export function Templates() {
  const templates = useLiveQuery(() => db.templates.orderBy('ingested_at').reverse().toArray(), []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);

  const selected = templates?.find((t) => t.id === selectedId) ?? null;

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    setParseError(null);
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.docx')) {
      setParseError(`Not a DOCX: ${file.name}`);
      return;
    }
    setParsing(true);
    // eslint-disable-next-line no-console
    console.info(`[Templates] parsing ${file.name} (${file.size} bytes)`);
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      const docx_blob_id = `docx://${cryptoRandomId()}`;
      const { schema, docx_blob } = await parseDocx(buf, {
        filename: file.name,
        docx_blob_id,
      });
      const record: TemplateRecord = {
        id: schema.id,
        name: schema.name,
        filename: file.name,
        ingested_at: schema.source.ingested_at,
        docx_bytes: docx_blob,
        schema_json: schema,
      };
      await db.templates.put(record);
      // eslint-disable-next-line no-console
      console.info(`[Templates] stored template ${schema.id} with ${schema.sections.length} sections`);
      setSelectedId(schema.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.error('[Templates] parse failed:', err);
      setParseError(message);
    } finally {
      setParsing(false);
      e.target.value = '';
    }
  }

  async function onDelete(id: string) {
    await db.templates.delete(id);
    if (selectedId === id) setSelectedId(null);
  }

  return (
    <main>
      <h1>Template library</h1>
      <p>
        Drop a DOCX template here. The parser reads its OOXML and emits the
        structural half of a TemplateSchema (page setup, named styles,
        numbering, fill regions). The original DOCX is kept locally as the
        export skeleton.
      </p>

      <label htmlFor="docx-input">Add a DOCX template</label>
      <input
        id="docx-input"
        type="file"
        accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        onChange={onFile}
        disabled={parsing}
      />
      {parsing && <p className="note">Parsing…</p>}
      {parseError && <div className="error">Parse failed: {parseError}</div>}

      <h2>Stored templates ({templates?.length ?? 0})</h2>
      {(!templates || templates.length === 0) && (
        <p className="note">No templates yet. Add one above.</p>
      )}
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {templates?.map((t) => (
          <li
            key={t.id}
            style={{
              padding: '0.5rem 0.75rem',
              border: '1px solid #ddd',
              borderRadius: 4,
              marginBottom: '0.25rem',
              background: selectedId === t.id ? '#eef' : '#fff',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'baseline',
              gap: '0.5rem',
            }}
            onClick={() => setSelectedId(t.id)}
          >
            <strong>{t.name}</strong>
            <span className="note" style={{ marginLeft: 'auto' }}>
              {(t.docx_bytes?.size ?? 0).toLocaleString()} bytes ·{' '}
              {t.schema_json.sections.length} section
              {t.schema_json.sections.length === 1 ? '' : 's'} ·{' '}
              {t.schema_json.metadata_fill_regions.length} metadata
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(t.id);
              }}
              style={{ marginLeft: '0.25rem', background: '#a33', borderColor: '#a33', padding: '0.25rem 0.5rem', fontSize: 11 }}
            >
              delete
            </button>
          </li>
        ))}
      </ul>

      {selected && <SchemaViewer schema={selected.schema_json} />}
    </main>
  );
}

function SchemaViewer({ schema }: { schema: TemplateSchema }) {
  const [tab, setTab] = useState<'summary' | 'json'>('summary');

  return (
    <section style={{ marginTop: '1.5rem', borderTop: '1px solid #ddd', paddingTop: '1rem' }}>
      <h2>Schema · {schema.name}</h2>
      <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '0.5rem' }}>
        <TabBtn active={tab === 'summary'} onClick={() => setTab('summary')}>Summary</TabBtn>
        <TabBtn active={tab === 'json'} onClick={() => setTab('json')}>Raw JSON</TabBtn>
      </div>
      {tab === 'summary' ? <SummaryView schema={schema} /> : <JsonView value={schema} />}
    </section>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        margin: 0,
        padding: '0.35rem 0.75rem',
        background: active ? '#2050a0' : '#ddd',
        color: active ? '#fff' : '#333',
        borderColor: active ? '#2050a0' : '#bbb',
        fontWeight: 600,
        fontSize: 12,
      }}
    >
      {children}
    </button>
  );
}

function SummaryView({ schema }: { schema: TemplateSchema }) {
  const ps = schema.formatting.page_setup;
  return (
    <div style={{ fontSize: 13 }}>
      <h3 style={{ marginTop: '0.75rem' }}>Source</h3>
      <Field label="Filename">{schema.source.filename}</Field>
      <Field label="Ingested">{schema.source.ingested_at}</Field>
      <Field label="Parser">{schema.source.structural_parser_version}</Field>
      <Field label="Semantic">{schema.source.semantic_synthesizer ?? '(not yet — Phase 1b)'}</Field>

      <h3>Page setup</h3>
      <Field label="Paper">{ps.paper}</Field>
      <Field label="Orientation">{ps.orientation}</Field>
      <Field label="Margins (twips)">
        T:{ps.margins_twips.top} R:{ps.margins_twips.right} B:{ps.margins_twips.bottom} L:{ps.margins_twips.left}
      </Field>

      <h3>Default font</h3>
      <Field label="Family">{schema.formatting.default_font.family ?? '(not specified)'}</Field>
      <Field label="Size">{schema.formatting.default_font.size_pt ?? '?'} pt</Field>

      <h3>Named styles ({schema.formatting.named_styles.length})</h3>
      <div style={{ maxHeight: 220, overflow: 'auto', background: '#f8f8f8', padding: '0.5rem', fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 11 }}>
        {schema.formatting.named_styles.map((s) => (
          <div key={s.id}>
            <strong>{s.id}</strong> · {s.name} · {s.type}
            {s.outline_level !== null && ` · outline ${s.outline_level}`}
            {s.numbering_id !== null && ` · num ${s.numbering_id}`}
            {s.based_on && ` · basedOn ${s.based_on}`}
          </div>
        ))}
      </div>

      <h3>Numbering definitions ({schema.formatting.numbering_definitions.length})</h3>
      <div style={{ background: '#f8f8f8', padding: '0.5rem', fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 11 }}>
        {schema.formatting.numbering_definitions.length === 0 ? (
          <em>none</em>
        ) : (
          schema.formatting.numbering_definitions.map((n) => (
            <div key={n.id}>
              numId={n.id} → abstract={n.abstract_id} · {n.levels.length} level{n.levels.length === 1 ? '' : 's'}
              {n.levels.slice(0, 3).map((l) => ` [${l.level}:${l.format}:${l.text}]`).join('')}
            </div>
          ))
        )}
      </div>

      <h3>Header / footer parts</h3>
      <Field label="Headers">{schema.formatting.headers.map((h) => h.part).join(', ') || '(none)'}</Field>
      <Field label="Footers">{schema.formatting.footers.map((f) => f.part).join(', ') || '(none)'}</Field>

      <h3>Metadata fill regions ({schema.metadata_fill_regions.length})</h3>
      {schema.metadata_fill_regions.length === 0 ? (
        <em>(none detected)</em>
      ) : (
        schema.metadata_fill_regions.map((m) => (
          <div key={m.id} style={{ marginBottom: '0.25rem', padding: '0.25rem 0.5rem', background: '#fff8e0', border: '1px solid #ec9' }}>
            <strong>{m.id}</strong> · kind={m.kind} · type={m.control_type}
            {m.sdt_tag && ` · sdt:${m.sdt_tag}`}
            {m.bookmark_name && ` · bookmark:${m.bookmark_name}`}
            {m.allowed_values && m.allowed_values.length > 0 && (
              <div style={{ fontSize: 11, color: '#666' }}>values: {m.allowed_values.join(', ')}</div>
            )}
          </div>
        ))
      )}

      <h3>Body fill regions / sections ({schema.sections.length})</h3>
      {schema.sections.length === 0 ? (
        <em>(none detected)</em>
      ) : (
        schema.sections.map((s) => (
          <div key={s.id} style={{ marginBottom: '0.5rem', padding: '0.5rem 0.75rem', background: '#e8f0ff', border: '1px solid #9ac' }}>
            <strong>#{s.order} {s.name}</strong>
            <div style={{ fontSize: 11, color: '#444' }}>
              id={s.id} · kind={s.fill_region.kind}
              {s.fill_region.kind === 'heading_bounded' && (
                <> · paragraphs {s.fill_region.anchor_paragraph_index}–{s.fill_region.end_anchor_paragraph_index}</>
              )}
              {' · roles: '}{s.fill_region.permitted_roles.join(', ')}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: '0.5rem', padding: '0.15rem 0' }}>
      <span style={{ minWidth: 140, color: '#666' }}>{label}</span>
      <span>{children}</span>
    </div>
  );
}

function JsonView({ value }: { value: unknown }) {
  return (
    <pre
      style={{
        background: '#1e1e1e',
        color: '#e0e0e0',
        padding: '0.75rem',
        fontSize: 11,
        maxHeight: 500,
        overflow: 'auto',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    >
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function cryptoRandomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `id_${Date.now()}_${Math.floor(Math.random() * 1e9)}`;
}

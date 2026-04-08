import { useState, type ChangeEvent, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type TemplateRecord } from '../lib/db/schema';
import { parseDocx } from '../lib/template/parser';
import type { TemplateSchema } from '../lib/template/types';
import { useAuth } from '../lib/state/auth';
import { AskSageClient } from '../lib/asksage/client';
import { synthesizeSchema, DEFAULT_SYNTHESIS_MODEL } from '../lib/template/synthesis/synthesize';
import { requestSchemaEdits } from '../lib/edit/schema-edit';
import type { ApplyResult } from '../lib/edit/types';

// Phase 1a UI: drop a DOCX file → parser produces structural schema →
// row in the local template library → click to view the schema.
// Phase 1b UI: synthesize semantic half via Gemini Flash on demand.

export function Templates() {
  const templates = useLiveQuery(() => db.templates.orderBy('ingested_at').reverse().toArray(), []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [synthError, setSynthError] = useState<string | null>(null);
  const [synthesizingId, setSynthesizingId] = useState<string | null>(null);
  const apiKey = useAuth((s) => s.apiKey);
  const baseUrl = useAuth((s) => s.baseUrl);

  const selected = templates?.find((t) => t.id === selectedId) ?? null;

  async function onSynthesize(template: TemplateRecord) {
    if (!apiKey) {
      setSynthError('Connect on the Connection tab first — synthesis needs an Ask Sage API key.');
      return;
    }
    setSynthError(null);
    setSynthesizingId(template.id);
    // eslint-disable-next-line no-console
    console.info(`[Templates] synthesizing semantic half for ${template.id} via ${DEFAULT_SYNTHESIS_MODEL}`);
    try {
      const client = new AskSageClient(baseUrl, apiKey);
      const result = await synthesizeSchema(client, template.schema_json, template.docx_bytes);
      const updated: TemplateRecord = {
        ...template,
        schema_json: result.schema,
      };
      await db.templates.put(updated);
      // eslint-disable-next-line no-console
      console.info(
        `[Templates] synthesis complete; ${result.schema.sections.filter((s) => s.intent).length}/${result.schema.sections.length} sections have intent; usage:`,
        result.usage,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.error('[Templates] synthesis failed:', err);
      setSynthError(message);
    } finally {
      setSynthesizingId(null);
    }
  }

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

      {selected && (
        <SchemaViewer
          schema={selected.schema_json}
          templateId={selected.id}
          onSynthesize={() => onSynthesize(selected)}
          synthesizing={synthesizingId === selected.id}
          synthError={synthError}
          canSynthesize={!!apiKey}
        />
      )}
    </main>
  );
}

interface SchemaViewerProps {
  schema: TemplateSchema;
  templateId: string;
  onSynthesize: () => void;
  synthesizing: boolean;
  synthError: string | null;
  canSynthesize: boolean;
}

function SchemaViewer({ schema, templateId, onSynthesize, synthesizing, synthError, canSynthesize }: SchemaViewerProps) {
  const [tab, setTab] = useState<'summary' | 'json' | 'refine'>('summary');
  const hasSemantic = schema.source.semantic_synthesizer !== null;

  return (
    <section style={{ marginTop: '1.5rem', borderTop: '1px solid #ddd', paddingTop: '1rem' }}>
      <h2>Schema · {schema.name}</h2>
      <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '0.5rem', alignItems: 'center' }}>
        <TabBtn active={tab === 'summary'} onClick={() => setTab('summary')}>Summary</TabBtn>
        <TabBtn active={tab === 'json'} onClick={() => setTab('json')}>Raw JSON</TabBtn>
        <TabBtn active={tab === 'refine'} onClick={() => setTab('refine')}>Refine</TabBtn>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          onClick={onSynthesize}
          disabled={synthesizing || !canSynthesize}
          title={!canSynthesize ? 'Connect on the Connection tab first' : `Calls ${DEFAULT_SYNTHESIS_MODEL} via /server/query`}
          style={{
            margin: 0,
            padding: '0.4rem 0.8rem',
            background: hasSemantic ? '#666' : '#2050a0',
            borderColor: hasSemantic ? '#666' : '#2050a0',
            fontSize: 12,
          }}
        >
          {synthesizing
            ? 'Synthesizing…'
            : hasSemantic
              ? 'Re-synthesize semantic'
              : 'Synthesize semantic'}
        </button>
      </div>
      {synthError && <div className="error">Synthesis failed: {synthError}</div>}
      {tab === 'summary' && <SummaryView schema={schema} />}
      {tab === 'json' && <JsonView value={schema} />}
      {tab === 'refine' && <RefinePanel templateId={templateId} schema={schema} />}
    </section>
  );
}

function RefinePanel({ templateId, schema }: { templateId: string; schema: TemplateSchema }) {
  const apiKey = useAuth((s) => s.apiKey);
  const baseUrl = useAuth((s) => s.baseUrl);
  const [instruction, setInstruction] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{
    applied: ApplyResult<TemplateSchema>;
    rationale: string | undefined;
    tokens_in: number;
    tokens_out: number;
  } | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!apiKey || !instruction.trim()) return;
    setError(null);
    setRunning(true);
    setPending(null);
    // eslint-disable-next-line no-console
    console.info(`[Refine] requesting edits for template ${templateId}: "${instruction.trim()}"`);
    try {
      const client = new AskSageClient(baseUrl, apiKey);
      const response = await requestSchemaEdits(client, {
        schema,
        instruction: instruction.trim(),
      });
      setPending({
        applied: response.applied,
        rationale: response.llm_output.rationale,
        tokens_in: response.tokens_in,
        tokens_out: response.tokens_out,
      });
      // eslint-disable-next-line no-console
      console.info(
        `[Refine] received ${response.llm_output.edits.length} edit(s); tokens=${response.tokens_in}+${response.tokens_out}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.error('[Refine] failed:', err);
      setError(message);
    } finally {
      setRunning(false);
    }
  }

  async function onAccept() {
    if (!pending) return;
    const updated: TemplateRecord = {
      id: templateId,
      name: pending.applied.result.name,
      filename: schema.source.filename,
      ingested_at: schema.source.ingested_at,
      // Preserve the existing DOCX bytes from the stored record
      docx_bytes: (await db.templates.get(templateId))!.docx_bytes,
      schema_json: pending.applied.result,
    };
    await db.templates.put(updated);
    setPending(null);
    setInstruction('');
  }

  function onReject() {
    setPending(null);
  }

  return (
    <div style={{ marginTop: '0.5rem' }}>
      <p className="note">
        Free-form instructions to the LLM. It returns a small list of edit operations
        instead of regenerating the whole schema — much cheaper for localized changes
        than re-running the full synthesis pass. The result is a preview you can accept
        or reject.
      </p>
      <p className="note">
        Examples: <em>"Make the purpose section's intent more specific to maintenance contracts"</em>{' '}
        · <em>"Add must_mention=DHA to all sections"</em>{' '}
        · <em>"Reorder so References comes last"</em>{' '}
        · <em>"Remove the banned phrase 'leverage' and add 'going forward'"</em>
      </p>

      <form onSubmit={onSubmit}>
        <label htmlFor="refine-instruction">Instruction</label>
        <textarea
          id="refine-instruction"
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
        <button type="submit" disabled={running || !apiKey || !instruction.trim()}>
          {running ? 'Asking the LLM…' : 'Request edits'}
        </button>
      </form>

      {error && <div className="error">Refinement failed: {error}</div>}

      {pending && (
        <section
          style={{
            marginTop: '1rem',
            padding: '0.75rem',
            background: '#fff8e0',
            border: '1px solid #d4a000',
            borderRadius: 4,
          }}
        >
          <h3 style={{ margin: '0 0 0.5rem', fontSize: 14 }}>
            Proposed edits ({pending.applied.applied.length})
          </h3>
          <p className="note" style={{ margin: '0 0 0.5rem' }}>
            Tokens: {pending.tokens_in} in / {pending.tokens_out} out
            {pending.rationale && <> · LLM rationale: <em>{pending.rationale}</em></>}
          </p>
          <ul style={{ listStyle: 'none', padding: 0, fontSize: 12, fontFamily: 'ui-monospace, Consolas, monospace' }}>
            {pending.applied.applied.map((a, i) => (
              <li
                key={i}
                style={{
                  padding: '0.2rem 0',
                  color: a.success ? '#060' : '#900',
                }}
              >
                {a.success ? '✓' : '✗'} {a.op}
                {a.error && ` — ${a.error}`}
              </li>
            ))}
          </ul>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
            <button type="button" onClick={onAccept} style={{ background: '#060', borderColor: '#060' }}>
              Accept and save
            </button>
            <button type="button" onClick={onReject} style={{ background: '#666', borderColor: '#666' }}>
              Reject
            </button>
          </div>
        </section>
      )}
    </div>
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

      <h3>Style (semantic — Phase 1b)</h3>
      {schema.style.voice === null ? (
        <em>(not yet synthesized — click "Synthesize semantic" above)</em>
      ) : (
        <div style={{ background: '#f8f4e8', padding: '0.5rem', border: '1px solid #d4c483', fontSize: 12 }}>
          <Field label="Voice">{schema.style.voice ?? '(none)'}</Field>
          <Field label="Tense">{schema.style.tense ?? '(none)'}</Field>
          <Field label="Register">{schema.style.register ?? '(none)'}</Field>
          <Field label="Jargon policy">{schema.style.jargon_policy ?? '(none)'}</Field>
          <Field label="Banned phrases">
            {schema.style.banned_phrases.length > 0 ? schema.style.banned_phrases.join(', ') : '(none)'}
          </Field>
        </div>
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
            {s.intent && (
              <div style={{ marginTop: '0.35rem', padding: '0.25rem 0.5rem', background: '#fff8e0', border: '1px solid #ec9', fontSize: 12 }}>
                <div><strong>Intent:</strong> {s.intent}</div>
                {s.target_words && (
                  <div><strong>Target words:</strong> {s.target_words[0]}–{s.target_words[1]}</div>
                )}
                {s.depends_on && s.depends_on.length > 0 && (
                  <div><strong>Depends on:</strong> {s.depends_on.join(', ')}</div>
                )}
                {s.validation && Object.keys(s.validation).length > 0 && (
                  <div><strong>Validation:</strong> <code>{JSON.stringify(s.validation)}</code></div>
                )}
              </div>
            )}
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

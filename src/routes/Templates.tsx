import { useMemo, useState, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type TemplateRecord } from '../lib/db/schema';
import { parseDocx } from '../lib/template/parser';
import type { TemplateSchema, BodyFillRegion } from '../lib/template/types';
import { useAuth } from '../lib/state/auth';
import { createLLMClient } from '../lib/provider/factory';
import { synthesizeSchema, DEFAULT_SYNTHESIS_MODEL } from '../lib/template/synthesis/synthesize';
import { requestSchemaEdits } from '../lib/edit/schema-edit';
import type { ApplyResult } from '../lib/edit/types';
import { DropZone } from '../components/DropZone';
import { SearchFilter, matchesSearch } from '../components/SearchFilter';
import { EmptyState } from '../components/EmptyState';
import { Spinner } from '../components/Spinner';
import { loadSettings } from '../lib/settings/store';
import { toast } from '../lib/state/toast';
import { buildTemplateBundle } from '../lib/share/bundle';
import { downloadBundle, bundleFilename } from '../lib/share/download';
import { importBundleFromText } from '../lib/share/import';

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
  const [search, setSearch] = useState('');
  const apiKey = useAuth((s) => s.apiKey);
  const baseUrl = useAuth((s) => s.baseUrl);
  const provider = useAuth((s) => s.provider);
  const settings = useLiveQuery(() => loadSettings(), []);
  const synthesisModelOverride = settings?.models.synthesis ?? null;

  const selected = templates?.find((t) => t.id === selectedId) ?? null;
  const filtered = useMemo(
    () =>
      (templates ?? []).filter(
        (t) =>
          matchesSearch(t.name, search) ||
          matchesSearch(t.filename, search),
      ),
    [templates, search],
  );

  async function onSynthesize(template: TemplateRecord) {
    if (!apiKey) {
      setSynthError('Connect on the Connection tab first — synthesis needs an API key.');
      return;
    }
    setSynthError(null);
    setSynthesizingId(template.id);
    // eslint-disable-next-line no-console
    console.info(`[Templates] synthesizing semantic half for ${template.id} via ${DEFAULT_SYNTHESIS_MODEL}`);
    try {
      const client = createLLMClient({ provider, baseUrl, apiKey });
      const result = await synthesizeSchema(
        client,
        template.schema_json,
        template.docx_bytes,
        synthesisModelOverride ? { model: synthesisModelOverride } : undefined,
      );
      const updated: TemplateRecord = {
        ...template,
        schema_json: result.schema,
      };
      await db.templates.put(updated);
      const intentCount = result.schema.sections.filter((s) => s.intent).length;
      toast.success(
        `Synthesis complete · ${intentCount}/${result.schema.sections.length} sections have intent`,
      );
      if (result.body_truncated) {
        toast.sticky(
          'error',
          `Document body was truncated: only ${result.body_paragraphs_sent}/${result.body_paragraphs_total} paragraphs (${result.body_chars_sent.toLocaleString()} chars) fit under the cap. Sections beyond that point may be missing. Raise body_cap_chars or use a smaller template.`,
        );
      }
      if (result.subject_leakage_warnings.length > 0) {
        const summary = result.subject_leakage_warnings
          .slice(0, 3)
          .map((w) => `"${w.section_name}" → ${w.flagged_tokens.slice(0, 3).join(', ')}`)
          .join('; ');
        const more =
          result.subject_leakage_warnings.length > 3
            ? ` (+ ${result.subject_leakage_warnings.length - 3} more)`
            : '';
        toast.sticky(
          'info',
          `Subject leakage detected in ${result.subject_leakage_warnings.length} section${result.subject_leakage_warnings.length === 1 ? '' : 's'}: ${summary}${more}. The drafter will override these at draft time, but you can hand-edit the intents to clean them up.`,
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.error('[Templates] synthesis failed:', err);
      setSynthError(message);
      toast.error(`Synthesis failed: ${message}`);
    } finally {
      setSynthesizingId(null);
    }
  }

  async function onFile(file: File) {
    setParseError(null);
    // Two accepted file types: a raw .docx (parse it) or a .json
    // bundle exported from this app (import it).
    const lower = file.name.toLowerCase();
    if (lower.endsWith('.json')) {
      await importBundleFile(file);
      return;
    }
    if (!lower.endsWith('.docx')) {
      setParseError(`Not a DOCX or share bundle: ${file.name}`);
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
      setSelectedId(schema.id);
      toast.success(
        `Ingested ${file.name} · ${schema.sections.length} section${schema.sections.length === 1 ? '' : 's'}`,
      );

      // Phase 1 (agentic auto-triggers): synthesize semantic schema
      // immediately after a successful ingest, no manual button click.
      // Only runs if the user is connected; otherwise the manual
      // "synthesize" button on the schema viewer remains as the
      // fallback. Wrapped so a synthesis failure can't break the
      // ingest flow.
      if (apiKey) {
        // Fire-and-forget: the onSynthesize function manages its own
        // loading state and toasts. We don't await it because the
        // ingest is already complete and the user shouldn't be
        // blocked on an LLM round-trip.
        void onSynthesize(record);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.error('[Templates] parse failed:', err);
      setParseError(message);
      toast.error(`Parse failed: ${message}`);
    } finally {
      setParsing(false);
    }
  }

  async function onDelete(id: string) {
    await db.templates.delete(id);
    if (selectedId === id) setSelectedId(null);
  }

  async function importBundleFile(file: File) {
    setParsing(true);
    try {
      const text = await file.text();
      const summary = await importBundleFromText(text);
      if (summary.kind !== 'template') {
        toast.error(
          `That bundle is a ${summary.kind} bundle. Drop it on the Projects tab instead.`,
        );
        return;
      }
      setSelectedId(summary.template_ids[0] ?? null);
      toast.success(`Imported template "${summary.display_name}"`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setParseError(message);
      toast.error(`Bundle import failed: ${message}`);
    } finally {
      setParsing(false);
    }
  }

  async function onShareTemplate(template: TemplateRecord) {
    try {
      const bundle = await buildTemplateBundle(template);
      const filename = bundleFilename(template.name, 'template');
      downloadBundle(filename, bundle);
      toast.success(`Exported ${filename}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`Export failed: ${message}`);
    }
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

      <DropZone
        accept=".docx,.json,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/json"
        onFile={onFile}
        disabled={parsing}
        label="Drop a DOCX template OR a shared .asdbundle.json file here"
        hint="DOCX files are parsed locally. Bundle files import a template a teammate exported from this tool."
      />
      {parsing && <p className="note">Parsing…</p>}
      {parseError && <div className="error">Parse failed: {parseError}</div>}

      <h2>Stored templates ({templates?.length ?? 0})</h2>
      {templates && templates.length > 0 && (
        <SearchFilter value={search} onChange={setSearch} placeholder="Filter templates by name or filename…" />
      )}
      {(!templates || templates.length === 0) && (
        <EmptyState
          title="No templates yet"
          body={<>Drop a DOCX above to ingest your first template.</>}
        />
      )}
      {templates && templates.length > 0 && filtered.length === 0 && (
        <EmptyState title="No matches" body={<>No templates match "{search}".</>} />
      )}
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {filtered.map((t) => (
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
              className="btn-secondary btn-sm"
              title="Export this template as a shareable bundle file"
              onClick={(e) => {
                e.stopPropagation();
                void onShareTemplate(t);
              }}
              style={{ marginLeft: '0.25rem' }}
            >
              share
            </button>
            <button
              type="button"
              className="btn-danger btn-sm"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(t.id);
              }}
              style={{ marginLeft: '0.25rem' }}
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
          className={hasSemantic ? 'btn-secondary btn-sm' : 'btn-sm'}
          onClick={onSynthesize}
          disabled={synthesizing || !canSynthesize}
          title={!canSynthesize ? 'Connect on the Connection tab first' : `Calls ${DEFAULT_SYNTHESIS_MODEL} via /server/query`}
        >
          {synthesizing ? (
            <Spinner light label="Synthesizing…" />
          ) : hasSemantic ? (
            'Re-synthesize semantic'
          ) : (
            'Synthesize semantic'
          )}
        </button>
      </div>
      {synthError && <div className="error">Synthesis failed: {synthError}</div>}
      {tab === 'summary' && <SummaryView schema={schema} templateId={templateId} />}
      {tab === 'json' && <JsonView value={schema} />}
      {tab === 'refine' && <RefinePanel templateId={templateId} schema={schema} />}
    </section>
  );
}

/**
 * Inline schema mutators — direct edits to a stored TemplateSchema
 * without going through the LLM. Used by SummaryView's edit affordances.
 */
async function patchSchema(
  templateId: string,
  patch: (s: TemplateSchema) => TemplateSchema,
): Promise<void> {
  const existing = await db.templates.get(templateId);
  if (!existing) return;
  await db.templates.put({ ...existing, schema_json: patch(existing.schema_json) });
}

async function updateSection(
  templateId: string,
  sectionId: string,
  fields: Partial<BodyFillRegion>,
): Promise<void> {
  await patchSchema(templateId, (s) => ({
    ...s,
    sections: s.sections.map((sec) => (sec.id === sectionId ? { ...sec, ...fields } : sec)),
  }));
}

async function updateStyle(
  templateId: string,
  fields: Partial<TemplateSchema['style']>,
): Promise<void> {
  await patchSchema(templateId, (s) => ({ ...s, style: { ...s.style, ...fields } }));
}

function RefinePanel({ templateId, schema }: { templateId: string; schema: TemplateSchema }) {
  const apiKey = useAuth((s) => s.apiKey);
  const baseUrl = useAuth((s) => s.baseUrl);
  const provider = useAuth((s) => s.provider);
  const settings = useLiveQuery(() => loadSettings(), []);
  const schemaEditModelOverride = settings?.models.schema_edit ?? null;
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
      const client = createLLMClient({ provider, baseUrl, apiKey });
      const response = await requestSchemaEdits(client, {
        schema,
        instruction: instruction.trim(),
        ...(schemaEditModelOverride ? { model: schemaEditModelOverride } : {}),
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
          <div className="btn-row" style={{ marginTop: '0.5rem' }}>
            <button type="button" className="btn-success" onClick={onAccept}>
              Accept and save
            </button>
            <button type="button" className="btn-secondary" onClick={onReject}>
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

function SummaryView({ schema, templateId }: { schema: TemplateSchema; templateId: string }) {
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

      <h3>Style (semantic — editable)</h3>
      <div style={{ background: '#f8f4e8', padding: '0.5rem', border: '1px solid #d4c483', fontSize: 12 }}>
        <InlineTextField
          label="Voice"
          value={schema.style.voice ?? ''}
          placeholder="third_person | second_person | first_person_plural"
          onChange={(v) => updateStyle(templateId, { voice: v || null })}
        />
        <InlineTextField
          label="Tense"
          value={schema.style.tense ?? ''}
          placeholder="present | past"
          onChange={(v) => updateStyle(templateId, { tense: v || null })}
        />
        <InlineTextField
          label="Register"
          value={schema.style.register ?? ''}
          placeholder="formal_government | technical | instructional"
          onChange={(v) => updateStyle(templateId, { register: v || null })}
        />
        <InlineTextField
          label="Jargon policy"
          value={schema.style.jargon_policy ?? ''}
          placeholder="one short sentence about terminology"
          onChange={(v) => updateStyle(templateId, { jargon_policy: v || null })}
        />
        <InlineTextField
          label="Banned phrases"
          value={schema.style.banned_phrases.join(', ')}
          placeholder="comma-separated"
          onChange={(v) =>
            updateStyle(templateId, {
              banned_phrases: v
                .split(',')
                .map((s) => s.trim())
                .filter((s) => s.length > 0),
            })
          }
        />
      </div>

      <h3>Body fill regions / sections ({schema.sections.length}) — editable</h3>
      {schema.sections.length === 0 ? (
        <em>(none detected)</em>
      ) : (
        schema.sections.map((s) => (
          <SectionEditor key={s.id} section={s} templateId={templateId} />
        ))
      )}
    </div>
  );
}

function InlineTextField({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  // If parent value changes externally, sync
  if (value !== draft && document.activeElement?.tagName !== 'INPUT') {
    setDraft(value);
  }
  return (
    <div style={{ display: 'flex', gap: '0.5rem', padding: '0.15rem 0', alignItems: 'center' }}>
      <span style={{ minWidth: 140, color: '#666', fontSize: 12 }}>{label}</span>
      <input
        type="text"
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== value) onChange(draft);
        }}
        style={{ flex: 1, padding: '0.25rem 0.4rem', font: 'inherit', fontSize: 12 }}
      />
    </div>
  );
}

function SectionEditor({ section, templateId }: { section: BodyFillRegion; templateId: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      style={{
        marginBottom: '0.5rem',
        padding: '0.5rem 0.75rem',
        background: '#e8f0ff',
        border: '1px solid #9ac',
        borderRadius: 4,
      }}
    >
      <div
        style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', cursor: 'pointer' }}
        onClick={() => setExpanded(!expanded)}
      >
        <strong>#{section.order} {section.name}</strong>
        <span style={{ fontSize: 11, color: '#666' }}>
          id={section.id} · {section.fill_region.kind}
        </span>
        <span style={{ marginLeft: 'auto', color: '#888' }}>{expanded ? '▾' : '▸'}</span>
      </div>
      {section.intent && !expanded && (
        <div style={{ marginTop: '0.25rem', fontSize: 12, color: '#444' }}>
          <em>{section.intent}</em>
        </div>
      )}
      {expanded && (
        <div style={{ marginTop: '0.4rem' }}>
          <InlineTextField
            label="Name"
            value={section.name}
            onChange={(v) => updateSection(templateId, section.id, { name: v })}
          />
          <InlineTextField
            label="Intent"
            value={section.intent ?? ''}
            placeholder="One sentence stating the section's communicative goal"
            onChange={(v) => updateSection(templateId, section.id, { intent: v || undefined })}
          />
          <InlineTextField
            label="Target words"
            value={section.target_words ? `${section.target_words[0]}-${section.target_words[1]}` : ''}
            placeholder="80-150"
            onChange={(v) => {
              const m = v.match(/^\s*(\d+)\s*[-–]\s*(\d+)\s*$/);
              if (m) {
                updateSection(templateId, section.id, {
                  target_words: [parseInt(m[1]!, 10), parseInt(m[2]!, 10)],
                });
              } else if (v.trim() === '') {
                updateSection(templateId, section.id, { target_words: undefined });
              }
            }}
          />
          <InlineTextField
            label="Depends on"
            value={(section.depends_on ?? []).join(', ')}
            placeholder="comma-separated section ids"
            onChange={(v) =>
              updateSection(templateId, section.id, {
                depends_on: v
                  .split(',')
                  .map((s) => s.trim())
                  .filter((s) => s.length > 0),
              })
            }
          />
          {section.validation && Object.keys(section.validation).length > 0 && (
            <div style={{ fontSize: 11, color: '#666', marginTop: '0.25rem' }}>
              Validation: <code>{JSON.stringify(section.validation)}</code>{' '}
              <em>(edit via Refine tab)</em>
            </div>
          )}
        </div>
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

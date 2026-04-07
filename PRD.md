# ASKSageDocumentWriter — Product Requirements Document

**Status:** Draft v0.2
**Last updated:** 2026-04-07
**Owner:** TingTung93

---

## 1. Problem & motivation

Government and military staff who write templated long-form documents (Performance Work Statements, market research reports, J&A memos, SOPs, policies, memorandums, after-action reports, charters, etc.) spend disproportionate time producing jargon-heavy prose that conforms to rigid format and style requirements. The work is high-volume, low-creativity, and bottlenecked by individual bandwidth.

Ask Sage is an authorized GenAI platform inside DoD enclaves (FedRAMP High, IL5/IL6) and is already accessible to many of these users. However, using Ask Sage's chat interface directly does not solve the problem because:

1. **Context windows can't hold all the templates and reference material at once.** Users cannot drop a stack of templates plus FAR clauses plus prior packets plus their own inputs into a single conversation and one-shot a deliverable.
2. **No structured workflow.** Chat is conversational; document production is structured. Users have to manually shepherd the model through each section, repeatedly re-establishing context.
3. **No format fidelity.** Output is markdown/plain text, not the styled DOCX their organization actually consumes.

ASKSageDocumentWriter solves this by automating the workflow that an experienced user would otherwise drive by hand: parse templates into a machine-readable schema, drive section-by-section generation against that schema with RAG over user-curated reference datasets, and emit a final DOCX that respects the original template's formatting.

## 2. Primary user & use cases

**Primary user (v1):** A staff member at a DHA Military Treatment Facility (MTF) who writes contract request packages (PWS, market research, J&A, IGCE narratives, acquisition plans) and other long-form templated documents (SOPs, policies, memorandums) on a recurring basis. Has Ask Sage access on the `api.asksage.health.mil` tenant with ~250k query tokens/month and ~2M training (dataset ingestion) tokens/month available.

**Target adoption path:** prove value to the primary user → primary user's team funds additional token capacity → tool spreads to peers in similar roles across DHA and other DoD components.

**Representative document classes the tool must handle generically:**

- Performance Work Statements (contracting)
- Market research reports (contracting)
- J&A memos (contracting)
- Standard Operating Procedures
- Policy documents
- Memorandums (DoD memo format)
- After-action reports
- Charters

The tool must be **document-type agnostic.** No domain-specific logic for any one class. The user provides templates; the tool learns the structure.

## 3. Hard constraints

These are non-negotiable. Every design decision must respect them.

### C1 — No security review required for adoption
The tool must be adoptable by an end user inside a DoD enclave without requiring an organizational impact analysis, vulnerability assessment, ATO, or software-approval review. This is the **make-or-break adoption lever.** Practically, this means:

- No new servers operated by us
- No new shared infrastructure of any kind
- No new credential storage outside the user's own machine
- No new data egress paths beyond what Ask Sage already provides
- No new authorization boundary in the customer's enclave

### C2 — User's own Ask Sage credentials, end-to-end
The tool uses the user's personal Ask Sage API key to perform every API call. Credentials never touch any system we operate. The tool sits entirely within the existing trust boundary that Ask Sage already occupies.

### C3 — Browser-deliverable
The tool must run in a standard browser on a typical DHA workstation. No installer, no native binary, no admin rights, no new system services. Distribution is a folder of static files the user can open from `file://`, serve from any local web server they already have, or host on an internal share.

### C4 — Token frugality
The user's monthly budget is finite (~250k query tokens, ~2M training/dataset tokens). The tool must produce useful work within that budget — initial target is 2 major documents per month with comfortable headroom for revisions. Every prompt must justify its size.

## 4. Solution overview

ASKSageDocumentWriter is a **zero-backend single-page web application** that orchestrates the Ask Sage Server API to drive a multi-stage agentic document generation pipeline. **Templates are local files** (DOCX) that the user adds to the app once each — the app parses their OOXML deterministically in-browser, captures structure and formatting authoritatively from the bytes, and uses an LLM only for the semantic layer (section intent, style guidance, validation rules). **Reference material** (FAR, DHA Issuances, prior packets, policy library) lives in Ask Sage datasets and is retrieved via RAG at drafting time. The split is intentional: **structure is local; content is dataset.**

### The agentic chain

```
PROJECT START
   │
   ▼
┌─────────────────────────────────────────────────────────────┐
│ Stage 1a — Deterministic OOXML parse (no model call)        │
│ Input:  local DOCX file (uploaded once per template)        │
│ Action: jszip + custom OOXML walker reads document.xml,     │
│         styles.xml, numbering.xml, settings.xml, sectPr,    │
│         headers/footers, content controls, bookmarks.       │
│         Detects fill regions in priority order:             │
│           1. Word content controls (w:sdt)                  │
│           2. Bookmarks                                      │
│           3. Placeholder text patterns ([INSERT...], {{...}})│
│           4. Heading-bounded sections (fallback)            │
│         Splits fill regions into:                           │
│           • metadata (CUI banner, doc number, dates,        │
│             classification, author — small structured)      │
│           • body (Purpose, Scope, Procedure — prose)        │
│ Output: structural half of TemplateSchema (formatting,      │
│         styles, numbering refs, fill_region descriptors)    │
└─────────────────────────────────────────────────────────────┘
   │
   ▼
┌─────────────────────────────────────────────────────────────┐
│ Stage 1b — Semantic schema synthesis                        │
│ Model: google-gemini-2.5-flash (constrained JSON output)    │
│ Input:  structural digest from 1a + sample paragraphs from  │
│         each region + user's project intent                 │
│ Action: emit semantic half of TemplateSchema — section      │
│         intents, target word counts, voice/tone rules,      │
│         dependencies, validation rules                      │
│ Output: merged TemplateSchema, persisted in IndexedDB       │
│         alongside the original DOCX bytes                   │
└─────────────────────────────────────────────────────────────┘
   │
   ▼
┌─────────────────────────────────────────────────────────────┐
│ Stage 2 — Project planning (user-in-the-loop)               │
│ Model: google-claude-45-haiku                               │
│ Input:  TemplateSchemas + user's project description        │
│ Action: propose which templates the project needs, surface  │
│         the synthesized section list, prompt the user for   │
│         project-wide inputs (period of performance, scope,  │
│         POCs, etc.) — collected ONCE, shared across docs    │
│ Output: ProjectPlan (templates × sections × shared inputs)  │
└─────────────────────────────────────────────────────────────┘
   │
   ▼
┌─────────────────────────────────────────────────────────────┐
│ Stage 3 — Section drafting (the main token spend)           │
│ Model: google-claude-46-sonnet                              │
│ For each section in dependency order:                       │
│   a. Build a tight prompt =                                 │
│        TemplateSchema spec for this section                 │
│      + project shared inputs                                │
│      + ~200-token summaries of prior sections in this doc   │
│      + RAG hit from reference dataset(s) via /server/query  │
│        with `dataset` parameter and `limit_references`      │
│   b. Call /server/query                                     │
│   c. Persist draft + Ask Sage `references` for citations    │
│   d. Update token meter                                     │
│ Where dependencies allow, sections fan out in parallel.     │
└─────────────────────────────────────────────────────────────┘
   │
   ▼
┌─────────────────────────────────────────────────────────────┐
│ Stage 4 — Critic & validation pass                          │
│ Model: google-claude-45-haiku                               │
│ For each section, check against the schema's validation    │
│ rules (length caps, required content, banned terms,         │
│ format requirements). Flag issues for user review.          │
└─────────────────────────────────────────────────────────────┘
   │
   ▼
┌─────────────────────────────────────────────────────────────┐
│ Stage 5 — DOCX assembly & export                            │
│ No model call. Pure local OOXML manipulation.               │
│ Clone the original DOCX bytes (always available — they're   │
│ stored in IndexedDB from Stage 1a). Walk to each fill       │
│ region. For metadata regions, substitute project inputs    │
│ directly. For body regions, replace contained paragraphs    │
│ with new paragraphs that REFERENCE the same paragraph       │
│ styles, numbering definitions, and inheritance the          │
│ surrounding template uses. Headers, footers, page setup,    │
│ margins, theme are inherited automatically because we       │
│ never touch them.                                           │
│                                                             │
│ The LLM never picks fonts or margins. It produces           │
│ structured output with role tags (heading, body, step,      │
│ bullet, note); the assembler maps roles to the template's   │
│ own style names.                                            │
└─────────────────────────────────────────────────────────────┘
```

### Why local templates + dataset references

**Deterministic local DOCX schema is the foundational strength of the tool.** Ask Sage's dataset ingest converts files to plain text, which strips margins, multilevel list definitions, indent levels, style names, headers/footers, numbering, tables, content controls, and section properties — all of the things our users need preserved in the output. If the schema source is RAG text, the tool can produce a content outline but cannot produce a document that respects native formatting conventions. By reading the original DOCX bytes locally, we get every formatting property authoritatively, no inference needed, no tokens consumed.

This forces a deliberate split:

| Asset | Where it lives | Why |
|---|---|---|
| **Templates** | Local DOCX files in the app (IndexedDB) | Need bytes for formatting fidelity; templates change rarely |
| **Reference material** | Ask Sage datasets | Voluminous; benefits from RAG; already inside the user's enclave |

Benefits of this split:

- Honors C1 (no new infrastructure for either asset)
- Honors C2 (user's own credentials for Ask Sage; templates never leave the user's machine)
- Eliminates the `/user/*` CORS-block problem entirely — we don't need dataset enumeration at all
- Templates and their schemas can be shared with peers as plain files (DOCX + JSON pairs) over SharePoint, email, or git
- Schema synthesis becomes faster, cheaper, and more reliable because the LLM only does the semantic pass — structure is ground truth from OOXML

The earlier design that put templates in Ask Sage datasets was a constraint chase, not a strength. This is a strength.

## 5. Verified technical foundation

Probed against `https://api.asksage.health.mil` from a DHA workstation browser on 2026-04-07. Raw outputs in `API_Testing_Outputs.md` (originally added in commit `ff4f161`).

### CORS — split by API surface

| Endpoint | Result | Verdict |
|---|---|---|
| `/server/get-models` | 174ms, 200 OK, full model list | CORS permissive |
| `/server/openai/v1/chat/completions` | 209ms, 400 (model error) | CORS permissive |
| `/server/query` | 234ms, 200 (model error in body) | CORS permissive |
| `/user/get-datasets` | 85ms, `Failed to fetch` | CORS preflight rejected |
| `/user/get-all-files-ingested` | 85ms, `Failed to fetch` | CORS preflight rejected |

**Implication:** the entire Server API is browser-accessible; the entire User API is not. The architecture must use only `/server/*` endpoints and treat dataset management as out-of-band.

### Authentication

Use the user's long-lived Ask Sage API key directly in the `x-access-tokens` HTTP header on every `/server/*` call. **No token exchange.** The Ask Sage docs describe `x-access-tokens` as accepting "a 24-hour access token or API key for authentication" — confirmed empirically against the health tenant.

```
POST https://api.asksage.health.mil/server/query
Content-Type: application/json
x-access-tokens: <user's long-lived API key>

{
  "message": "...",
  "model": "google-claude-46-sonnet",
  "dataset": "pws-templates",
  "limit_references": 6,
  "temperature": 0.2
}
```

The token exchange flow (`/user/get-token-with-api-key`) is unusable from the browser on this tenant because it's on the User API surface — but we don't need it.

### Available models on the health.mil tenant

Verified via `/server/get-models`. Selection used by the pipeline:

| Stage | Model ID | Rationale |
|---|---|---|
| Schema synthesis (semantic pass) | `google-gemini-2.5-flash` | Strong constrained-JSON output; fast and cheap; only handles the semantic layer because structure is parsed deterministically from OOXML |
| Project planning | `google-claude-45-haiku` | Cheap, fast structural reasoning |
| Section drafting | `google-claude-46-sonnet` | Strong long-form, sane cost |
| Critic/validation | `google-claude-45-haiku` | Cheap pattern checks |
| Final polish | `google-claude-46-sonnet` | Same as drafting |
| Vision (v2 only) | `aws-bedrock-nemotron-12b-vl-gov` | For PDF templates with images |

The full model menu (40+ models incl. Claude 4.5/4.6 family, GPT-5.1/4.1 Gov, Gemini 2.5, Nova, Llama, Imagen, Veo, Nemotron) is enumerated at runtime via `/server/get-models`, so the pipeline's model selection is overridable by the user without code changes.

### Limitations discovered

1. **No raw file download from datasets.** Ask Sage exposes no documented endpoint to retrieve the original bytes of a file ingested into a dataset. This does not affect ASKSageDocumentWriter because templates are local files in the app, not dataset entries — the limitation only would have mattered if we were trying to round-trip binary fidelity through Ask Sage, which we're not.
2. **No streaming.** Ask Sage's `/server/query` does not appear to support SSE/streaming. The pipeline is job-based with section-level checkpoints; the user sees progress as sections complete, not as tokens stream.
3. **No conversation persistence.** Ask Sage is stateless; the app owns all conversation state.
4. **`/user/*` CORS-blocked.** No programmatic dataset enumeration or management. Reference datasets are configured by name (typed once, remembered locally). Does not affect templates because templates are local.

## 6. Template schema specification

The TemplateSchema is the artifact that connects template understanding to document generation. It has **two halves with distinct provenance:**

- **Structural half** (`formatting`, `fill_regions`, `style_refs`) — populated **deterministically** from the OOXML by the local parser in Stage 1a. These fields are ground truth from the binary; no LLM involved.
- **Semantic half** (`intent`, `target_words`, `depends_on`, `validation`, `voice`) — populated by Gemini Flash in Stage 1b from the parsed structure plus sample content. Human-reviewable and editable.

```jsonc
{
  "$schema": "https://asksage-doc-writer.local/schemas/template/v2",
  "id": "sop-mtf-clinical-v1",
  "name": "MTF Clinical SOP",
  "version": 1,
  "source": {
    "filename": "SOP_Clinical_Template_v3.docx",
    "ingested_at": "2026-04-07T18:22:11Z",
    "structural_parser_version": "1.0.0",
    "semantic_synthesizer": "google-gemini-2.5-flash",
    "docx_blob_id": "idb://templates/sop-mtf-clinical-v1.docx"
  },

  // ─── STRUCTURAL HALF — deterministic from OOXML ──────────────────
  "formatting": {
    "page_setup": {
      "paper": "letter",
      "orientation": "portrait",
      "margins_twips": { "top": 1440, "right": 1440, "bottom": 1440, "left": 1440 },
      "header_distance": 720,
      "footer_distance": 720
    },
    "default_font": { "family": "Times New Roman", "size_pt": 12 },
    "theme": "Office",
    "named_styles": [
      { "id": "Heading1", "name": "Heading 1", "based_on": "Normal", "outline_level": 0 },
      { "id": "Heading2", "name": "Heading 2", "based_on": "Normal", "outline_level": 1 },
      { "id": "BodyText", "name": "Body Text", "based_on": "Normal" },
      { "id": "ListNumber", "name": "List Number", "numbering_id": 7 },
      { "id": "ListBullet", "name": "List Bullet", "numbering_id": 3 },
      { "id": "Note", "name": "Note", "based_on": "BodyText" }
    ],
    "numbering_definitions": [
      {
        "id": 7,
        "kind": "decimal",
        "levels": [
          { "level": 0, "format": "%1.", "indent_twips": 720 },
          { "level": 1, "format": "%1.%2.", "indent_twips": 1440 },
          { "level": 2, "format": "%1.%2.%3.", "indent_twips": 2160 }
        ]
      },
      { "id": 3, "kind": "bullet", "levels": [{ "level": 0, "glyph": "•", "indent_twips": 720 }] }
    ],
    "headers": [{ "type": "default", "part": "word/header1.xml" }],
    "footers": [{ "type": "default", "part": "word/footer1.xml" }]
  },

  // ─── METADATA FILL REGIONS — small, structured, filled from project inputs ───
  // These get filled WITHOUT an LLM call. Values come from the user's project
  // inputs or shared profile (POCs, dates, classification, etc.).
  "metadata_fill_regions": [
    {
      "id": "cui_banner",
      "kind": "content_control",
      "sdt_tag": "CUIBanner",
      "control_type": "dropdown",
      "allowed_values": ["UNCLASSIFIED", "CUI", "CUI//SP-PRVCY", "CUI//SP-PROPIN"],
      "project_input_field": "classification",
      "required": true
    },
    {
      "id": "document_number",
      "kind": "content_control",
      "sdt_tag": "DocNumber",
      "control_type": "plain_text",
      "project_input_field": "document_number"
    },
    {
      "id": "effective_date",
      "kind": "content_control",
      "sdt_tag": "EffectiveDate",
      "control_type": "date",
      "project_input_field": "effective_date"
    },
    {
      "id": "approving_authority",
      "kind": "bookmark",
      "bookmark_name": "ApprovingAuthority",
      "control_type": "plain_text",
      "project_input_field": "approving_authority"
    }
  ],

  // ─── BODY FILL REGIONS / SECTIONS — prose, drafted by the LLM ─────
  "sections": [
    {
      "id": "purpose",
      "name": "1. Purpose",
      "order": 1,
      "required": true,

      // Structural — from OOXML parse
      "fill_region": {
        "kind": "heading_bounded",
        "heading_text": "1. Purpose",
        "heading_style_id": "Heading1",
        "body_style_id": "BodyText",
        "anchor_paragraph_index": 12,
        "end_anchor_paragraph_index": 14
      },

      // Semantic — from Gemini Flash
      "intent": "State the SOP's goal and the operational outcome it produces.",
      "target_words": [80, 150],
      "depends_on": [],
      "validation": { "must_mention": ["scope_subject"], "must_not_exceed_words": 200 }
    },
    {
      "id": "responsibilities",
      "name": "3. Responsibilities",
      "order": 3,
      "required": true,
      "fill_region": {
        "kind": "content_control",
        "sdt_tag": "ResponsibilitiesBody",
        "heading_style_id": "Heading1",
        "body_style_id": "BodyText",
        "permitted_roles": ["body", "bullet", "table"],
        "table_hint": { "columns": ["Role", "Duty"], "style_id": "TableGrid" }
      },
      "intent": "Enumerate roles and their specific duties under this SOP.",
      "target_words": [200, 400],
      "depends_on": ["purpose", "scope"]
    },
    {
      "id": "procedure",
      "name": "4. Procedure",
      "order": 4,
      "required": true,
      "fill_region": {
        "kind": "content_control",
        "sdt_tag": "ProcedureBody",
        "heading_style_id": "Heading1",
        "body_style_id": "BodyText",
        "numbered_list_style_id": "ListNumber",
        "numbering_id": 7,
        "permitted_roles": ["body", "step", "note", "bullet"]
      },
      "intent": "Step-by-step instructions an operator can follow without ambiguity.",
      "target_words": [400, 1200],
      "depends_on": ["scope", "responsibilities"]
    }
    // ... additional sections elided
  ],

  "style": {
    "voice": "third_person",
    "tense": "present",
    "register": "formal_government",
    "jargon_policy": "use_DoD_and_DHA_terminology",
    "banned_phrases": ["going forward", "leverage synergies"]
  }
}
```

### How this connects to drafting and export

**Drafting** (Stage 3) sees the section's `intent`, `target_words`, dependencies, and validation rules. The drafting model produces output as a structured paragraph array with role tags:

```json
[
  { "role": "step", "text": "Verify the patient's eligibility against DEERS." },
  { "role": "step", "text": "Document the encounter in CHCS." },
  { "role": "note", "text": "If DEERS is unreachable, escalate to the duty officer." }
]
```

**Export** (Stage 5) maps role tags to the template's own style ids via `fill_region.permitted_roles` and the style/numbering references:

| Role tag | Resolved to (for this section) |
|---|---|
| `step` | paragraph using `ListNumber` style with `numbering_id: 7` |
| `body` | paragraph using `BodyText` style |
| `note` | paragraph using `Note` style |
| `bullet` | paragraph using `ListBullet` style |
| `table` | actual `<w:tbl>` element using `TableGrid` style |

**The LLM never picks fonts, margins, or indents.** Those live in the template's styles. The schema's job is to expose the right style ids to the assembler so role tags resolve correctly.

### Key properties

- **Document-class agnostic.** Same shape for SOP, PWS, J&A memo, DoD memorandum, charter, after-action report. No domain hardcoding.
- **Two-halved provenance.** Structural fields are deterministic and stable; semantic fields are LLM-derived and editable. Re-running the semantic pass never overwrites the structural half.
- **Metadata vs body separation.** CUI banners, classification dropdowns, document numbers, dates, approving authorities — filled from project inputs without an LLM call. Keeps the drafting budget focused on prose.
- **Fill region detection priority** (in Stage 1a): content controls → bookmarks → placeholder text patterns → heading-bounded fallback. Real-world templates from DHA are likely to mix all four.
- **Section dependencies are explicit** (`depends_on`), enabling parallel drafting of independent sections.
- **Schema is paired with the original DOCX** via `docx_blob_id` — both are stored together in IndexedDB and exported/imported together.

## 7. Architecture & tech stack

### Component diagram

```
┌──────────────────────────────────────────────────────────────────┐
│  Browser (DHA workstation)                                       │
│  Origin: file://, http://localhost, or internal web server       │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  React SPA                                                 │  │
│  │                                                            │  │
│  │  ┌────────────┐ ┌────────────┐ ┌────────────────────────┐  │  │
│  │  │ Template   │ │ Document   │ │ Generation             │  │  │
│  │  │ + ingest   │ │ workspace  │ │ pipeline (in-tab)      │  │  │
│  │  └────────────┘ └────────────┘ └────────────────────────┘  │  │
│  │         │             │                  │                │  │
│  │         └─────────────┴──────────────────┘                 │  │
│  │                       │                                    │  │
│  │              ┌────────▼─────────┐                          │  │
│  │              │  Ask Sage client │                          │  │
│  │              │  (fetch wrapper) │                          │  │
│  │              └────────┬─────────┘                          │  │
│  │                       │                                    │  │
│  │              ┌────────▼─────────┐                          │  │
│  │              │  IndexedDB       │                          │  │
│  │              │  - template DOCX │                          │  │
│  │              │    bytes (Blobs) │                          │  │
│  │              │  - schemas       │                          │  │
│  │              │  - projects      │                          │  │
│  │              │  - drafts        │                          │  │
│  │              │  - audit log     │                          │  │
│  │              │  - api key (enc) │                          │  │
│  │              └──────────────────┘                          │  │
│  └────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────┬────────────────────────────────┘
                                  │  HTTPS, x-access-tokens header
                                  ▼
                    ┌─────────────────────────────┐
                    │  api.asksage.health.mil     │
                    │  /server/* only             │
                    │  (already authorized in     │
                    │   the user's enclave)       │
                    └─────────────────────────────┘
```

### Tech stack

| Layer | Choice | Rationale |
|---|---|---|
| Build | Vite | Fast dev loop, simple static output, no backend assumed |
| UI framework | React + TypeScript | Mature ecosystem for the workspace UI, type safety on the schema |
| State | Zustand | Minimal, no boilerplate, fits in-tab workflow |
| Persistence | Dexie (IndexedDB) | Simple typed IndexedDB wrapper; stores DOCX bytes as Blobs alongside schemas |
| HTTP | native `fetch` | No SDK needed; Ask Sage is plain JSON |
| **DOCX read** | **`jszip` + custom OOXML walker we own** | Direct, deterministic access to every formatting property. Reads `document.xml`, `styles.xml`, `numbering.xml`, `settings.xml`, `sectPr`, `header*.xml`, `footer*.xml`, `theme1.xml`, content controls (`w:sdt`), bookmarks. Rejected `mammoth.js` (lossy → HTML), `docx-preview` (renders only), `docx` npm (write-only). |
| **DOCX write** | **Clone original bytes via `jszip` + targeted XML mutation** | Preserves every formatting node we don't touch. Walks to fill regions by content control id, bookmark name, placeholder pattern, or heading anchor — and replaces only the contained paragraphs. Headers/footers/margins/styles inherited automatically. |
| DOCX write (scratch fallback) | `docx` npm package | Only used in the unlikely case a template's bytes are unavailable at export time. Lower fidelity. |
| XML | `fast-xml-parser` or browser-native `DOMParser` | For parsing/serializing the OOXML parts |
| PDF parsing (v1 best-effort) | `pdf.js` | Browser-native; extracts text + positions + fonts. Fidelity is approximate compared to DOCX. |
| Crypto for stored API key | WebCrypto API (AES-GCM with PBKDF2-derived key from user passphrase) | Browser-native, no library |
| Routing | React Router | Standard |
| Tests | Vitest + Playwright | Vitest for unit (especially the OOXML parser/assembler — these need extensive fixture-based tests against real DHA-style templates). Playwright for the agentic pipeline integration tests against a recorded Ask Sage transcript. |

### Why no backend, restated

The architecture has zero server-side code we operate. The Ask Sage Server API is reached directly from the browser via `fetch`. This is what makes C1 (no security review) achievable: there is nothing to review beyond the static files themselves, and there are no new data paths.

### Distribution

`npm run build` produces a `dist/` folder. The user puts that folder anywhere they can serve static files: `python -m http.server`, an internal SharePoint static-site host, an Apache directory on a workstation, or even just opening `index.html` from `file://`. No installer, no admin rights.

## 8. v1 scope

### In scope

- API key entry, validation against `/server/get-models`, optional encrypted persistence in IndexedDB
- **Local DOCX template ingest:** file picker, OOXML parser, fill region detection (content controls, bookmarks, placeholder text, heading-bounded fallback), structural schema emission, original DOCX bytes stored as Blob in IndexedDB
- **Semantic schema synthesis** via Gemini 2.5 Flash, merged into the unified TemplateSchema
- **Schema viewer/editor UI** with structural fields read-only and semantic fields editable
- **Template library:** persistent local collection of ingested templates + their schemas, with import/export as DOCX+JSON pairs for sharing
- Project creation: pick templates from the local library, name reference dataset(s), provide project description
- Stage 2: project planning UI — auto-derives shared inputs from `metadata_fill_regions` across selected templates
- Stage 3: section drafting pipeline with live progress, per-section regenerate, RAG against reference datasets, structured paragraph output with role tags
- Stage 4: critic pass against validation rules + Haiku LLM critique of flagged sections
- **Stage 5: DOCX assembly via clone-and-mutate** — preserves all formatting from the original template, swaps in metadata values and drafted prose, role-tag → style-id resolution, round-trip verification
- Live token budget meter (reads `usage` field from `/server/query` responses) with pre-run cost projection
- Local audit log of every Ask Sage call (prompt, model, tokens, references) viewable in-app
- Project export/import as a `.json` file (so users can share project configs)

### Out of scope (v2 or later)

- **PDF template input:** best-effort only in v1 (DOCX is the priority); full PDF parsing with structure inference is v2
- **PDF output:** v1 outputs DOCX exclusively; users print to PDF if needed
- **Scratch DOCX generation** (when no template bytes are available): not needed in v1 because templates are always ingested as files. Reserved as a v2 fallback only if the use case appears.
- In-app dataset management (Ask Sage UI handles this — and the User API is CORS-blocked anyway)
- Multi-user collaboration / shared workspaces
- Automated FAR/DHA citation verification
- Image-bearing templates with vision-model passes
- Schema versioning with diff/migration
- Rare content control types (rich text, repeating sections, building block galleries) — supported types documented per release
- Browser extension or Tauri packaging
- Server-side anything

## 9. Token economics

### Per-document cost model

For one major document of typical length (e.g., a 15-page SOP, a 10-page market research report, or one 20-page PWS):

| Stage | Model | Calls | Avg. tokens per call (in/out) | Subtotal |
|---|---|---|---|---|
| Schema synthesis (semantic only; structural is free) — paid once per template, amortized across ~5 docs that reuse it | Flash | 1 ÷ 5 = 0.2 | 4k in / 2k out | ~1k |
| Project planning | Haiku | 1 | 3k in / 1k out | 4k |
| Section drafting (~8 sections, with summaries + RAG snippets) | Sonnet 4.6 | 8 | 4k in / 2k out | 48k |
| Critic pass (only on flagged sections, ~half) | Haiku | 4 | 2.5k in / 0.5k out | 12k |
| Final polish | Sonnet 4.6 | 1 | 6k in / 3k out | 9k |
| **Total per major document** | | | | **~74k tokens** |

At ~74k tokens per document, the 250k/month budget supports **3 major documents per month** with comfortable headroom for revisions and re-runs. Schema synthesis is now nearly free thanks to (a) deterministic OOXML parsing eliminating the structural cost entirely and (b) Flash being cheap and fast for the semantic pass. The remaining cost is concentrated where it matters: actual prose drafting.

### Levers if we need to push further

1. Drop critic pass to spot-check only flagged sections → -15k/doc
2. Replace section-drafting model with `google-claude-45-sonnet` instead of 4.6 → ~40% cost reduction at modest quality cost
3. Tighter section summaries (100 tokens instead of 200) → -5k/doc
4. RAG `limit_references: 4` instead of 6 → -3k/doc

Aggressive mode lands around 50k/document → 5 docs/month within the same budget.

### Training/dataset budget

The 2M training token budget is consumed entirely by ingesting **reference material** (FAR, DHA Issuances, prior packets, policy library) into Ask Sage datasets, which the user does in Ask Sage's own UI. **Templates do not consume training tokens** because they live locally as DOCX files in the app, not in Ask Sage datasets.

## 10. Phased build plan

Phases are scoped by deliverable, not calendar.

### Phase 0 — Project scaffold

- Vite + React + TS project initialized in repo
- Dexie schema for templates (DOCX Blob + schema)/projects/drafts/audit
- Ask Sage client wrapper with `x-access-tokens` auth
- API key entry screen with `/server/get-models` validation
- Basic routing and shell layout
- Vitest harness with a fixture transcript of Ask Sage responses for offline testing

**Done when:** the user can paste an API key, see the model list returned by their tenant, and the dev server runs without backend.

### Phase 1a — DOCX template parser

- DOCX file picker / drop zone
- `jszip` + custom OOXML walker reading `document.xml`, `styles.xml`, `numbering.xml`, `settings.xml`, `sectPr`, `header*.xml`, `footer*.xml`, `theme1.xml`
- Fill region detection in priority order: content controls (`w:sdt`) → bookmarks → placeholder text patterns → heading-bounded fallback
- Metadata vs body fill region classification (control type, value constraints, project_input_field mapping)
- Emits the structural half of the TemplateSchema and stores the original DOCX as a Blob in IndexedDB paired with the schema
- Fixture-based unit tests against several real-world DOCX templates (DHA-style SOP, DoD memo, PWS template) — this is the most test-heavy piece of the codebase

**Done when:** dropping a real DHA template DOCX into the app produces a structurally complete TemplateSchema (formatting, styles, numbering, fill_regions) with no LLM call. The schema viewer can render the parsed structure.

### Phase 1b — Semantic schema synthesis

- Gemini 2.5 Flash client integration with strict-JSON output
- Stage 1b prompt: takes the structural digest from 1a + sample paragraphs from each region → emits semantic half (intent, target_words, depends_on, validation, voice/style)
- Merge into the unified TemplateSchema
- Schema viewer/editor UI: tree view of sections, edit semantic fields inline, structural fields read-only

**Done when:** the user can take a freshly parsed template through the semantic pass and end up with a TemplateSchema they'd actually use.

### Phase 2 — Section drafting

- Project creation: pick templates from the local library, name reference dataset(s), provide project description
- Stage 2: project planning UI with shared inputs (auto-derived from `metadata_fill_regions` across selected templates so the user fills CUI banner / dates / POCs once)
- Stage 3: drafting pipeline with parallelism where `depends_on` allows; structured paragraph output with role tags
- Section workspace with regenerate button, references panel from Ask Sage RAG, live token meter
- Audit log viewer

**Done when:** the user can run a real project end-to-end through drafting and see all sections produced as structured paragraph arrays with citations.

### Phase 3 — DOCX assembly & export

- DOCX clone-and-mutate assembler: walks the original bytes, locates each fill region (by sdt id, bookmark name, placeholder pattern, or heading anchor), substitutes metadata regions from project inputs, replaces body region paragraphs with new ones referencing the same styles and numbering definitions
- Role-tag → style-id resolver per section
- Round-trip verification: the assembled DOCX is re-parsed by the same Phase 1a parser to confirm structural integrity
- Save / download flow

**Done when:** an exported document opens in Word with margins, headers/footers, multilevel lists, indents, content control values, and styles all matching the original template, with the LLM-drafted prose in place of the fill regions.

### Phase 4 — Critic, polish, and packaging

- Stage 4: critic pass with deterministic validation (length, must_mention, banned_phrases) + Haiku LLM critique on flagged sections
- Stage 5: final polish pass
- Cost projection UI (pre-run estimate based on schema)
- Settings: model overrides per stage
- Production build, distribution README, internal-share deployment guide

**Done when:** the user is producing real contracting/SOP/policy work with the tool and the team is positioned to evaluate funding additional token capacity.

## 11. Open questions & risks

### Open questions

1. **Fill region detection coverage.** Real DHA templates are likely to mix content controls (CUI banners, classification dropdowns, admin metadata), bookmarks, and unmarked heading-bounded sections. How well does the priority-ordered detector handle messy real-world templates? Tested via the Phase 1a fixture suite.
2. **Semantic synthesis quality with Gemini Flash.** Flash is fast and JSON-strong, but the semantic pass needs to produce genuinely useful section intents, target lengths, and validation rules from the structural digest. If quality is insufficient, fall back to `google-claude-45-sonnet` for synthesis at modest cost increase (still cheap because it's one call per template).
3. **`/server/query` `dataset` parameter behavior.** The Ask Sage docs describe the parameter but don't specify exactly how RAG retrieval scopes work for multi-file datasets. May require empirical tuning of `limit_references` and prompt strategies during Phase 2.
4. **Token usage reporting accuracy.** The `usage` field in responses needs to be cross-checked against the user's Ask Sage usage dashboard (we can't call `/server/count-monthly-tokens` because it's on the User API surface). A small drift is acceptable; large drift would break the budget meter.
5. **API key persistence UX.** Encrypted IndexedDB with a passphrase is the right default, but adds friction. Validate during Phase 0 whether users prefer paste-on-load.
6. **Role-tag set completeness.** The drafting model emits paragraphs tagged with semantic roles (`heading`, `body`, `step`, `bullet`, `note`, `table`). Are there additional roles real templates need (`warning`, `caution`, `definition`, `example`, `quotation`)? Surface during Phase 3 fixture testing.

### Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Ask Sage changes CORS policy on `/server/*` | Low | Catastrophic — kills the architecture | The SPA's HTTP layer is isolated so swapping in a local-proxy fallback (Python script or browser extension) is a small change. Not built in v1. |
| OOXML parser misses fill regions in real-world templates | Medium | Some sections require manual schema editing | Multiple detection strategies + schema editor UI + fixture suite of real DHA-style templates built up over Phase 1a |
| Style/numbering inheritance breaks on export for unusual templates (custom multilevel lists, nested tables, embedded objects) | Medium | Some output documents need manual fixup in Word | Round-trip verification in Phase 3; document known unsupported features; maintain a fixture corpus for regression testing |
| Semantic synthesis produces low-quality intents and validation rules | Medium | More user time spent editing the schema | Schema editor is core v1 UX; if Flash is insufficient, escalate to Sonnet for the semantic pass |
| Token costs exceed projections | Low (math has headroom) | User runs out of monthly budget mid-project | Live meter + cost projection + abort button; aggressive-mode model overrides documented |
| Ask Sage adds streaming and the lack of streaming feels dated | Low | UX polish only | Job-based UX with section-level checkpoints is appropriate for long-form anyway |
| Templates with rare content control types (rich text, repeating sections, building block galleries) aren't fully supported in v1 | Medium | Those templates fall back to placeholder/heading detection | Document supported control types per release; expand coverage in v2 |

---

## Appendix A — Decisions log

| Date | Decision | Reason |
|---|---|---|
| 2026-04-06 | Zero-backend SPA, no hosted infrastructure | Constraint C1 (no security review) |
| 2026-04-06 | User's own Ask Sage credentials, never proxied | Constraint C2 |
| 2026-04-07 | Skip Ask Sage token-exchange flow; use raw API key in `x-access-tokens` | `/user/get-token-with-api-key` is CORS-blocked on health.mil; raw API key works directly per Ask Sage docs and verified empirically |
| 2026-04-07 | No in-app dataset management UI | `/user/*` endpoints are CORS-blocked on health.mil; users manage datasets in Ask Sage's own UI |
| 2026-04-07 | **Templates are local DOCX files in the app, NOT Ask Sage dataset entries.** Reference material remains in Ask Sage datasets. | Ask Sage's dataset ingest converts files to plain text and strips formatting (margins, multilevel lists, indents, styles, headers/footers, content controls). If schemas are synthesized from RAG text only, the tool cannot produce documents with native formatting. Reading the original DOCX bytes locally is the only way to preserve formatting fidelity, and it makes deterministic local schema parsing the foundational strength of the tool. Walks back the 2026-04-06 "templates in datasets" idea. |
| 2026-04-07 | Two-stage schema synthesis: Stage 1a deterministic OOXML parse → structural half; Stage 1b LLM semantic pass → semantic half | Structure is ground truth from the binary, costs zero tokens, never wrong. LLM is reserved for what only an LLM can do: inferring section intent, target lengths, validation rules. |
| 2026-04-07 | Schema synthesis (semantic pass) uses `google-gemini-2.5-flash` | Strong constrained-JSON output, fast, cheap. Earlier choice of Claude 4.6 Opus was overkill since structural extraction is now deterministic. |
| 2026-04-07 | Drafting models: `google-claude-46-sonnet` (drafting/polish), `google-claude-45-haiku` (planning/critic) | Verified available on health.mil; best quality/cost trade for prose generation |
| 2026-04-07 | DOCX export = clone original bytes + targeted XML mutation. **No more "hybrid skeleton-fill vs. scratch" — skeleton-fill is the only path** because the original DOCX is always present (it's how we ingested the template in the first place). Scratch-generation is a v2 fallback only. | Eliminates the lower-fidelity output path entirely. The user doesn't have to "provide a skeleton" as a separate step — the template they ingested IS the skeleton. |
| 2026-04-07 | The drafting LLM emits structured paragraphs with role tags (`heading`, `body`, `step`, `bullet`, `note`, `table`); the assembler maps role tags to template-defined style ids per section. **The LLM never picks fonts, margins, or indents.** | Word's style system handles formatting inheritance correctly when content references styles. Pushing formatting decisions into the template's existing styles is dramatically more robust than trying to generate formatting from a schema description. |
| 2026-04-07 | Metadata fill regions (CUI banner, classification, dates, doc number, POCs) are first-class and filled from project inputs WITHOUT an LLM call | DHA templates contain content controls for CUI markings and admin metadata that must be filled deterministically, not drafted. Keeps the drafting budget focused on prose. |
| 2026-04-07 | PDF input is best-effort in v1; PDF output is deferred to v2 | DOCX has authoritative structural metadata; PDF doesn't. Generating fixed-layout PDF from scratch is its own project. v1 outputs DOCX even from PDF inputs; users print to PDF if needed. |

## Appendix B — Verified API endpoints used

All on `https://api.asksage.health.mil`:

- `POST /server/get-models` — model menu enumeration; called once per session
- `POST /server/query` — primary completion endpoint with `dataset` and `limit_references` for RAG; used by all drafting stages
- `POST /server/openai/v1/chat/completions` — alternative OpenAI-compatible endpoint, available as a fallback if `/server/query` behavior changes

Header on every call: `x-access-tokens: <user's Ask Sage API key>`

## Appendix C — File reference

- `probe.html` — browser-side API probe; kept in repo for future re-validation
- `API_Testing_Outputs.md` — captured probe results from 2026-04-07 verification run; basis for §5
- `PRD.md` — this document

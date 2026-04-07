# ASKSageDocumentWriter — Product Requirements Document

**Status:** Draft v0.1
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

ASKSageDocumentWriter is a **zero-backend single-page web application** that orchestrates the Ask Sage Server API to drive a multi-stage agentic document generation pipeline. The user supplies templates and reference material as **Ask Sage datasets** (managed in Ask Sage's own UI, not in this app), and the tool synthesizes a JSON schema from the template dataset on each project, then drives section-by-section drafting against the reference dataset(s).

### The agentic chain

```
PROJECT START
   │
   ▼
┌─────────────────────────────────────────────────────────────┐
│ Stage 1 — Schema synthesis (one-shot per project)           │
│ Model: google-claude-46-opus                                │
│ Input:  name of template dataset + project intent           │
│ Action: query the template dataset, asking the model to     │
│         identify each template, dissect its structure, and  │
│         emit a strict JSON TemplateSchema describing        │
│         sections, style rules, formatting conventions,      │
│         field placeholders, and validation rules            │
│ Output: TemplateSchema[] for the project (cached locally)   │
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
│ If the user has provided a local DOCX skeleton for the      │
│ template, fill it in place (high fidelity). Otherwise,      │
│ generate a styled DOCX from scratch using the schema's      │
│ formatting rules (lower fidelity, no friction).             │
└─────────────────────────────────────────────────────────────┘
```

### Why dataset-first

Templates and reference material live in Ask Sage datasets that the user manages through Ask Sage's existing web UI. The tool **never uploads or hosts files itself.** Benefits:

- Honors C1 (no new data flows or storage)
- Honors C2 (Ask Sage already controls the data inside the user's existing trust boundary)
- Eliminates dataset management UI entirely from v1 (it lives in Ask Sage)
- Lets the user share template datasets with peers using Ask Sage's existing sharing model

The tradeoff is that the User API (`/user/*`) is CORS-blocked from the browser on the health.mil tenant (see §5), so the tool cannot list or enumerate datasets programmatically. The user types the dataset name into a project config field; the app remembers it for next time. **The LLM is the file browser** — Stage 1 asks it to enumerate and describe what it finds in the dataset via RAG.

## 5. Verified technical foundation

Probed against `https://api.asksage.health.mil` from a DHA workstation browser on 2026-04-07. Raw outputs in `API_Testing_Outputs` (commit `ff4f161`).

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
| Schema synthesis | `google-claude-46-opus` | Most capable; called once per project |
| Project planning | `google-claude-45-haiku` | Cheap, fast structural reasoning |
| Section drafting | `google-claude-46-sonnet` | Strong long-form, sane cost |
| Critic/validation | `google-claude-45-haiku` | Cheap pattern checks |
| Final polish | `google-claude-46-sonnet` | Same as drafting |
| Vision (v2 only) | `aws-bedrock-nemotron-12b-vl-gov` | For PDF templates with images |

The full model menu (40+ models incl. Claude 4.5/4.6 family, GPT-5.1/4.1 Gov, Gemini 2.5, Nova, Llama, Imagen, Veo, Nemotron) is enumerated at runtime via `/server/get-models`, so the pipeline's model selection is overridable by the user without code changes.

### Limitations discovered

1. **No raw file download from datasets.** Ask Sage exposes no documented endpoint to retrieve the original DOCX bytes of a file ingested into a dataset. The schema synthesizer therefore works from the *text* representation Ask Sage returns via RAG, not the original binary. For high-fidelity DOCX export the user must drop a local copy of each template into the app once as an export skeleton (see §6, hybrid export).
2. **No streaming.** Ask Sage's `/server/query` does not appear to support SSE/streaming. The pipeline is job-based with section-level checkpoints; the user sees progress as sections complete, not as tokens stream.
3. **No conversation persistence.** Ask Sage is stateless; the app owns all conversation state.

## 6. Template schema specification

The TemplateSchema is the artifact that connects template understanding to document generation. It is plain JSON, intended to be readable by both the LLM and a human reviewer.

```json
{
  "$schema": "https://asksage-doc-writer.local/schemas/template/v1",
  "id": "sop-mtf-clinical-v1",
  "name": "MTF Clinical SOP",
  "version": 1,
  "source": {
    "dataset": "mtf-templates",
    "filename": "SOP_Clinical_Template_v3.docx",
    "synthesized_by": "google-claude-46-opus",
    "synthesized_at": "2026-04-07T18:22:11Z"
  },
  "document_metadata": {
    "title_field": "title",
    "classification_banner": "UNCLASSIFIED",
    "header_fields": ["effective_date", "approving_authority", "review_cycle"],
    "footer_fields": ["page_x_of_y", "document_id"]
  },
  "style": {
    "voice": "third_person",
    "tense": "present",
    "register": "formal_government",
    "sentence_length": "moderate",
    "jargon_policy": "use_DoD_and_DHA_terminology",
    "banned_phrases": ["going forward", "leverage synergies"]
  },
  "formatting": {
    "heading_levels": ["1.", "1.1.", "1.1.1."],
    "list_style": "numbered_then_lettered",
    "citation_style": "inline_parenthetical",
    "table_policy": "use_for_responsibility_matrices"
  },
  "sections": [
    {
      "id": "purpose",
      "name": "1. Purpose",
      "order": 1,
      "required": true,
      "intent": "State the SOP's goal and the operational outcome it produces.",
      "target_words": [80, 150],
      "depends_on": [],
      "validation": {
        "must_mention": ["scope_subject"],
        "must_not_exceed_words": 200
      }
    },
    {
      "id": "scope",
      "name": "2. Scope",
      "order": 2,
      "required": true,
      "intent": "Define which personnel, facilities, and activities the SOP applies to.",
      "target_words": [60, 120],
      "depends_on": ["purpose"]
    },
    {
      "id": "responsibilities",
      "name": "3. Responsibilities",
      "order": 3,
      "required": true,
      "intent": "Enumerate roles and their specific duties under this SOP.",
      "target_words": [200, 400],
      "depends_on": ["purpose", "scope"],
      "format_hint": "responsibility_matrix_table"
    },
    {
      "id": "procedure",
      "name": "4. Procedure",
      "order": 4,
      "required": true,
      "intent": "Step-by-step instructions an operator can follow without ambiguity.",
      "target_words": [400, 1200],
      "depends_on": ["scope", "responsibilities"]
    },
    {
      "id": "references",
      "name": "5. References",
      "order": 5,
      "required": true,
      "intent": "Cite governing regulations, instructions, and parent policies.",
      "target_words": [40, 200],
      "depends_on": []
    },
    {
      "id": "revision_history",
      "name": "6. Revision History",
      "order": 6,
      "required": true,
      "intent": "Tabular log of versions, dates, authors, and change summaries.",
      "target_words": [20, 100],
      "depends_on": [],
      "format_hint": "table_columns: version, date, author, summary"
    }
  ]
}
```

Key properties of the schema:

- **Document-class agnostic.** The same shape works for an SOP, a PWS, a J&A memo, a DoD memorandum, etc. No field is contracting-specific or healthcare-specific.
- **Section dependencies are explicit** (`depends_on`), enabling parallel drafting of independent sections and serial drafting where context must flow.
- **Validation rules are first-class** so the critic stage can run deterministic checks before LLM-driven critique.
- **Style and formatting rules are scoped to the document, not the section**, since most templates are stylistically uniform.
- **Synthesis provenance** is recorded so future versions can re-synthesize and diff.

The schema is regenerated fresh per project from the current state of the template dataset. There is no schema cache invalidation problem because there is no schema cache; this is a deliberate v1 simplification.

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
│  │  │ Project    │ │ Document   │ │ Generation             │  │  │
│  │  │ setup      │ │ workspace  │ │ pipeline (in-tab)      │  │  │
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
│  │              │  - projects      │                          │  │
│  │              │  - schemas       │                          │  │
│  │              │  - drafts        │                          │  │
│  │              │  - skeletons     │                          │  │
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
| Persistence | Dexie (IndexedDB) | Simple typed IndexedDB wrapper |
| HTTP | native `fetch` | No SDK needed; Ask Sage is plain JSON |
| DOCX read | `jszip` + custom OOXML walker | Direct OOXML access; no external API |
| DOCX write (skeleton-fill) | `docxtemplater` (license check required) or hand-rolled OOXML | Preserves original styling |
| DOCX write (from scratch) | `docx` npm package | Used when no skeleton is available |
| PDF parsing (v2) | `pdf.js` | Browser-native |
| Crypto for stored API key | WebCrypto API (AES-GCM with PBKDF2-derived key from user passphrase) | Browser-native, no library |
| Routing | React Router | Standard |
| Tests | Vitest + Playwright | Vitest for unit, Playwright for the agentic pipeline integration tests against a recorded Ask Sage transcript |

### Why no backend, restated

The architecture has zero server-side code we operate. The Ask Sage Server API is reached directly from the browser via `fetch`. This is what makes C1 (no security review) achievable: there is nothing to review beyond the static files themselves, and there are no new data paths.

### Distribution

`npm run build` produces a `dist/` folder. The user puts that folder anywhere they can serve static files: `python -m http.server`, an internal SharePoint static-site host, an Apache directory on a workstation, or even just opening `index.html` from `file://`. No installer, no admin rights.

## 8. v1 scope

### In scope

- API key entry, validation against `/server/get-models`, optional encrypted persistence in IndexedDB
- Project creation: name, description, target template dataset name, target reference dataset name(s)
- Stage 1: schema synthesis from template dataset → JSON TemplateSchemas, displayed for user review/edit
- Stage 2: project planning UI — select which templates the project needs, fill shared inputs once
- Stage 3: section drafting pipeline with live progress, per-section regenerate, RAG against reference datasets
- Stage 4: critic pass against validation rules + LLM critique of each section
- Stage 5: DOCX export — hybrid mode (skeleton-fill if local DOCX provided, scratch otherwise)
- Live token budget meter (reads `usage` field from `/server/query` responses) with pre-run cost projection
- Local audit log of every Ask Sage call (prompt, model, tokens, references) viewable in-app
- Project export/import as a `.json` file (so users can share project configs)

### Out of scope (v2 or later)

- PDF template ingestion (v1 is DOCX only)
- In-app dataset management (Ask Sage UI handles this — and the User API is CORS-blocked anyway)
- Multi-user collaboration / shared workspaces
- Automated FAR/DHA citation verification
- Image-bearing templates with vision-model passes
- Schema versioning with diff/migration
- Browser extension or Tauri packaging
- Server-side anything

## 9. Token economics

### Per-document cost model

For one major document of typical length (e.g., a 15-page SOP, a 10-page market research report, or one 20-page PWS):

| Stage | Calls | Avg. tokens per call (in/out) | Subtotal |
|---|---|---|---|
| Schema synthesis (amortized: this happens once per project, across ~3 docs) | 1 ÷ 3 = 0.33 | 8k in / 4k out | ~4k |
| Project planning | 1 | 3k in / 1k out | 4k |
| Section drafting (~8 sections, with summaries + RAG snippets) | 8 | 4k in / 2k out | 48k |
| Critic pass | 8 | 2.5k in / 0.5k out | 24k |
| Final polish | 1 | 6k in / 3k out | 9k |
| **Total per major document** | | | **~89k tokens** |

At ~89k tokens per document, the 250k/month budget supports **2-3 major documents per month** with comfortable headroom for revisions. This meets the user's stated floor of 2 major docs/month and leaves room for the team to validate the workflow before requesting a token bump.

### Levers if we need to push further

1. Drop critic pass to spot-check only flagged sections → -15k/doc
2. Replace section-drafting model with `google-claude-45-sonnet` instead of 4.6 → ~40% cost reduction at modest quality cost
3. Tighter section summaries (100 tokens instead of 200) → -5k/doc
4. RAG `limit_references: 4` instead of 6 → -3k/doc

Aggressive mode lands around 50k/document → 5 docs/month within the same budget.

### Training/dataset budget

The 2M training token budget is consumed entirely by ingesting templates and reference material into Ask Sage datasets, which the user does in Ask Sage's own UI. The tool itself does not consume training tokens.

## 10. Phased build plan

Phases are scoped by deliverable, not calendar.

### Phase 0 — Project scaffold

- Vite + React + TS project initialized in repo
- Dexie schema for projects/schemas/drafts/audit
- Ask Sage client wrapper with `x-access-tokens` auth
- API key entry screen with `/server/get-models` validation
- Basic routing and shell layout
- Vitest harness with a fixture transcript of Ask Sage responses for offline testing

**Done when:** the user can paste an API key, see the model list returned by their tenant, and the dev server runs without backend.

### Phase 1 — Schema synthesis

- Project creation form (name, template dataset name, reference dataset name)
- Stage 1 implementation: prompts `google-claude-46-opus` against the template dataset to enumerate templates and emit JSON schemas
- Schema viewer/editor UI (tree view of sections, fields editable inline)
- Schema persistence in IndexedDB

**Done when:** the user can point at a real template dataset on health.mil and get back valid TemplateSchemas they can review.

### Phase 2 — Section drafting

- Stage 2: project planning UI with shared inputs
- Stage 3: drafting pipeline with parallelism where dependencies allow
- Section workspace with regenerate button, references panel, token meter
- Audit log viewer

**Done when:** the user can run a real project end-to-end through drafting and see all sections produced with citations.

### Phase 3 — DOCX export

- Local DOCX skeleton upload per template (one-time per template, persisted in IndexedDB)
- Skeleton-fill export path using OOXML manipulation
- Scratch-generation export path for templates without skeletons
- Export verification: round-trip a generated DOCX through a parser and compare structure

**Done when:** the user can export a real project's documents as styled DOCX files that match the original template look.

### Phase 4 — Critic, polish, and packaging

- Stage 4: critic pass with deterministic validation + LLM critique
- Stage 5: final polish pass
- Cost projection UI (pre-run estimate based on schema)
- Settings: model overrides per stage
- Production build, distribution README, internal-share deployment guide

**Done when:** the user is producing real contracting/SOP/policy work with the tool and the team is positioned to evaluate funding additional token capacity.

## 11. Open questions & risks

### Open questions

1. **Local DOCX skeleton workflow.** Users will need to drop a local copy of each template into the app for high-fidelity export. How painful is this in practice on a DHA workstation where file operations are sometimes restricted? May need to validate during Phase 3.
2. **Schema synthesis quality variance.** How well does `google-claude-46-opus` actually identify and dissect templates from a RAG view of a dataset? Will the synthesized schemas need significant human editing to be usable? This is the single biggest unknown for Phase 1.
3. **`/server/query` `dataset` parameter behavior.** The Ask Sage docs describe the parameter but don't specify exactly how RAG retrieval scopes work for multi-file datasets. May require empirical tuning of `limit_references` and prompt strategies.
4. **Token usage reporting accuracy.** The `usage` field in responses needs to be verified against `/server/count-monthly-tokens` (User API — CORS blocked) or against the user's Ask Sage usage dashboard. A small drift is acceptable; large drift would break the budget meter.
5. **API key persistence UX.** Encrypted IndexedDB with a passphrase is the right default, but adds friction. Need to validate during Phase 0 whether users prefer paste-on-load.

### Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Ask Sage changes CORS policy on `/server/*` | Low | Catastrophic — kills the architecture | Maintain a parallel local-proxy fallback design (Python or PowerShell script that wraps the same fetch logic). Not built in v1, but the SPA's HTTP layer is isolated so swapping it is a small change. |
| Schema synthesis produces unusable schemas | Medium | Forces manual schema editing as primary workflow | Schema viewer/editor is in v1 scope; users can hand-correct. If the failure rate is high, fall back to a guided template-walking UX where the user confirms each section. |
| Token costs exceed projections | Medium | User runs out of monthly budget mid-project | Live meter + cost projection + abort button; aggressive-mode model overrides documented |
| User API CORS becomes desirable later (e.g., for in-app dataset management) | Medium | Blocks features but not core flow | Wait and see; if the demand is strong, ship the optional local proxy |
| Ask Sage adds streaming and the lack of streaming feels dated | Low | UX polish only | Job-based UX with section-level checkpoints is appropriate for long-form anyway |
| DOCX skeleton-fill has fidelity issues with complex templates (tables, content controls, embedded objects) | Medium | Some templates fall back to scratch-generation | Document the limitation; allow per-template choice between skeleton-fill and scratch |

---

## Appendix A — Decisions log

| Date | Decision | Reason |
|---|---|---|
| 2026-04-06 | Zero-backend SPA, no hosted infrastructure | Constraint C1 (no security review) |
| 2026-04-06 | User's own Ask Sage credentials, never proxied | Constraint C2 |
| 2026-04-06 | Templates and references live in Ask Sage datasets, not in this app | Constraint C1 + Ask Sage already inside enclave boundary |
| 2026-04-07 | Skip Ask Sage token-exchange flow; use raw API key in `x-access-tokens` | `/user/get-token-with-api-key` is CORS-blocked on health.mil; raw API key works directly per Ask Sage docs and verified empirically |
| 2026-04-07 | No in-app dataset management UI | `/user/*` endpoints are CORS-blocked on health.mil; users manage datasets in Ask Sage's own UI |
| 2026-04-07 | Default models: Claude 4.6 Opus (synthesis), Sonnet (drafting), Haiku 4.5 (critic) | Verified available via `/server/get-models` on health.mil; best quality/cost trade across the menu |
| 2026-04-07 | Hybrid DOCX export (skeleton-fill if available, scratch otherwise) | Ask Sage exposes no documented endpoint to retrieve raw file bytes from a dataset; need a local skeleton for fidelity |
| 2026-04-07 | Schema regenerated fresh per project, no schema cache | Avoids cache invalidation problem; cost is small relative to drafting |

## Appendix B — Verified API endpoints used

All on `https://api.asksage.health.mil`:

- `POST /server/get-models` — model menu enumeration; called once per session
- `POST /server/query` — primary completion endpoint with `dataset` and `limit_references` for RAG; used by all drafting stages
- `POST /server/openai/v1/chat/completions` — alternative OpenAI-compatible endpoint, available as a fallback if `/server/query` behavior changes

Header on every call: `x-access-tokens: <user's Ask Sage API key>`

## Appendix C — File reference

- `probe.html` — browser-side API probe; kept in repo for future re-validation
- `API_Testing_Outputs` — captured probe results from 2026-04-07 verification run; basis for §5
- `PRD.md` — this document

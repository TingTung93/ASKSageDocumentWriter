# Ask Sage — Document Co-Writer

A single-file, no-backend co-writing workstation for long-form DoD / DHA contracting documents (PWS, J&A, market research memos, SOW, IGCE). Drops into a browser and talks to your AI provider directly.

## What ships

- **`Co-Writer.html`** — the deliverable. Single self-contained HTML file, all JS/CSS/fonts inlined. Open it in any browser or drop it on a workstation. This is what the preview renders.
- **`src/`** — the same app, split into one concern per file. Reference tree for editing, code review, and re-bundling.

## Running the source tree

Because `src/` loads components through relative paths, it needs a static file server (the preview sandbox here serves one file at a time and can't resolve siblings — use local hosting).

Create an `index.html` at the `src/` root that mirrors the inlined file's `<script>` order and load each component via `<script src="./components/Foo.jsx">`, or regenerate `Co-Writer.html` from the split tree with your own inliner. Then:

```bash
python -m http.server 8080     # or any static file server, from the folder holding your index.html
```

Babel transpiles JSX in-browser, so there is no build pipeline — edit a file, refresh the page.

## Project shape

```
Co-Writer.html            # inlined single-file build (the deliverable; this is what runs)

src/
  styles/
    main.css              # whole design system + component CSS
  data/
    projects.js           # sidebar project list
    sources.js            # attached docs + RAG datasets
    chat.js               # demo conversation turns
    sections.js           # TOC + section statuses
    citeExcerpts.js       # hover-card source excerpts per citation number
    draftBodies.js        # prose used by the .docx exporter
  lib/
    docxExport.js         # docx.js-based Word/.md/PDF export helper
    docxIngest.js         # mammoth.js-based template parser (headings + {{placeholders}})
  components/
    App.jsx               # top-level layout + state + keyboard shortcuts
    Sidebar.jsx           # projects + Library/Audit/Settings nav + local-workstation chip
    SourcesPane.jsx       # left pane — attached docs / RAG / citation pills
    ChatPane.jsx          # center pane — conversation + composer + slash menu
    DraftPane.jsx         # right pane — PWS rendering, TOC, scroll-spy, review summary
    Tweaks.jsx            # in-design Tweaks panel (state / density / view)
    CommandPalette.jsx    # ⌘K navigator
    ToastProvider.jsx     # bottom-center toast system
    ExportModal.jsx       # Word / PDF / Markdown export dialog
    IngestModal.jsx       # drag-drop DOCX template parser
    LibraryView.jsx       # templates + datasets tabs
    AuditView.jsx         # activity log (every model call, tokens, cost)
    SettingsView.jsx      # connection / models / drafting / RAG / privacy / usage / reset
    FirstRun.jsx          # first-run onboarding overlay
    EmptyState.jsx        # "start a new draft" empty state
```

## How components share state

Every `<script type="text/babel" src>` gets its own local scope after Babel transpiles it, so the app follows the standard shared-scope pattern:

- Every component attaches itself to `window` (`window.Sidebar = Sidebar`, etc.) so the App root can find it.
- Data files are plain globals (`window.PROJECTS`, `window.SOURCES`, etc.).
- `ToastProvider` exposes `window.useToast()` via React context.
- Keyboard shortcuts, toast bridging, and view routing are handled in `App.jsx`.

Load order matters — dependencies before dependents, `App.jsx` last.

## Dependencies (all CDN, no package install)

- React 18.3.1 (development build)
- Babel Standalone 7.29.0 (in-browser JSX)
- docx 7.x (Word document export)
- mammoth 1.6 (DOCX template ingest)
- IBM Plex Sans / Mono and Instrument Serif from Google Fonts

## Keyboard shortcuts

- `⌘K` / `Ctrl+K` — command palette
- `⌘E` — open export dialog
- `⌘R` — regenerate active section
- `G D` — Draft workspace
- `G L` — Library
- `G A` — Activity log
- `G ,` — Settings
- `/` — focus composer (slash command menu)

## Features

- Three-pane workspace: sources ↔ chat ↔ streaming draft with synchronized citation pills
- Real `.docx` export via docx.js (title, headings, body paragraphs, page-number footer)
- Real DOCX template ingest via mammoth.js (heading detection + placeholder regex)
- Markdown and PDF (browser print) export
- Cross-section review with findings and one-click fixes
- Scroll-spy TOC, version history, slash commands, hover citations, toasts, command palette
- First-run onboarding for local-only operation
- Settings for provider, model routing, drafting behavior, RAG, privacy, usage, reset
- Activity log / audit trail of every model call

## No backend, ever

All state lives in browser memory. API keys are held in session storage only. No telemetry unless explicitly opted into.

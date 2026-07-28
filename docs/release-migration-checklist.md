# Release and Migration Checklist

## Automated gates

- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] `git diff --check`
- [ ] Integrated propose/recover/accept/reload/undo/reject workflow passes
- [ ] Provider adapter and conformance suites pass
- [ ] No credentials appear in IndexedDB, traces, diagnostics, or release HTML

## Existing-data safety

- [ ] Open a copy of an existing IndexedDB database without clearing storage
- [ ] Existing templates, projects, drafts, documents, recipe runs, and settings load
- [ ] Existing provider IDs and local endpoint settings resolve
- [ ] Version targets continue using draft ID for `template_draft` and project ID for `freeform_draft`
- [ ] Export/import a backup before any future destructive schema migration
- [ ] Project deletion cleanup is verified against versions, sessions, turns, traces, and checkpoints

## Provider matrix

- [ ] Ask Sage completion and authorized grounding
- [ ] GenAI.mil completion
- [ ] OpenRouter completion
- [ ] Keyless local completion
- [ ] Verified local native-tool continuation
- [ ] Completion-only local fallback
- [ ] CORS, mixed-content, TLS, timeout, authentication, and unknown-model errors are understandable

## Workflow and export matrix

- [ ] Template draft, placeholder resolution, proposal, accept, and DOCX export
- [ ] Reject leaves canonical draft unchanged
- [ ] Accept, reload, undo, and export restores exact prior content
- [ ] Freeform block and paragraph edit parity
- [ ] Existing-DOCX structural edit and export
- [ ] Citation provenance rejects unknown source IDs
- [ ] Interrupted and awaiting-approval recovery does not replay provider/tool calls
- [ ] Word and LibreOffice open synthetic exported fixtures

## Product review

- [ ] HashRouter and `file://` startup
- [ ] Keyboard-only selection, proposal review, accept, reject, and focus restoration
- [ ] 200% zoom, narrow layout, reduced motion, and screen-reader labels
- [ ] Diagnostics remain opt-in and visually secondary
- [ ] Route ownership matches `docs/route-ownership.md`
- [ ] Legacy route remains available for this release
- [ ] `release/index.html` is regenerated from reviewed source and size is recorded

## Object URLs and retention

- [ ] Interactive downloads revoke generated object URLs
- [ ] No recovery path depends on a persisted blob URL
- [ ] Active/awaiting proposal artifacts are exempt from cleanup
- [ ] Accepted version lineage is never deleted by routine retention
- [ ] Any legacy diagnostic blob URL is labeled transient

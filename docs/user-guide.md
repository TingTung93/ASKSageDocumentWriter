# Draft Workspace User Guide

## Choose a provider

Draft Workspace supports Ask Sage, GenAI.mil, OpenRouter, and generic
OpenAI-compatible endpoints. Local presets are convenience URLs, not capability
claims. Run connection verification for every endpoint/model pair. Native tool
use and structured output are enabled only when verified; basic completion is
the portability baseline.

Local browsers may block requests because of CORS, mixed HTTP/HTTPS content, or
untrusted TLS certificates. Configure the model server for browser access and
use an endpoint appropriate for the page's security context. An API key may be
left empty when the local server does not require one.

Never send data to a provider unless its authorization and handling terms match
the document's classification. The application cannot make that organizational
decision for you.

## Draft and revise

1. Create a template or freeform project and add only approved context.
2. Generate the initial draft.
3. Select a supported section, paragraph, or freeform block.
4. Enter a precise instruction and review the displayed target and source scope.
5. Generate a proposal. The canonical draft does not change yet.
6. Inspect the before/after diff, validation findings, and citation provenance.
7. Accept to create a durable version, or reject to leave the draft unchanged.

If another accepted edit changed the target first, the proposal is stale and
must be generated again. Ambiguous paragraph movement also fails closed.

## Versions, recovery, and undo

Awaiting proposals are restored from IndexedDB after reload. Acceptance updates
the canonical draft and appends an immutable version in one transaction. Undo
restores a selected snapshot by creating a new child version; it never deletes
history.

Exports always read canonical accepted project state. Preview proposals and
transient object URLs are not export sources.

## Diagnostics and privacy

Credentials are session-only and diagnostic output redacts credential-like
values. Document content, proposal artifacts, and version snapshots remain in
the browser's IndexedDB until the corresponding project/session is removed.
Diagnostics are opt-in. Use synthetic documents when sharing a diagnostic
export.

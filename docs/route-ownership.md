# Route Ownership and Consolidation Decision

## Current ownership

| Surface | Owner and purpose | Change policy |
| --- | --- | --- |
| V2 project workspace | Primary template and freeform drafting, approval, versions, grounding, and export | All new project-drafting capability lands here |
| Documents | Specialized import and structural editing of an existing DOCX | Retained until its OOXML operations use the shared lifecycle without losing fidelity |
| Legacy ProjectDetail | Compatibility access for older project workflows and diagnostics | Maintenance and data-loss fixes only |

Documents is not currently a duplicate project workspace: it owns existing-DOCX
structural operations that template/freeform adapters do not replace. Its
proposal, approval, diff, trace, and version UI should converge on shared
components, while document-specific anchors and OOXML operations remain in its
adapter.

## Data-safety decision

No route is removed in this release. IndexedDB stores, provider IDs, project
records, draft composite IDs, recipe IDs, and persisted version target IDs keep
their existing names. Product rebranding does not rename durable identifiers.

Legacy retirement requires:

1. One released version with V2 enabled and legacy access still available.
2. Migration tests using an existing version-8/9 database.
3. Template, freeform, and existing-DOCX export parity.
4. Import/export backup instructions.
5. Explicit approval of the route removal and a recovery path for unsupported
   records.

## Retention

Accepted versions are append-only compact JSON snapshots. Preview and trace
artifacts may be cleaned only under a documented count/age policy and never
while referenced by an active or awaiting-approval turn. Cleanup must not remove
accepted lineage, canonical drafts, provider configuration, or source records.
Transient blob URLs are never durable state; downloads reconstruct blobs from
IndexedDB and revoke generated URLs after use.

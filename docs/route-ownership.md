# Route Ownership and Consolidation Decision

## Current ownership

| Surface | Owner and purpose | Change policy |
| --- | --- | --- |
| V2 home (`/v2`) | Product startup, project discovery, creation, and bundle import | Root and historical top-level workflow URLs enter the V2 shell |
| V2 project workspace | Primary template and freeform drafting, approval, versions, grounding, and export | All new project-drafting capability lands here |
| Embedded V2 Documents | Import and structural editing of an existing DOCX | Reuses the established document engine inside V2 chrome; classic access is compatibility-only |
| Embedded V2 Library | Template and reference management for project drafting | V2 entry points open the embedded view; classic Templates and Datasets remain compatibility surfaces backed by the same IndexedDB records |
| Embedded V2 Activity log | Audit review and export while working in a project | V2 entry points open the embedded view; classic Audit remains a compatibility surface backed by the same audit records |
| Embedded V2 Settings | Provider connection, model routing, drafting review, defaults, and cost assumptions | V2 entry points open the embedded view; classic Settings remains a compatibility surface backed by the same settings store |
| Documents domain | Specialized import and structural editing of an existing DOCX | Its OOXML operations remain distinct while its user-facing entry point is owned by V2 |
| `/legacy/projects/:id` ProjectDetail | Temporary compatibility access for older project workflows and diagnostics | Maintenance and data-loss fixes only; it is not a destination for new project links |

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

## Navigation and history

Embedded V2 views are represented by the `view` query parameter on the current
project URL (for example, `/v2/:id?view=settings`). Selecting a view from the
sidebar, command palette, onboarding, or an in-workspace recovery action pushes
one browser-history entry. Browser Back and Forward therefore restore the prior
embedded view without leaving the project. The workspace is the canonical
default: it omits the query parameter, and unknown `view` values fall back to
the workspace.

Opening another project always starts in that project's workspace. Historical
top-level classic URLs redirect to V2-owned equivalents. Explicit `/legacy/*`
URLs remain directly reachable during the observation release, but V2 workflow
links do not navigate to them. All retained settings and audit
surfaces use the same IndexedDB stores; reset and export behavior must remain
equivalent while those compatibility routes exist.

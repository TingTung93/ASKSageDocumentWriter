# Phase 0 — Product Identity and Architecture Boundaries

> **Phase rule:** This phase changes product-facing identity and establishes compatibility boundaries. It does not rename provider code or introduce the editing workflow.

**Goal:** Separate the product from the Ask Sage provider brand, decide or safely defer the final product name, and document the architectural contracts later phases must preserve.

**Depends on:** The completed SPA cohesion/reliability remediation.

**Produces:** A provider-neutral product identity module, naming decision record, compatibility inventory, updated visible branding, and architecture decision records for provider and editing boundaries.

## Scope

### Included

- Product positioning and audience definition
- Naming scorecard and decision
- Central product-identity configuration
- Visible product-brand replacement
- Provider/product terminology rules
- Storage and schema compatibility inventory
- Architecture decision records
- Branding regression tests

### Excluded

- Renaming `asksage` provider IDs or modules
- Renaming the IndexedDB database
- Renaming session-storage keys
- Provider adapter implementation
- Draft selection or editing UI
- Legacy route removal

## Files

- Create `src/lib/product/identity.ts`
- Create `src/lib/product/identity.test.ts`
- Create `src/lib/product/compatibility.ts`
- Create `docs/product-positioning.md`
- Create `docs/decisions/0001-product-identity.md`
- Create `docs/decisions/0002-provider-boundary.md`
- Modify `src/components/Shell.tsx`
- Modify `src/components/v2/V2Sidebar.tsx`
- Modify `src/components/v2/V2Layout.tsx`
- Modify `src/components/v2/V2FirstRun.tsx`
- Modify `src/routes/Welcome.tsx`
- Modify `index.html`
- Modify `README.md`
- Modify `package.json` description
- Modify visible UI tests
- Modify `release/index.html` through the build

## Task 0.1 — Positioning and Naming Decision

- [ ] Identify primary users, secondary users, and deployment environments.
- [ ] Record required brand attributes: professional, trustworthy, provider-neutral, document-oriented, extensible.
- [ ] Record prohibited implications: Ask Sage affiliation, universal CUI authorization, cloud-only operation, chat-only workflow, automatic unreviewed authorship.
- [ ] Produce three to five candidate names.
- [ ] Score candidates using the master-plan naming scorecard.
- [ ] Check obvious trademark, domain, repository, and package conflicts.
- [ ] Review finalists with representative users.
- [ ] Select the public name or approve `Draft Workspace` as a time-bounded internal working identity.
- [ ] Record the decision, rationale, rejected alternatives, and revisit date.

## Task 0.2 — Central Product Identity

Implement:

```ts
export interface ProductIdentity {
  name: string;
  shortName: string;
  descriptor: string;
  mark: string;
}
```

- [ ] Add one exported `PRODUCT_IDENTITY`.
- [ ] Replace product-facing hard-coded names in current and V2 shells.
- [ ] Replace the welcome heading and first-run copy.
- [ ] Update the browser title and metadata.
- [ ] Update README title, description, and affiliation language.
- [ ] Keep provider labels sourced from provider metadata.
- [ ] Add tests ensuring the product name is not reused as a provider ID or label.

## Task 0.3 — Compatibility Inventory

Document and test where practical:

- IndexedDB name `asksage-doc-writer`
- existing store and index names
- `asksage:*` session-storage keys
- `asksage` provider ID
- `lib/asksage` module paths
- template schema URLs
- bundle/import format identifiers
- saved project and recipe IDs
- historical audit entries and plans

- [ ] Mark identifiers as permanent, migratable later, or display-only.
- [ ] Add compatibility comments near identity configuration.
- [ ] Verify a database created by the prior release still opens.
- [ ] Verify prior session settings remain readable.
- [ ] Do not rewrite historical records for cosmetic consistency.

## Task 0.4 — Architecture Decisions

Record:

- product identity versus provider identity;
- canonical provider contract owned by Phase 1;
- canonical editing proposal owned by Phase 2;
- approval as the only mutation boundary;
- V2 as the primary project workspace;
- standalone Documents as a specialized existing-document target until Phase 5 decides consolidation.

## Tests

- Product identity unit tests
- Shell, sidebar, welcome, and first-run rendering tests
- Provider labels remain unchanged
- Existing IndexedDB opens without migration
- Existing storage keys restore connection configuration
- No product screen claims the app is Ask Sage

## Quality Gates

```powershell
npm run typecheck
npm test
npm run build
```

Manual checks:

- Open the built file through `file://`.
- Confirm the product name is consistent.
- Confirm Ask Sage appears only where it describes the provider or provider-specific capability.
- Confirm existing local projects remain visible.

## Exit Gate

Phase 0 is complete when:

1. A product name or formally approved temporary identity exists.
2. Visible product identity is centralized.
3. Provider branding remains technically and legally distinct.
4. Compatibility identifiers are documented and unchanged.
5. Architecture boundaries for Phases 1–5 are recorded.
6. Tests and production build pass.

## Handoff to Phase 1

Phase 1 may import product identity for connection UI but must not add provider-specific branding to shared workflow contracts.


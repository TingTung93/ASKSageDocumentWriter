# ADR 0002: Provider and Editing Architecture Boundaries

- Status: Accepted
- Date: 2026-07-27

## Decision

Shared workflows depend on canonical provider capabilities, never a branded
provider implementation. Phase 1 owns the canonical completion, structured
output, embeddings, and tool-use contract. Ask Sage-only datasets, uploads, and
live search remain behind capability checks.

Phase 2 owns the canonical typed editing proposal. Generating or validating a
proposal never mutates a document; explicit user approval is the only mutation
boundary.

V2 is the primary project workspace. The standalone Documents route remains a
specialized existing-document target until Phase 5 makes a consolidation
decision. Legacy routes and stored records remain readable throughout.

## Consequences

Product identity may be imported by shared connection UI, but it must never
become a provider id. Provider labels come from provider metadata. Editing
targets may vary, while their proposal, validation, approval, recovery, and
audit lifecycle remains consistent.

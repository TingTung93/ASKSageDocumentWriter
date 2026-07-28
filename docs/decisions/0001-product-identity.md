# ADR 0001: Separate Product and Provider Identity

- Status: Accepted, temporary name
- Date: 2026-07-27
- Revisit: Before the first public branded release, or by 2026-10-31

## Decision

Use **Draft Workspace** as a time-bounded product working identity. Keep Ask
Sage, GenAI.mil, OpenRouter, and local backend names strictly as provider
identities. Centralize visible product strings in `src/lib/product/identity.ts`.

## Rationale

The application supports multiple remote and local providers. Naming the whole
product after one provider creates false affiliation and capability
expectations. Draft Workspace describes the current workflow without claiming
ownership of a provider or authorization for a data classification.

## Alternatives

Document Foundry, Draftline, and Sourcecraft scored well but need trademark,
domain, package, and representative-user checks. The historical
ASKSageDocumentWriter name is rejected as a public product name because it
conflates product and provider.

## Consequences

Historical persistence, provider, module, and bundle identifiers remain
unchanged. Future naming work changes `PRODUCT_IDENTITY` and visible assets, not
stored user data.

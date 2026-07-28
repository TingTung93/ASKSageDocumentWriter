/**
 * Product-facing identity is intentionally separate from provider identity.
 *
 * Do not use these values as provider ids, persistence keys, schema
 * identifiers, or import/export format identifiers. Those compatibility
 * contracts are listed in compatibility.ts.
 */
export interface ProductIdentity {
  name: string;
  shortName: string;
  descriptor: string;
  mark: string;
}

/**
 * Time-bounded working identity while naming, trademark, domain, and
 * representative-user research is completed. See ADR 0001.
 */
export const PRODUCT_IDENTITY: Readonly<ProductIdentity> = Object.freeze({
  name: 'Draft Workspace',
  shortName: 'Draft',
  descriptor: 'provider-neutral document drafting workspace',
  mark: 'DW',
});

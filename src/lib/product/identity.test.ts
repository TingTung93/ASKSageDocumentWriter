import { describe, expect, it } from 'vitest';
import { PRODUCT_IDENTITY } from './identity';
import {
  COMPATIBILITY_IDENTIFIERS,
  COMPATIBILITY_STORE_NAMES,
} from './compatibility';

describe('product identity boundary', () => {
  it('uses the provider-neutral working identity', () => {
    expect(PRODUCT_IDENTITY).toEqual({
      name: 'Draft Workspace',
      shortName: 'Draft',
      descriptor: 'provider-neutral document drafting workspace',
      mark: 'DW',
    });
  });

  it('does not reuse the product name as a provider id or compatibility identifier', () => {
    const values = COMPATIBILITY_IDENTIFIERS.map(({ value }) => value.toLowerCase());
    expect(values).not.toContain(PRODUCT_IDENTITY.name.toLowerCase());
    expect(values).toContain('asksage');
  });

  it('preserves the prior database, storage, provider, bundle, and store identifiers', () => {
    expect(COMPATIBILITY_IDENTIFIERS).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: 'asksage-doc-writer' }),
      expect.objectContaining({ value: 'asksage:apiKey' }),
      expect.objectContaining({ value: 'asksage:baseUrl' }),
      expect.objectContaining({ value: 'asksage:provider' }),
      expect.objectContaining({ value: 'asksage' }),
      expect.objectContaining({ value: 'ASKSageDocumentWriter' }),
    ]));
    expect(COMPATIBILITY_STORE_NAMES).toEqual(expect.arrayContaining([
      'templates',
      'projects',
      'drafts',
      'documents',
      'settings',
      'recipe_runs',
    ]));
  });
});

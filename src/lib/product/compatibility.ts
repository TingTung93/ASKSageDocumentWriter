export type CompatibilityDisposition = 'permanent' | 'migratable-later' | 'display-only';

export interface CompatibilityIdentifier {
  kind: string;
  value: string;
  disposition: CompatibilityDisposition;
  reason: string;
}

/**
 * Historical identifiers that branding work must not rewrite.
 *
 * Keeping this inventory executable gives later migrations a single review
 * point and prevents cosmetic rebranding from silently orphaning user data.
 */
export const COMPATIBILITY_IDENTIFIERS = Object.freeze([
  {
    kind: 'indexeddb-database',
    value: 'asksage-doc-writer',
    disposition: 'permanent',
    reason: 'Changing it would make existing local projects appear lost.',
  },
  {
    kind: 'session-storage-key',
    value: 'asksage:apiKey',
    disposition: 'permanent',
    reason: 'Existing browser sessions must continue to restore credentials.',
  },
  {
    kind: 'session-storage-key',
    value: 'asksage:baseUrl',
    disposition: 'permanent',
    reason: 'Existing browser sessions must continue to restore endpoints.',
  },
  {
    kind: 'session-storage-key',
    value: 'asksage:provider',
    disposition: 'permanent',
    reason: 'Existing browser sessions must continue to restore provider selection.',
  },
  {
    kind: 'session-storage-key',
    value: 'asksage:v2:first-run-dismissed',
    disposition: 'migratable-later',
    reason: 'Changing it without a dual-read migration would replay onboarding.',
  },
  {
    kind: 'provider-id',
    value: 'asksage',
    disposition: 'permanent',
    reason: 'Persisted settings and provider routing depend on this id.',
  },
  {
    kind: 'module-path',
    value: 'lib/asksage',
    disposition: 'migratable-later',
    reason: 'It names provider-specific implementation, not the product.',
  },
  {
    kind: 'bundle-exporter',
    value: 'ASKSageDocumentWriter',
    disposition: 'permanent',
    reason: 'Existing bundle readers use this historical format identifier.',
  },
] satisfies CompatibilityIdentifier[]);

export const COMPATIBILITY_STORE_NAMES = Object.freeze([
  'templates',
  'projects',
  'drafts',
  'documents',
  'audit',
  'settings',
  'recipe_runs',
  'editing_sessions',
  'editing_turns',
  'document_versions',
  'agent_trace_events',
  'agent_trace_artifacts',
  'agent_checkpoints',
  'learned_preferences',
]);

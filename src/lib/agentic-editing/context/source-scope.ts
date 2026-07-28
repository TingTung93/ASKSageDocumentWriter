import type { AgentCapabilities } from '../types';

export type GroundingSourceKind =
  | 'project_note'
  | 'attached_file'
  | 'file_chunk'
  | 'dataset'
  | 'research_pack'
  | 'live_search';

export interface GroundingSourceRef {
  id: string;
  kind: GroundingSourceKind;
  label: string;
  parentId?: string;
  estimatedCharacters: number;
  optional: boolean;
  defaultIncluded?: boolean;
}

export interface SourceScopeRequest {
  sources: readonly GroundingSourceRef[];
  includedSourceIds?: readonly string[];
  excludedSourceIds?: readonly string[];
  pinnedSourceIds?: readonly string[];
  maxContextCharacters: number;
}

export interface ResolvedSourceScopeEntry extends GroundingSourceRef {
  included: boolean;
  pinned: boolean;
  allocatedCharacters: number;
  truncated: boolean;
  reason:
    | 'pinned_by_user'
    | 'included_by_user'
    | 'included_by_default'
    | 'excluded_by_user'
    | 'unavailable'
    | 'context_budget';
  availabilityReason?: string;
}

export interface ResolvedSourceScope {
  entries: ResolvedSourceScopeEntry[];
  includedSourceIds: string[];
  estimatedCharacters: number;
  allocatedCharacters: number;
  maxContextCharacters: number;
  truncated: boolean;
}

export function sourceAvailability(
  source: GroundingSourceRef,
  capabilities: AgentCapabilities,
): { available: boolean; reason?: string } {
  switch (source.kind) {
    case 'dataset':
      return capabilities.providerDatasets
        ? { available: true }
        : { available: false, reason: 'The active provider does not support provider datasets.' };
    case 'live_search':
      return capabilities.liveSearch
        ? { available: true }
        : { available: false, reason: 'The active provider does not support live search.' };
    case 'file_chunk':
    case 'attached_file':
      return capabilities.localReferenceSearch || capabilities.providerDatasets
        ? { available: true }
        : { available: false, reason: 'No verified local or provider file-grounding path is available.' };
    case 'project_note':
    case 'research_pack':
      return { available: true };
  }
}

export function resolveSourceScope(
  request: SourceScopeRequest,
  capabilities: AgentCapabilities,
): ResolvedSourceScope {
  const included = new Set(request.includedSourceIds ?? []);
  const excluded = new Set(request.excludedSourceIds ?? []);
  const pinned = new Set(request.pinnedSourceIds ?? []);
  const knownIds = new Set(request.sources.map(({ id }) => id));
  for (const id of [...included, ...excluded, ...pinned]) {
    if (!knownIds.has(id)) throw new Error(`Unknown grounding source id: ${id}`);
  }

  // Pinned sources always win over an accidental simultaneous exclusion.
  const ordered = [...request.sources].sort((left, right) => {
    const pinDelta = Number(pinned.has(right.id)) - Number(pinned.has(left.id));
    return pinDelta || request.sources.indexOf(left) - request.sources.indexOf(right);
  });
  let remaining = Math.max(0, request.maxContextCharacters);
  const entries: ResolvedSourceScopeEntry[] = [];

  for (const source of ordered) {
    const isPinned = pinned.has(source.id);
    const availability = sourceAvailability(source, capabilities);
    const requested = isPinned
      || included.has(source.id)
      || (!excluded.has(source.id) && (source.defaultIncluded || !source.optional));
    let reason: ResolvedSourceScopeEntry['reason'];
    let shouldInclude = false;

    if (!availability.available) {
      reason = 'unavailable';
    } else if (isPinned) {
      reason = 'pinned_by_user';
      shouldInclude = true;
    } else if (excluded.has(source.id)) {
      reason = 'excluded_by_user';
    } else if (included.has(source.id)) {
      reason = 'included_by_user';
      shouldInclude = true;
    } else if (requested) {
      reason = 'included_by_default';
      shouldInclude = true;
    } else {
      reason = 'excluded_by_user';
    }

    const allocatedCharacters = shouldInclude
      ? Math.min(Math.max(0, source.estimatedCharacters), remaining)
      : 0;
    const contextTruncated = shouldInclude && allocatedCharacters < source.estimatedCharacters;
    if (shouldInclude && allocatedCharacters === 0 && !isPinned) {
      shouldInclude = false;
      reason = 'context_budget';
    }
    remaining -= allocatedCharacters;
    entries.push({
      ...source,
      included: shouldInclude,
      pinned: isPinned,
      allocatedCharacters,
      truncated: contextTruncated,
      reason,
      ...(!availability.available && availability.reason
        ? { availabilityReason: availability.reason }
        : {}),
    });
  }

  // Restore stable source-list order for artifacts and UI.
  entries.sort((left, right) => (
    request.sources.findIndex(({ id }) => id === left.id)
    - request.sources.findIndex(({ id }) => id === right.id)
  ));
  return {
    entries,
    includedSourceIds: entries.filter(({ included }) => included).map(({ id }) => id),
    estimatedCharacters: entries
      .filter(({ included }) => included)
      .reduce((sum, entry) => sum + entry.estimatedCharacters, 0),
    allocatedCharacters: entries.reduce((sum, entry) => sum + entry.allocatedCharacters, 0),
    maxContextCharacters: Math.max(0, request.maxContextCharacters),
    truncated: entries.some(({ truncated }) => truncated),
  };
}

export function serializeResolvedSourceScope(scope: ResolvedSourceScope): string {
  return JSON.stringify(scope);
}

export function hasGroundedMaterial(scope: ResolvedSourceScope): boolean {
  return scope.entries.some((entry) => entry.included && entry.allocatedCharacters > 0);
}

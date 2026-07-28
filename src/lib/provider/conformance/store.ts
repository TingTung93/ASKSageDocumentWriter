import { normalizeEndpoint } from './probe';
import {
  CONFORMANCE_PROBE_VERSION,
  type ConformanceIdentity,
  type ConformanceReport,
} from './types';

const PREFIX = 'draft-workspace:provider-conformance:';

export interface ConformanceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function conformanceCacheKey(
  identity: ConformanceIdentity,
  probeVersion = CONFORMANCE_PROBE_VERSION,
): string {
  const parts = [
    identity.providerId.trim(),
    normalizeEndpoint(identity.endpoint),
    identity.model.trim(),
    identity.authConfigurationId.trim(),
    String(probeVersion),
  ];
  // JSON encoding avoids delimiter collisions while persisting no secrets.
  return `${PREFIX}${encodeURIComponent(JSON.stringify(parts))}`;
}

export class ConformanceReportStore {
  constructor(private readonly storage: ConformanceStorage) {}

  get(identity: ConformanceIdentity): ConformanceReport | undefined {
    const raw = this.storage.getItem(conformanceCacheKey(identity));
    if (!raw) return undefined;
    try {
      const report = JSON.parse(raw) as ConformanceReport;
      if (!isMatchingReport(report, identity)) {
        this.storage.removeItem(conformanceCacheKey(identity));
        return undefined;
      }
      return report;
    } catch {
      this.storage.removeItem(conformanceCacheKey(identity));
      return undefined;
    }
  }

  put(report: ConformanceReport): void {
    this.storage.setItem(
      conformanceCacheKey(report.identity, report.probeVersion),
      JSON.stringify(report),
    );
  }

  invalidate(identity: ConformanceIdentity): void {
    this.storage.removeItem(conformanceCacheKey(identity));
  }
}

function isMatchingReport(
  report: ConformanceReport,
  identity: ConformanceIdentity,
): boolean {
  return (
    report.probeVersion === CONFORMANCE_PROBE_VERSION &&
    report.identity.providerId === identity.providerId.trim() &&
    report.identity.endpoint === normalizeEndpoint(identity.endpoint) &&
    report.identity.model === identity.model.trim() &&
    report.identity.authConfigurationId === identity.authConfigurationId.trim()
  );
}

import { describe, expect, it } from 'vitest';
import {
  ConformanceReportStore,
  conformanceCacheKey,
  type ConformanceStorage,
} from './store';
import { CONFORMANCE_PROBE_VERSION, type ConformanceReport } from './types';

class MemoryStorage implements ConformanceStorage {
  readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

const report: ConformanceReport = {
  identity: {
    providerId: 'local',
    endpoint: 'http://localhost:11434/v1',
    model: 'model-a',
    authConfigurationId: 'random-auth-revision-1',
  },
  probeVersion: CONFORMANCE_PROBE_VERSION,
  probedAt: '2026-07-27T00:00:00.000Z',
  signals: {
    reachability: { status: 'supported' },
    modelList: { status: 'supported' },
    completion: { status: 'supported' },
    jsonOutput: { status: 'unsupported' },
    toolCall: { status: 'unsupported' },
    toolResultContinuation: { status: 'skipped' },
    multipleToolCalls: { status: 'skipped' },
    embeddings: { status: 'unsupported' },
  },
};

describe('ConformanceReportStore', () => {
  it('round trips non-secret reports and normalizes endpoint cache keys', () => {
    const storage = new MemoryStorage();
    const store = new ConformanceReportStore(storage);
    store.put(report);

    expect(store.get({
      ...report.identity,
      endpoint: 'HTTP://LOCALHOST:11434/v1/',
    })).toEqual(report);
  });

  it('changes keys for provider, endpoint, model, auth revision, and probe version', () => {
    const base = report.identity;
    const keys = new Set([
      conformanceCacheKey(base),
      conformanceCacheKey({ ...base, providerId: 'hosted' }),
      conformanceCacheKey({ ...base, endpoint: 'http://localhost:1234/v1' }),
      conformanceCacheKey({ ...base, model: 'model-b' }),
      conformanceCacheKey({ ...base, authConfigurationId: 'random-auth-revision-2' }),
      conformanceCacheKey(base, CONFORMANCE_PROBE_VERSION + 1),
    ]);
    expect(keys.size).toBe(6);
  });

  it('invalidates explicitly and drops malformed cache records', () => {
    const storage = new MemoryStorage();
    const store = new ConformanceReportStore(storage);
    store.put(report);
    store.invalidate(report.identity);
    expect(store.get(report.identity)).toBeUndefined();

    storage.setItem(conformanceCacheKey(report.identity), '{invalid');
    expect(store.get(report.identity)).toBeUndefined();
    expect(storage.values.size).toBe(0);
  });

  it('does not require or persist API keys', () => {
    const storage = new MemoryStorage();
    new ConformanceReportStore(storage).put(report);
    const serialized = JSON.stringify([...storage.values.entries()]);

    expect(serialized).not.toContain('apiKey');
    expect(serialized).not.toContain('Bearer');
  });
});

import { describe, expect, it, vi } from 'vitest';
import { runConformanceProbe } from './probe';
import type { ConformanceIdentity, ConformanceProbeClient } from './types';

const identity: ConformanceIdentity = {
  providerId: 'local',
  endpoint: 'HTTP://LOCALHOST:11434/v1/',
  model: 'tool-model',
  authConfigurationId: 'auth-session-2',
};

function fullClient(): ConformanceProbeClient {
  return {
    listModels: vi.fn(async () => ['tool-model']),
    complete: vi.fn(async () => ({ text: 'conformance-ok' })),
    completeJson: vi.fn(async () => ({ conformance: 'ok' })),
    completeWithTools: vi.fn(async () => ({
      text: '',
      toolCalls: [{
        id: 'call-1',
        name: 'conformance_echo',
        arguments: '{"value":"probe"}',
      }],
    })),
    continueWithToolResult: vi.fn(async () => ({ text: 'Received probe.' })),
    embed: vi.fn(async () => [[0.1, 0.2]]),
  };
}

describe('runConformanceProbe', () => {
  it('independently verifies completion, JSON, tools, continuation, and embeddings', async () => {
    const report = await runConformanceProbe(identity, fullClient());

    expect(report.identity.endpoint).toBe('http://localhost:11434/v1');
    expect(report.signals).toMatchObject({
      reachability: { status: 'supported' },
      modelList: { status: 'supported' },
      completion: { status: 'supported' },
      jsonOutput: { status: 'supported' },
      toolCall: { status: 'supported' },
      toolResultContinuation: { status: 'supported' },
      multipleToolCalls: { status: 'skipped' },
      embeddings: { status: 'supported' },
    });
  });

  it('reports optional methods as unsupported without failing completion', async () => {
    const client: ConformanceProbeClient = {
      complete: async () => ({ text: 'conformance-ok' }),
    };
    const report = await runConformanceProbe(identity, client);

    expect(report.signals.completion.status).toBe('supported');
    expect(report.signals.jsonOutput.status).toBe('unsupported');
    expect(report.signals.toolCall.status).toBe('unsupported');
    expect(report.signals.toolResultContinuation.status).toBe('skipped');
    expect(report.signals.embeddings.status).toBe('unsupported');
  });

  it('classifies malformed JSON and embeddings independently', async () => {
    const client = fullClient();
    client.completeJson = async () => ({ wrong: true });
    client.embed = async () => [[Number.NaN]];
    const report = await runConformanceProbe(identity, client);

    expect(report.signals.jsonOutput.error?.kind).toBe('malformed_response');
    expect(report.signals.embeddings.error?.kind).toBe('malformed_response');
    expect(report.signals.completion.status).toBe('supported');
  });

  it('redacts credentials from classified error messages', async () => {
    const client: ConformanceProbeClient = {
      complete: async () => {
        const error = new Error(
          'Authorization: Bearer sk-supersecret123 ?api_key=anothersecret',
        ) as Error & { status: number };
        error.status = 401;
        throw error;
      },
    };
    const report = await runConformanceProbe(identity, client);
    const serialized = JSON.stringify(report);

    expect(report.signals.completion.error?.kind).toBe('authentication');
    expect(serialized).not.toContain('supersecret');
    expect(serialized).not.toContain('anothersecret');
    expect(serialized).toContain('[REDACTED]');
  });
});

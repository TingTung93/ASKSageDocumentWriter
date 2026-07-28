import { describe, expect, it } from 'vitest';
import { probeTools } from './tool-probe';
import type { ConformanceProbeClient } from './types';

describe('probeTools', () => {
  it('accepts object arguments and preserves the tool-call id for continuation', async () => {
    let continuedId = '';
    const client: ConformanceProbeClient = {
      complete: async () => ({ text: '' }),
      completeWithTools: async () => ({
        text: '',
        toolCalls: [{
          id: 'provider-call-9',
          name: 'conformance_echo',
          arguments: { value: 'probe' },
        }],
      }),
      continueWithToolResult: async ({ toolCall }) => {
        continuedId = toolCall.id;
        return { text: 'probe accepted' };
      },
    };
    const result = await probeTools(client);

    expect(result.toolCall.status).toBe('supported');
    expect(result.toolResultContinuation.status).toBe('supported');
    expect(continuedId).toBe('provider-call-9');
  });

  it('rejects text imitation and skips continuation', async () => {
    const client: ConformanceProbeClient = {
      complete: async () => ({ text: '' }),
      completeWithTools: async () => ({
        text: '{"name":"conformance_echo","arguments":{"value":"probe"}}',
      }),
      continueWithToolResult: async () => ({ text: 'should not execute' }),
    };
    const result = await probeTools(client);

    expect(result.toolCall.error?.kind).toBe('malformed_response');
    expect(result.toolResultContinuation.status).toBe('skipped');
  });

  it('can verify multiple tool calls when requested', async () => {
    const client: ConformanceProbeClient = {
      complete: async () => ({ text: '' }),
      completeWithTools: async () => ({
        text: '',
        toolCalls: [
          { id: '1', name: 'conformance_echo', arguments: { value: 'probe' } },
          { id: '2', name: 'conformance_echo', arguments: { value: 'probe' } },
        ],
      }),
      continueWithToolResult: async () => ({ text: 'probe' }),
    };
    const result = await probeTools(client, { includeMultipleToolCalls: true });

    expect(result.multipleToolCalls.status).toBe('supported');
  });
});

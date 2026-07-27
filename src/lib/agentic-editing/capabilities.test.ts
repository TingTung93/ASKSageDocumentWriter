import { describe, expect, it } from 'vitest';
import type { LLMClient } from '../provider/types';
import { executionPathFor, resolveAgentCapabilities } from './capabilities';

function client(tools: boolean): LLMClient {
  return {
    capabilities: { fileUpload: false, dataset: false, liveSearch: false, tools, jsonOutput: true },
    getModels: async () => [], query: async () => ({ message: '', response: '', status: 200, uuid: '' }),
    queryJson: async <T>() => ({ data: {} as T, raw: { message: '', response: '', status: 200, uuid: '' } }),
  };
}

describe('resolveAgentCapabilities', () => {
  it('never enables tools when the provider rejects them', () => {
    const caps = resolveAgentCapabilities(client(false), { id: 'x', name: 'x', object: 'model', owned_by: 'x', created: 'now', capabilities: { tool_calling: true } });
    expect(caps.nativeTools).toBe(false);
    expect(executionPathFor(caps)).toBe('prompt_only');
  });

  it('uses the prompt-only path when selected-model metadata rules tools out', () => {
    const caps = resolveAgentCapabilities(client(true), { id: 'x', name: 'x', object: 'model', owned_by: 'x', created: 'now', capabilities: { tool_calling: false } });
    expect(caps.nativeTools).toBe(false);
  });
});

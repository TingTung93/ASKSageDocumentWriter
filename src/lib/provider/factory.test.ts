import { describe, expect, it } from 'vitest';
import {
  createLLMClient,
  defaultBaseUrlFor,
  defaultModelFor,
  providerLabel,
} from './factory';
import { LocalOpenAIClient } from './local_openai';

describe('provider factory local_openai support', () => {
  it('uses the Ollama OpenAI-compatible URL as the local default', () => {
    expect(defaultBaseUrlFor('local_openai')).toBe('http://localhost:11434/v1');
  });

  it('labels local_openai as Local OpenAI-compatible', () => {
    expect(providerLabel('local_openai')).toMatch(/Local OpenAI-compatible/);
  });

  it('creates a LocalOpenAIClient for local_openai', () => {
    const client = createLLMClient({
      provider: 'local_openai',
      baseUrl: 'http://localhost:11434/v1',
      apiKey: '',
    });

    expect(client).toBeInstanceOf(LocalOpenAIClient);
  });

  it('returns local model defaults by stage', () => {
    expect(defaultModelFor('local_openai', 'drafting')).toBe('qwen3:14b');
    expect(defaultModelFor('local_openai', 'cleanup')).toBe('qwen3:8b');
  });
});

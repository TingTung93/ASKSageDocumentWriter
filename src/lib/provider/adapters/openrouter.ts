import { OpenRouterClient } from '../openrouter';
import { LegacyLLMPortableAdapter } from './legacy-llm';

export class OpenRouterPortableAdapter extends LegacyLLMPortableAdapter {
  constructor(baseUrl: string, apiKey: string) {
    super(new OpenRouterClient(apiKey, baseUrl), {
      providerId: 'openrouter',
      displayName: 'OpenRouter',
      endpoint: baseUrl,
      local: false,
    });
  }
}

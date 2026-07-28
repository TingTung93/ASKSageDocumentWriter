import { GenAIMilClient } from '../genai_mil';
import { LegacyLLMPortableAdapter } from './legacy-llm';

export class GenAIMilPortableAdapter extends LegacyLLMPortableAdapter {
  constructor(baseUrl: string, apiKey: string) {
    super(new GenAIMilClient(baseUrl, apiKey), {
      providerId: 'genai_mil',
      displayName: 'GenAI.mil',
      endpoint: baseUrl,
      local: false,
    });
  }
}

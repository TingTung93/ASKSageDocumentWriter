import { AskSageClient } from '../../asksage/client';
import { LegacyLLMPortableAdapter } from './legacy-llm';

export class AskSagePortableAdapter extends LegacyLLMPortableAdapter {
  constructor(baseUrl: string, apiKey: string) {
    super(new AskSageClient(baseUrl, apiKey), {
      providerId: 'asksage',
      displayName: 'Ask Sage',
      endpoint: baseUrl,
      local: false,
    });
  }
}

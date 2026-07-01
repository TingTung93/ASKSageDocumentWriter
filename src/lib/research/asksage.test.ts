import { describe, expect, it, vi } from 'vitest';
import { buildResearchPrompt, runAskSageResearch } from './asksage';
import type { LLMClient } from '../provider/types';

describe('Ask Sage research runner', () => {
  it('builds a prompt that requires citations and Markdown', () => {
    const prompt = buildResearchPrompt({
      project_name: 'Cyber project',
      project_description: 'Assess current zero trust guidance.',
      objective: 'Find current guidance',
      focus_questions: 'What changed recently?',
      depth: 'standard',
    });

    expect(prompt).toContain('Return strict JSON');
    expect(prompt).toContain('citation_ids');
    expect(prompt).toContain('Markdown reference pack');
  });

  it('uses Ask Sage live crawl mode and dataset none', async () => {
    const client = {
      capabilities: { fileUpload: true, dataset: true, liveSearch: true },
      queryJson: vi.fn().mockResolvedValue({
        data: {
          query_plan: ['zero trust guidance'],
          findings: [{ text: 'OMB guidance exists', citation_ids: ['c1'] }],
          citations: [
            {
              title: 'OMB',
              url: 'https://www.whitehouse.gov/omb/',
              source_type: 'web_result',
            },
          ],
          gaps: ['Confirm agency-specific policy'],
          markdown: '# Research Pack\n\nFinding.',
        },
        raw: {
          response: '{}',
          references: 'https://www.whitehouse.gov/omb/',
          model: 'm',
          usage: { prompt_tokens: 1, completion_tokens: 2 },
        },
      }),
      getModels: vi.fn(),
      query: vi.fn(),
    } as unknown as LLMClient;

    const result = await runAskSageResearch(client, {
      project_name: 'Cyber project',
      project_description: 'Assess current zero trust guidance.',
      objective: 'Find current guidance',
      focus_questions: '',
      depth: 'quick',
      model: 'google-claude-46-sonnet',
    });

    expect(client.queryJson).toHaveBeenCalledWith(expect.objectContaining({
      dataset: 'none',
      live: 2,
      limit_references: 10,
      model: 'google-claude-46-sonnet',
    }));
    expect(result.pack.citations[0].url).toBe('https://www.whitehouse.gov/omb/');
    expect(result.tokens_in).toBe(1);
    expect(result.tokens_out).toBe(2);
  });

  it('fails fast when live search is unavailable', async () => {
    const client = {
      capabilities: { fileUpload: false, dataset: false, liveSearch: false },
      queryJson: vi.fn(),
      getModels: vi.fn(),
      query: vi.fn(),
    } as unknown as LLMClient;

    await expect(runAskSageResearch(client, {
      project_name: 'Project',
      project_description: 'Description',
      objective: 'Research',
      depth: 'quick',
    })).rejects.toThrow(/live web search/i);
    expect(client.queryJson).not.toHaveBeenCalled();
  });
});

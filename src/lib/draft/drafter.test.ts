import { describe, it, expect, vi } from 'vitest';
import { draftSection } from './drafter';
import type { LLMClient } from '../provider/types';
import type { QueryInput, QueryResponse } from '../asksage/types';
import type { PriorSectionSummary } from './types';

function makeClient(
  queries: Array<Partial<QueryResponse>>
): LLMClient {
  let callCount = 0;
  return {
    provider: 'asksage',
    capabilities: { dataset: true, liveSearch: false, fileUpload: false },
    query: vi.fn().mockImplementation(async (_input: QueryInput) => {
      const q = queries[callCount++];
      if (!q) throw new Error(`Unexpected query call ${callCount}`);
      return {
        status: 200,
        response: 'OK',
        uuid: 'test',
        message: q.message || '',
        tool_calls: q.tool_calls || [],
        usage: q.usage || { prompt_tokens: 10, completion_tokens: 10 },
        references: q.references || '',
        web_search_results: [],
        embedding_down: false,
        vectors_down: false,
        ...q
      } as QueryResponse;
    }),
    getModels: vi.fn().mockResolvedValue([{ id: 'google-claude-46-sonnet' }]),
  } as unknown as LLMClient;
}

const mockTemplate = {
  id: 'tmpl',
  name: 'Test Template',
  description: 'A template',
  global_instructions: '',
  fill_regions: [],
  shared_inputs: [],
  visual_style: {},
  style: {
    voice: '',
    tense: '',
    register: '',
    jargon_policy: '',
    banned_phrases: []
  }
} as any;

const mockSection = {
  name: 'Intro',
  description: 'Write an intro',
  fill_region: {
    permitted_roles: ['body']
  }
} as any;

describe('drafter tools', () => {
  it('executes calculate_math', async () => {
    const client = makeClient([
      {
        tool_calls: [{
          id: 'call1',
          type: 'function',
          function: { name: 'calculate_math', arguments: JSON.stringify({ expression: '2 + 3 * 4' }) }
        }]
      },
      {
        message: '```json\n{"paragraphs": [{"role": "BodyText", "text": "Result is 14"}]}\n```'
      }
    ]);

    await draftSection(client, {
      template: mockTemplate,
      section: mockSection,
      project_description: 'test',
      shared_inputs: {},
      prior_summaries: []
    });

    const calls = vi.mocked(client.query).mock.calls;
    expect(calls.length).toBe(2);
    const secondCall = calls[1][0] as QueryInput;
    const conversation = secondCall.message as any[];
    const toolMsg = conversation.find(c => c.user === 'tool' && c.tool_call_id === 'call1');
    expect(toolMsg.message).toBe('14');
  });

  it('executes query_attached_document', async () => {
    const client = makeClient([
      {
        tool_calls: [{
          id: 'call2',
          type: 'function',
          function: { name: 'query_attached_document', arguments: JSON.stringify({ query: 'secret clause' }) }
        }]
      },
      {
        message: '```json\n{"paragraphs": []}\n```'
      }
    ]);

    await draftSection(client, {
      template: mockTemplate,
      section: mockSection,
      project_description: 'test',
      shared_inputs: {},
      prior_summaries: [],
      references_block: 'This is line 1.\nThis has the secret clause.'
    });

    const calls = vi.mocked(client.query).mock.calls;
    const secondCall = calls[1][0] as QueryInput;
    const conversation = secondCall.message as any[];
    const toolMsg = conversation.find(c => c.user === 'tool' && c.tool_call_id === 'call2');
    expect(toolMsg.message).toContain('This has the secret clause.');
  });

  it('executes search_project_history', async () => {
    const client = makeClient([
      {
        tool_calls: [{
          id: 'call3',
          type: 'function',
          function: { name: 'search_project_history', arguments: JSON.stringify({ keyword: 'background' }) }
        }]
      },
      {
        message: '```json\n{"paragraphs": []}\n```'
      }
    ]);

    const prior: PriorSectionSummary[] = [{ section_id: 'prev', name: 'Background Info', summary: 'This is background context.' }];

    await draftSection(client, {
      template: mockTemplate,
      section: mockSection,
      project_description: 'test',
      shared_inputs: {},
      prior_summaries: prior
    });

    const calls = vi.mocked(client.query).mock.calls;
    const secondCall = calls[1][0] as QueryInput;
    const conversation = secondCall.message as any[];
    const toolMsg = conversation.find(c => c.user === 'tool' && c.tool_call_id === 'call3');
    expect(toolMsg.message).toBe('Background Info: This is background context.');
  });

  it('executes design_complex_table', async () => {
    const client = makeClient([
      {
        tool_calls: [{
          id: 'call4',
          type: 'function',
          function: { 
            name: 'design_complex_table', 
            arguments: JSON.stringify({ 
              title: 'My Table', 
              headers: ['Col A', 'Col B'], 
              rows: [['1', '2'], ['3', '4']],
              nested_lists: true
            }) 
          }
        }]
      },
      {
        message: '```json\n{"paragraphs": []}\n```'
      }
    ]);

    await draftSection(client, {
      template: mockTemplate,
      section: mockSection,
      project_description: 'test',
      shared_inputs: {},
      prior_summaries: []
    });

    const calls = vi.mocked(client.query).mock.calls;
    const secondCall = calls[1][0] as QueryInput;
    const conversation = secondCall.message as any[];
    const toolMsg = conversation.find(c => c.user === 'tool' && c.tool_call_id === 'call4');
    
    expect(toolMsg.message).toContain('### My Table');
    expect(toolMsg.message).toContain('| Col A | Col B |');
    expect(toolMsg.message).toContain('| 1 | 2 |');
    expect(toolMsg.message).toContain('Contains nested list formatting');
  });

  it('executes apply_advanced_formatting with multi_level_list', async () => {
    const client = makeClient([
      {
        tool_calls: [{
          id: 'call5',
          type: 'function',
          function: { 
            name: 'apply_advanced_formatting', 
            arguments: JSON.stringify({ 
              text: 'Item 1\nItem 2\nItem 3', 
              formatting_type: 'multi_level_list'
            }) 
          }
        }]
      },
      {
        message: '```json\n{"paragraphs": []}\n```'
      }
    ]);

    await draftSection(client, {
      template: mockTemplate,
      section: mockSection,
      project_description: 'test',
      shared_inputs: {},
      prior_summaries: []
    });

    const calls = vi.mocked(client.query).mock.calls;
    const secondCall = calls[1][0] as QueryInput;
    const conversation = secondCall.message as any[];
    const toolMsg = conversation.find(c => c.user === 'tool' && c.tool_call_id === 'call5');
    
    expect(toolMsg.message).toContain('- Item 1');
    expect(toolMsg.message).toContain('  - Item 2');
    expect(toolMsg.message).toContain('    - Item 3');
  });

  it('executes apply_advanced_formatting with indented_section', async () => {
    const client = makeClient([
      {
        tool_calls: [{
          id: 'call6',
          type: 'function',
          function: { 
            name: 'apply_advanced_formatting', 
            arguments: JSON.stringify({ 
              text: 'Line 1\nLine 2', 
              formatting_type: 'indented_section'
            }) 
          }
        }]
      },
      {
        message: '```json\n{"paragraphs": []}\n```'
      }
    ]);

    await draftSection(client, {
      template: mockTemplate,
      section: mockSection,
      project_description: 'test',
      shared_inputs: {},
      prior_summaries: []
    });

    const calls = vi.mocked(client.query).mock.calls;
    const secondCall = calls[1][0] as QueryInput;
    const conversation = secondCall.message as any[];
    const toolMsg = conversation.find(c => c.user === 'tool' && c.tool_call_id === 'call6');
    
    expect(toolMsg.message).toContain('> [Formatted as indented_section]');
    expect(toolMsg.message).toContain('> Line 1\n> Line 2');
  });

  it('executes fetch_url (failure case)', async () => {
    const client = makeClient([
      {
        tool_calls: [{
          id: 'call7',
          type: 'function',
          function: { 
            name: 'fetch_url', 
            arguments: JSON.stringify({ 
              url: 'http://invalid.test.invalid'
            }) 
          }
        }]
      },
      {
        message: '```json\n{"paragraphs": []}\n```'
      }
    ]);

    await draftSection(client, {
      template: mockTemplate,
      section: mockSection,
      project_description: 'test',
      shared_inputs: {},
      prior_summaries: []
    });

    const calls = vi.mocked(client.query).mock.calls;
    const secondCall = calls[1][0] as QueryInput;
    const conversation = secondCall.message as any[];
    const toolMsg = conversation.find(c => c.user === 'tool' && c.tool_call_id === 'call7');
    
    // The test environment fetch will fail on invalid domains.
    expect(toolMsg.message).toContain('Failed to fetch URL');
  });

  it('executes fetch_url (success case)', async () => {
    // We mock global.fetch for this test
    const oldFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '<html><body>Success</body></html>'
    } as any);

    try {
      const client = makeClient([
        {
          tool_calls: [{
            id: 'call8',
            type: 'function',
            function: { 
              name: 'fetch_url', 
              arguments: JSON.stringify({ 
                url: 'http://example.com'
              }) 
            }
          }]
        },
        {
          message: '```json\n{"paragraphs": []}\n```'
        }
      ]);

      await draftSection(client, {
        template: mockTemplate,
        section: mockSection,
        project_description: 'test',
        shared_inputs: {},
        prior_summaries: []
      });

      const calls = vi.mocked(client.query).mock.calls;
      const secondCall = calls[1][0] as QueryInput;
      const conversation = secondCall.message as any[];
      const toolMsg = conversation.find(c => c.user === 'tool' && c.tool_call_id === 'call8');
      
      expect(toolMsg.message).toContain('Fetched 33 bytes');
      expect(toolMsg.message).toContain('<html><body>Success</body></html>');
    } finally {
      global.fetch = oldFetch;
    }
  });

  it('handles unknown tool call', async () => {
    const client = makeClient([
      {
        tool_calls: [{
          id: 'call9',
          type: 'function',
          function: { name: 'unknown_tool', arguments: '{}' }
        }]
      },
      { message: '```json\n{"paragraphs": []}\n```' }
    ]);
    await draftSection(client, { template: mockTemplate, section: mockSection, project_description: 'test', shared_inputs: {}, prior_summaries: [] });
    const calls = vi.mocked(client.query).mock.calls;
    const conversation = calls[1][0].message as any[];
    const toolMsg = conversation.find(c => c.user === 'tool' && c.tool_call_id === 'call9');
    expect(toolMsg.message).toContain('Error: Unknown tool unknown_tool');
  });

  it('handles tool arguments parsing error', async () => {
    const client = makeClient([
      {
        tool_calls: [{
          id: 'call10',
          type: 'function',
          function: { name: 'calculate_math', arguments: '{ bad json' }
        }]
      },
      { message: '```json\n{"paragraphs": []}\n```' }
    ]);
    await draftSection(client, { template: mockTemplate, section: mockSection, project_description: 'test', shared_inputs: {}, prior_summaries: [] });
    const calls = vi.mocked(client.query).mock.calls;
    const conversation = calls[1][0].message as any[];
    const toolMsg = conversation.find(c => c.user === 'tool' && c.tool_call_id === 'call10');
    expect(toolMsg.message).toContain('Error executing tool: SyntaxError:');
  });

  it('throws on unparseable LLM output', async () => {
    const client = makeClient([
      { message: 'Not JSON at all' }
    ]);
    await expect(draftSection(client, { template: mockTemplate, section: mockSection, project_description: 'test', shared_inputs: {}, prior_summaries: [] }))
      .rejects.toThrow(/Drafting response was not parseable JSON/);
  });
});

import { summarizeDraft } from './drafter';

describe('summarizeDraft', () => {
  it('uses llm_self_summary if provided and non-empty', () => {
    expect(summarizeDraft([], '  This is a summary.  ')).toBe('This is a summary.');
  });

  it('truncates llm_self_summary to 300 characters', () => {
    const long = 'A'.repeat(400);
    expect(summarizeDraft([], long).length).toBe(300);
  });

  it('falls back to first paragraph text if no self_summary', () => {
    const paragraphs = [{ role: 'body', text: 'First paragraph text.' }];
    expect(summarizeDraft(paragraphs, undefined)).toBe('First paragraph text.');
  });

  it('truncates first paragraph text to 200 characters', () => {
    const long = 'B'.repeat(300);
    const paragraphs = [{ role: 'body', text: long }];
    expect(summarizeDraft(paragraphs, '')).toBe('B'.repeat(200));
  });

  it('returns (empty draft) if no valid paragraph and no summary', () => {
    expect(summarizeDraft([{ role: 'body', text: '' }], undefined)).toBe('(empty draft)');
    expect(summarizeDraft([], '')).toBe('(empty draft)');
  });
});

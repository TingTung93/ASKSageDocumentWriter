import { describe, expect, it } from 'vitest';
import type { OpenAIToolCall } from '../asksage/types';
import {
  buildOpenAIHeaders,
  mapModelRowToModelInfo,
  mapOpenAIResponseToQueryResponse,
  mapQueryInputToOpenAIChatBody,
  parseJsonFromOpenAIText,
  sortOpenAIEmbeddings,
  urlForOpenAIPath,
} from './openai_compat';

describe('OpenAI-compatible provider mapping', () => {
  it('joins a base URL and API path without duplicate slashes', () => {
    expect(urlForOpenAIPath('http://localhost:11434/v1/', '/models')).toBe(
      'http://localhost:11434/v1/models',
    );
    expect(urlForOpenAIPath('http://localhost:11434/v1', 'models')).toBe(
      'http://localhost:11434/v1/models',
    );
  });

  it('builds optional auth, content type, and extra headers', () => {
    expect(buildOpenAIHeaders({ apiKey: '', includeContentType: false })).toEqual({});
    expect(buildOpenAIHeaders({ apiKey: '   ', includeContentType: true })).toEqual({
      'Content-Type': 'application/json',
    });
    expect(
      buildOpenAIHeaders({
        apiKey: 'sk-test',
        includeContentType: true,
        extra: { 'X-Title': 'ASKSageDocumentWriter' },
      }),
    ).toEqual({
      Authorization: 'Bearer sk-test',
      'Content-Type': 'application/json',
      'X-Title': 'ASKSageDocumentWriter',
    });
  });

  it('maps QueryInput conversation turns and canonical tool fields into a chat body', () => {
    const toolCall: OpenAIToolCall = {
      id: 'call-1',
      type: 'function',
      function: { name: 'lookup', arguments: '{"query":"alpha"}' },
    };
    const body = mapQueryInputToOpenAIChatBody({
      model: 'openai/gpt-4o',
      system_prompt: 'use tools carefully',
      temperature: 0.1,
      message: [
        { user: 'me', message: 'Find alpha' },
        { user: 'gpt', message: '', tool_calls: [toolCall] },
        { user: 'tool', message: '{"answer":42}', tool_call_id: 'call-1', name: 'lookup' },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'lookup',
            parameters: { type: 'object' },
          },
        },
      ],
      tool_choice: {
        type: 'function',
        function: { name: 'lookup' },
      },
      dataset: 'ignored',
      limit_references: 5,
      live: 2,
      persona: 1,
    });

    expect(body).toEqual({
      model: 'openai/gpt-4o',
      messages: [
        { role: 'system', content: 'use tools carefully' },
        { role: 'user', content: 'Find alpha' },
        { role: 'assistant', content: '', tool_calls: [toolCall] },
        { role: 'tool', content: '{"answer":42}', tool_call_id: 'call-1', name: 'lookup' },
      ],
      temperature: 0.1,
      tools: [
        {
          type: 'function',
          function: {
            name: 'lookup',
            parameters: { type: 'object' },
          },
        },
      ],
      tool_choice: {
        type: 'function',
        function: { name: 'lookup' },
      },
    });
  });

  it('maps chat completion content, tool_calls, and usage to QueryResponse', () => {
    const toolCall: OpenAIToolCall = {
      id: 'call-1',
      type: 'function',
      function: { name: 'lookup', arguments: '{"query":"alpha"}' },
    };

    expect(
      mapOpenAIResponseToQueryResponse({
        id: 'gen-1',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'done',
              tool_calls: [toolCall],
            },
          },
        ],
        usage: {
          prompt_tokens: 3,
          completion_tokens: 4,
          total_tokens: 7,
        },
      }),
    ).toMatchObject({
      message: 'done',
      response: 'OK',
      status: 200,
      uuid: 'gen-1',
      usage: {
        prompt_tokens: 3,
        completion_tokens: 4,
        total_tokens: 7,
      },
      tool_calls: [toolCall],
    });
  });

  it('parses fenced JSON from OpenAI text content', () => {
    expect(parseJsonFromOpenAIText<{ ok: boolean }>('```json\n{"ok":true}\n```')).toEqual({
      ok: true,
    });
  });

  it('maps sparse model rows and capability fields to ModelInfo', () => {
    expect(
      mapModelRowToModelInfo(
        {
          id: 'llama3',
          context_length: 8192,
          architecture: {
            input_modalities: ['text'],
            output_modalities: ['text'],
          },
          supported_parameters: ['temperature', 'tools'],
        },
        'local',
      ),
    ).toEqual({
      id: 'llama3',
      name: 'llama3',
      object: 'model',
      owned_by: 'local',
      created: 'na',
      capabilities: {
        context_length: 8192,
        input_modalities: ['text'],
        output_modalities: ['text'],
        supported_parameters: ['temperature', 'tools'],
      },
    });
  });

  it('sorts embeddings rows by index', () => {
    expect(
      sortOpenAIEmbeddings({
        data: [
          { index: 1, embedding: [0.3, 0.4] },
          { index: 0, embedding: [0.1, 0.2] },
        ],
      }),
    ).toEqual([
      { index: 0, embedding: [0.1, 0.2] },
      { index: 1, embedding: [0.3, 0.4] },
    ]);
  });
});

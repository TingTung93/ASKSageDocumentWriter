import type {
  ConformanceProbeClient,
  ProbeOptions,
  ProbeSignal,
  ProbeToolCall,
  ProbeToolDefinition,
} from './types';
import { probeOperation, unsupportedSignal } from './probe-helpers';

const ECHO_TOOL: ProbeToolDefinition = {
  name: 'conformance_echo',
  description: 'Return the supplied value unchanged.',
  inputSchema: {
    type: 'object',
    properties: { value: { type: 'string' } },
    required: ['value'],
    additionalProperties: false,
  },
};

function validEchoCall(call: ProbeToolCall | undefined): call is ProbeToolCall {
  if (!call || !call.id || call.name !== ECHO_TOOL.name) return false;
  const args = typeof call.arguments === 'string'
    ? safelyParse(call.arguments)
    : call.arguments;
  return Boolean(
    args &&
    typeof args === 'object' &&
    (args as Record<string, unknown>).value === 'probe',
  );
}

function safelyParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

export interface ToolProbeResult {
  toolCall: ProbeSignal;
  toolResultContinuation: ProbeSignal;
  multipleToolCalls: ProbeSignal;
}

export async function probeTools(
  client: ConformanceProbeClient,
  options: ProbeOptions = {},
): Promise<ToolProbeResult> {
  if (!client.completeWithTools) {
    const unsupported = unsupportedSignal('Client does not expose tool calls.');
    return {
      toolCall: unsupported,
      toolResultContinuation: { status: 'skipped', detail: 'Tool call unsupported.' },
      multipleToolCalls: { status: 'skipped', detail: 'Tool call unsupported.' },
    };
  }

  let acceptedCall: ProbeToolCall | undefined;
  const toolCall = await probeOperation(async (signal) => {
    const response = await client.completeWithTools!({
      messages: [{ role: 'user', content: 'Call conformance_echo with value "probe".' }],
      tools: [ECHO_TOOL],
      signal,
    });
    acceptedCall = response.toolCalls?.find(validEchoCall);
    if (!acceptedCall) throw new MalformedProbeError('No valid conformance_echo tool call.');
  }, options);

  let continuation: ProbeSignal;
  if (toolCall.status !== 'supported') {
    continuation = { status: 'skipped', detail: 'A valid tool call is required.' };
  } else if (!client.continueWithToolResult) {
    continuation = unsupportedSignal('Client does not expose tool-result continuation.');
  } else {
    continuation = await probeOperation(async (signal) => {
      const response = await client.continueWithToolResult!({
        messages: [{ role: 'user', content: 'Call conformance_echo with value "probe".' }],
        toolCall: acceptedCall!,
        result: { value: 'probe' },
        signal,
      });
      if (!response.text.toLowerCase().includes('probe')) {
        throw new MalformedProbeError('Continuation did not acknowledge the tool result.');
      }
    }, options);
  }

  const multipleToolCalls: ProbeSignal = options.includeMultipleToolCalls
    ? await probeOperation(async (signal) => {
      const response = await client.completeWithTools!({
        messages: [{
          role: 'user',
          content: 'Call conformance_echo twice, once for value "probe" and once for value "probe".',
        }],
        tools: [ECHO_TOOL],
        signal,
      });
      if ((response.toolCalls ?? []).filter(validEchoCall).length < 2) {
        throw new UnsupportedProbeError('Parallel or multiple tool calls were not returned.');
      }
    }, options)
    : { status: 'skipped', detail: 'Multiple-call probing was not requested.' };

  return { toolCall, toolResultContinuation: continuation, multipleToolCalls };
}

export class MalformedProbeError extends Error {
  readonly probeKind = 'malformed_response';
}

export class UnsupportedProbeError extends Error {
  readonly probeKind = 'unsupported';
}

import {
  CONFORMANCE_PROBE_VERSION,
  type ConformanceIdentity,
  type ConformanceProbeClient,
  type ConformanceReport,
  type ProbeOptions,
  type ProbeSignal,
} from './types';
import { probeOperation, unsupportedSignal } from './probe-helpers';
import { MalformedProbeError, probeTools } from './tool-probe';

export async function runConformanceProbe(
  identity: ConformanceIdentity,
  client: ConformanceProbeClient,
  options: ProbeOptions = {},
): Promise<ConformanceReport> {
  const completion = await probeOperation(async (signal) => {
    const result = await client.complete({
      messages: [{ role: 'user', content: 'Reply with exactly: conformance-ok' }],
      signal,
    });
    if (!result.text.toLowerCase().includes('conformance-ok')) {
      throw new MalformedProbeError('Completion did not contain the probe marker.');
    }
  }, options);

  const reachability: ProbeSignal = completion.status === 'supported'
    ? { status: 'supported', latencyMs: completion.latencyMs }
    : { ...completion };

  const modelList = client.listModels
    ? await probeOperation(async (signal) => {
      const models = await client.listModels!(signal);
      if (!Array.isArray(models)) throw new MalformedProbeError('Model list was not an array.');
      if (!models.includes(identity.model)) {
        const error = new Error(`Configured model "${identity.model}" was not listed.`);
        (error as Error & { probeKind: string }).probeKind = 'unknown_model';
        throw error;
      }
    }, options)
    : unsupportedSignal('Client does not expose model listing.');

  const jsonOutput = client.completeJson
    ? await probeOperation(async (signal) => {
      const value = await client.completeJson!({
        messages: [{
          role: 'user',
          content: 'Return a JSON object with {"conformance":"ok"}.',
        }],
        signal,
      });
      if (
        !value ||
        typeof value !== 'object' ||
        (value as Record<string, unknown>).conformance !== 'ok'
      ) throw new MalformedProbeError('Structured output did not match the probe schema.');
    }, options)
    : unsupportedSignal('Client does not expose structured output.');

  const embeddings = client.embed
    ? await probeOperation(async (signal) => {
      const vectors = await client.embed!(['conformance'], signal);
      if (
        vectors.length !== 1 ||
        vectors[0].length === 0 ||
        vectors[0].some((value) => !Number.isFinite(value))
      ) throw new MalformedProbeError('Embedding response was not a finite vector.');
    }, options)
    : unsupportedSignal('Client does not expose embeddings.');

  const tools = await probeTools(client, options);
  return {
    identity: normalizeIdentity(identity),
    probeVersion: CONFORMANCE_PROBE_VERSION,
    probedAt: new Date().toISOString(),
    signals: {
      reachability,
      modelList,
      completion,
      jsonOutput,
      toolCall: tools.toolCall,
      toolResultContinuation: tools.toolResultContinuation,
      multipleToolCalls: tools.multipleToolCalls,
      embeddings,
    },
  };
}

export function normalizeEndpoint(endpoint: string): string {
  return endpoint.trim().replace(/\/+$/, '').toLowerCase();
}

function normalizeIdentity(identity: ConformanceIdentity): ConformanceIdentity {
  return {
    providerId: identity.providerId.trim(),
    endpoint: normalizeEndpoint(identity.endpoint),
    model: identity.model.trim(),
    authConfigurationId: identity.authConfigurationId.trim(),
  };
}

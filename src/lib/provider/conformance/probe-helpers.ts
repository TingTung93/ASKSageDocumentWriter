import type { ProbeErrorKind, ProbeOptions, ProbeSignal } from './types';

interface ClassifiedError extends Error {
  status?: number;
  probeKind?: ProbeErrorKind;
}

export function unsupportedSignal(detail: string): ProbeSignal {
  return { status: 'unsupported', detail };
}

export async function probeOperation(
  operation: (signal: AbortSignal) => Promise<void>,
  options: ProbeOptions,
): Promise<ProbeSignal> {
  const started = Date.now();
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 15_000;
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  try {
    await operation(controller.signal);
    return { status: 'supported', latencyMs: Date.now() - started };
  } catch (error) {
    const classified = classifyProbeError(error, timedOut, options.signal?.aborted);
    return {
      status: classified.kind === 'unsupported' ? 'unsupported' : 'failed',
      latencyMs: Date.now() - started,
      error: classified,
    };
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abort);
  }
}

export function classifyProbeError(
  error: unknown,
  timedOut = false,
  externallyAborted = false,
): { kind: ProbeErrorKind; message: string; status?: number } {
  if (timedOut) return { kind: 'timeout', message: 'Probe timed out.' };
  if (externallyAborted) return { kind: 'aborted', message: 'Probe was aborted.' };
  const value = error as ClassifiedError;
  const status = typeof value?.status === 'number' ? value.status : undefined;
  const raw = error instanceof Error ? error.message : String(error);
  const lower = raw.toLowerCase();
  let kind: ProbeErrorKind = value?.probeKind ?? 'unknown';
  if (status === 401 || status === 403) kind = 'authentication';
  else if (status === 404 && lower.includes('model')) kind = 'unknown_model';
  else if (lower.includes('mixed content')) kind = 'mixed_content';
  else if (lower.includes('cors') || lower.includes('cross-origin')) kind = 'cors';
  else if (lower.includes('abort')) kind = 'aborted';
  else if (
    lower.includes('network') ||
    lower.includes('failed to fetch') ||
    error instanceof TypeError
  ) kind = 'network';
  return { kind, message: sanitizeMessage(raw), status };
}

function sanitizeMessage(message: string): string {
  // Avoid retaining header values, bearer tokens, or key-like query parameters.
  return message
    .replace(/(authorization\s*[:=]\s*)([^\s,;]+)/gi, '$1[REDACTED]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/([?&](?:api[_-]?key|token)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/\b(?:sk|key)-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]');
}

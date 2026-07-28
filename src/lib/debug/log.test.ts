import { describe, expect, it } from 'vitest';
import {
  isDiagnosticsEnabled,
  isStartupFailure,
  redactLogMessage,
  redactCredentials,
  type LogEntry,
} from './log';

describe('diagnostics', () => {
  it('supports explicit query and hash-route opt-in', () => {
    expect(isDiagnosticsEnabled({ search: '?diagnostics=1', hash: '' }, false)).toBe(true);
    expect(isDiagnosticsEnabled({ search: '', hash: '#/projects?diagnostics=1' }, false)).toBe(true);
  });

  it('does not opt in for unrelated production locations', () => {
    expect(isDiagnosticsEnabled({ search: '', hash: '#/projects' }, false)).toBe(false);
  });

  it('recognizes application startup boundary failures', () => {
    const entry: LogEntry = {
      ts: 0,
      level: 'error',
      message: '[ErrorBoundary] Error: render failed',
    };
    expect(isStartupFailure(entry)).toBe(true);
  });

  it('redacts common credentials and bounds captured bodies', () => {
    const message = redactLogMessage(
      `Authorization: Bearer secret-token apiKey=my-secret ${'document body '.repeat(500)}`,
    );
    expect(message).not.toContain('secret-token');
    expect(message).not.toContain('my-secret');
    expect(message).toContain('[REDACTED]');
    expect(message).toContain('[log content truncated]');
  });

  it('recursively redacts credential fields and bearer values', () => {
    const safe = redactCredentials({
      request: {
        headers: { Authorization: 'Bearer deeply-secret' },
        items: [{ api_key: 'also-secret' }, { label: 'safe' }],
      },
    });
    expect(safe).toEqual({
      request: {
        headers: { Authorization: '[REDACTED]' },
        items: [{ api_key: '[REDACTED]' }, { label: 'safe' }],
      },
    });
  });
});

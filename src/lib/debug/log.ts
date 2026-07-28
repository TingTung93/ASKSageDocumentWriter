// In-page log capture. The DHA workstation blocks DevTools, so we have
// to surface console output, uncaught errors, and unhandled rejections
// somewhere visible. This module patches the global console + installs
// window listeners and exposes a subscribable buffer for the DebugPanel.

export type LogLevel = 'log' | 'info' | 'warn' | 'error';

export interface LogEntry {
  ts: number;
  level: LogLevel;
  message: string;
}

const MAX_ENTRIES = 500;
const MAX_MESSAGE_LENGTH = 4_000;
const SENSITIVE_KEY = /(?:^|[_-])(?:api[_-]?key|authorization|access[_-]?token|refresh[_-]?token|password|secret|token)(?:$|[_-])/i;
const REDACTED = '[REDACTED]';

export function isDiagnosticsEnabled(
  location: Pick<Location, 'search' | 'hash'> = window.location,
  development = import.meta.env.DEV,
): boolean {
  if (development) return true;

  const search = new URLSearchParams(location.search);
  const hashQuery = location.hash.includes('?')
    ? new URLSearchParams(location.hash.slice(location.hash.indexOf('?') + 1))
    : null;
  return search.get('diagnostics') === '1' || hashQuery?.get('diagnostics') === '1';
}

export function isStartupFailure(entry: LogEntry): boolean {
  return (
    entry.level === 'error' &&
    (entry.message.startsWith('[main] crash during init:') ||
      entry.message.startsWith('[ErrorBoundary]'))
  );
}

class DebugLog {
  private entries: LogEntry[] = [];
  private listeners = new Set<() => void>();
  private installed = false;

  install(): void {
    if (this.installed) return;
    this.installed = true;

    const wrap = (level: LogLevel, original: (...a: unknown[]) => void) => {
      return (...args: unknown[]) => {
        try {
          original.apply(console, args);
        } catch {
          /* ignore — original might be detached */
        }
        this.add(level, args.map(stringify).join(' '));
      };
    };

    // Bind to globalThis.console to preserve receiver.
    /* eslint-disable no-console */
    const c = globalThis.console;
    c.log = wrap('log', c.log.bind(c));
    c.info = wrap('info', c.info.bind(c));
    c.warn = wrap('warn', c.warn.bind(c));
    c.error = wrap('error', c.error.bind(c));
    /* eslint-enable no-console */

    if (typeof window !== 'undefined') {
      window.addEventListener('error', (e: ErrorEvent) => {
        const stack = e.error instanceof Error ? e.error.stack : '';
        this.add(
          'error',
          `[window.error] ${e.message}` +
            (e.filename ? ` at ${e.filename}:${e.lineno}:${e.colno}` : '') +
            (stack ? `\n${stack}` : ''),
        );
      });

      window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
        const reason = e.reason;
        const message =
          reason instanceof Error
            ? `[unhandledrejection] ${reason.name}: ${reason.message}` +
              (reason.stack ? `\n${reason.stack}` : '')
            : `[unhandledrejection] ${stringify(reason)}`;
        this.add('error', message);
      });
    }

    this.add('info', '[debugLog] installed; capturing console + window errors');
  }

  add(level: LogLevel, message: string): void {
    const safeMessage = redactLogMessage(message);
    // Replace the array (immutable) so React.useSyncExternalStore sees a
    // new reference and re-renders.
    this.entries = [...this.entries, { ts: Date.now(), level, message: safeMessage }];
    if (this.entries.length > MAX_ENTRIES) {
      this.entries = this.entries.slice(-MAX_ENTRIES);
    }
    this.listeners.forEach((fn) => fn());
  }

  getSnapshot = (): LogEntry[] => this.entries;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  clear(): void {
    this.entries = [];
    this.listeners.forEach((fn) => fn());
  }

  asText(): string {
    return this.entries
      .map((e) => `${new Date(e.ts).toISOString()} [${e.level}] ${e.message}`)
      .join('\n');
  }
}

export function redactLogMessage(message: string): string {
  const redacted = message
    .replace(/\b(Bearer)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [REDACTED]')
    .replace(
      /(["']?(?:api[_-]?key|authorization|token)["']?\s*[:=]\s*)["']?[^"',\s}]+["']?/gi,
      '$1[REDACTED]',
    );

  if (redacted.length <= MAX_MESSAGE_LENGTH) return redacted;
  return `${redacted.slice(0, MAX_MESSAGE_LENGTH)}\n[log content truncated]`;
}

/** Return a JSON-safe copy with credential-like fields redacted at any depth. */
export function redactCredentials<T>(value: T): T {
  return redactValue(value, new WeakSet<object>()) as T;
}

function redactValue(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return redactLogMessage(value);
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, seen));

  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    out[key] = SENSITIVE_KEY.test(key) ? REDACTED : redactValue(child, seen);
  }
  return out;
}

function stringify(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v === null || v === undefined) return String(v);
  if (v instanceof Error) {
    return `${v.name}: ${v.message}` + (v.stack ? `\n${v.stack}` : '');
  }
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export const debugLog = new DebugLog();

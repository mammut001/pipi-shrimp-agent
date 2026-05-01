/**
 * errorLogger - Local error logging with sanitization
 *
 * Stores the most recent errors in memory (ring buffer of 100).
 * All entries are sanitized before storage: API keys, tokens, Authorization
 * headers, and overly long text content are redacted.
 *
 * Default behavior: local-only, no remote reporting.
 */

const MAX_ENTRIES = 100;

export type ErrorLogLevel = 'error' | 'warn' | 'info';

export interface ErrorLogEntry {
  id: string;
  timestamp: number;
  level: ErrorLogLevel;
  message: string;
  source: string;
  stack?: string;
  context?: string;
}

/** Patterns that should be redacted from any string */
const SENSITIVE_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // API keys: sk-..., key-..., Bearer ..., token=...
  { pattern: /sk-[a-zA-Z0-9_-]{20,}/g, replacement: 'sk-***REDACTED***' },
  { pattern: /key-[a-zA-Z0-9_-]{20,}/g, replacement: 'key-***REDACTED***' },
  { pattern: /Bearer\s+[a-zA-Z0-9_.-]{20,}/gi, replacement: 'Bearer ***REDACTED***' },
  { pattern: /Authorization[:\s]+[a-zA-Z0-9_.-]{20,}/gi, replacement: 'Authorization: ***REDACTED***' },
  { pattern: /token[=:]\s*[a-zA-Z0-9_.-]{20,}/gi, replacement: 'token=***REDACTED***' },
  // Generic long hex/base64 strings that look like secrets (40+ chars)
  { pattern: /\b[a-f0-9]{40,}\b/gi, replacement: '***REDACTED_HEX***' },
  { pattern: /\b[A-Za-z0-9+/=]{60,}\b/g, replacement: '***REDACTED_B64***' },
];

/**
 * Sanitize a string by redacting sensitive patterns and truncating long content.
 */
function sanitize(text: string, maxLen = 500): string {
  let result = text;
  for (const { pattern, replacement } of SENSITIVE_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  if (result.length > maxLen) {
    result = result.slice(0, maxLen) + `… [truncated, total ${text.length} chars]`;
  }
  return result;
}

/** Ring buffer of error log entries */
let _entries: ErrorLogEntry[] = [];

function generateId(): string {
  return `err-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Record an error log entry. Sanitizes message, stack, and context.
 */
export function logError(
  level: ErrorLogLevel,
  message: string,
  source: string,
  error?: unknown,
  context?: string,
): void {
  const entry: ErrorLogEntry = {
    id: generateId(),
    timestamp: Date.now(),
    level,
    message: sanitize(message),
    source: sanitize(source, 200),
  };

  if (error instanceof Error) {
    entry.stack = sanitize(error.stack || error.message, 800);
  } else if (error !== undefined && error !== null) {
    entry.stack = sanitize(String(error), 800);
  }

  if (context) {
    entry.context = sanitize(context, 300);
  }

  _entries.push(entry);
  if (_entries.length > MAX_ENTRIES) {
    _entries = _entries.slice(-MAX_ENTRIES);
  }
}

/**
 * Get a copy of all stored error log entries (newest last).
 */
export function getErrorLogs(): ErrorLogEntry[] {
  return [..._entries];
}

/**
 * Get a formatted string of recent error logs suitable for clipboard.
 * Sanitized: no API keys, tokens, or raw message bodies.
 */
export function getErrorLogsText(maxEntries = 50): string {
  const entries = _entries.slice(-maxEntries);
  if (entries.length === 0) return '(No error logs)';

  return entries
    .map((e) => {
      const time = new Date(e.timestamp).toISOString();
      const parts = [`[${time}] [${e.level.toUpperCase()}] [${e.source}] ${e.message}`];
      if (e.stack) parts.push(`  Stack: ${e.stack}`);
      if (e.context) parts.push(`  Context: ${e.context}`);
      return parts.join('\n');
    })
    .join('\n\n');
}

/**
 * Clear all stored error logs.
 */
export function clearErrorLogs(): void {
  _entries = [];
}

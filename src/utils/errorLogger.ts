/**
 * errorLogger - Local error logging with sanitization and localStorage persistence
 *
 * Stores the most recent errors in memory (ring buffer of 100) and persists
 * the most recent 50 to localStorage so logs survive page reloads.
 * All entries are sanitized before storage: API keys, tokens, Authorization
 * headers, passwords, and overly long text content are redacted.
 *
 * Default behavior: local-only, no remote reporting.
 */

const MAX_MEMORY_ENTRIES = 100;
const MAX_PERSISTED_ENTRIES = 50;
const STORAGE_KEY = 'pipi_error_logs_v1';

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
  // API keys: sk-..., key-..., Bearer ...
  { pattern: /sk-[a-zA-Z0-9_-]{20,}/g, replacement: 'sk-***REDACTED***' },
  { pattern: /key-[a-zA-Z0-9_-]{20,}/g, replacement: 'key-***REDACTED***' },
  { pattern: /Bearer\s+[a-zA-Z0-9_.-]{20,}/gi, replacement: 'Bearer ***REDACTED***' },
  { pattern: /Authorization[:\s]+[a-zA-Z0-9_.-]{20,}/gi, replacement: 'Authorization: ***REDACTED***' },
  // Named secret fields: apiKey: xxx, api_key: xxx, x-api-key: xxx, token: xxx,
  //   access_token: xxx, refresh_token: xxx, password: xxx
  { pattern: /(apiKey|api_key|x-api-key|token|access_token|refresh_token|password)\s*[:=]\s*\S+/gi, replacement: '$1=***REDACTED***' },
  // URL query parameters containing secrets: ?api_key=xxx, &token=xxx, &access_token=xxx
  { pattern: /([?&])(api_key|apikey|token|access_token|refresh_token|secret|password)=([^&\s]+)/gi, replacement: '$1$2=***REDACTED***' },
  // Generic long hex/base64 strings that look like secrets (40+ chars)
  { pattern: /\b[a-f0-9]{40,}\b/gi, replacement: '***REDACTED_HEX***' },
  { pattern: /\b[A-Za-z0-9+/=]{60,}\b/g, replacement: '***REDACTED_B64***' },
];

/**
 * Sanitize a string by redacting sensitive patterns and truncating long content.
 */
export function sanitize(text: string, maxLen = 500): string {
  let result = text;
  for (const { pattern, replacement } of SENSITIVE_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  if (result.length > maxLen) {
    result = result.slice(0, maxLen) + `… [truncated, total ${text.length} chars]`;
  }
  return result;
}

/** Ring buffer of error log entries (in-memory) */
let _entries: ErrorLogEntry[] = [];

/**
 * Load persisted entries from localStorage on init.
 * Silently returns [] if localStorage is unavailable or data is corrupt.
 */
function loadPersistedEntries(): ErrorLogEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ErrorLogEntry[];
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(-MAX_PERSISTED_ENTRIES);
  } catch {
    return [];
  }
}

/**
 * Persist the most recent entries to localStorage.
 * Silently no-ops if localStorage is unavailable.
 */
function persistEntries(): void {
  try {
    const toPersist = _entries.slice(-MAX_PERSISTED_ENTRIES);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toPersist));
  } catch {
    // localStorage full or unavailable — don't crash
  }
}

// Initialize from localStorage on module load
_entries = loadPersistedEntries();

function generateId(): string {
  return `err-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Record an error log entry. Sanitizes message, stack, and context.
 * Also persists to localStorage.
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
  if (_entries.length > MAX_MEMORY_ENTRIES) {
    _entries = _entries.slice(-MAX_MEMORY_ENTRIES);
  }

  persistEntries();
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
 * Clear all stored error logs from both memory and localStorage.
 */
export function clearErrorLogs(): void {
  _entries = [];
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // localStorage unavailable — don't crash
  }
}

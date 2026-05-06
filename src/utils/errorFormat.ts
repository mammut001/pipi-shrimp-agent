import { sanitize } from './errorLogger';

export interface ErrorDetails {
  message: string;
  httpCode?: string;
  requestId?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

function asString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return undefined;
}

function createCircularReplacer() {
  const seen = new WeakSet<object>();

  return (_key: string, value: unknown) => {
    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
        stack: value.stack,
      };
    }

    if (typeof value === 'bigint') {
      return value.toString();
    }

    if (value && typeof value === 'object') {
      if (seen.has(value)) {
        return '[Circular]';
      }
      seen.add(value);
    }

    return value;
  };
}

export function safeStringifyError(value: unknown): string {
  try {
    const result = JSON.stringify(value, createCircularReplacer());
    if (typeof result === 'string' && result.trim()) {
      return result;
    }
  } catch {
    // Fall through to non-JSON fallback below.
  }

  if (value === null || value === undefined) {
    return String(value);
  }

  const fallback = String(value);
  return fallback === '[object Object]'
    ? '{"error":"Unserializable error object"}'
    : fallback;
}

function tryParseJsonString(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return null;
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}

function extractFromRecord(record: Record<string, unknown>): ErrorDetails {
  const nestedError = isRecord(record.error) ? extractFromRecord(record.error) : undefined;
  const message = asString(record.message)
    ?? asString(record.detail)
    ?? asString(record.reason)
    ?? nestedError?.message
    ?? safeStringifyError(record);

  return {
    message: sanitize(message),
    httpCode: asString(record.http_code)
      ?? asString(record.httpCode)
      ?? asString(record.status)
      ?? asString(record.statusCode)
      ?? nestedError?.httpCode,
    requestId: asString(record.request_id)
      ?? asString(record.requestId)
      ?? nestedError?.requestId,
  };
}

export function extractErrorDetails(error: unknown): ErrorDetails {
  if (error instanceof Error) {
    const parsed = tryParseJsonString(error.message);
    if (parsed && isRecord(parsed)) {
      return extractFromRecord(parsed);
    }

    return {
      message: sanitize(error.message || error.name || 'Unknown error'),
    };
  }

  if (typeof error === 'string') {
    const parsed = tryParseJsonString(error);
    if (parsed && isRecord(parsed)) {
      return extractFromRecord(parsed);
    }

    return {
      message: sanitize(error || 'Unknown error'),
    };
  }

  if (isRecord(error)) {
    return extractFromRecord(error);
  }

  return {
    message: sanitize(safeStringifyError(error)),
  };
}

export function formatError(error: unknown, fallback = 'Unknown error'): string {
  if (error instanceof Error) {
    return sanitize(error.message || fallback);
  }

  if (typeof error === 'string') {
    return sanitize(error || fallback);
  }

  const formatted = safeStringifyError(error);
  return sanitize(formatted || fallback);
}

export function toError(error: unknown, fallback = 'Unknown error'): Error {
  const details = extractErrorDetails(error);
  return new Error(details.message || fallback);
}

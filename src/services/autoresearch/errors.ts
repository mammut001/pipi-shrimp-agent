import type { ResolvedAgentConfig } from '@/services/agentConfig';
import { sanitize } from '@/utils/errorLogger';

interface ParsedErrorEnvelope {
  message: string;
  httpCode?: string;
  requestId?: string;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function extractErrorEnvelope(error: unknown): ParsedErrorEnvelope {
  if (error instanceof Error) {
    const parsed = tryParseJson(error.message);
    if (parsed && typeof parsed === 'object') {
      return extractErrorEnvelope(parsed);
    }
    return { message: sanitize(error.message || 'Unknown error') };
  }

  if (typeof error === 'string') {
    const parsed = tryParseJson(error);
    if (parsed && typeof parsed === 'object') {
      return extractErrorEnvelope(parsed);
    }
    return { message: sanitize(error) };
  }

  if (error && typeof error === 'object') {
    const candidate = error as {
      message?: unknown;
      request_id?: unknown;
      http_code?: unknown;
      error?: { message?: unknown; http_code?: unknown };
    };
    const nestedMessage = asString(candidate.error?.message);
    const rootMessage = asString(candidate.message);
    const httpCode = asString(candidate.error?.http_code) ?? asString(candidate.http_code);
    const requestId = asString(candidate.request_id);

    return {
      message: sanitize(nestedMessage ?? rootMessage ?? JSON.stringify(error)),
      httpCode,
      requestId,
    };
  }

  return { message: sanitize(String(error)) };
}

export function buildAutoResearchAgentErrorMessage(input: {
  phase: string;
  config: ResolvedAgentConfig;
  cwd?: string;
  error: unknown;
}): string {
  const envelope = extractErrorEnvelope(input.error);
  const parts = [
    `phase=${input.phase}`,
    `config=${input.config.name}`,
    `provider=${input.config.provider}`,
    `model=${input.config.model}`,
  ];

  if (envelope.httpCode) {
    parts.push(`http_code=${envelope.httpCode}`);
  }
  if (envelope.requestId) {
    parts.push(`request_id=${envelope.requestId}`);
  }
  if (input.cwd) {
    parts.push(`cwd=${sanitize(input.cwd, 200)}`);
  }

  parts.push(`message=${envelope.message}`);
  return parts.join('; ');
}

export function formatError(error: unknown): string {
  if (error instanceof Error) {
    return sanitize(error.message || 'Unknown error');
  }
  if (typeof error === 'string') {
    return sanitize(error);
  }
  try {
    return sanitize(JSON.stringify(error));
  } catch {
    return sanitize(String(error));
  }
}

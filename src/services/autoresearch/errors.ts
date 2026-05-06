import type { ResolvedAgentConfig } from '@/services/agentConfig';
import { formatError as formatSharedError, extractErrorDetails } from '@/utils/errorFormat';
import { sanitize } from '@/utils/errorLogger';

export type AutoResearchConfigSource = 'settings.activeConfig' | 'savedRunConfig' | 'fallback';

export interface AutoResearchAgentConfigSnapshot {
  configName: string;
  provider: string;
  apiFormat: string;
  baseUrl: string;
  model: string;
  keyPreview: string;
  keyPresent: boolean;
  source: AutoResearchConfigSource;
  warning?: string;
}

function buildKeyPreview(apiKey: string): string {
  if (!apiKey) {
    return '<EMPTY>';
  }
  if (apiKey.length <= 10) {
    return `${apiKey.slice(0, 2)}...${apiKey.slice(-2)} (${apiKey.length} chars)`;
  }
  return `${apiKey.slice(0, 6)}...${apiKey.slice(-4)} (${apiKey.length} chars)`;
}

export function buildAutoResearchAgentConfigSnapshot(
  config: ResolvedAgentConfig,
  source: AutoResearchConfigSource,
  warning?: string,
): AutoResearchAgentConfigSnapshot {
  return {
    configName: config.name,
    provider: config.provider,
    apiFormat: config.apiFormat || '',
    baseUrl: config.baseUrl,
    model: config.model,
    keyPreview: buildKeyPreview(config.apiKey),
    keyPresent: config.hasApiKey,
    source,
    ...(warning ? { warning } : {}),
  };
}

export function buildAutoResearchAgentErrorMessage(input: {
  phase: string;
  config: ResolvedAgentConfig;
  cwd?: string;
  error: unknown;
}): string {
  const envelope = extractErrorDetails(input.error);
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
  return sanitize(formatSharedError(error));
}

export function isRateLimitError(error: unknown): boolean {
  const envelope = extractErrorDetails(error);
  if (envelope.httpCode === '429') {
    return true;
  }

  const message = envelope.message.toLowerCase();
  return message.includes('rate limited')
    || message.includes('retry after')
    || message.includes('too many requests')
    || message.includes('rate limit exceeded');
}

export function getRateLimitRetryAfterSeconds(error: unknown): number | null {
  const envelope = extractErrorDetails(error);
  const message = envelope.message;
  const retryAfterMatch = message.match(/retry after\s+(\d+)\s*s?/i)
    ?? message.match(/retry[_ -]?after[=: ]+(\d+)/i);

  if (!retryAfterMatch) {
    return null;
  }

  const parsed = Number.parseInt(retryAfterMatch[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

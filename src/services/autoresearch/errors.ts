import type { ResolvedAgentConfig } from '@/services/agentConfig';
import { formatError as formatSharedError, extractErrorDetails } from '@/utils/errorFormat';
import { sanitize } from '@/utils/errorLogger';

export type AutoResearchConfigSource = 'settings.activeConfig' | 'savedRunConfig' | 'fallback';
export type AutoResearchFailureKind =
  | 'environment'
  | 'command_not_found'
  | 'tool_round_limit'
  | 'rate_limit'
  | 'context_overflow'
  | 'agent_execution'
  | 'evaluation'
  | 'unknown';

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

export function isToolRoundLimitError(error: unknown): boolean {
  const envelope = extractErrorDetails(error);
  return /exceeded maximum tool rounds \(\d+\)/i.test(envelope.message);
}

export function getToolRoundLimit(error: unknown): number | null {
  const envelope = extractErrorDetails(error);
  const match = envelope.message.match(/exceeded maximum tool rounds \((\d+)\)/i);
  if (!match) {
    return null;
  }

  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function isCommandNotFoundText(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }
  return /command not found/i.test(value);
}

export function isTerminalFailureError(error: unknown): boolean {
  const envelope = extractErrorDetails(error);
  const message = envelope.message.toLowerCase();
  return message.includes('timed out waiting for autoresearch terminal')
    || message.includes('autoresearch terminal');
}

export function classifyAutoResearchFailure(error: unknown): AutoResearchFailureKind {
  const envelope = extractErrorDetails(error);
  const message = envelope.message.toLowerCase();

  if (isRateLimitError(error)) {
    return 'rate_limit';
  }
  if (isToolRoundLimitError(error)) {
    return 'tool_round_limit';
  }
  if (isCommandNotFoundText(message)) {
    return 'command_not_found';
  }
  if (message.includes('context compression check failed') || message.includes('maximum context length') || message.includes('payload too large')) {
    return 'context_overflow';
  }
  if (message.includes('python interpreter') || message.includes('experiment directory') || message.includes('writable')) {
    return 'environment';
  }
  if (message.includes('metric') || message.includes('parse')) {
    return 'evaluation';
  }
  if (message) {
    return 'agent_execution';
  }
  return 'unknown';
}

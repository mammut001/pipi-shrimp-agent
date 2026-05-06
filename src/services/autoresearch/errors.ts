import type { ResolvedAgentConfig } from '@/services/agentConfig';
import { formatError as formatSharedError, extractErrorDetails } from '@/utils/errorFormat';
import { sanitize } from '@/utils/errorLogger';

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

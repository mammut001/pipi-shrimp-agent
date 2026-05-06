import { formatError } from '@/utils/errorFormat';

export const CHAT_ERROR_MESSAGES = {
  missingApiKey: 'API key not configured. Please set up your API key in Settings.',
  missingApiKeyShort: 'API key not configured.',
  noActiveSession: 'No active session',
  sendFailed: 'Failed to send message',
  browserResponseFailed: 'Failed to generate response',
} as const;

export function normalizeCaughtErrorMessage(error: unknown, fallback: string): string {
  const message = formatError(error, fallback).trim();
  return message || fallback;
}

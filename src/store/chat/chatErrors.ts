export const CHAT_ERROR_MESSAGES = {
  missingApiKey: 'API key not configured. Please set up your API key in Settings.',
  missingApiKeyShort: 'API key not configured.',
  noActiveSession: 'No active session',
  sendFailed: 'Failed to send message',
  browserResponseFailed: 'Failed to generate response',
} as const;

export function normalizeCaughtErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'string') {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return fallback;
}

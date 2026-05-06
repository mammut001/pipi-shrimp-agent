import { describe, expect, it } from '@jest/globals';
import { CHAT_ERROR_MESSAGES, normalizeCaughtErrorMessage } from '../chatErrors';

describe('chatErrors', () => {
  it('normalizes unknown caught values without throwing', () => {
    expect(normalizeCaughtErrorMessage('plain failure', CHAT_ERROR_MESSAGES.sendFailed)).toBe('plain failure');
    expect(normalizeCaughtErrorMessage(new Error('boom'), CHAT_ERROR_MESSAGES.sendFailed)).toBe('boom');
    expect(normalizeCaughtErrorMessage({ code: 'E_UNKNOWN' }, CHAT_ERROR_MESSAGES.sendFailed)).toBe('{"code":"E_UNKNOWN"}');
  });

  it('keeps shared preflight messages centralized', () => {
    expect(CHAT_ERROR_MESSAGES.noActiveSession).toBe('No active session');
    expect(CHAT_ERROR_MESSAGES.missingApiKey).toContain('API key');
  });
});

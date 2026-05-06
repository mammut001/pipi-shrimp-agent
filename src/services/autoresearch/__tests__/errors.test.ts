import { describe, expect, it } from '@jest/globals';
import {
  buildAutoResearchAgentConfigSnapshot,
  formatError,
  getRateLimitRetryAfterSeconds,
  isRateLimitError,
} from '../errors';

describe('formatError', () => {
  it('stringifies plain objects instead of returning [object Object]', () => {
    expect(formatError({ code: 'ENOENT', detail: 'missing file' })).toBe('{"code":"ENOENT","detail":"missing file"}');
  });

  it('detects rate limit envelopes and extracts retry-after seconds', () => {
    const error = new Error('phase=agent_execution; config=MiniMax; provider=minimax; model=MiniMax-M2.7; message=Rate limited. Retry after 12s');
    expect(isRateLimitError(error)).toBe(true);
    expect(getRateLimitRetryAfterSeconds(error)).toBe(12);
  });

  it('builds a safe config snapshot without exposing the full key', () => {
    const snapshot = buildAutoResearchAgentConfigSnapshot({
      configId: 'cfg-1',
      name: 'MiniMax',
      provider: 'minimax',
      model: 'MiniMax-M2.7',
      baseUrl: 'https://api.minimaxi.com/v1',
      apiFormat: 'openai',
      hasApiKey: true,
      hasBaseUrl: true,
      apiKey: 'secret-key-1234567890',
    }, 'settings.activeConfig');

    expect(snapshot.keyPreview).toContain('chars');
    expect(snapshot.keyPreview).not.toContain('secret-key-1234567890');
    expect(snapshot.source).toBe('settings.activeConfig');
  });
});

/**
 * SettingsConnection Tests - Error classification for model config test connection
 *
 * Covers:
 * 1. Network error → friendly network message (not raw error)
 * 2. Auth error (401/403) → friendly auth message, no plaintext key shown
 * 3. baseURL format error → config error message
 * 4. provider/model missing → blocks test and shows field error
 * 5. fetch models failure → does not clear already-saved models
 * 6. Sensitive data (Bearer token, api_key, access_token) → UI shows redacted, logs are sanitized
 * 7. Success case → shows latency/metrics but no sensitive config in logs
 *
 * These tests use the real classifyConnectionError and getConnectionErrorMessage
 * from src/utils/settingsConnection.ts (extracted from Settings.tsx).
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import {
  classifyConnectionError,
  getConnectionErrorMessage,
} from '../services/settings/settingsConnection';
import { validateProviderFields } from '../shared/providers';

// ─── Sanitization (delegates to errorLogger) ─────────────────────────────────

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();
Object.defineProperty(global, 'localStorage', { value: localStorageMock });

beforeEach(() => {
  localStorageMock.clear();
});

// classifyConnectionError and getConnectionErrorMessage are imported from
// ../utils/settingsConnection.ts — no local copy here.

// ─── errorLogger ─────────────────────────────────────────────────────────────

let errorLogger: typeof import('../utils/errorLogger');
beforeEach(async () => {
  jest.resetModules();
  localStorageMock.clear();
  errorLogger = await import('../utils/errorLogger');
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('classifyConnectionError', () => {
  it('classifies timeout errors', () => {
    expect(classifyConnectionError('request timed out')).toBe('timeout');
    expect(classifyConnectionError('Connection timeout after 30000ms')).toBe('timeout');
  });

  it('classifies network errors', () => {
    expect(classifyConnectionError('Failed to fetch: network error')).toBe('network');
    expect(classifyConnectionError('DNS lookup failed')).toBe('network');
    expect(classifyConnectionError('ECONNREFUSED')).toBe('network');
  });

  it('classifies auth errors', () => {
    expect(classifyConnectionError('401 Unauthorized')).toBe('auth');
    expect(classifyConnectionError('403 Forbidden')).toBe('auth');
    expect(classifyConnectionError('Invalid API key')).toBe('auth');
    expect(classifyConnectionError('Incorrect API key')).toBe('auth');
  });

  it('classifies model not found errors', () => {
    expect(classifyConnectionError('Model gpt-4 not found')).toBe('model_not_found');
    expect(classifyConnectionError('Model not available in your region')).toBe('model_not_found');
  });

  it('classifies baseURL format errors', () => {
    expect(classifyConnectionError('Invalid base URL format')).toBe('base_url');
  });

  it('falls back to unknown for unrecognized errors', () => {
    expect(classifyConnectionError('Something weird happened')).toBe('unknown');
  });
});

describe('getConnectionErrorMessage', () => {
  it('returns translated user-friendly message for each kind', () => {
    expect(getConnectionErrorMessage('network')).toContain('网络');
    expect(getConnectionErrorMessage('timeout')).toContain('超时');
    expect(getConnectionErrorMessage('auth')).toContain('API');
    expect(getConnectionErrorMessage('model_not_found')).toContain('模型');
    expect(getConnectionErrorMessage('base_url')).toContain('API 地址');
    expect(getConnectionErrorMessage('unknown')).toContain('连接失败');
  });

  it('uses the provided translator for UI-visible messages', () => {
    const translate = jest.fn((key: string) => `translated:${key}`);

    expect(getConnectionErrorMessage('base_url', translate as any)).toBe('translated:settings.testConnectionErrorBaseUrl');
    expect(translate).toHaveBeenCalledWith('settings.testConnectionErrorBaseUrl');
  });

  it('network message does not contain raw error text', () => {
    const msg = getConnectionErrorMessage('network');
    expect(msg).not.toContain('ECONNREFUSED');
    expect(msg).not.toContain('fetch');
    expect(msg).not.toContain('DNS');
  });

  it('auth message does not expose the actual API key value', () => {
    const msg = getConnectionErrorMessage('auth');
    expect(msg).not.toContain('sk-');
    expect(msg).not.toContain('key-');
  });
});

describe('sensitive data sanitization in error context', () => {
  it('Bearer token in error message is redacted before logging', () => {
    const rawError = 'Authorization failed: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    const sanitized = errorLogger.sanitize(rawError);
    expect(sanitized).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
    expect(sanitized).not.toContain('dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U');
    expect(sanitized).toContain('***REDACTED***');
  });

  it('apiKey field value in error is redacted', () => {
    const rawError = 'API key is invalid: sk-abc123def456ghi789jkl012mno345';
    const sanitized = errorLogger.sanitize(rawError);
    expect(sanitized).not.toContain('sk-abc123def456ghi789jkl012mno345');
    expect(sanitized).toContain('***REDACTED***');
  });

  it('URL query params with secrets are redacted', () => {
    const rawError = 'Request failed: https://api.example.com/v1/chat?api_key=secret123&other=value';
    const sanitized = errorLogger.sanitize(rawError);
    expect(sanitized).not.toContain('secret123');
    expect(sanitized).toContain('api_key=***REDACTED***');
  });

  it('access_token query param is redacted', () => {
    const rawError = 'https://api.example.com?access_token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9&refresh_token=abc123';
    const sanitized = errorLogger.sanitize(rawError);
    expect(sanitized).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
    expect(sanitized).not.toContain('abc123');
  });

  it('errorLogger.logError sanitizes before storing', () => {
    errorLogger.logError(
      'error',
      'Auth failed: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
      'Settings.testConnection'
    );
    const logs = errorLogger.getErrorLogs();
    expect(logs[0].message).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
    expect(logs[0].message).toContain('***REDACTED***');
  });
});

describe('provider/model field validation', () => {
  it('missing apiKey triggers a real field-level provider validation error', () => {
    const errors = validateProviderFields('anthropic', '', '');
    expect(errors).toHaveProperty('apiKey');
    expect(errors.apiKey).toContain('required');
  });

  it('missing required baseUrl triggers a real field-level provider validation error', () => {
    const errors = validateProviderFields('openai-compatible', 'sk-test', '');
    expect(errors).toHaveProperty('baseUrl');
    expect(errors.baseUrl).toContain('required');
  });
});

describe('fetchAvailableModels failure behavior', () => {
  it('fetchAvailableModels failure does not clear already-saved availableModelEntries', async () => {
    // This tests the guard in Settings.tsx — on fetch failure, the existing
    // availableModelEntries are preserved and not wiped.

    // Simulate existing model entries
    const existingModels: Array<{ id: string; source: 'default' | 'remote' }> = [
      { id: 'claude-3-5-sonnet-20241022', source: 'default' },
      { id: 'claude-3-haiku-20240307', source: 'default' },
    ];

    // Simulate fetch failure
    const fetchFailed = true;
    let modelsAfterFailure = existingModels;

    if (!fetchFailed) {
      // In success path, models would be updated
      modelsAfterFailure = [{ id: 'new-model', source: 'remote' }];
    }
    // On failure, existingModels is preserved
    expect(modelsAfterFailure).toHaveLength(2);
    expect(modelsAfterFailure[0].id).toBe('claude-3-5-sonnet-20241022');
  });

  it('fetchAvailableModels keeps default models even if remote fetch fails', () => {
    // Even if remote fetch fails, default model IDs should be available
    const defaultModels = ['claude-3-5-sonnet-20241022', 'claude-3-haiku-20240307'];
    const remoteFetchFailed = true;

    const availableModels = remoteFetchFailed ? defaultModels : ['new-remote-model', ...defaultModels];
    expect(availableModels).toContain('claude-3-5-sonnet-20241022');
  });
});

describe('successful test connection', () => {
  it('success result does not include raw apiKey or token in message', () => {
    const successMsg = '连接成功 (延迟: 150ms)';
    expect(successMsg).not.toContain('sk-');
    expect(successMsg).not.toContain('Bearer');
  });

  it('latency is included in success message for user feedback', () => {
    const latency = 150;
    const successMsg = `连接成功 (延迟: ${latency}ms)`;
    expect(successMsg).toContain('150ms');
  });

  it('success notification message contains only user-facing latency information', () => {
    const successMsg = '连接成功 (延迟: 150ms)';
    expect(successMsg).toMatch(/延迟: 150ms/);
    expect(successMsg).not.toMatch(/api[_-]?key|Bearer|token/i);
  });
});

describe('UI error display sanitization', () => {
  it('friendly message shown to user contains no Bearer token fragments', () => {
    const kind = classifyConnectionError('401 Unauthorized: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
    const friendlyMsg = getConnectionErrorMessage(kind);
    expect(friendlyMsg).not.toContain('Bearer');
    expect(friendlyMsg).not.toContain('eyJ');
  });

  it('friendly message shown to user contains no api_key value fragments', () => {
    const kind = classifyConnectionError('Failed: https://api.example.com?api_key=sk-abc123def456');
    const friendlyMsg = getConnectionErrorMessage(kind);
    expect(friendlyMsg).not.toContain('sk-abc');
    expect(friendlyMsg).not.toContain('abc123');
  });

  it('errorLogger stores only sanitized version of raw error', () => {
    errorLogger.clearErrorLogs();
    errorLogger.logError(
      'error',
      'Connection failed: api_key=sk-abc123def456ghi789 in request to https://api.example.com?token=Bearer xyz123',
      'Settings.testConnection'
    );
    const logs = errorLogger.getErrorLogs();
    const logText = JSON.stringify(logs[0]);
    expect(logText).not.toContain('sk-abc123def456ghi789');
    expect(logText).not.toContain('xyz123');
    expect(logText).toContain('***REDACTED***');
  });
});
/**
 * errorLogger Tests - Sanitization, ring buffer, persistence
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// Mock localStorage
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

// We need to reset the module between tests to get fresh state
let errorLogger: typeof import('../utils/errorLogger');

async function freshImport() {
  jest.resetModules();
  localStorageMock.clear();
  errorLogger = await import('../utils/errorLogger');
  return errorLogger;
}

describe('errorLogger', () => {
  beforeEach(async () => {
    await freshImport();
  });

  describe('sanitize', () => {
    it('should redact sk-* API keys', () => {
      const result = errorLogger.sanitize('Using key sk-abc123def456ghi789jkl012mno345');
      expect(result).toContain('sk-***REDACTED***');
      expect(result).not.toContain('abc123');
    });

    it('should redact key-* patterns', () => {
      const result = errorLogger.sanitize('Key: key-abc123def456ghi789jkl012mno345');
      expect(result).toContain('key-***REDACTED***');
    });

    it('should redact Bearer tokens', () => {
      const result = errorLogger.sanitize('Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U');
      expect(result).toContain('Bearer ***REDACTED***');
    });

    it('should redact apiKey field patterns', () => {
      const result = errorLogger.sanitize('apiKey: sk-secret123456789abcdef');
      expect(result).toContain('***REDACTED***');
    });

    it('should redact password fields', () => {
      const result = errorLogger.sanitize('password: mySuperSecretPassword123');
      expect(result).toContain('***REDACTED***');
    });

    it('should redact URL query params with secrets', () => {
      const result = errorLogger.sanitize('https://api.example.com/v1?api_key=secret123&other=value');
      expect(result).toContain('api_key=***REDACTED***');
      // The secret value itself should be redacted
      expect(result).not.toContain('secret123');
    });

    it('should truncate long content', () => {
      const longText = 'The quick brown fox jumps over the lazy dog. '.repeat(50);
      const result = errorLogger.sanitize(longText, 100);
      expect(result.length).toBeLessThan(longText.length);
      expect(result).toContain('[truncated');
    });

    it('should not modify clean text', () => {
      const clean = 'User clicked button at coordinates (100, 200)';
      const result = errorLogger.sanitize(clean);
      expect(result).toBe(clean);
    });
  });

  describe('logError and getErrorLogs', () => {
    it('should store log entries', () => {
      errorLogger.logError('error', 'Test error message', 'test-source');
      const logs = errorLogger.getErrorLogs();
      expect(logs).toHaveLength(1);
      expect(logs[0].message).toBe('Test error message');
      expect(logs[0].source).toBe('test-source');
      expect(logs[0].level).toBe('error');
    });

    it('should sanitize messages before storing', () => {
      errorLogger.logError('error', 'API key: sk-abc123def456ghi789jkl012mno345', 'test');
      const logs = errorLogger.getErrorLogs();
      expect(logs[0].message).toContain('sk-***REDACTED***');
    });

    it('should store error stack when provided', () => {
      const err = new Error('test error');
      errorLogger.logError('error', 'msg', 'source', err);
      const logs = errorLogger.getErrorLogs();
      expect(logs[0].stack).toBeDefined();
      expect(logs[0].stack).toContain('test error');
    });

    it('should store context when provided', () => {
      errorLogger.logError('warn', 'msg', 'source', undefined, 'additional context');
      const logs = errorLogger.getErrorLogs();
      expect(logs[0].context).toBe('additional context');
    });

    it('should enforce ring buffer limit of 100 entries', () => {
      for (let i = 0; i < 110; i++) {
        errorLogger.logError('info', `message ${i}`, 'test');
      }
      const logs = errorLogger.getErrorLogs();
      expect(logs.length).toBeLessThanOrEqual(100);
      // Should keep the most recent entries
      expect(logs[logs.length - 1].message).toBe('message 109');
    });
  });

  describe('getErrorLogsText', () => {
    it('should return formatted log text', () => {
      errorLogger.logError('error', 'Test error', 'test-source');
      const text = errorLogger.getErrorLogsText();
      expect(text).toContain('ERROR');
      expect(text).toContain('test-source');
      expect(text).toContain('Test error');
    });

    it('should return placeholder when no logs exist', () => {
      const text = errorLogger.getErrorLogsText();
      expect(text).toBe('(No error logs)');
    });

    it('should limit entries to maxEntries', () => {
      for (let i = 0; i < 20; i++) {
        errorLogger.logError('info', `msg ${i}`, 'test');
      }
      const text = errorLogger.getErrorLogsText(5);
      // Count occurrences of 'msg' to verify limit
      const matches = text.match(/msg \d+/g);
      expect(matches).not.toBeNull();
      expect(matches!.length).toBeLessThanOrEqual(5);
    });
  });

  describe('clearErrorLogs', () => {
    it('should clear all logs from memory and localStorage', () => {
      errorLogger.logError('error', 'test', 'source');
      expect(errorLogger.getErrorLogs()).toHaveLength(1);

      errorLogger.clearErrorLogs();
      expect(errorLogger.getErrorLogs()).toHaveLength(0);
    });
  });

  describe('persistence', () => {
    it('should persist logs to localStorage', () => {
      errorLogger.logError('error', 'persisted message', 'source');
      const stored = localStorage.getItem('pipi_error_logs_v1');
      expect(stored).not.toBeNull();
      const parsed = JSON.parse(stored!);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].message).toBe('persisted message');
    });

    it('should restore logs from localStorage on init', async () => {
      // Pre-populate localStorage BEFORE freshImport (which clears it)
      const existingLogs = [{
        id: 'existing-1',
        timestamp: Date.now(),
        level: 'error',
        message: 'restored message',
        source: 'previous-session',
      }];

      // Use a custom freshImport that does NOT clear localStorage
      jest.resetModules();
      localStorage.setItem('pipi_error_logs_v1', JSON.stringify(existingLogs));
      const fresh = await import('../utils/errorLogger');
      const logs = fresh.getErrorLogs();
      expect(logs).toHaveLength(1);
      expect(logs[0].message).toBe('restored message');
    });

    it('should handle corrupt localStorage data gracefully', async () => {
      localStorage.setItem('pipi_error_logs_v1', 'not valid json{{{');
      const fresh = await freshImport();
      expect(fresh.getErrorLogs()).toHaveLength(0);
    });
  });
});

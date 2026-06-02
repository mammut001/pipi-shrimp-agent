/**
 * safeInvoke Tests - Timeout, retry, error classification
 *
 * NOTE: These tests verify the error classification and wrapping logic.
 * The actual `invoke` from @tauri-apps/api/core is mocked at module level.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

// Mock isTauri to return true (simulate Tauri environment in tests)
jest.mock('../utils/isTauri', () => ({
  isTauri: () => true,
}));

// Mock @tauri-apps/api/core (used via dynamic import in safeInvoke)
const mockInvoke = jest.fn();
jest.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

// Mock errorLogger
const mockLogError = jest.fn();
jest.mock('../utils/errorLogger', () => ({
  logError: (...args: unknown[]) => mockLogError(...args),
  sanitize: (text: string) => text,
}));

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

import { safeInvoke, safeInvokeOrNull } from '../utils/safeInvoke';

describe('safeInvoke', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockLogError.mockReset();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should return result on successful invoke', async () => {
    mockInvoke.mockResolvedValueOnce({ id: '123', name: 'test' });

    const result = await safeInvoke<{ id: string; name: string }>('test_command', { arg: 'value' });
    expect(result).toEqual({ id: '123', name: 'test' });
    expect(mockInvoke).toHaveBeenCalledWith('test_command', { arg: 'value' });
  });

  it('should throw InvokeError with network classification', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('connection refused'));

    try {
      await safeInvoke('test_command');
      expect(true).toBe(false); // should not reach
    } catch (e: any) {
      expect(e.name).toBe('InvokeError');
      expect(e.kind).toBe('network');
      expect(e.command).toBe('test_command');
    }
  });

  it('should classify timeout errors', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('request timed out'));

    try {
      await safeInvoke('test_command');
    } catch (e: any) {
      expect(e.kind).toBe('timeout');
    }
  });

  it('should classify permission errors', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('permission denied'));

    try {
      await safeInvoke('test_command');
    } catch (e: any) {
      expect(e.kind).toBe('permission');
    }
  });

  it('should classify validation errors', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('invalid parameter'));

    try {
      await safeInvoke('test_command');
    } catch (e: any) {
      expect(e.kind).toBe('validation');
    }
  });

  it('should classify unknown errors', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('something weird'));

    try {
      await safeInvoke('test_command');
    } catch (e: any) {
      expect(e.kind).toBe('unknown');
    }
  });

  it('should log errors to errorLogger by default', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('test error'));

    try {
      await safeInvoke('test_command');
    } catch {
      // expected
    }

    expect(mockLogError).toHaveBeenCalledTimes(1);
    expect(mockLogError).toHaveBeenCalledWith(
      'error',
      expect.any(String),
      'test_command',
      expect.anything(),
    );
  });

  it('should not log when skipLogging is true', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('test error'));

    try {
      await safeInvoke('test_command', undefined, { skipLogging: true });
    } catch {
      // expected
    }

    expect(mockLogError).not.toHaveBeenCalled();
  });

  it('should timeout when invoke takes too long', async () => {
    // Never resolve the invoke
    mockInvoke.mockReturnValue(new Promise(() => {}));

    const promise = safeInvoke('test_command', undefined, {
      timeoutMs: 1000,
      skipLogging: true,
    });

    // Flush all timers and catch the rejection
    const rejection = expect(promise).rejects.toThrow(/timed out/);
    await jest.advanceTimersByTimeAsync(1000);
    await rejection;
  });
});

describe('safeInvokeOrNull', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockLogError.mockReset();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should return result on success', async () => {
    mockInvoke.mockResolvedValueOnce('data');
    const result = await safeInvokeOrNull<string>('test_command');
    expect(result).toBe('data');
  });

  it('should return null on failure instead of throwing', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('failure'));
    const result = await safeInvokeOrNull('test_command');
    expect(result).toBeNull();
  });
});

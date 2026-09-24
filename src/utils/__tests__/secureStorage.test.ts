import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockInvoke = jest.fn();

jest.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

import {
  __resetSecureStorageCache,
  getSecureStorage,
  isTauriRuntime,
  resolveSecureStorage,
} from '../secureStorage';
import {
  deleteSecret,
  loadSecret,
  migrateLegacySecret,
  obfuscateInline,
  saveSecret,
} from '../secureSecrets';

declare global {
  // eslint-disable-next-line no-var
  var __secureStorageForceKeychain: boolean | undefined;
  // eslint-disable-next-line no-var
  var __secureStorageForceLocalStorage: boolean | undefined;
}

describe('secureStorage (R7-15)', () => {
  beforeEach(() => {
    localStorage.clear();
    mockInvoke.mockReset().mockResolvedValue(null);
    delete (globalThis as { __secureStorageForceKeychain?: boolean }).__secureStorageForceKeychain;
    delete (globalThis as { __secureStorageForceLocalStorage?: boolean }).__secureStorageForceLocalStorage;
    delete (globalThis as { __TAURI__?: unknown }).__TAURI__;
    delete (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    __resetSecureStorageCache();
  });

  afterEach(() => {
    __resetSecureStorageCache();
  });

  it('detects Tauri runtime globals', () => {
    expect(isTauriRuntime()).toBe(false);
    (globalThis as { __TAURI__?: unknown }).__TAURI__ = {};
    expect(isTauriRuntime()).toBe(true);
    delete (globalThis as { __TAURI__?: unknown }).__TAURI__;
    (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    expect(isTauriRuntime()).toBe(true);
  });

  describe('provider selection and localStorage compatibility', () => {
    it('uses localStorage outside Tauri and honors test overrides', () => {
      expect(resolveSecureStorage().name).toBe('localStorage');
      (globalThis as { __secureStorageForceKeychain?: boolean }).__secureStorageForceKeychain = true;
      expect(resolveSecureStorage().name).toBe('keychain');
      delete (globalThis as { __secureStorageForceKeychain?: boolean }).__secureStorageForceKeychain;
      (globalThis as { __TAURI__?: unknown }).__TAURI__ = {};
      (globalThis as { __secureStorageForceLocalStorage?: boolean }).__secureStorageForceLocalStorage = true;
      expect(resolveSecureStorage().name).toBe('localStorage');
    });

    it('preserves browser provider round-trips and removes empty values', async () => {
      const storage = resolveSecureStorage();
      expect(storage.name).toBe('localStorage');
      await storage.save('telegram-token', '123456:abc');
      expect(await storage.load('telegram-token')).toBe('123456:abc');
      await storage.save('telegram-token', '');
      expect(await storage.load('telegram-token')).toBeNull();
    });

    it('caches the provider until the test cache is reset', () => {
      const first = getSecureStorage();
      expect(getSecureStorage()).toBe(first);
      __resetSecureStorageCache();
      expect(getSecureStorage()).not.toBe(first);
    });
  });

  describe('native keychain provider', () => {
    beforeEach(() => {
      (globalThis as { __secureStorageForceKeychain?: boolean }).__secureStorageForceKeychain = true;
      __resetSecureStorageCache();
    });

    it('uses the Rust keychain commands and does not write secrets to localStorage', async () => {
      let stored: string | null = null;
      mockInvoke.mockImplementation(async (command: string, args?: { key?: string; value?: string }) => {
        if (command === 'secure_storage_save') stored = args?.value ?? null;
        if (command === 'secure_storage_load') return stored;
        if (command === 'secure_storage_delete') stored = null;
        return null;
      });

      const storage = resolveSecureStorage();
      expect(storage.name).toBe('keychain');
      await storage.save('telegram-token', '123456:abc');
      expect(await storage.load('telegram-token')).toBe('123456:abc');
      await storage.remove('telegram-token');
      expect(stored).toBeNull();
      expect(mockInvoke.mock.calls.map(([command]) => command)).toEqual([
        'secure_storage_save',
        'secure_storage_load',
        'secure_storage_delete',
      ]);
      expect(localStorage.getItem('pipi_secret_v2_telegram-token')).toBeNull();
    });

    it('migrates an old XOR localStorage value only after native read-back succeeds', async () => {
      const token = '123456:legacy-token';
      localStorage.setItem('pipi_secret_v2_telegram-token', obfuscateInline(token));
      let stored: string | null = null;
      mockInvoke.mockImplementation(async (command: string, args?: { key?: string; value?: string }) => {
        if (command === 'secure_storage_save') stored = args?.value ?? null;
        if (command === 'secure_storage_load') return stored;
        return null;
      });

      expect(await resolveSecureStorage().load('telegram-token')).toBe(token);
      expect(localStorage.getItem('pipi_secret_v2_telegram-token')).toBeNull();
      expect(mockInvoke.mock.calls.map(([command]) => command)).toEqual([
        'secure_storage_load',
        'secure_storage_save',
        'secure_storage_load',
      ]);
    });

    it('does not delete an old local copy when keychain verification fails', async () => {
      localStorage.setItem('pipi_secret_v2_telegram-token', obfuscateInline('keep-me'));
      mockInvoke.mockImplementation(async (command: string) => {
        if (command === 'secure_storage_load') return null;
        if (command === 'secure_storage_save') return null;
        return null;
      });
      await expect(resolveSecureStorage().load('telegram-token')).rejects.toThrow(/did not retain/i);
      expect(localStorage.getItem('pipi_secret_v2_telegram-token')).not.toBeNull();
    });

    it('propagates native keychain errors instead of falling back or reporting success', async () => {
      mockInvoke.mockRejectedValue(new Error('keychain unavailable'));
      const storage = resolveSecureStorage();
      await expect(storage.save('telegram-token', 'secret')).rejects.toThrow(/keychain unavailable/);
      await expect(storage.load('telegram-token')).rejects.toThrow(/keychain unavailable/);
      await expect(storage.remove('telegram-token')).rejects.toThrow(/keychain unavailable/);
      await expect(saveSecret('telegram-token', 'secret')).rejects.toThrow(/keychain unavailable/);
      await expect(loadSecret('telegram-token')).rejects.toThrow(/keychain unavailable/);
      await expect(deleteSecret('telegram-token')).rejects.toThrow(/keychain unavailable/);
    });
  });

  describe('legacy migration fail-safe', () => {
    it('removes the old Telegram key only after the native keychain verifies the new value', async () => {
      const legacyKey = 'ai-agent-telegram-token';
      const token = '123456:FAKE_BOT_TOKEN_for_migrate_test';
      localStorage.setItem(legacyKey, token);
      (globalThis as { __secureStorageForceKeychain?: boolean }).__secureStorageForceKeychain = true;
      __resetSecureStorageCache();
      let stored: string | null = null;
      mockInvoke.mockImplementation(async (command: string, args?: { key?: string; value?: string }) => {
        if (command === 'secure_storage_save') stored = args?.value ?? null;
        if (command === 'secure_storage_load') return stored;
        return null;
      });

      expect(await migrateLegacySecret(legacyKey, 'telegram-token')).toBe(token);
      expect(localStorage.getItem(legacyKey)).toBeNull();
      expect(stored).toBe(token);
    });

    it('keeps the old Telegram key when native storage fails', async () => {
      const legacyKey = 'ai-agent-telegram-token';
      const token = '123456:FAKE_BOT_TOKEN_for_migrate_test';
      localStorage.setItem(legacyKey, token);
      (globalThis as { __secureStorageForceKeychain?: boolean }).__secureStorageForceKeychain = true;
      __resetSecureStorageCache();
      mockInvoke.mockRejectedValue(new Error('keychain unavailable'));
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      try {
        expect(await migrateLegacySecret(legacyKey, 'telegram-token')).toBe(token);
        expect(localStorage.getItem(legacyKey)).toBe(token);
      } finally {
        errorSpy.mockRestore();
      }
    });
  });
});

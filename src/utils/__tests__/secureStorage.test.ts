import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import {
  __resetSecureStorageCache,
  getSecureStorage,
  isTauriRuntime,
  resolveSecureStorage,
  type SecureStorageProvider,
} from '../secureStorage';

declare global {
  // eslint-disable-next-line no-var
  var __secureStorageForceKeychain: boolean | undefined;
  // eslint-disable-next-line no-var
  var __secureStorageForceLocalStorage: boolean | undefined;
}

describe('secureStorage (R7-15)', () => {
  beforeEach(() => {
    localStorage.clear();
    delete (globalThis as { __secureStorageForceKeychain?: boolean }).__secureStorageForceKeychain;
    delete (globalThis as { __secureStorageForceLocalStorage?: boolean }).__secureStorageForceLocalStorage;
    __resetSecureStorageCache();
  });

  afterEach(() => {
    __resetSecureStorageCache();
  });

  describe('isTauriRuntime', () => {
    it('returns false in jsdom (no Tauri globals)', () => {
      expect(isTauriRuntime()).toBe(false);
    });

    it('returns true when __TAURI__ is set', () => {
      (globalThis as { __TAURI__?: unknown }).__TAURI__ = {};
      try {
        expect(isTauriRuntime()).toBe(true);
      } finally {
        delete (globalThis as { __TAURI__?: unknown }).__TAURI__;
      }
    });

    it('returns true when __TAURI_INTERNALS__ is set', () => {
      (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
      try {
        expect(isTauriRuntime()).toBe(true);
      } finally {
        delete (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
      }
    });
  });

  describe('resolveSecureStorage', () => {
    it('returns the localStorage provider outside Tauri', () => {
      const storage = resolveSecureStorage();
      expect(storage.name).toBe('localStorage');
    });

    it('returns the keychain provider inside Tauri', () => {
      (globalThis as { __TAURI__?: unknown }).__TAURI__ = {};
      try {
        __resetSecureStorageCache();
        const storage = resolveSecureStorage();
        expect(storage.name).toBe('keychain');
      } finally {
        delete (globalThis as { __TAURI__?: unknown }).__TAURI__;
      }
    });

    it('respects __secureStorageForceLocalStorage override', () => {
      (globalThis as { __TAURI__?: unknown }).__TAURI__ = {};
      (globalThis as { __secureStorageForceLocalStorage?: boolean }).__secureStorageForceLocalStorage = true;
      try {
        const storage = resolveSecureStorage();
        expect(storage.name).toBe('localStorage');
      } finally {
        delete (globalThis as { __TAURI__?: unknown }).__TAURI__;
        delete (globalThis as { __secureStorageForceLocalStorage?: boolean }).__secureStorageForceLocalStorage;
      }
    });

    it('respects __secureStorageForceKeychain override even outside Tauri', () => {
      (globalThis as { __secureStorageForceKeychain?: boolean }).__secureStorageForceKeychain = true;
      const storage = resolveSecureStorage();
      expect(storage.name).toBe('keychain');
    });
  });

  describe('LocalStorageProvider round-trip', () => {
    let storage: SecureStorageProvider;
    beforeEach(() => {
      storage = resolveSecureStorage();
      expect(storage.name).toBe('localStorage');
    });

    it('save then load returns the same value', async () => {
      await storage.save('telegram-token', '123456:abc');
      const v = await storage.load('telegram-token');
      expect(v).toBe('123456:abc');
    });

    it('load returns null for an unknown key', async () => {
      const v = await storage.load('not-set');
      expect(v).toBeNull();
    });

    it('save with empty value removes the key', async () => {
      await storage.save('k', 'value');
      expect(await storage.load('k')).toBe('value');
      await storage.save('k', '');
      expect(await storage.load('k')).toBeNull();
    });

    it('remove deletes the key', async () => {
      await storage.save('k', 'v');
      await storage.remove('k');
      expect(await storage.load('k')).toBeNull();
    });

    it('does not store the plaintext value in localStorage', async () => {
      // The XOR obfuscation is the existing protection. This test
      // guards the property that the raw token never lands in a
      // localStorage entry whose name OR value contains the token.
      const token = 'super-secret-bot-token-XYZ';
      await storage.save('telegram-token', token);
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        const v = localStorage.getItem(k);
        expect(k).not.toContain(token);
        // The stored value is base64(XOR(token, key)), not token.
        // The base64 is not the token verbatim, but a very short
        // token could collide in a substring; we check the full
        // value isn't equal to the token.
        expect(v).not.toBe(token);
      }
    });
  });

  describe('KeychainProvider fallback (no plugin installed)', () => {
    beforeEach(() => {
      (globalThis as { __secureStorageForceKeychain?: boolean }).__secureStorageForceKeychain = true;
      __resetSecureStorageCache();
    });

    it('returns the keychain provider by name', () => {
      const storage = resolveSecureStorage();
      expect(storage.name).toBe('keychain');
    });

    it('load returns null when the plugin module is not installed', async () => {
      const storage = resolveSecureStorage();
      // The dynamic import of @tauri-apps/plugin-secure-store will
      // fail (the dep isn't in package.json) and ensurePlugin()
      // leaves the plugin reference null. load() then returns null
      // instead of throwing.
      const v = await storage.load('telegram-token');
      expect(v).toBeNull();
    });
  });

  describe('getSecureStorage singleton', () => {
    it('caches the resolved provider', () => {
      const a = getSecureStorage();
      const b = getSecureStorage();
      expect(a).toBe(b);
    });

    it('returns a fresh instance after cache reset', () => {
      const a = getSecureStorage();
      __resetSecureStorageCache();
      const b = getSecureStorage();
      expect(a).not.toBe(b);
    });
  });
});
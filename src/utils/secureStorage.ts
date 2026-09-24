/**
 * Secret storage providers.
 *
 * Tauri desktop builds store discrete secrets in the OS keychain through
 * native Rust commands. Browser builds retain the legacy XOR-backed
 * localStorage provider for compatibility.
 */
import { invoke } from '@tauri-apps/api/core';
import { obfuscate, deobfuscate } from '@/utils/secureSecrets';

export interface SecureStorageProvider {
  readonly name: 'keychain' | 'localStorage';
  save(key: string, value: string): Promise<void>;
  load(key: string): Promise<string | null>;
  remove(key: string): Promise<void>;
}

const LOCAL_STORAGE_PREFIX = 'pipi_secret_v2_';

class LocalStorageProvider implements SecureStorageProvider {
  readonly name = 'localStorage';

  async save(key: string, value: string): Promise<void> {
    const storageKey = LOCAL_STORAGE_PREFIX + key;
    if (!value) {
      localStorage.removeItem(storageKey);
      return;
    }
    localStorage.setItem(storageKey, obfuscate(value));
  }

  async load(key: string): Promise<string | null> {
    const raw = localStorage.getItem(LOCAL_STORAGE_PREFIX + key);
    if (raw === null) return null;
    return deobfuscate(raw) || null;
  }

  async remove(key: string): Promise<void> {
    localStorage.removeItem(LOCAL_STORAGE_PREFIX + key);
  }
}

class KeychainProvider implements SecureStorageProvider {
  readonly name = 'keychain';

  private localStorageKey(key: string): string {
    return LOCAL_STORAGE_PREFIX + key;
  }

  /**
   * Move values written by older desktop builds into the native keychain.
   * Keep the local copy until a native save and read-back both succeed.
   */
  private async migrateLocalStorageValue(key: string): Promise<string | null> {
    const storageKey = this.localStorageKey(key);
    const raw = localStorage.getItem(storageKey);
    if (raw === null) return null;

    const decoded = deobfuscate(raw) || null;
    if (!decoded) {
      localStorage.removeItem(storageKey);
      return null;
    }

    await invoke<void>('secure_storage_save', { key, value: decoded });
    const verified = await invoke<string | null>('secure_storage_load', { key });
    if (verified !== decoded) {
      throw new Error('Native keychain did not retain the migrated secret.');
    }

    localStorage.removeItem(storageKey);
    return decoded;
  }

  async save(key: string, value: string): Promise<void> {
    if (!value) {
      await this.remove(key);
      return;
    }
    await invoke<void>('secure_storage_save', { key, value });
    localStorage.removeItem(this.localStorageKey(key));
  }

  async load(key: string): Promise<string | null> {
    const value = await invoke<string | null>('secure_storage_load', { key });
    if (value !== null && value !== undefined) return value;
    return this.migrateLocalStorageValue(key);
  }

  async remove(key: string): Promise<void> {
    await invoke<void>('secure_storage_delete', { key });
    localStorage.removeItem(this.localStorageKey(key));
  }
}

/** Detect the Tauri runtime surfaces supported by this application. */
export function isTauriRuntime(): boolean {
  if (typeof window === 'undefined' && typeof globalThis === 'undefined') {
    return false;
  }
  const w = (typeof window !== 'undefined' ? window : (globalThis as unknown)) as {
    __TAURI__?: unknown;
    __TAURI_INTERNALS__?: unknown;
  };
  const g = (typeof globalThis !== 'undefined' ? globalThis : ({} as unknown)) as {
    __TAURI__?: unknown;
    __TAURI_INTERNALS__?: unknown;
  };
  return Boolean(w.__TAURI__ || w.__TAURI_INTERNALS__ || g.__TAURI__ || g.__TAURI_INTERNALS__);
}

/**
 * Test overrides let jsdom exercise the native bridge. Browser builds
 * otherwise keep the existing localStorage provider.
 */
export function resolveSecureStorage(): SecureStorageProvider {
  const w = (typeof window !== 'undefined' ? window : ({} as unknown)) as Record<string, unknown>;
  const g = (typeof globalThis !== 'undefined' ? globalThis : ({} as unknown)) as Record<string, unknown>;
  if (w.__secureStorageForceKeychain === true || g.__secureStorageForceKeychain === true) {
    return new KeychainProvider();
  }
  if (w.__secureStorageForceLocalStorage === true || g.__secureStorageForceLocalStorage === true) {
    return new LocalStorageProvider();
  }
  if (!isTauriRuntime()) return new LocalStorageProvider();
  return new KeychainProvider();
}

let cached: SecureStorageProvider | null = null;

export function getSecureStorage(): SecureStorageProvider {
  if (!cached) cached = resolveSecureStorage();
  return cached;
}

/** Test-only: clear the singleton so the provider is resolved again. */
export function __resetSecureStorageCache(): void {
  cached = null;
}
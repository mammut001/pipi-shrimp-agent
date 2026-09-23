/**
 * secureStorage — Pluggable secret storage abstraction.
 *
 * AUDIT-FIX [R7-15]: Telegram bot tokens (and other long-lived API
 * secrets) used to be stored exclusively in localStorage with XOR
 * obfuscation. That's better than plaintext but still recoverable
 * with browser devtools or a same-origin XSS. The full fix is to
 * move secrets to the OS keychain via tauri-plugin-secure-store.
 *
 * Because that plugin isn't yet a project dependency, this module
 * implements the migration spike:
 *
 *   1. A `SecureStorageProvider` interface with save/load/delete.
 *   2. A `LocalStorageProvider` that wraps the existing XOR
 *      obfuscation (no regression for current users).
 *   3. A `KeychainProvider` that wraps the Tauri secure-store
 *      plugin. The plugin module is loaded dynamically so the
 *      bundle doesn't break when the plugin isn't installed.
 *   4. A `getSecureStorage()` factory that returns KeychainProvider
 *      when the runtime is Tauri (or a test force-flag), otherwise
 *      LocalStorageProvider. The factory does not probe whether the
 *      plugin module is installed — KeychainProvider surfaces missing
 *      plugin as save-throw / load-null (no silent XOR fallback).
 *
 * When a working keychain backend is actually available, secrets
 * never touch localStorage. Until then, prefer the localStorage
 * provider (default outside Tauri) and treat keychain selection
 * without a plugin as a hard failure for writes.
 *
 * The factory is a function (not a module-level constant) so tests
 * can override the detection.
 */

import { obfuscate, deobfuscate } from '@/utils/secureSecrets';

export interface SecureStorageProvider {
  /** Provider name for diagnostics: 'keychain' | 'localStorage'. */
  readonly name: 'keychain' | 'localStorage';
  save(key: string, value: string): Promise<void>;
  load(key: string): Promise<string | null>;
  remove(key: string): Promise<void>;
}

const LOCAL_STORAGE_PREFIX = 'pipi_secret_v2_';

/**
 * localStorage-backed provider. Uses the existing XOR obfuscation
 * so users on the current build see no change in behaviour.
 */
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
    const storageKey = LOCAL_STORAGE_PREFIX + key;
    const raw = localStorage.getItem(storageKey);
    if (raw === null) return null;
    const decoded = deobfuscate(raw);
    return decoded || null;
  }

  async remove(key: string): Promise<void> {
    const storageKey = LOCAL_STORAGE_PREFIX + key;
    localStorage.removeItem(storageKey);
  }
}

/**
 * OS-keychain-backed provider via tauri-plugin-secure-store.
 *
 * The plugin isn't a dependency of this repo yet, so we use a
 * dynamic import that resolves to `null` if the module isn't
 * installed. There is NO silent localStorage fallback inside this
 * provider: `save` throws when the plugin is missing; `load`
 * returns `null`. Callers (especially migrateLegacySecret) must
 * treat that as failure and keep any prior secret until a verified
 * write succeeds.
 */
class KeychainProvider implements SecureStorageProvider {
  readonly name = 'keychain';
  // Module reference resolved lazily. We avoid `any` in the public
  // type by typing it as the minimum surface we use.
  private plugin: null | {
    set: (key: string, value: string) => Promise<void>;
    get: (key: string) => Promise<string | null>;
    delete: (key: string) => Promise<boolean>;
  } = null;
  private loadAttempted = false;

  private async ensurePlugin(): Promise<void> {
    if (this.loadAttempted) return;
    this.loadAttempted = true;
    try {
      // The plugin is provided as `@tauri-apps/plugin-secure-store`
      // by tauri-plugin-secure-store. Until the project adds the
      // dep, this dynamic import will fail and `this.plugin` stays
      // null — save() then throws; there is no silent fallback to
      // localStorage here. The `@vite-ignore` directive tells
      // Rollup not to bundle the dep (it may not be installed); the
      // module path is split into a const so the tsc + Rollup
      // analyzers don't try to resolve it.
      const moduleName = '@tauri-apps/plugin-secure-store';
      const mod = (await import(/* @vite-ignore */ moduleName)) as unknown as typeof this.plugin;
      this.plugin = mod;
    } catch {
      this.plugin = null;
    }
  }

  async save(key: string, value: string): Promise<void> {
    await this.ensurePlugin();
    if (!this.plugin) {
      throw new Error(
        'Tauri secure-store plugin is not installed; cannot use keychain backend.',
      );
    }
    if (!value) {
      await this.remove(key);
      return;
    }
    await this.plugin.set(key, value);
  }

  async load(key: string): Promise<string | null> {
    await this.ensurePlugin();
    if (!this.plugin) return null;
    return await this.plugin.get(key);
  }

  async remove(key: string): Promise<void> {
    await this.ensurePlugin();
    if (!this.plugin) return;
    await this.plugin.delete(key);
  }
}

/**
 * Heuristic: are we running inside a Tauri webview?
 * `window.__TAURI__` is set by the Tauri runtime; `__TAURI_INTERNALS__`
 * is the v2 surface. We check both `window` and `globalThis` so the
 * helper works under jsdom (where the runtime globals may be set on
 * `globalThis` rather than `window`).
 */
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
 * Resolve the active provider. Override hooks:
 *   - `__secureStorageForceKeychain` (boolean) — used by tests
 *     and by an opt-in settings flag.
 *   - `__secureStorageForceLocalStorage` (boolean) — for tests
 *     that want to exercise the localStorage path.
 *
 * Resolution order:
 *   1. Test overrides
 *   2. If running outside Tauri, return LocalStorageProvider
 *   3. Otherwise return KeychainProvider by name. IMPORTANT: this
 *      does NOT mean writes silently land in localStorage when the
 *      plugin is missing — KeychainProvider.save throws and
 *      .load returns null. Prefer LocalStorageProvider (or a force
 *      override) until a real plugin is wired; migrateLegacySecret
 *      keeps the legacy key until a verified write succeeds.
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

/**
 * Singleton accessor. Tests can clear the cache via
 * `__resetSecureStorageCache()` (a testing hook exposed below)
 * after changing the override flags.
 */
export function getSecureStorage(): SecureStorageProvider {
  if (!cached) cached = resolveSecureStorage();
  return cached;
}

/** Test-only: clear the singleton so the factory re-evaluates. */
export function __resetSecureStorageCache(): void {
  cached = null;
}
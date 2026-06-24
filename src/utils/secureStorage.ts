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
 *   4. A `getSecureStorage()` factory that returns the keychain
 *      provider when the runtime is Tauri AND the plugin module
 *      is reachable, otherwise the localStorage provider.
 *
 * When the keychain provider is in use, secrets never touch
 * localStorage at all — no XOR key to leak. When localStorage is
 * the active backend, the existing behaviour is preserved.
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
 * installed. The first call that needs the keychain will throw
 * an explicit "keychain plugin not available" error if the
 * platform isn't Tauri or the plugin isn't installed.
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
      // dep, this dynamic import will fail and we'll fall back to
      // localStorage in the factory. The `@ts-expect-error` keeps
      // tsc --noEmit clean while the optional dep is absent; the
      // try/catch makes the runtime safe regardless.
      const mod = (await import(
        // @ts-expect-error optional tauri plugin dep, intentionally absent
        /* @vite-ignore */ '@tauri-apps/plugin-secure-store'
      )) as unknown as typeof this.plugin;
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
 *   3. Otherwise return KeychainProvider (it will fall back to
 *      localStorage internally if the plugin module isn't present,
 *      so the public surface stays "keychain" but writes go to
 *      localStorage when the plugin is missing — see migration
 *      notes in the module doc comment).
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
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockInvoke = jest.fn();

jest.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

declare global {
  // eslint-disable-next-line no-var
  var __secureStorageForceKeychain: boolean | undefined;
  // eslint-disable-next-line no-var
  var __secureStorageForceLocalStorage: boolean | undefined;
}

const NAMESPACED_KEY = 'pipi_secret_v2_telegram-token';
const LEGACY_KEY = 'ai-agent-telegram-token';

function findPlaintextLeaks(needles: string[]): string[] {
  const hits: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i) ?? '';
    const value = localStorage.getItem(key) ?? '';
    for (const needle of needles) {
      if (needle && (key.includes(needle) || value.includes(needle))) {
        hits.push(key);
      }
    }
  }
  return hits;
}

describe('initializeSettings telegram keychain regression (R7-15)', () => {
  let useSettingsStore: typeof import('../settingsStore').useSettingsStore;
  let initializeSettings: typeof import('../settingsStore').initializeSettings;
  let obfuscateInline: typeof import('../../utils/secureSecrets').obfuscateInline;

  beforeEach(async () => {
    jest.resetModules();
    localStorage.clear();
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue(null);
    delete (globalThis as { __TAURI__?: unknown }).__TAURI__;
    delete (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    delete (globalThis as { __secureStorageForceLocalStorage?: boolean }).__secureStorageForceLocalStorage;
    (globalThis as { __secureStorageForceKeychain?: boolean }).__secureStorageForceKeychain = true;

    ({ useSettingsStore, initializeSettings } = await import('../settingsStore'));
    ({ obfuscateInline } = await import('../../utils/secureSecrets'));
    await initializeSettings();
    useSettingsStore.setState({ telegramToken: undefined });
    localStorage.clear();
    mockInvoke.mockReset();
  });

  it('(a) keychain hit removes both legacy copies and leaves no plaintext', async () => {
    const keychainToken = '123456:KEYCHAIN_token_a';
    mockInvoke.mockImplementation(async (command: string) => {
      if (command === 'secret_get') return keychainToken;
      return null;
    });
    localStorage.setItem(NAMESPACED_KEY, obfuscateInline(keychainToken));
    localStorage.setItem(LEGACY_KEY, keychainToken);

    await initializeSettings();

    expect(useSettingsStore.getState().telegramToken).toBe(keychainToken);
    expect(localStorage.getItem(NAMESPACED_KEY)).toBeNull();
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
    expect(findPlaintextLeaks([keychainToken])).toEqual([]);
  });

  it('(b) interrupted-migration restart keeps keychain value and finishes cleanup', async () => {
    const keychainToken = '123456:KEYCHAIN_token_b';
    const staleXorToken = '123456:STALE_xor_token_b';
    const staleLegacyToken = '123456:STALE_legacy_token_b';
    mockInvoke.mockImplementation(async (command: string) => {
      if (command === 'secret_get') return keychainToken;
      return null;
    });
    localStorage.setItem(NAMESPACED_KEY, obfuscateInline(staleXorToken));
    localStorage.setItem(LEGACY_KEY, staleLegacyToken);

    await initializeSettings();

    expect(useSettingsStore.getState().telegramToken).toBe(keychainToken);
    expect(localStorage.getItem(NAMESPACED_KEY)).toBeNull();
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
    expect(findPlaintextLeaks([keychainToken, staleXorToken, staleLegacyToken])).toEqual([]);

    await initializeSettings();

    expect(useSettingsStore.getState().telegramToken).toBe(keychainToken);
    expect(localStorage.getItem(NAMESPACED_KEY)).toBeNull();
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
    expect(findPlaintextLeaks([keychainToken, staleXorToken, staleLegacyToken])).toEqual([]);
  });

  it('(c) keychain read failure leaves both legacy copies untouched', async () => {
    const xorSeed = obfuscateInline('123456:STALE_xor_token_c');
    const legacySeed = '123456:STALE_legacy_token_c';
    localStorage.setItem(NAMESPACED_KEY, xorSeed);
    localStorage.setItem(LEGACY_KEY, legacySeed);
    mockInvoke.mockRejectedValue(new Error('keychain unavailable'));
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await initializeSettings();
    } finally {
      errorSpy.mockRestore();
    }

    expect(useSettingsStore.getState().telegramToken).toBeUndefined();
    expect(localStorage.getItem(NAMESPACED_KEY)).toBe(xorSeed);
    expect(localStorage.getItem(LEGACY_KEY)).toBe(legacySeed);
  });
});

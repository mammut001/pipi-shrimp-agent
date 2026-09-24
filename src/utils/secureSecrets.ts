/**
 * secureSecrets — Unified secret storage abstraction.
 *
 * Discrete secrets use the selected SecureStorageProvider: native OS
 * keychain in Tauri desktop builds and the legacy XOR-backed provider
 * in browser builds. Inline settings that mix secrets with other data
 * still use the existing XOR format and are not OS-keychain protected.
 */

const INSTALLATION_KEY_STORAGE = '__pipi_shrimp_sk__';

/**
 * Get or create the per-installation XOR key.
 * Returns a Uint8Array of 32 random bytes.
 */
function getInstallationKey(): Uint8Array {
  const stored = localStorage.getItem(INSTALLATION_KEY_STORAGE);
  if (stored) {
    try {
      const bytes = new Uint8Array(stored.length / 2);
      for (let i = 0; i < stored.length; i += 2) {
        bytes[i / 2] = parseInt(stored.substring(i, i + 2), 16);
      }
      if (bytes.length === 32) return bytes;
    } catch {
      // Corrupted key, regenerate
    }
  }

  // Generate new random key using Web Crypto API
  const key = new Uint8Array(32);
  crypto.getRandomValues(key);

  // Store as hex string
  const hex = Array.from(key).map(b => b.toString(16).padStart(2, '0')).join('');
  localStorage.setItem(INSTALLATION_KEY_STORAGE, hex);

  return key;
}

/**
 * XOR data bytes with the installation key (cycling).
 */
function xorWithKey(data: Uint8Array, key: Uint8Array): Uint8Array {
  const result = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    result[i] = data[i] ^ key[i % key.length];
  }
  return result;
}

/**
 * Convert Uint8Array to base64 string.
 */
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Convert base64 string to Uint8Array.
 */
function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Obfuscate a value using XOR cipher + base64.
 * Returns a string with a version prefix marker.
 */
function obfuscate(value: string): string {
  if (!value) return '';
  const key = getInstallationKey();
  const encoder = new TextEncoder();
  const data = encoder.encode(value);
  const xored = xorWithKey(data, key);
  return toBase64(xored);
}

/**
 * Deobfuscate a value.
 * Handles v2 (XOR+base64), v1 (plain btoa), and legacy plaintext.
 */
function deobfuscate(value: string): string {
  if (!value) return '';

  // Try XOR+base64 decode first (v2 format)
  try {
    const xored = fromBase64(value);
    const key = getInstallationKey();
    const decrypted = xorWithKey(xored, key);
    return new TextDecoder().decode(decrypted);
  } catch {
    // Not valid base64 or corrupted
  }

  // Fallback: try legacy btoa decode (v1 format)
  try {
    return decodeURIComponent(escape(atob(value)));
  } catch {
    // Not valid base64, might be plaintext from before any obfuscation
    return value;
  }
}

/**
 * Save a secret value. The active provider is selected by
 * `getSecureStorage()`. In the default (localStorage) provider the
 * value is XOR-obfuscated and persisted under `pipi_secret_v2_<key>`
 * in localStorage. When the keychain provider is active (Tauri
 * runtime + tauri-plugin-secure-store installed), the value is
 * stored in the OS keychain and never touches localStorage.
 *
 * AUDIT-FIX [R7-15]: This shim keeps the existing function signature
 * so all callers (settingsStore, telegramStore) keep working without
 * changes, but the underlying storage is now pluggable.
 *
 * @param key - Unique identifier for the secret (e.g. 'telegram-token', 'api-key-config-123')
 * @param value - The plaintext secret to store
 */
export async function saveSecret(key: string, value: string): Promise<void> {
  const { getSecureStorage } = await import('@/utils/secureStorage');
  await getSecureStorage().save(key, value);
}

/**
 * Load a secret value.
 *
 * @param key - Unique identifier for the secret
 * @returns The plaintext secret, or null if not found
 */
export async function loadSecret(key: string): Promise<string | null> {
  const { getSecureStorage } = await import('@/utils/secureStorage');
  return getSecureStorage().load(key);
}

/**
 * Delete a secret.
 *
 * @param key - Unique identifier for the secret
 */
export async function deleteSecret(key: string): Promise<void> {
  const { getSecureStorage } = await import('@/utils/secureStorage');
  await getSecureStorage().remove(key);
}

/**
 * Migrate a legacy obfuscated value from an old storage key to the new
 * secureSecrets namespace. Returns the decoded value.
 *
 * Fail-safe: the legacy localStorage key is removed only after the
 * active SecureStorageProvider save+load round-trip verifies the new
 * value. If the native keychain is unavailable, the
 * legacy key is left intact and the decoded value is still returned
 * when available so the caller can hydrate this session.
 *
 * @param legacyKey - The old localStorage key (e.g. 'ai-agent-telegram-token')
 * @param newKey - The new secureSecrets key (e.g. 'telegram-token')
 * @returns The decoded value, or null if no legacy value exists
 */
export async function migrateLegacySecret(legacyKey: string, newKey: string): Promise<string | null> {
  // Hold decoded outside try so a mid-migrate throw can still hydrate
  // the caller while leaving the legacy key untouched for retry.
  let decoded: string | null = null;
  try {
    const raw = localStorage.getItem(legacyKey);
    if (raw === null) return null;

    // Decode the legacy value (may be v1 btoa or plaintext)
    decoded = deobfuscate(raw) || null;
    if (!decoded) {
      // Empty / undecodable legacy entry — safe to drop.
      localStorage.removeItem(legacyKey);
      return null;
    }

    // Fail-safe (AUDIT-FIX [R7-15]): only delete the legacy key AFTER the
    // active provider confirms it retained the value. Calling storage
    // directly preserves any keychain failure while the old token remains.
    const { getSecureStorage } = await import('@/utils/secureStorage');
    const storage = getSecureStorage();
    await storage.save(newKey, decoded);
    const verified = await storage.load(newKey);
    if (verified !== decoded) {
      console.error(
        `Failed to migrate legacy secret "${legacyKey}": new store did not retain value; leaving legacy key in place.`,
      );
      // Keep legacy so the token remains readable on next boot / retry.
      return decoded;
    }

    localStorage.removeItem(legacyKey);
    return decoded;
  } catch (error) {
    // Do NOT remove legacyKey when the native store fails. Return decoded
    // when available so this session can hydrate;
    // next boot will re-attempt migrate against the intact legacy key.
    console.error(`Failed to migrate legacy secret "${legacyKey}":`, error);
    return decoded;
  }
}

/**
 * Obfuscate a value for inline use (e.g. persisting configs that mix
 * secrets and non-secrets in the same JSON blob).
 *
 * Uses XOR cipher with per-installation key — significantly stronger
 * than the previous btoa() approach.
 */
export function obfuscateInline(value: string): string {
  return obfuscate(value);
}

/**
 * Deobfuscate an inline value.
 * Handles v2 (XOR), v1 (btoa), and legacy plaintext transparently.
 */
export function deobfuscateInline(value: string): string {
  return deobfuscate(value);
}

// Re-export the underlying XOR primitives so the pluggable
// secureStorage provider (R7-15) can call them without re-implementing
// the cipher.
export { obfuscate, deobfuscate };

/**
 * secureSecrets — Unified secret storage abstraction.
 *
 * Provides a single API for saving/loading/deleting sensitive values
 * (API keys, tokens, passwords) in localStorage with XOR obfuscation.
 *
 * ⚠️ SECURITY WARNING ⚠️
 * localStorage + XOR obfuscation is NOT real encryption.
 * A determined attacker with devtools access can reverse this.
 *
 * Current protection:
 *   - XOR cipher with a per-installation random 32-byte key
 *   - The key is stored in localStorage (same origin), so this is
 *     defense-in-depth against casual XSS exfiltration and accidental
 *     log/console exposure
 *   - Significantly stronger than plain btoa() — cannot be decoded
 *     by simply calling atob() on the stored value
 *
 * Future upgrade path:
 *   - @tauri-apps/plugin-secure-store (OS keychain backed)
 *   - tauri-plugin-stronghold integration
 *   - When available, migrate saveSecret/loadSecret to use native
 *     secure storage with localStorage as fallback only.
 */

const SECRET_PREFIX = 'pipi_secret_v2_';
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
 * Save a secret value to localStorage.
 *
 * @param key - Unique identifier for the secret (e.g. 'telegram-token', 'api-key-config-123')
 * @param value - The plaintext secret to store
 */
export function saveSecret(key: string, value: string): void {
  try {
    const storageKey = SECRET_PREFIX + key;
    if (!value) {
      localStorage.removeItem(storageKey);
      return;
    }
    localStorage.setItem(storageKey, obfuscate(value));
  } catch (error) {
    console.error(`Failed to save secret "${key}":`, error);
  }
}

/**
 * Load a secret value from localStorage.
 *
 * @param key - Unique identifier for the secret
 * @returns The plaintext secret, or null if not found
 */
export function loadSecret(key: string): string | null {
  try {
    const storageKey = SECRET_PREFIX + key;
    const raw = localStorage.getItem(storageKey);
    if (raw === null) return null;
    const decoded = deobfuscate(raw);
    return decoded || null;
  } catch (error) {
    console.error(`Failed to load secret "${key}":`, error);
    return null;
  }
}

/**
 * Delete a secret from localStorage.
 *
 * @param key - Unique identifier for the secret
 */
export function deleteSecret(key: string): void {
  try {
    const storageKey = SECRET_PREFIX + key;
    localStorage.removeItem(storageKey);
  } catch (error) {
    console.error(`Failed to delete secret "${key}":`, error);
  }
}

/**
 * Migrate a legacy obfuscated value from an old storage key to the new
 * secureSecrets namespace. Returns the decoded value.
 *
 * @param legacyKey - The old localStorage key (e.g. 'ai-agent-telegram-token')
 * @param newKey - The new secureSecrets key (e.g. 'telegram-token')
 * @returns The migrated value, or null if no legacy value exists
 */
export function migrateLegacySecret(legacyKey: string, newKey: string): string | null {
  try {
    const raw = localStorage.getItem(legacyKey);
    if (raw === null) return null;

    // Decode the legacy value (may be v1 btoa or plaintext)
    const decoded = deobfuscate(raw);

    // Save under new key with v2 XOR encoding
    if (decoded) {
      saveSecret(newKey, decoded);
    }

    // Remove legacy key
    localStorage.removeItem(legacyKey);

    return decoded || null;
  } catch (error) {
    console.error(`Failed to migrate legacy secret "${legacyKey}":`, error);
    return null;
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

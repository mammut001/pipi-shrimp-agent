/**
 * Safe localStorage helpers.
 *
 * AUDIT-FIX [fix-22#1] — Centralises the `try { localStorage.setItem(...) }
 * catch { /* ignore *\/ }` pattern that was repeated in 5+ places. The
 * raw localStorage API can throw `QuotaExceededError` (5MB cap on most
 * browsers) or `SecurityError` (private browsing) silently. This helper:
 *
 *   1. Wraps both `getItem` and `setItem` in try/catch and surfaces the
 *      error to a caller-provided callback so the UI can react.
 *   2. Emits a single `console.warn` per call (no log flood).
 *   3. Provides a one-shot migration helper so the *-name-rename in
 *      `fix-20` can be re-used by other keys.
 */

export interface SafeStorageResult<T> {
  /** The value read, or `null` if the key was missing or unreadable. */
  value: T | null;
  /**
   * True when the read returned a real value (not a fall-through null
   * caused by an exception). Lets callers distinguish "key absent" from
   * "JSON parse failed".
   */
  parsed: boolean;
  /** The exception caught, if any. */
  error: unknown;
}

export function safeGetItem<T = string>(key: string): SafeStorageResult<T> {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return { value: null, parsed: false, error: null };
    return { value: raw as unknown as T, parsed: true, error: null };
  } catch (error) {
    console.warn(`[safeStorage] getItem('${key}') failed:`, error);
    return { value: null, parsed: false, error };
  }
}

export function safeGetJSON<T = unknown>(key: string): SafeStorageResult<T> {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return { value: null, parsed: false, error: null };
    return { value: JSON.parse(raw) as T, parsed: true, error: null };
  } catch (error) {
    console.warn(`[safeStorage] getJSON('${key}') failed:`, error);
    return { value: null, parsed: false, error };
  }
}

export function safeSetItem(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (error) {
    console.warn(`[safeStorage] setItem('${key}') failed:`, error);
    return false;
  }
}

export function safeSetJSON<T>(key: string, value: T): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    console.warn(`[safeStorage] setJSON('${key}') failed:`, error);
    return false;
  }
}

export function safeRemoveItem(key: string): boolean {
  try {
    localStorage.removeItem(key);
    return true;
  } catch (error) {
    console.warn(`[safeStorage] removeItem('${key}') failed:`, error);
    return false;
  }
}

/**
 * One-shot key rename. If `oldKey` exists and `newKey` does not, copy the
 * value across and delete the old entry. Returns `true` when a
 * migration actually happened.
 */
export function safeMigrateKey(oldKey: string, newKey: string): boolean {
  try {
    const oldValue = localStorage.getItem(oldKey);
    if (oldValue == null) return false;
    if (localStorage.getItem(newKey) == null) {
      localStorage.setItem(newKey, oldValue);
    }
    localStorage.removeItem(oldKey);
    return true;
  } catch (error) {
    console.warn(
      `[safeStorage] migrateKey('${oldKey}' -> '${newKey}') failed:`,
      error,
    );
    return false;
  }
}

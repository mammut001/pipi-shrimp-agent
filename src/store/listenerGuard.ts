/**
 * Event Listener Guard Module
 *
 * Provides ref-count based event listener management to ensure only ONE set of
 * Tauri event listeners is active at a time, even when multiple components
 * (ChatBrowserWorkspaceShell, BrowserPanel, BrowserMiniPreview) call setup.
 *
 * This is intentionally NOT inside a Zustand store because:
 * 1. The cleanup function needs to be callable outside of React's render cycle
 * 2. The ref-count pattern is a cross-ccomponent coordination concern, not UI state
 *
 * For testing/SSR scenarios, import this module directly and call clear() to reset.
 */

export interface ListenerRegistration {
  cleanup: () => void;
  refCount: number;
}

// Global state for listener coordination
let _listenerRefCount = 0;
let _listenerCleanup: (() => void) | null = null;
let _listenerSetupPromise: Promise<() => void> | null = null;

/**
 * Get current ref count (for debugging/testing)
 */
export function getListenerRefCount(): number {
  return _listenerRefCount;
}

/**
 * Check if listeners are currently registered
 */
export function hasListeners(): boolean {
  return _listenerCleanup !== null;
}

/**
 * Clear all listeners and reset state (for testing)
 */
export function clearListeners(): void {
  if (_listenerCleanup) {
    _listenerCleanup();
  }
  _listenerRefCount = 0;
  _listenerCleanup = null;
  _listenerSetupPromise = null;
}

/**
 * Register event listeners with ref-count guard.
 * Multiple callers can safely call this; only the first registers listeners,
 * subsequent callers share the same registration until the last one cleans up.
 *
 * @param setupFn Async function that sets up listeners and returns a cleanup function
 * @returns A cleanup function that decrements the ref count
 */
export async function registerWithRefCount(
  setupFn: () => Promise<() => void>
): Promise<() => void> {
  _listenerRefCount += 1;

  // Listeners already registered — share registration; last ref tears down
  if (_listenerCleanup) {
    return () => {
      _listenerRefCount = Math.max(0, _listenerRefCount - 1);
      if (_listenerRefCount === 0 && _listenerCleanup) {
        _listenerCleanup();
        _listenerCleanup = null;
        _listenerSetupPromise = null;
      }
    };
  }

  // If registration is already in-flight, await the same promise
  if (_listenerSetupPromise) {
    await _listenerSetupPromise;
    return () => {
      _listenerRefCount = Math.max(0, _listenerRefCount - 1);
      if (_listenerRefCount === 0 && _listenerCleanup) {
        _listenerCleanup();
      }
    };
  }

  // Create the setup promise so concurrent callers can await it
  _listenerSetupPromise = (async () => {
    _listenerCleanup = await setupFn();
    return _listenerCleanup!;
  })();

  try {
    await _listenerSetupPromise;
  } catch (err) {
    _listenerSetupPromise = null;
    _listenerRefCount = Math.max(0, _listenerRefCount - 1);
    throw err;
  }

  // Return cleanup function — only the last ref actually tears down listeners
  return () => {
    _listenerRefCount = Math.max(0, _listenerRefCount - 1);
    if (_listenerRefCount === 0 && _listenerCleanup) {
      _listenerCleanup();
      _listenerCleanup = null;
      _listenerSetupPromise = null;
    }
  };
}

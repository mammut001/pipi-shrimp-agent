/**
 * usePolling — Shared polling hook with visibility-based pausing.
 *
 * Automatically pauses polling when the browser tab/window is hidden
 * (Page Visibility API) and resumes when it becomes visible again.
 * This reduces CPU usage in long-running desktop apps where the user
 * may switch to another window.
 *
 * @param callback  - Async function to call on each tick
 * @param intervalMs - Polling interval in milliseconds
 * @param enabled   - Whether polling is active (default: true)
 */

import { useEffect, useRef } from 'react';

export function usePolling(
  callback: () => void | Promise<void>,
  intervalMs: number,
  enabled: boolean = true,
): void {
  const savedCallback = useRef(callback);
  const intervalId = useRef<ReturnType<typeof setInterval> | null>(null);

  // Keep callback ref up to date without restarting the interval
  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled) {
      // Clear any existing interval when disabled
      if (intervalId.current !== null) {
        clearInterval(intervalId.current);
        intervalId.current = null;
      }
      return;
    }

    const tick = () => {
      void savedCallback.current();
    };

    // Run immediately on mount / enable
    tick();

    // Start interval
    intervalId.current = setInterval(tick, intervalMs);

    // Pause when tab is hidden, resume when visible
    const handleVisibility = () => {
      if (document.hidden) {
        if (intervalId.current !== null) {
          clearInterval(intervalId.current);
          intervalId.current = null;
        }
      } else {
        // Immediately tick on resume to catch up
        tick();
        if (intervalId.current === null) {
          intervalId.current = setInterval(tick, intervalMs);
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      if (intervalId.current !== null) {
        clearInterval(intervalId.current);
        intervalId.current = null;
      }
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [intervalMs, enabled]);
}

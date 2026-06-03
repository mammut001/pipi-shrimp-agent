/**
 * useClipboard - React hook for clipboard operations
 *
 * Provides a simple interface for copying text to clipboard with feedback state.
 */

import { useState, useCallback, useEffect, useRef } from 'react';

/**
 * Hook for clipboard operations.
 *
 * AUDIT-2026-06-02 (lifecycle): every successful copy schedules a setTimeout to reset
 * `copied=false`. Previously the timer id was discarded; if the consuming component
 * unmounted before the timeout (rapid click then route change, virtualised message rows
 * scrolling out), the timer would fire setCopied on an unmounted component and the
 * underlying closure would leak. Now we keep the latest timer id in a ref, clear it on
 * unmount and before scheduling a new one, and skip state updates after unmount.
 */
export function useClipboard(timeout: number = 2000) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  const scheduleReset = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (mountedRef.current) {
        setCopied(false);
      }
    }, timeout);
  }, [timeout]);

  const safeSetCopied = useCallback((value: boolean) => {
    if (mountedRef.current) {
      setCopied(value);
    }
  }, []);

  const safeSetError = useCallback((value: Error | null) => {
    if (mountedRef.current) {
      setError(value);
    }
  }, []);

  const copy = useCallback(async (text: string): Promise<boolean> => {
    safeSetError(null);

    // Try modern clipboard API first
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        safeSetCopied(true);
        scheduleReset();
        return true;
      } catch (err) {
        // Fall through to fallback
        console.warn('Clipboard API failed, using fallback:', err);
      }
    }

    // Fallback for older browsers or secure contexts
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      textarea.setAttribute('readonly', '');
      document.body.appendChild(textarea);
      textarea.select();
      textarea.setSelectionRange(0, 99999); // For mobile devices

      const success = document.execCommand('copy');
      document.body.removeChild(textarea);

      if (success) {
        safeSetCopied(true);
        scheduleReset();
        return true;
      } else {
        throw new Error('execCommand copy failed');
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      safeSetError(error);
      console.error('Failed to copy to clipboard:', error);
      return false;
    }
  }, [scheduleReset, safeSetCopied, safeSetError]);

  return { copy, copied, error };
}

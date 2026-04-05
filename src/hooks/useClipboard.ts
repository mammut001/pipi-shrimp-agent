/**
 * useClipboard - React hook for clipboard operations
 *
 * Provides a simple interface for copying text to clipboard with feedback state.
 */

import { useState, useCallback } from 'react';

/**
 * Hook for clipboard operations
 */
export function useClipboard(timeout: number = 2000) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const copy = useCallback(async (text: string): Promise<boolean> => {
    setError(null);

    // Try modern clipboard API first
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), timeout);
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
        setCopied(true);
        setTimeout(() => setCopied(false), timeout);
        return true;
      } else {
        throw new Error('execCommand copy failed');
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      console.error('Failed to copy to clipboard:', error);
      return false;
    }
  }, [timeout]);

  return { copy, copied, error };
}

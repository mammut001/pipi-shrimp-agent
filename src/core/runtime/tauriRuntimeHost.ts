import { invoke } from '@tauri-apps/api/core';
import type { RuntimeHost } from './RuntimeHost';

/**
 * Default production RuntimeHost: asks the Tauri backend to stop the session
 * subprocess when SessionRuntime.cancel() runs.
 */
export function createTauriRuntimeHost(): RuntimeHost {
  return {
    cancelSubprocess(sessionId: string): void {
      try {
        void invoke('stop_subprocess', { sessionId }).catch(() => {});
      } catch {
        // Safe fallback if invoke is not bound (e.g. non-Tauri contexts)
      }
    },
  };
}

/** Shared default instance used by the session registry when no host is injected. */
export const defaultTauriRuntimeHost: RuntimeHost = createTauriRuntimeHost();

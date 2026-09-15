import { invoke } from '@tauri-apps/api/core';
import type { RuntimeHost } from './RuntimeHost';
import { installRuntimeTraceDevDump, sharedRuntimeTraceSink } from './RuntimeTraceSink';

/**
 * Default production RuntimeHost: asks the Tauri backend to stop the session
 * subprocess when SessionRuntime.cancel() runs, and records structured
 * lifecycle/identity events into the shared ring-buffer sink.
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
    trace: sharedRuntimeTraceSink.record,
  };
}

/** Shared default instance used by the session registry when no host is injected. */
export const defaultTauriRuntimeHost: RuntimeHost = createTauriRuntimeHost();

/** DevTools: `globalThis.__PIPI_RUNTIME_TRACE__.dumpJsonLines()` */
installRuntimeTraceDevDump();

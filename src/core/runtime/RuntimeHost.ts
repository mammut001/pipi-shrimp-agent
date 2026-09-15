import type { RuntimeTraceEvent } from './RuntimeTrace';

/**
 * Host-side adapter for SessionRuntime cancellation side effects.
 *
 * Keeps SessionRuntime free of Tauri / IPC imports so the same class can run
 * under the desktop app, headless harnesses, and unit tests.
 */
export interface RuntimeHost {
  cancelSubprocess(sessionId: string): void | Promise<void>;
  /**
   * Optional lifecycle / identity trace sink. Omit or leave undefined for a
   * no-op (production default). Tests inject a capturing sink.
   */
  trace?(event: RuntimeTraceEvent): void;
}

/** No-op host for tests and non-Tauri environments. */
export const noopRuntimeHost: RuntimeHost = {
  cancelSubprocess(_sessionId: string): void {
    // intentionally empty
  },
};

/**
 * CDP runtime snapshot — unified browser UI state for external Chrome sessions.
 *
 * Published by CDP task execution and connection sync so BrowserMiniPreview and
 * BrowserSurfaceHost do not rely on legacy embedded `isWindowOpen`.
 */

export type CdpTaskStatus = 'idle' | 'running' | 'completed' | 'failed';

export interface CdpRuntimeSnapshot {
  currentUrl: string | null;
  healthStatus: string | null;
  launchMode: string | null;
  taskStatus: CdpTaskStatus;
  activeTaskLabel: string | null;
  lastError: string | null;
  lastResult: string | null;
  lastUpdatedAt: number | null;
  lastFailedAction: string | null;
}

export const INITIAL_CDP_RUNTIME: CdpRuntimeSnapshot = {
  currentUrl: null,
  healthStatus: null,
  launchMode: null,
  taskStatus: 'idle',
  activeTaskLabel: null,
  lastError: null,
  lastResult: null,
  lastUpdatedAt: null,
  lastFailedAction: null,
};

const DEFAULT_RUNTIME_TTL_MS = 30 * 60 * 1000;

/** True when CDP runtime has recent task/url context even if cdpStore.status is stale. */
export function isCdpRuntimeActive(
  runtime: CdpRuntimeSnapshot,
  maxAgeMs: number = DEFAULT_RUNTIME_TTL_MS,
): boolean {
  if (runtime.taskStatus === 'running') {
    return true;
  }

  if (runtime.currentUrl?.trim()) {
    return true;
  }

  const hasOutcome = Boolean(runtime.lastResult?.trim() || runtime.lastError?.trim());
  if (!hasOutcome) {
    return runtime.taskStatus === 'completed' || runtime.taskStatus === 'failed';
  }

  if (!runtime.lastUpdatedAt) {
    return true;
  }

  return Date.now() - runtime.lastUpdatedAt <= maxAgeMs;
}

export function mergeCdpRuntimeSnapshot(
  current: CdpRuntimeSnapshot,
  patch: Partial<CdpRuntimeSnapshot>,
): CdpRuntimeSnapshot {
  return {
    ...current,
    ...patch,
    lastUpdatedAt: patch.lastUpdatedAt ?? Date.now(),
  };
}
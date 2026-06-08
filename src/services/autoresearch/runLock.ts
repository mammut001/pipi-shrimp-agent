import { useAutoResearchStore } from '@/store/autoresearchStore';
import type { AutoResearchRunRecord, AutoResearchRunStatus } from './history';

type AutoResearchLifecycleLoopState = 'idle' | 'running' | 'paused' | 'stopped' | 'error';

export interface AutoResearchLifecycleState {
  id: string;
  loopState: AutoResearchLifecycleLoopState;
  runHistory: AutoResearchRunRecord[];
}

export interface AutoResearchLifecycleLock {
  locked: boolean;
  loopState: AutoResearchLifecycleLoopState;
  activeRun: AutoResearchRunRecord | null;
  reason: string | null;
}

const ACTIVE_LOCK_STATUSES = new Set<AutoResearchRunStatus>([
  'running',
  'waiting_rate_limit',
  'reflection_failed',
]);

function getActiveRun(state: AutoResearchLifecycleState): AutoResearchRunRecord | null {
  if (!state.id) {
    return null;
  }

  return state.runHistory.find((run) => run.id === state.id) ?? null;
}

function getLockReason(
  state: AutoResearchLifecycleState,
  activeRun: AutoResearchRunRecord | null,
): string | null {
  if (!state.id) {
    return null;
  }

  if (state.loopState === 'paused') {
    return 'AutoResearch is paused.';
  }

  if (activeRun?.status === 'reflection_failed') {
    return 'AutoResearch is waiting for recovery acknowledgement.';
  }

  if (activeRun?.status === 'waiting_rate_limit') {
    return 'AutoResearch is waiting for provider rate-limit recovery.';
  }

  if (state.loopState === 'running' || activeRun?.status === 'running') {
    return 'AutoResearch is still running.';
  }

  return null;
}

function lifecycleLocksEqual(a: AutoResearchLifecycleLock, b: AutoResearchLifecycleLock): boolean {
  return (
    a.locked === b.locked
    && a.loopState === b.loopState
    && a.reason === b.reason
    && a.activeRun?.id === b.activeRun?.id
    && a.activeRun?.status === b.activeRun?.status
  );
}

export function getAutoResearchLifecycleLock(
  state: AutoResearchLifecycleState,
): AutoResearchLifecycleLock {
  const activeRun = getActiveRun(state);
  const locked = Boolean(
    state.id
      && (
        state.loopState === 'running'
        || state.loopState === 'paused'
        || (activeRun && ACTIVE_LOCK_STATUSES.has(activeRun.status))
      ),
  );

  return {
    locked,
    loopState: state.loopState,
    activeRun,
    reason: locked ? getLockReason(state, activeRun) : null,
  };
}

export function useAutoResearchLifecycleLock(): AutoResearchLifecycleLock {
  return useAutoResearchStore(
    (state) => getAutoResearchLifecycleLock(state),
    lifecycleLocksEqual,
  );
}

export function buildAutoResearchRunLockMessage(
  action: string,
  source: AutoResearchLifecycleState | AutoResearchLifecycleLock,
): string {
  const lock = 'locked' in source ? source : getAutoResearchLifecycleLock(source);
  const reason = lock.reason ?? 'AutoResearch is locked.';
  return `${reason} Stop the active run before you ${action}.`;
}

export function assertAutoResearchLifecycleUnlocked(
  state: AutoResearchLifecycleState,
  action: string,
): void {
  const lock = getAutoResearchLifecycleLock(state);
  if (!lock.locked) {
    return;
  }

  throw new Error(buildAutoResearchRunLockMessage(action, lock));
}
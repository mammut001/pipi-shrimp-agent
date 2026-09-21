/**
 * AutoResearch Loop Engine — Autonomous experiment cycle state machine.
 *
 * AG-02 split:
 *  - `./loopEngine.preflightPhase.ts` — run startup / env checks (PR2a)
 *  - `./loopEngine.iterationPhase.ts` — one iteration body (PR2b)
 *  - `./loopEngine.metricsPhase.ts` — PARSE_METRICS helpers (PR2b)
 *  - `./loopEngine.resultParser.ts` — pure structured-result parsers
 *
 * This file keeps the outer loop, AbortController lifecycle (R5-02),
 * and the public start/stop/pause/resume API.
 */

import { useAutoResearchStore, updateRunRecord } from '@/store/autoresearchStore';
import { formatError, isAutoResearchAbortError } from './errors';
import { emitAutoResearchRuntimeEvent } from './runtimeEvents';
import { runExperimentLoopPreflight } from './loopEngine.preflightPhase';
import {
  AutoResearchAbortedError,
  runExperimentIteration,
} from './loopEngine.iterationPhase';

export { AutoResearchAbortedError } from './loopEngine.iterationPhase';

/**
 * AUDIT-FIX [audit-1-ar#1]: Module-level AbortController for the running loop.
 * Created by `startExperimentLoop` (and threaded through by `setupFlow`),
 * fired by `stopExperimentLoop()` or the AutoResearch page's unmount
 * effect. The loop checks `signal.aborted` at the top of each iteration
 * and inside `sendMessage`'s entry to bail out cleanly instead of
 * keeping the SSH session and the next LLM call alive in the background.
 * Only one loop runs at a time so a single module-level handle suffices.
 */
let activeLoopAbortController: AbortController | null = null;

function clearActiveLoopHandle(controller: AbortController): void {
  if (activeLoopAbortController === controller) {
    activeLoopAbortController = null;
  }
}

/**
 * Wait for the AutoResearch loop to either resume from 'paused' or be
 * aborted via the AbortSignal. Used by the loop body's pause branch so
 * the user clicking Stop during a paused loop doesn't have to wait for
 * the next 1-second poll. Peeks the store every 250ms.
 *
 * AUDIT-FIX [R5-09]: replaces the previous bare `setTimeout(resolve,
 * 1000)` so the abort path is signal-aware.
 */
/** @internal exported for R5-09 regression tests */
export function waitForResumeOrAbort(signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    let stopped = false;
    const finish = () => {
      if (stopped) return;
      stopped = true;
      signal?.removeEventListener('abort', onAbort);
      clearInterval(interval);
      resolve();
    };
    const onAbort = () => finish();
    const interval = setInterval(() => {
      const st = useAutoResearchStore.getState().loopState;
      if (st !== 'paused') {
        finish();
      }
    }, 250);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function startExperimentLoop(
  sendMessage: (systemPrompt: string, userMessage: string) => Promise<string>,
  options: { signal?: AbortSignal; abortController?: AbortController } = {},
): Promise<void> {
  // Prefer the controller created by setupFlow so Stop aborts the same
  // signal that sendMessage / runHeadlessAgentTurn observe.
  const abortController = options.abortController ?? new AbortController();
  if (activeLoopAbortController && activeLoopAbortController !== abortController) {
    activeLoopAbortController.abort();
  }
  activeLoopAbortController = abortController;
  const signal = abortController.signal;
  const externalSignal = options.signal;

  let externalAbortListener: (() => void) | null = null;
  if (externalSignal && externalSignal !== abortController.signal) {
    if (externalSignal.aborted) {
      abortController.abort();
    } else {
      externalAbortListener = () => abortController.abort();
      externalSignal.addEventListener('abort', externalAbortListener, { once: true });
    }
  }

  // AUDIT-FIX [R5-02]: wrap preflight + loop in one try/finally so
  // `activeLoopAbortController` is always cleared — on !ok return,
  // unexpected preflight throw, or normal loop exit — so a later
  // startExperimentLoop can restart cleanly after setup failure.
  // AUDIT-FIX [AG-02 PR2a]: the preflight phase (ssh config check,
  // platform support, run_started event, remote OS check, sshpass
  // check, bootstrap apply, startup context, session paths, session
  // hydration, living doc rebuild, environment inspection, dirty-repo
  // check) was extracted to ./loopEngine.preflightPhase.ts. The
  // helper returns a discriminated union; we map each failure kind
  // back to the same user-facing error string the in-line code used
  // to produce.
  try {
  const preflight = await runExperimentLoopPreflight();
  if (!preflight.ok) {
    let message: string;
    switch (preflight.kind) {
      case 'no_ssh_config':
        message = 'SSH config not set';
        break;
      default:
        message = preflight.error;
        break;
    }
    useAutoResearchStore.getState().setError(message);
    return;
  }

  const { notifier, sessionId, artifactCfg, experimentCfg, sessionContent, environmentSummary, workDir } = preflight.ctx;
  const store = useAutoResearchStore.getState();
  let consecutiveRateLimitCount = 0;
  let bestSnapshotDir = preflight.ctx.bestSnapshotDir;

  // AUDIT-FIX [AG-02 PR2b]: per-iteration body (run dir, agent dispatch,
  // PARSE_METRICS, rollback, baseline promote) extracted to
  // ./loopEngine.iterationPhase.ts. Metrics helpers live in
  // ./loopEngine.metricsPhase.ts.
  try {
  while (true) {
    // Honor external abort (e.g. AutoResearch page unmount) before doing any
    // expensive work this iteration. Without this, closing the page mid-iteration
    // would keep the SSH session and the next LLM request alive.
    if (signal?.aborted) {
      useAutoResearchStore.getState().setRunStatus('stopped', {
        summary: 'Aborted by user (UI unmount or stop signal).',
        endedAt: new Date().toISOString(),
      });
      useAutoResearchStore.getState().setLoopState('stopped');
      emitAutoResearchRuntimeEvent({
        level: 'warn',
        phase: 'DONE',
        type: 'run_status_changed',
        message: 'AutoResearch loop aborted by user signal.',
        summary: 'Aborted.',
      });
      break;
    }

    const state = useAutoResearchStore.getState();
    if (state.id !== sessionId || state.loopState === 'idle') {
      break;
    }
    const activeRun = state.runHistory.find((run) => run.id === state.id);

    if (state.consecutiveFailures >= 3) {
      await notifier.onLoopStopped('3 consecutive failures', state);
      useAutoResearchStore.getState().setRunStatus('failed', {
        summary: 'Stopped after 3 consecutive failures.',
        endedAt: new Date().toISOString(),
      });
      emitAutoResearchRuntimeEvent({
        level: 'error',
        phase: 'FAILED',
        type: 'run_completed',
        message: 'Run stopped after 3 consecutive failures.',
        summary: 'Run failed after 3 consecutive failures.',
      });
      useAutoResearchStore.getState().setLoopState('stopped');
      break;
    }
    if (state.loopState === 'stopped' || state.loopState === 'error') {
      break;
    }
    if (state.currentIteration >= state.maxIterations) {
      await notifier.onLoopStopped('Max iterations reached', state);
      if (activeRun?.status !== 'failed' && activeRun?.status !== 'reflection_failed') {
        useAutoResearchStore.getState().setRunStatus('completed', {
          summary: 'Max iterations reached.',
          endedAt: new Date().toISOString(),
        });
        emitAutoResearchRuntimeEvent({
          level: 'info',
          phase: 'DONE',
          type: 'run_completed',
          message: 'Run completed after reaching max iterations.',
          summary: 'Run completed.',
        });
      }
      useAutoResearchStore.getState().setLoopState('stopped');
      break;
    }
    if (state.loopState === 'paused') {
      // AUDIT-FIX [R5-09]: Wait for resume or stop, but honour the
      // AbortSignal. The previous 1-second setTimeout had no signal
      // awareness, so clicking Stop during a paused loop would wait
      // up to a full second before the next iteration-check saw the
      // 'stopped' state. We now poll the store every 250ms AND bail
      // out immediately when the signal fires, so stop-during-pause
      // returns within ~250ms.
      await waitForResumeOrAbort(signal);
      if (signal?.aborted) {
        break;
      }
      continue;
    }


    const outcome = await runExperimentIteration({
      sendMessage,
      signal,
      sessionId,
      artifactCfg,
      experimentCfg,
      sessionContent,
      environmentSummary,
      workDir,
      notifier,
      metricDirection: store.metricDirection,
      maxIterations: store.maxIterations,
      consecutiveRateLimitCount,
      bestSnapshotDir,
    });
    consecutiveRateLimitCount = outcome.consecutiveRateLimitCount;
    bestSnapshotDir = outcome.bestSnapshotDir;
    if (outcome.kind === 'break') {
      break;
    }
  }
  } catch (error) {
    // Aborts are expected; the iteration boundary has already transitioned
    // the run into `stopped`. Don't surface them as runtime errors.
    // Match both the loopEngine class and the duck-typed Error from
    // chatAdapter (which can't import the class without a cycle).
    const isAbort = error instanceof AutoResearchAbortedError
      || isAutoResearchAbortError(error);
    if (isAbort) {
      const latest = useAutoResearchStore.getState();
      if (latest.id === sessionId && latest.loopState !== 'stopped' && latest.loopState !== 'paused') {
        useAutoResearchStore.getState().setRunStatus('stopped', {
          summary: 'Aborted by user.',
          endedAt: new Date().toISOString(),
        });
        useAutoResearchStore.getState().setLoopState('stopped');
      }
    } else {
      throw error;
    }
  }
  } finally {
    // R5-02: always null the stop handle (preflight fail, throw, or exit).
    if (externalAbortListener && externalSignal) {
      externalSignal.removeEventListener('abort', externalAbortListener);
    }
    clearActiveLoopHandle(abortController);
  }
}

/** Test-only accessor for abort-controller lifecycle assertions (R5-02). */
export function getActiveLoopAbortControllerForTest(): AbortController | null {
  return activeLoopAbortController;
}

export function suspendExperimentLoopOnUnmount(): void {
  const state = useAutoResearchStore.getState();
  if (state.loopState === 'running' || state.loopState === 'paused') {
    useAutoResearchStore.getState().patchActiveRunResumeToken({ status: 'paused' });
    useAutoResearchStore.getState().setRunStatus('paused', {
      summary: 'Run paused on page exit.',
    });
    useAutoResearchStore.getState().setLoopState('paused');
    if (activeLoopAbortController) {
      activeLoopAbortController.abort();
    }
  }
}

export function stopExperimentLoop(targetRunId?: string): void {
  // Fire the in-flight abort first so any active LLM call can be cancelled
  // before we even set the run status. The loop will pick this up on its
  // next iteration boundary and exit cleanly via the catch above.
  if (activeLoopAbortController) {
    activeLoopAbortController.abort();
  }
  const state = useAutoResearchStore.getState();
  const runId = targetRunId || state.id || state.selectedRunId;
  useAutoResearchStore.getState().setRunStatus('stopped', {
    summary: 'Stopped by user.',
    endedAt: new Date().toISOString(),
  });
  if (runId && state.id !== runId) {
    useAutoResearchStore.setState((s) => ({
      runHistory: updateRunRecord(s.runHistory, runId, (r) => ({
        ...r,
        status: 'stopped',
        endedAt: new Date().toISOString(),
        summary: 'Stopped by user.',
        resumeToken: undefined,
      })),
    }));
  }
  emitAutoResearchRuntimeEvent({
    level: 'warn',
    phase: 'DONE',
    type: 'run_status_changed',
    message: 'Run stopped by user.',
    summary: 'Run stopped by user.',
  });
  useAutoResearchStore.getState().setLoopState('stopped');
}

export function pauseExperimentLoop(): void {
  emitAutoResearchRuntimeEvent({
    level: 'info',
    phase: 'DECIDE_NEXT',
    type: 'run_status_changed',
    message: 'Run paused by user.',
    summary: 'Run paused by user.',
  });
  useAutoResearchStore.getState().patchActiveRunResumeToken({ status: 'paused' });
  useAutoResearchStore.getState().setRunStatus('paused', {
    summary: 'Run paused by user.',
  });
  useAutoResearchStore.getState().setLoopState('paused');
}

export async function resumePersistedExperimentLoop(targetRunId?: string): Promise<void> {
  const state = useAutoResearchStore.getState();
  const runId = targetRunId
    || state.id
    || state.selectedRunId
    || state.runHistory.find((r) => r.resumeToken?.resumable && (r.status === 'paused' || r.resumeToken?.status === 'paused'))?.id;
  if (!runId) {
    throw new Error('No resumable AutoResearch run found.');
  }
  const { resumeInterruptedAutoResearchRun } = await import('./setupFlow');
  await resumeInterruptedAutoResearchRun(runId);
}

export function resumeExperimentLoop(targetRunId?: string): void {
  const state = useAutoResearchStore.getState();
  if (activeLoopAbortController && state.loopState === 'paused') {
    useAutoResearchStore.getState().patchActiveRunResumeToken({ status: 'running' });
    useAutoResearchStore.getState().setRunStatus('running', {
      summary: 'Run resumed.',
    });
    emitAutoResearchRuntimeEvent({
      level: 'info',
      phase: 'DECIDE_NEXT',
      type: 'run_status_changed',
      message: 'Run resumed by user.',
      summary: 'Run resumed by user.',
    });
    useAutoResearchStore.getState().setLoopState('running');
    return;
  }
  void resumePersistedExperimentLoop(targetRunId).catch((error) => {
    useAutoResearchStore.getState().setError(`Failed to resume run: ${formatError(error)}`);
  });
}

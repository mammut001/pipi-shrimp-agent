/**
 * AutoResearch Loop Engine — iteration failure handlers.
 *
 * Extracted from `loopEngine.iterationPhase.ts` as part of AG-02 PR2b
 * follow-up. Owns the failure paths when an iteration encounters a
 * provider rate limit or an agent/reflection execution error.
 *
 * Abort rethrow is kept in the core `runExperimentIteration` caller.
 */

import { useAutoResearchStore, type ExperimentEntry, type SshConfig } from '@/store/autoresearchStore';
import { captureCommitHash, type RunDir } from './runDir';
import {
  classifyAutoResearchFailure,
  formatError,
  getRateLimitRetryAfterSeconds,
  isTerminalFailureError,
} from './errors';
import { isAutoResearchReflectionFailureError } from './reflection';
import { emitAutoResearchRuntimeEvent, setAutoResearchPhase } from './runtimeEvents';
import { createNotifier } from './notifier';
import { appendIterationMetrics, type IterationMetrics } from './metricsStore';
import { rebuildLivingDoc } from './livingDoc';
import { logExperiment } from './expLogger';
import { type AutoResearchEnvironmentSummary } from './preflight';
import {
  buildIterationParsedMetrics,
  buildIterationNarrative,
  buildRateLimitRetryNarrative,
  buildIterationRecoveryActions,
} from './loopEngine.metricsPhase';
import {
  AutoResearchAbortedError,
  MAX_CONSECUTIVE_RATE_LIMITS,
  sleep,
} from './loopEngine.iterationAbort';
import {
  rollbackIterationWorkspace,
  writeRunStatus,
  getRunArtifactPaths,
} from './loopEngine.iterationWorkspace';

export type IterationPhaseOutcome =
  | {
      kind: 'continue';
      consecutiveRateLimitCount: number;
      bestSnapshotDir: string;
    }
  | {
      kind: 'break';
      consecutiveRateLimitCount: number;
      bestSnapshotDir: string;
    };

export interface HandleRateLimitFailureParams {
  error: unknown;
  iteration: number;
  startMs: number;
  sessionId: string;
  metricName: string;
  artifactCfg: SshConfig;
  iterationCfg: SshConfig;
  runDir: RunDir;
  consecutiveRateLimitCount: number;
  bestSnapshotDir: string;
  signal: AbortSignal;
}

export async function handleRateLimitFailure(
  params: HandleRateLimitFailureParams,
): Promise<IterationPhaseOutcome> {
  const {
    error,
    iteration,
    startMs,
    sessionId,
    metricName,
    artifactCfg,
    iterationCfg,
    runDir,
    bestSnapshotDir,
    signal,
  } = params;
  let consecutiveRateLimitCount = params.consecutiveRateLimitCount + 1;
  const retryAfterSeconds = getRateLimitRetryAfterSeconds(error);
  const cooldownSeconds = retryAfterSeconds ?? Math.min(60, 15 * Math.pow(2, consecutiveRateLimitCount - 1));
  const message = formatError(error);
  const finishedAt = new Date().toISOString();
  const durationMs = Date.now() - startMs;

  useAutoResearchStore.getState().completeIterationRecord({
    iteration,
    status: 'failed',
    phase: 'FAILED',
    hypothesis: 'Provider rate limit',
    change: 'Retry scheduled after provider cooldown',
    reasoning: 'The provider rate limited the request before this iteration completed. AutoResearch will retry the same iteration after cooldown.',
    narrative: buildRateLimitRetryNarrative({
      iteration,
      cooldownSeconds,
      message,
    }),
    codeChangesSummary: 'Iteration attempt aborted before evaluation completed; retry scheduled after cooldown.',
    durationMs,
    parsedMetrics: buildIterationParsedMetrics(metricName, null),
    reflectionSummary: 'Provider rate limited the request before AutoResearch could finish the iteration.',
    metricValue: null,
    commitHash: await captureCommitHash(iterationCfg),
    error: message,
    endedAt: finishedAt,
    artifactPaths: getRunArtifactPaths(runDir),
  });

  useAutoResearchStore.getState().setCurrentIterationValue(Math.max(0, iteration - 1));
  useAutoResearchStore.getState().setRunStatus('waiting_rate_limit', {
    summary: `Provider rate limited the run. Cooling down ${cooldownSeconds}s.`,
  });
  useAutoResearchStore.getState().setStatusMessage(
    `Provider rate limited this run. Waiting ${cooldownSeconds}s before retrying iteration ${iteration}.`,
  );
  setAutoResearchPhase('FAILED', {
    iteration,
    level: 'warn',
    summary: `Iteration ${iteration} is waiting for provider cooldown.`,
    metadata: {
      cooldownSeconds,
    },
  });
  emitAutoResearchRuntimeEvent({
    level: 'warn',
    phase: 'FAILED',
    type: 'provider_error',
    message,
    summary: `Provider rate limited iteration ${iteration}.`,
    metadata: {
      iteration,
      cooldownSeconds,
      iterDir: runDir.iterDir,
    },
    iterationId: `${sessionId}-iter-${iteration}`,
  });
  useAutoResearchStore.getState().appendLiveOutput(
    `[rate-limit] ${message}\n[rate-limit] waiting ${cooldownSeconds}s before retrying iteration ${iteration}\n`,
  );
  await writeRunStatus(artifactCfg, runDir, {
    iteration,
    status: 'RATE_LIMITED',
    metricValue: null,
    failReason: message,
    durationMs,
    commitHash: await captureCommitHash(iterationCfg),
    retryAfterSeconds: cooldownSeconds,
  });
  const rollbackResult = await rollbackIterationWorkspace(iterationCfg, iteration, runDir, {
    reason: 'rate_limit',
  });
  if (!rollbackResult.success) {
    useAutoResearchStore.getState().setError(rollbackResult.message);
    return {
      kind: 'break',
      consecutiveRateLimitCount,
      bestSnapshotDir,
    };
  }
  if (consecutiveRateLimitCount >= MAX_CONSECUTIVE_RATE_LIMITS) {
    const endedAt = new Date().toISOString();
    const summary = `Provider rate limited the run ${MAX_CONSECUTIVE_RATE_LIMITS} times consecutively. Stopping AutoResearch.`;
    useAutoResearchStore.getState().setRunStatus('failed', {
      summary,
      endedAt,
      reason: message,
    });
    useAutoResearchStore.getState().setStatusMessage(undefined);
    emitAutoResearchRuntimeEvent({
      level: 'error',
      phase: 'FAILED',
      type: 'run_completed',
      message: summary,
      summary,
      metadata: {
        cooldownSeconds,
        consecutiveRateLimitCount,
        iteration,
        iterDir: runDir.iterDir,
      },
    });
    useAutoResearchStore.getState().setLoopState('stopped');
    return {
      kind: 'break',
      consecutiveRateLimitCount,
      bestSnapshotDir,
    };
  }
  // Sleep is interruptible: if the user stops mid-cooldown, the
  // signal aborts the sleep and we surface AutoResearchAbortedError
  // which the outer try/catch (added in the #1 abort fix) handles
  // as a clean exit instead of waiting out the full cooldown.
  try {
    await sleep(cooldownSeconds * 1000, signal);
  } catch (sleepError) {
    if (sleepError instanceof AutoResearchAbortedError
        || (sleepError instanceof Error && sleepError.name === 'AutoResearchAbortedError')) {
      return {
        kind: 'break',
        consecutiveRateLimitCount,
        bestSnapshotDir,
      };
    }
    throw sleepError;
  }
  return {
    kind: 'continue',
    consecutiveRateLimitCount,
    bestSnapshotDir,
  };
}

export interface HandleExecutionFailureParams {
  error: unknown;
  iteration: number;
  startedAt: string;
  startMs: number;
  sessionId: string;
  artifactCfg: SshConfig;
  iterationCfg: SshConfig;
  runDir: RunDir;
  bestSnapshotDir: string;
  workDir: string;
  environmentSummary: AutoResearchEnvironmentSummary;
  notifier: ReturnType<typeof createNotifier>;
}

export async function handleExecutionFailure(
  params: HandleExecutionFailureParams,
): Promise<IterationPhaseOutcome> {
  const {
    error,
    iteration,
    startedAt,
    startMs,
    sessionId,
    artifactCfg,
    iterationCfg,
    runDir,
    bestSnapshotDir,
    workDir,
    environmentSummary,
    notifier,
  } = params;

  const consecutiveRateLimitCount = 0;
  const finishedAt = new Date().toISOString();
  const durationMs = Date.now() - startMs;
  const reflectionFailure = isAutoResearchReflectionFailureError(error);
  const failureMessage = formatError(error);
  const failureKind = reflectionFailure ? 'reflection_failed' : classifyAutoResearchFailure(error);
  const entry: ExperimentEntry = {
    iteration,
    hypothesis: reflectionFailure ? 'Reflection failed' : 'Agent execution error',
    change: 'N/A',
    metricValue: null,
    status: 'FAILED',
    failReason: failureMessage,
    reasoning: reflectionFailure
      ? 'The reflection parser exhausted its contract and AutoResearch marked the iteration failed.'
      : 'The Agent failed to complete the iteration.',
    timestamp: finishedAt,
    durationMs,
  };
  const failedRecord: IterationMetrics = {
    iteration,
    sessionId,
    metricName: useAutoResearchStore.getState().metricName,
    metricValue: null,
    status: 'FAILED',
    failReason: failureMessage,
    hypothesis: entry.hypothesis,
    commitHash: await captureCommitHash(iterationCfg),
    durationMs,
    startedAt,
    finishedAt,
    reflection: reflectionFailure
      ? {
        parserPath: error.decisionResult.parserPath,
        retryCount: error.decisionResult.retryCount,
        reason: failureMessage,
      }
      : undefined,
  };
  const narrative = buildIterationNarrative({
    hypothesis: entry.hypothesis,
    change: entry.change,
    status: 'FAILED',
    metricName: useAutoResearchStore.getState().metricName,
    metricValue: null,
    failReason: failureMessage,
    nextStep: entry.reasoning,
  });
  if (reflectionFailure) {
    useAutoResearchStore.getState().setReflectionFailed(failureMessage, {
      summary: failureMessage,
      endedAt: finishedAt,
    });
  } else {
    useAutoResearchStore.getState().setRunStatus('failed', {
      summary: failureMessage,
      endedAt: finishedAt,
      reason: failureMessage,
    });
    if (isTerminalFailureError(error)) {
      useAutoResearchStore.getState().setLoopState('stopped');
    }
  }
  useAutoResearchStore.getState().addExperiment(entry);
  useAutoResearchStore.getState().completeIterationRecord({
    iteration,
    status: 'failed',
    phase: 'FAILED',
    hypothesis: entry.hypothesis,
    change: entry.change,
    reasoning: entry.reasoning,
    narrative,
    codeChangesSummary: entry.change,
    durationMs,
    parsedMetrics: buildIterationParsedMetrics(useAutoResearchStore.getState().metricName, null),
    reflectionSummary: entry.reasoning,
    metricValue: entry.metricValue,
    commitHash: failedRecord.commitHash,
    error: entry.failReason ?? null,
    endedAt: finishedAt,
    artifactPaths: getRunArtifactPaths(runDir),
    recoveryActions: buildIterationRecoveryActions({
      status: 'FAILED',
      hasLogs: true,
    }),
  });
  setAutoResearchPhase('FAILED', {
    iteration,
    level: 'error',
    summary: `Iteration ${iteration} failed during ${reflectionFailure ? 'reflection' : 'agent execution'}.`,
  });
  emitAutoResearchRuntimeEvent({
    level: 'error',
    phase: isTerminalFailureError(error)
      ? 'terminal'
      : (failureKind === 'reflection_failed' ? 'agent_execution' : 'FAILED'),
    type: reflectionFailure ? 'provider_error' : 'iteration_failed',
    message: entry.failReason ?? 'Agent execution error',
    summary: `Iteration ${iteration} failed.`,
    metadata: {
      iteration,
      iterDir: runDir.iterDir,
      failureKind,
      parserPath: reflectionFailure ? error.decisionResult.parserPath : undefined,
      retryCount: reflectionFailure ? error.decisionResult.retryCount : undefined,
    },
    iterationId: `${sessionId}-iter-${iteration}`,
  });
  useAutoResearchStore.getState().incrementConsecutiveFailures();
  await appendIterationMetrics(artifactCfg, sessionId, failedRecord);
  await writeRunStatus(artifactCfg, runDir, {
    iteration,
    status: entry.status,
    metricValue: null,
    failReason: entry.failReason ?? null,
    durationMs,
    commitHash: failedRecord.commitHash,
  });
  await rebuildLivingDoc(artifactCfg, sessionId, {
    startedAt: useAutoResearchStore.getState().startedAt,
    workDir,
    metricName: useAutoResearchStore.getState().metricName,
    direction: useAutoResearchStore.getState().metricDirection,
    experimentNotesPath: environmentSummary.notesPath,
  });
  const rollbackResult = await rollbackIterationWorkspace(iterationCfg, iteration, runDir, {
    terminal: !isTerminalFailureError(error),
    reason: reflectionFailure ? 'reflection_failure' : 'agent_execution_error',
  });
  await logExperiment(entry, useAutoResearchStore.getState());
  await notifier.onExperimentComplete(entry, useAutoResearchStore.getState());
  if (!rollbackResult.success) {
    useAutoResearchStore.getState().setError(rollbackResult.message);
  }

  return {
    kind: 'continue',
    consecutiveRateLimitCount,
    bestSnapshotDir,
  };
}

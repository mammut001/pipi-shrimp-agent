/**
 * AutoResearch Loop Engine — iteration phase.
 *
 * Extracted from `loopEngine.startExperimentLoop` as part of AG-02
 * PR2b. Owns one iteration of the experiment loop: create the run
 * dir, build the system prompt, dispatch the agent, parse metrics
 * (via `./loopEngine.metricsPhase`), record results, rollback on
 * failure / non-improvement, and promote improved baselines.
 *
 * The outer `while` (pause / stop / max-iterations / consecutive
 * failures) and the R5-02 try/finally + `clearActiveLoopHandle`
 * lifecycle stay in `loopEngine.ts`.
 *
 * `runExperimentIteration` returns a small discriminated outcome so
 * the caller can update `consecutiveRateLimitCount` /
 * `bestSnapshotDir` and decide whether to `continue` or `break`
 * without collapsing per-path user-facing behavior.
 */

import { useAutoResearchStore, type ExperimentEntry, type SshConfig } from '@/store/autoresearchStore';
import { logExperiment } from './expLogger';
import { getRemoteDiff } from './rollback';
import { createNotifier } from './notifier';
import {
  appendIterationMetrics,
  readAllMetrics,
  type IterationMetrics,
} from './metricsStore';
import {
  captureCommitHash,
  createRunDir,
  promoteRunDirToBestBaseline,
  writeTargetText,
  type RunDir,
} from './runDir';
import { readLivingDoc, rebuildLivingDoc } from './livingDoc';
import { clearCurrentRunDir, setCurrentRunDir } from './terminalRunner';
import {
  formatError,
  isAutoResearchAbortError,
  isRateLimitError,
} from './errors';
import { emitAutoResearchRuntimeEvent, setAutoResearchPhase } from './runtimeEvents';
import { type AutoResearchEnvironmentSummary } from './preflight';
import { toExperimentEntry } from './loopEngine.preflightPhase';
import {
  parseIterationMetrics,
  mergeArtifactPaths,
  buildIterationNarrative,
  buildIterationParsedMetrics,
  buildIterationRecoveryActions,
} from './loopEngine.metricsPhase';
import {
  AutoResearchAbortedError,
  throwIfAborted,
  isBudgetExhaustedIterationSignal,
} from './loopEngine.iterationAbort';
import { buildSystemPrompt } from './loopEngine.iterationPrompt';
import {
  buildIterationWorkspaceCfg,
  rollbackIterationWorkspace,
  writeRunStatus,
  getRunArtifactPaths,
} from './loopEngine.iterationWorkspace';
import {
  handleRateLimitFailure,
  handleExecutionFailure,
  type IterationPhaseOutcome,
} from './loopEngine.iterationFailure';

// Re-export public symbols from extracted modules for consumers and tests
export {
  AutoResearchAbortedError,
  calculateBudgetReserve,
  throwIfAborted,
  TOOL_BUDGET_EXHAUSTED_MARKER,
  MAX_CONSECUTIVE_RATE_LIMITS,
  sleep,
  isBudgetExhaustedIterationSignal,
} from './loopEngine.iterationAbort';

export {
  buildSystemPrompt,
  type PromptInput,
} from './loopEngine.iterationPrompt';

export {
  buildIterationWorkspaceCfg,
  rollbackIterationWorkspace,
  writeRunStatus,
  getRunArtifactPaths,
} from './loopEngine.iterationWorkspace';

export {
  handleRateLimitFailure,
  handleExecutionFailure,
  type IterationPhaseOutcome,
  type HandleRateLimitFailureParams,
  type HandleExecutionFailureParams,
} from './loopEngine.iterationFailure';

// ---------------------------------------------------------------------------
// Iteration phase context / outcome.
// ---------------------------------------------------------------------------

export interface IterationPhaseContext {
  sendMessage: (systemPrompt: string, userMessage: string) => Promise<string>;
  signal: AbortSignal;
  sessionId: string;
  artifactCfg: SshConfig;
  experimentCfg: SshConfig;
  sessionContent: string;
  environmentSummary: AutoResearchEnvironmentSummary;
  workDir: string;
  notifier: ReturnType<typeof createNotifier>;
  /** Metric direction / maxIterations snapshot from loop start
   *  (same fields the in-line body previously read from the `store`
   *  const captured after preflight). */
  metricDirection: 'lower' | 'higher';
  maxIterations: number;
  consecutiveRateLimitCount: number;
  bestSnapshotDir: string;
}

/**
 * Run a single experiment iteration. Caller owns the outer `while`
 * (abort / idle / consecutive-failures / max-iterations / pause) and
 * the R5-02 AbortController lifecycle.
 */
export async function runExperimentIteration(
  ctx: IterationPhaseContext,
): Promise<IterationPhaseOutcome> {
  const {
    sendMessage,
    signal,
    sessionId,
    artifactCfg,
    experimentCfg,
    sessionContent,
    environmentSummary,
    workDir,
    notifier,
  } = ctx;
  let consecutiveRateLimitCount = ctx.consecutiveRateLimitCount;
  let bestSnapshotDir = ctx.bestSnapshotDir;
  const store = {
    metricDirection: ctx.metricDirection,
    maxIterations: ctx.maxIterations,
  };

  // Mirror the pre-extract body: capture `state` once at the top of
  // the iteration (after outer-loop gate checks), then increment.
  const state = useAutoResearchStore.getState();

  useAutoResearchStore.getState().incrementIteration();
  const iteration = useAutoResearchStore.getState().currentIteration;
  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  useAutoResearchStore.getState().setStatusMessage(undefined);
  useAutoResearchStore.getState().setLiveOutput('');

  let runDir: RunDir;
  try {
    runDir = await createRunDir(artifactCfg, sessionId, iteration, {
      snapshotSourceDir: bestSnapshotDir,
    });
  } catch (error) {
    useAutoResearchStore.getState().setError(`Failed to create run directory: ${formatError(error)}`);
    return {
      kind: 'break',
      consecutiveRateLimitCount,
      bestSnapshotDir,
    };
  }
  setCurrentRunDir(runDir);
  const iterationCfg = buildIterationWorkspaceCfg(experimentCfg, runDir);
  useAutoResearchStore.getState().startIterationRecord({
    iteration,
    startedAt,
    artifactPaths: getRunArtifactPaths(runDir),
  });
  setAutoResearchPhase('INIT', {
    iteration,
    summary: `Iteration ${iteration} started.`,
    message: `Iteration ${iteration} started.`,
    metadata: {
      iterDir: runDir.iterDir,
    },
  });
  emitAutoResearchRuntimeEvent({
    level: 'info',
    phase: 'INIT',
    type: 'iteration_started',
    message: `Iteration ${iteration} started.`,
    summary: `Iteration ${iteration} started.`,
    metadata: {
      iterDir: runDir.iterDir,
    },
    iterationId: `${sessionId}-iter-${iteration}`,
  });
  await writeRunStatus(artifactCfg, runDir, {
    iteration,
    status: 'RUNNING',
    metricValue: null,
    failReason: null,
    durationMs: 0,
    commitHash: await captureCommitHash(iterationCfg),
  });

  try {
    setAutoResearchPhase('READ_CONTEXT', {
      iteration,
      summary: `Iteration ${iteration} is loading context and run artifacts.`,
    });
    const livingDoc = await readLivingDoc(artifactCfg, sessionId) || '';
    let previousMetrics: IterationMetrics[] = [];
    try {
      previousMetrics = await readAllMetrics(artifactCfg, sessionId, state.metricDirection);
    } catch {
      previousMetrics = [];
    }
    const systemPrompt = buildSystemPrompt({
      sessionContent,
      livingDoc,
      sshConfig: experimentCfg,
      runDir,
      environmentSummary,
      metricDirection: store.metricDirection,
      metricName: state.metricName,
      maxIterations: store.maxIterations,
      iteration,
      previousMetrics,
    });
    await writeTargetText(artifactCfg, runDir.systemPromptPath, `${systemPrompt}\n`);

    const userMessage = `Run experiment iteration #${iteration}. Follow the iteration workspace contract exactly.`;
    setAutoResearchPhase('PLAN_HYPOTHESIS', {
      iteration,
      summary: `Iteration ${iteration} is planning the next hypothesis.`,
    });
    // Re-check abort right before dispatching the LLM — the in-flight sendMessage
    // itself is wrapped in chatAdapter to honor `signal`.
    throwIfAborted(signal, `Iteration ${iteration} LLM dispatch`);
    const agentOutput = await sendMessage(systemPrompt, userMessage);
    consecutiveRateLimitCount = 0;
    const budgetExhausted = isBudgetExhaustedIterationSignal(agentOutput);
    setAutoResearchPhase('PARSE_METRICS', {
      iteration,
      summary: `Iteration ${iteration} is parsing experiment metrics.`,
    });
    const { parsed, parseError } = await parseIterationMetrics(
      artifactCfg,
      runDir,
      state.metricName,
      state.metricDirection,
      agentOutput,
    );
    const diff = await getRemoteDiff(iterationCfg);
    const commitHash = await captureCommitHash(iterationCfg);
    const finishedAt = new Date().toISOString();
    const durationMs = Date.now() - startMs;

    await writeTargetText(artifactCfg, runDir.diffPath, diff);

    if (!parsed) {
      const failureReason = parseError ?? 'Could not parse metrics.json or structured agent output.';
      const failedRecord: IterationMetrics = {
        iteration,
        sessionId,
        runId: sessionId,
        primaryMetric: state.metricName,
        direction: state.metricDirection,
        timestamp: finishedAt,
        generator: 'loop_engine',
        schemaVersion: 1,
        metricName: state.metricName,
        metricValue: null,
        status: 'FAILED',
        failReason: failureReason,
        hypothesis: 'Unparseable result',
        commitHash,
        durationMs,
        startedAt,
        finishedAt,
      };
      const entry: ExperimentEntry = {
        ...toExperimentEntry(failedRecord),
        change: 'See agent output',
        reasoning: agentOutput.slice(-1000),
      };
      const narrative = buildIterationNarrative({
        hypothesis: entry.hypothesis,
        change: entry.change,
        status: 'FAILED',
        metricName: state.metricName,
        metricValue: null,
        failReason: failureReason,
        nextStep: entry.reasoning,
      });
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
        parsedMetrics: buildIterationParsedMetrics(state.metricName, null),
        reflectionSummary: entry.reasoning,
        metricValue: entry.metricValue,
        commitHash,
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
        level: 'warn',
        summary: `Iteration ${iteration} failed while parsing metrics.`,
        metadata: {
          failReason: failureReason,
        },
      });
      if (budgetExhausted) {
        emitAutoResearchRuntimeEvent({
          level: 'warn',
          phase: 'FAILED',
          type: 'provider_error',
          message: `iteration_failed_due_to_budget: iteration ${iteration} exhausted the tool budget before evaluation completed.`,
          summary: `Iteration ${iteration} exhausted the tool budget.`,
          metadata: {
            iteration,
            iterDir: runDir.iterDir,
            failReason: failureReason,
          },
          iterationId: `${sessionId}-iter-${iteration}`,
        });
      }
      emitAutoResearchRuntimeEvent({
        level: 'warn',
        phase: 'FAILED',
        type: 'iteration_failed',
        message: `Iteration ${iteration} finished without parseable metrics.`,
        summary: `Iteration ${iteration} failed: no parseable metrics were produced.`,
        metadata: {
          failReason: entry.failReason ?? null,
          iterDir: runDir.iterDir,
        },
        iterationId: `${sessionId}-iter-${iteration}`,
      });
      useAutoResearchStore.getState().incrementConsecutiveFailures();
      await appendIterationMetrics(artifactCfg, sessionId, failedRecord);
      await writeRunStatus(artifactCfg, runDir, {
        iteration,
        status: entry.status,
        metricValue: entry.metricValue,
        failReason: entry.failReason ?? null,
        durationMs,
        commitHash,
      });
      const rollbackResult = await rollbackIterationWorkspace(iterationCfg, iteration, runDir, {
        reason: budgetExhausted ? 'budget_exhaustion_parse_failure' : 'parse_failure',
      });
      await rebuildLivingDoc(artifactCfg, sessionId, {
        startedAt: state.startedAt,
        workDir,
        metricName: state.metricName,
        direction: state.metricDirection,
        experimentNotesPath: environmentSummary.notesPath,
      });
      await logExperiment(entry, useAutoResearchStore.getState());
      await notifier.onExperimentComplete(entry, useAutoResearchStore.getState());
      if (!rollbackResult.success) {
        useAutoResearchStore.getState().setError(rollbackResult.message);
        return {
          kind: 'break',
          consecutiveRateLimitCount,
          bestSnapshotDir,
        };
      }
      return {
        kind: 'continue',
        consecutiveRateLimitCount,
        bestSnapshotDir,
      };
    }

    if (parsed && typeof parsed.metricValue === 'number' && Number.isFinite(parsed.metricValue)) {
      if (parsed.status === 'FAILED') {
        const currentBest = state.bestMetric;
        const isBetter = currentBest === null || currentBest === undefined
          ? true
          : state.metricDirection === 'higher'
            ? parsed.metricValue > currentBest
            : parsed.metricValue < currentBest;
        parsed.status = isBetter ? 'IMPROVED' : 'NOT_IMPROVED';
        parsed.failReason = undefined;
        emitAutoResearchRuntimeEvent({
          level: 'info',
          phase: 'PARSE_METRICS',
          type: 'metrics_parsed',
          message: `evaluation_fallback_from_metrics: iteration ${iteration} recovered score ${parsed.metricValue} despite agent failure or lane rejection.`,
          summary: `Iteration ${iteration} recovered score ${parsed.metricValue} (${parsed.status}).`,
          metadata: {
            iteration,
            iterDir: runDir.iterDir,
            parser: parsed.parseSource,
            metricValue: parsed.metricValue,
          },
          iterationId: `${sessionId}-iter-${iteration}`,
        });
      }
    }

    const metricsRecord: IterationMetrics = {
      iteration,
      sessionId,
      runId: sessionId,
      primaryMetric: parsed.metricName,
      direction: state.metricDirection,
      timestamp: finishedAt,
      generator: 'loop_engine',
      schemaVersion: 1,
      metricName: parsed.metricName,
      metricValue: parsed.metricValue,
      status: parsed.status,
      failReason: parsed.failReason,
      hypothesis: parsed.hypothesis,
      change: parsed.change,
      reasoning: parsed.reasoning,
      artifactPaths: parsed.artifactPaths,
      commitHash,
      durationMs,
      startedAt,
      finishedAt,
      extra: parsed.extra,
    };

    const entry = toExperimentEntry(metricsRecord);
    const narrative = buildIterationNarrative({
      hypothesis: parsed.hypothesis,
      change: parsed.change,
      status: parsed.status,
      metricName: parsed.metricName,
      metricValue: parsed.metricValue,
      failReason: parsed.failReason,
      nextStep: parsed.reasoning,
    });
    useAutoResearchStore.getState().addExperiment(entry);
    if (budgetExhausted && parsed.parseSource === 'metrics_json') {
      emitAutoResearchRuntimeEvent({
        level: 'info',
        phase: 'PARSE_METRICS',
        type: 'metrics_parsed',
        message: `evaluation_fallback_from_metrics: iteration ${iteration} completed using metrics.json after tool budget exhaustion.`,
        summary: `Iteration ${iteration} recovered metrics from metrics.json after budget exhaustion.`,
        metadata: {
          iteration,
          iterDir: runDir.iterDir,
          parser: parsed.parseSource,
        },
        iterationId: `${sessionId}-iter-${iteration}`,
      });
    }
    if (budgetExhausted && parsed.status === 'FAILED') {
      emitAutoResearchRuntimeEvent({
        level: 'warn',
        phase: 'FAILED',
        type: 'provider_error',
        message: `iteration_failed_due_to_budget: iteration ${iteration} exhausted the tool budget before evaluation completed.`,
        summary: `Iteration ${iteration} exhausted the tool budget.`,
        metadata: {
          iteration,
          iterDir: runDir.iterDir,
          failReason: parsed.failReason ?? null,
        },
        iterationId: `${sessionId}-iter-${iteration}`,
      });
    }
    if (parsed.parseSource === 'deprecated_result_line') {
      emitAutoResearchRuntimeEvent({
        level: 'warn',
        phase: 'PARSE_METRICS',
        type: 'metrics_parsed',
        message: `Iteration ${iteration} used deprecated EXPERIMENT_RESULT fallback parsing.`,
        summary: `Iteration ${iteration} used deprecated fallback parsing.`,
        metadata: {
          iterDir: runDir.iterDir,
          parser: parsed.parseSource,
        },
        iterationId: `${sessionId}-iter-${iteration}`,
      });
    }
    setAutoResearchPhase('DECIDE_NEXT', {
      iteration,
      summary: `Iteration ${iteration} is deciding the next step.`,
    });
    useAutoResearchStore.getState().completeIterationRecord({
      iteration,
      status: parsed.status === 'FAILED' ? 'failed' : 'completed',
      phase: parsed.status === 'FAILED' ? 'FAILED' : 'DONE',
      hypothesis: entry.hypothesis,
      change: entry.change,
      reasoning: entry.reasoning,
      narrative,
      codeChangesSummary: parsed.change,
      durationMs,
      parsedMetrics: buildIterationParsedMetrics(parsed.metricName, parsed.metricValue, parsed.extra),
      reflectionSummary: parsed.reasoning,
      metricValue: entry.metricValue,
      commitHash,
      error: entry.failReason ?? null,
      endedAt: finishedAt,
      artifactPaths: mergeArtifactPaths(getRunArtifactPaths(runDir), parsed.artifactPaths),
      recoveryActions: buildIterationRecoveryActions({
        status: parsed.status,
        hasLogs: true,
      }),
    });
    emitAutoResearchRuntimeEvent({
      level: parsed.status === 'FAILED' ? 'warn' : 'info',
      phase: parsed.status === 'FAILED' ? 'FAILED' : 'DONE',
      type: 'metrics_parsed',
      message: `Metrics parsed for iteration ${iteration}.`,
      summary: parsed.metricValue === null
        ? `Iteration ${iteration} produced no metric value.`
        : `Iteration ${iteration} reached ${parsed.metricName}=${parsed.metricValue}.`,
      metadata: {
        metricName: parsed.metricName,
        metricValue: parsed.metricValue,
        parser: parsed.parseSource,
        iterDir: runDir.iterDir,
      },
      iterationId: `${sessionId}-iter-${iteration}`,
    });
    emitAutoResearchRuntimeEvent({
      level: parsed.status === 'FAILED' ? 'warn' : 'info',
      phase: parsed.status === 'FAILED' ? 'FAILED' : 'DONE',
      type: parsed.status === 'FAILED' ? 'iteration_failed' : 'iteration_completed',
      message: `Iteration ${iteration} completed with status ${parsed.status}.`,
      summary: `Iteration ${iteration} ${parsed.status === 'FAILED' ? 'failed' : 'completed'}.`,
      metadata: {
        metricValue: parsed.metricValue,
        failReason: parsed.failReason ?? null,
        iterDir: runDir.iterDir,
      },
      iterationId: `${sessionId}-iter-${iteration}`,
    });
    setAutoResearchPhase(parsed.status === 'FAILED' ? 'FAILED' : 'DONE', {
      iteration,
      level: parsed.status === 'FAILED' ? 'warn' : 'info',
      summary: `Iteration ${iteration} ${parsed.status === 'FAILED' ? 'failed' : 'completed'}.`,
    });

    if (parsed.status === 'IMPROVED' && parsed.metricValue !== null) {
      useAutoResearchStore.getState().updateBestMetric(parsed.metricValue);
      useAutoResearchStore.getState().resetConsecutiveFailures();
    } else if (parsed.status === 'FAILED') {
      useAutoResearchStore.getState().incrementConsecutiveFailures();
    } else {
      useAutoResearchStore.getState().resetConsecutiveFailures();
    }

    await appendIterationMetrics(artifactCfg, sessionId, metricsRecord);
    await writeRunStatus(artifactCfg, runDir, {
      iteration,
      status: parsed.status,
      metricValue: parsed.metricValue,
      failReason: parsed.failReason ?? null,
      durationMs,
      commitHash,
    });
    const rollbackResult = (parsed.status === 'FAILED' || parsed.status === 'NOT_IMPROVED')
      ? await rollbackIterationWorkspace(iterationCfg, iteration, runDir, {
        reason: parsed.status === 'FAILED'
          ? budgetExhausted ? 'budget_exhaustion_failed_iteration' : 'failed_iteration'
          : 'not_improved_iteration',
      })
      : { success: true, message: '' };
    await rebuildLivingDoc(artifactCfg, sessionId, {
      startedAt: state.startedAt,
      workDir,
      metricName: state.metricName,
      direction: state.metricDirection,
      experimentNotesPath: environmentSummary.notesPath,
    });
    await logExperiment(entry, useAutoResearchStore.getState());
    await notifier.onExperimentComplete(entry, useAutoResearchStore.getState());
    if (!rollbackResult.success) {
      useAutoResearchStore.getState().setError(rollbackResult.message);
      return {
        kind: 'break',
        consecutiveRateLimitCount,
        bestSnapshotDir,
      };
    }
    if (parsed.status === 'IMPROVED' && parsed.metricValue !== null) {
      try {
        bestSnapshotDir = await promoteRunDirToBestBaseline(artifactCfg, sessionId, runDir.codeDir);
        emitAutoResearchRuntimeEvent({
          level: 'info',
          phase: 'DONE',
          type: 'iteration_completed',
          message: `Iteration ${iteration} promoted its workspace as the next baseline.`,
          summary: `Iteration ${iteration} became the next baseline.`,
          metadata: {
            iteration,
            baselineDir: bestSnapshotDir,
            iterDir: runDir.iterDir,
          },
          iterationId: `${sessionId}-iter-${iteration}`,
        });
      } catch (error) {
        useAutoResearchStore.getState().setError(`Failed to preserve improved baseline: ${formatError(error)}`);
        return {
          kind: 'break',
          consecutiveRateLimitCount,
          bestSnapshotDir,
        };
      }
    }

    const trendInterval = useAutoResearchStore.getState().telegramConfig.trendReportInterval;
    if (iteration % trendInterval === 0) {
      const experiments = useAutoResearchStore.getState().experiments;
      const recent = experiments.slice(-trendInterval);
      const improved = recent.filter(e => e.status === 'IMPROVED').length;
      const failed = recent.filter(e => e.status === 'FAILED').length;
      const report = [
        `最近 ${trendInterval} 轮: ${improved} improved, ${failed} failed, ${trendInterval - improved - failed} not improved`,
        `当前最佳: ${useAutoResearchStore.getState().bestMetric ?? 'N/A'}`,
      ].join('\n');
      await notifier.onTrendReport(report, useAutoResearchStore.getState());
    }

    const icon = parsed.status === 'IMPROVED' ? '✅' : parsed.status === 'FAILED' ? '❌' : '➖';
    const summary = `[Exp ${iteration}] ${parsed.hypothesis} → ${parsed.status} ${icon} (${parsed.metricValue ?? 'N/A'})`;
    useAutoResearchStore.getState().appendLiveOutput(summary + '\n');
  } catch (error) {
    if (isAutoResearchAbortError(error)) {
      throw error;
    }
    if (isRateLimitError(error)) {
      return await handleRateLimitFailure({
        error,
        iteration,
        startMs,
        sessionId,
        metricName: state.metricName,
        artifactCfg,
        iterationCfg,
        runDir,
        consecutiveRateLimitCount,
        bestSnapshotDir,
        signal,
      });
    }

    return await handleExecutionFailure({
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
    });
  } finally {
    clearCurrentRunDir();
  }

  return {
    kind: 'continue',
    consecutiveRateLimitCount,
    bestSnapshotDir,
  };
}

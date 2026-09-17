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
import { useSettingsStore } from '@/store/settingsStore';
import { buildShellProfilePromptContext } from '@/utils/windowsShellProfile';
import { logExperiment } from './expLogger';
import { rollback, getRemoteDiff } from './rollback';
import { createNotifier } from './notifier';
import { describeTarget } from '@/utils/remoteExec';
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
import { buildMultiRoundGuidance } from './iterationPrompt';
import { clearCurrentRunDir, setCurrentRunDir } from './terminalRunner';
import {
  classifyAutoResearchFailure,
  formatError,
  getRateLimitRetryAfterSeconds,
  isAutoResearchAbortError,
  isRateLimitError,
  isTerminalFailureError,
} from './errors';
import { isAutoResearchReflectionFailureError } from './reflection';
import {
  getAutoResearchLivingDocPathFromWorkDir,
  getAutoResearchSessionFilePathFromWorkDir,
} from './paths';
import { emitAutoResearchRuntimeEvent, setAutoResearchPhase } from './runtimeEvents';
import {
  type AutoResearchEnvironmentSummary,
} from './preflight';
import { mapExperimentFileToCheckout } from './experimentPathRewrite';
import { formatAutoResearchToolCatalog, getAutoResearchToolProfile } from './toolCatalog';
import { formatAutoResearchToolLanes } from './toolLanes';
import { toExperimentEntry } from './loopEngine.preflightPhase';
import {
  parseIterationMetrics,
  mergeArtifactPaths,
  buildIterationNarrative,
  buildIterationParsedMetrics,
  buildRateLimitRetryNarrative,
  buildIterationRecoveryActions,
} from './loopEngine.metricsPhase';

interface PromptInput {
  sessionContent: string;
  livingDoc: string;
  sshConfig: SshConfig;
  runDir: RunDir;
  environmentSummary: AutoResearchEnvironmentSummary;
  metricDirection: 'lower' | 'higher';
  metricName: string;
  maxIterations: number;
  iteration: number;
  previousMetrics: IterationMetrics[];
}

export const TOOL_BUDGET_EXHAUSTED_MARKER = '__AUTORESEARCH_TOOL_BUDGET_EXHAUSTED__';
const MAX_CONSECUTIVE_RATE_LIMITS = 3;

export class AutoResearchAbortedError extends Error {
  constructor(message = 'AutoResearch loop was aborted by the user.') {
    super(message);
    this.name = 'AutoResearchAbortedError';
  }
}

export function throwIfAborted(signal: AbortSignal | undefined, context: string): void {
  if (signal?.aborted) {
    throw new AutoResearchAbortedError(`${context} aborted by user.`);
  }
}

// AUDIT-016 FIX: Budget reserve is now calculated dynamically based on remaining iterations.
// This ensures the reserve is meaningful even when maxIterations is small (e.g., 1).
export function calculateBudgetReserve(maxIterations: number): number {
  // Reserve 2 rounds or 25% of maxIterations, whichever is smaller but at least 1
  return Math.max(1, Math.min(2, Math.floor(maxIterations * 0.25)));
}

/**
 * Sleep that can be interrupted by an AbortSignal. Used for rate-limit
 * cooldowns so the user can stop a run immediately instead of waiting
 * out a 60+ second sleep.
 *
 * AUDIT-FIX [audit-3-ar#9]: Prior implementation was a bare
 * `setTimeout(resolve, ms)`. The user clicking Stop during a 60s+ rate
 * limit cooldown would update the UI to "stopped" via
 * `stopExperimentLoop()`, but the loop body would still sleep the full
 * duration before checking the abort flag on the next iteration
 * boundary — blocking async cleanup and wasting backend resources.
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AutoResearchAbortedError('sleep aborted before start'));
      return;
    }
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new AutoResearchAbortedError('sleep aborted mid-wait'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function buildSystemPrompt({
  sessionContent,
  livingDoc,
  sshConfig,
  runDir,
  environmentSummary,
  metricDirection,
  metricName,
  maxIterations,
  iteration,
  previousMetrics,
}: PromptInput): string {
  // AUDIT-016 FIX: Calculate budget reserve dynamically based on maxIterations
  const budgetReserve = calculateBudgetReserve(maxIterations);
  const isLocal = sshConfig.mode === 'local';
  const toolProfile = getAutoResearchToolProfile(sshConfig);
  const allowedTools = formatAutoResearchToolCatalog(sshConfig);
  const toolLanes = formatAutoResearchToolLanes(sshConfig);
  const iterationCodeDir = runDir.codeDir;
  const iterationRunScript = mapExperimentFileToCheckout(
    environmentSummary.runScriptPath,
    environmentSummary.experimentDir,
    iterationCodeDir,
  );
  const iterationNotes = mapExperimentFileToCheckout(
    environmentSummary.notesPath,
    environmentSummary.experimentDir,
    iterationCodeDir,
  );
  const envLine = isLocal
    ? `Executing directly on the local machine. Tool sandbox: ${runDir.iterDir}. Experiment checkout: ${iterationCodeDir}.`
    : `Remote host via SSH — ${describeTarget(sshConfig)}.`;
  const shellProfileContext = isLocal
    ? buildShellProfilePromptContext({
        selection: useSettingsStore.getState().windowsShellProfile,
        workDir: sshConfig.remoteWorkDir,
      })
    : null;
  const toolCfgHint = isLocal
    ? `Use ${toolProfile.commandTool} for target-side commands with cwd="${iterationCodeDir}". Use ${toolProfile.readTool} for file reads, ${toolProfile.createDirectoryTool} for directory creation, and ${toolProfile.writeTool} for file writes.`
    : `Use ${toolProfile.commandTool} for target-side commands with mode="ssh", host="${sshConfig.host}", user="${sshConfig.user}", port=${sshConfig.port}, authMode="${sshConfig.authMode}"${sshConfig.authMode === 'key' ? `, keyPath="${sshConfig.keyPath}"` : ''}, remoteWorkDir="${sshConfig.remoteWorkDir}". Use ${toolProfile.readTool} for file reads. Use ${toolProfile.uploadTool} for remote file creation or replacement. Only set terminal=true when the command needs a PTY or live terminal output. Never ask for credentials.`;
  const inspectionScope = isLocal
    ? 'Read only the minimum files you need, and use only the local experiment tools listed above.'
    : 'Read only the minimum files you need, and use only the SSH experiment tools listed above.';
  const executionRequirement = isLocal
    ? `Run the experiment command through ${toolProfile.commandTool} with cwd set to ${iterationCodeDir}.`
    : `Run the experiment command through ${toolProfile.commandTool}. Use terminal=true only when the command needs a PTY or live terminal output; otherwise keep it false or omitted.`;
  const toolLaneGuard = isLocal
    ? 'Never call ssh_exec, ssh_read_file, or ssh_upload_file in this local run.'
    : 'Never call execute_command, read_file, write_file, or create_directory in this SSH run.';

  return `# AutoResearch Agent

## Role
You are running one autonomous experiment iteration inside Pipi-Shrimp AutoResearch.

## Environment
- Execution target: ${envLine}
- Tool config: ${toolCfgHint}
- Only permitted experiment tools for this run: ${allowedTools}
${shellProfileContext ? `- Active shell profile: ${shellProfileContext.shellProfileLabel}\n- ${shellProfileContext.shellProfileGuidance}` : ''}

## Phase Tool Lanes
${toolLanes}

## Environment Preflight
- Iteration experiment checkout (READ/WRITE HERE): ${iterationCodeDir}
- Original experiment directory (already snapshotted; do not read or write): ${environmentSummary.experimentDir}
- Git repository: ${environmentSummary.repoStatus} (${environmentSummary.dirtyFileCount} dirty files before this iteration)
- Preferred Python command: ${environmentSummary.preferredPythonCommand}
- Recommended run command: ${environmentSummary.recommendedRunCommand}
- Required files already confirmed: ${iterationRunScript}, ${iterationNotes}
- Workspace writable: ${environmentSummary.worktreeWritable ? 'yes' : 'no'}
- GPU telemetry: ${environmentSummary.gpuSummary || 'not checked'}

## Session File
${sessionContent}

## Multi-round strategy
${buildMultiRoundGuidance({
    iteration,
    maxIterations,
    metricName,
    direction: metricDirection,
    previous: previousMetrics,
  })}

## Living AutoResearch Notes
${livingDoc || 'No prior iterations recorded yet.'}

## Iteration Workspace
- Iteration directory: ${runDir.iterDir}
- Iteration code checkout: ${iterationCodeDir}
- Hypothesis file: ${runDir.hypothesisPath}
- Metrics file: ${runDir.metricsPath}
- Diff file: ${runDir.diffPath}

## WORKSPACE CONTRACT
- Your tool working directory is ${runDir.iterDir}. Use relative paths from there whenever possible.
- Per-iteration code lives in: ${iterationCodeDir} (already a clean git checkout)
- Modify run_experiment.py in ${iterationCodeDir} (for example: code/run_experiment.py), NOT in the original experiment dir
- Run the experiment from ${iterationCodeDir} using "${environmentSummary.recommendedRunCommand}". When calling execute_command, set cwd/work_dir to ${iterationCodeDir}.
- Write hypothesis.md and diff.patch into ${runDir.iterDir}/ (one level above code/)
- Write metrics.json to ${runDir.metricsPath}. If your experiment script naturally emits ./metrics.json from ${iterationCodeDir}, the host will also accept that location as a fallback.
- The host will diff ${iterationCodeDir} vs the parent run's baseline to produce diff.patch
- Do NOT touch the original experiment directory directly

## Requirements for this iteration
1. Do exactly one hypothesis/change/run/evaluate cycle.
2. Before making changes, do at most one batched inspection pass. ${inspectionScope}
3. Write a short hypothesis summary to ${runDir.hypothesisPath}.
4. ${executionRequirement}
5. Before finishing, write exactly one valid JSON object to ${runDir.metricsPath} with:
  {"schemaVersion":1,"sessionId":"${runDir.sessionId}","runId":"${runDir.sessionId}","iteration":${runDir.iter},"primaryMetric":"${metricName}","direction":"${metricDirection}","timestamp":"<ISO8601>","generator":"agent","metricName":"${metricName}","metricValue":<number|null>,"status":"IMPROVED|NOT_IMPROVED|FAILED","hypothesis":"<one line>","change":"<short summary>","reasoning":"<brief reasoning>","artifactPaths":["<optional path>"],"failReason":"<optional>","extra":{"<optional>":"<optional>"}}
6. If the metric is missing, the command crashes, or the run times out, still write the JSON object with status FAILED, metricValue null, and a concrete failReason.
7. Also emit a final fallback line as a deprecated backup only if the host cannot read metrics.json:
   EXPERIMENT_RESULT: metric_value=<number_or_null> status=<IMPROVED|NOT_IMPROVED|FAILED> hypothesis="<one line>"
   or
   EXPERIMENT_RESULT: metric_value=null status=FAILED fail_reason="<reason>" hypothesis="<one line>"
8. Reserve the last ${budgetReserve} tool calls for reading metrics/logs, writing the final result, and cleanup. If you are near that reserve, stop exploring or modifying code and finalize.
9. Run the expensive experiment or training/evaluation command at most once in this iteration. If it fails, read logs or metrics and emit FAILED instead of patching and rerunning.
10. If the change is not improved or the run fails, revert your working tree before finishing.
11. ${toolLaneGuard}
12. Respect the phase tool lanes above. Once you move into PARSE_METRICS or DECIDE_NEXT, do not go back to editing code or rerunning the experiment in the same iteration.
13. Do not repeat dead ends from the living doc unless you have a materially different reason.
14. If you are still exploring after the first inspection pass, stop exploring and either run the experiment or emit a FAILED result with a concrete failReason.
15. Treat GPU thermal state as a safety constraint. If telemetry shows GPU temperature >= 85C, fan speed is unavailable/0 during a GPU-heavy run, or the target appears thermally unsafe, avoid escalating workload and write a FAILED result with failReason="thermal_guard" instead of pushing another run.
16. Do not change GPU fan speed, power limits, persistence mode, or other hardware controls unless the session file explicitly permits hardware control and the command is safe for the target.
`;
}

export function buildIterationWorkspaceCfg(cfg: SshConfig, runDir: RunDir): SshConfig {
  return {
    ...cfg,
    remoteWorkDir: runDir.codeDir,
  };
}

export function isBudgetExhaustedIterationSignal(agentOutput: string): boolean {
  return agentOutput.includes(TOOL_BUDGET_EXHAUSTED_MARKER);
}

export async function rollbackIterationWorkspace(
  cfg: SshConfig,
  iteration: number,
  runDir: RunDir,
  options: { terminal?: boolean; reason: string },
): Promise<{ success: boolean; message: string }> {
  useAutoResearchStore.getState().addRunEvent({
    level: 'info',
    phase: 'system',
    message: `rollback_started: iteration ${iteration} rollback requested.`,
    metadata: {
      iteration,
      iterDir: runDir.iterDir,
      reason: options.reason,
    },
  });

  const result = await rollback(cfg, { terminal: options.terminal ?? false });
  useAutoResearchStore.getState().addRunEvent({
    level: result.success ? 'info' : 'error',
    phase: 'system',
    message: result.success
      ? `rollback_completed: iteration ${iteration} workspace reverted.`
      : `rollback_failed: iteration ${iteration} workspace could not be reverted.`,
    metadata: {
      iteration,
      iterDir: runDir.iterDir,
      reason: options.reason,
      rollbackMessage: result.message,
    },
  });

  return result;
}

export async function writeRunStatus(
  cfg: SshConfig,
  runDir: RunDir,
  payload: Record<string, unknown>,
): Promise<void> {
  await writeTargetText(cfg, runDir.statusPath, `${JSON.stringify(payload, null, 2)}\n`);
}

export function getRunArtifactPaths(runDir: RunDir): string[] {
  return [
    runDir.iterDir,
    runDir.systemPromptPath,
    runDir.hypothesisPath,
    runDir.diffPath,
    runDir.metricsPath,
    runDir.statusPath,
    runDir.reflectionInputPath,
    runDir.reflectionRawPath,
    runDir.reflectionParsedPath,
    runDir.transcriptPath,
    `${runDir.logsDir}/stdout.log`,
    `${runDir.logsDir}/stderr.log`,
    `${runDir.logsDir}/combined.log`,
  ];
}


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
        consecutiveRateLimitCount += 1;
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
          parsedMetrics: buildIterationParsedMetrics(state.metricName, null),
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

      consecutiveRateLimitCount = 0;
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
    } finally {
      clearCurrentRunDir();
    }

  return {
    kind: 'continue',
    consecutiveRateLimitCount,
    bestSnapshotDir,
  };
}

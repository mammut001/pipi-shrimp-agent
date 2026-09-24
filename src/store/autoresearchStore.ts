/**
 * AutoResearch Store — Zustand state for the autonomous experiment loop.
 *
 * Manages the live run state plus persistent run history used by the
 * AutoResearch page and agent panel.
 */

import { create } from 'zustand';
import { connectAutoResearchPersistence } from './autoresearchPersistence';
import type { AutoResearchStore } from './autoresearchStoreTypes';
import {
  buildRunRecordFromInit,
  createEmptySession, defaultTelegramConfig,
  createRunEvent,
  getFallbackSelectedRunId,
  isBetterMetric,
  sanitizeOptionalText,
  toIterationRecord,
  updateRunRecord,
  upsertRunRecord,
  withActiveRunUpdate,
} from './autoresearchStoreRecords';
export {
  getActiveAutoResearchRun,
  getAutoResearchRunReason,
  getSelectedAutoResearchRun,
  getSelectedAutoResearchRunContext,
  getSortedAutoResearchRuns,
  isAutoResearchTerminalState,
  updateRunRecord,
} from './autoresearchStoreRecords';
export type {
  AutoResearchSelectedRunContext,
  AutoResearchStore,
  ExperimentEntry,
  ExperimentSession,
  ExperimentStatus,
  LoopState,
  TelegramNotifyConfig,
} from './autoresearchStoreTypes';
import type { AutoResearchAgentConfigSnapshot } from '@/services/autoresearch/errors';
import {
  clipLiveOutputBuffer,
  clipLiveOutputExcerpt,
  clipLiveOutputExcerptInMemory,
  loadPersistedAutoResearchHistory,
  redactAutoResearchSensitiveText,
  toHistoryConfigSnapshot,
  type AutoResearchIterationRecord,
  type AutoResearchRecoveryAction,
  type AutoResearchResumeToken,
  type AutoResearchRunEvent,
  type AutoResearchRunPhase,
  type AutoResearchRunRecord,
  type AutoResearchRunStatus,
} from '@/services/autoresearch/history';
import {
  buildAutoResearchDefaultConfig,
  loadPersistedAutoResearchLastUsedConfig,
  persistAutoResearchLastUsedConfig,
  type AutoResearchDefaultConfig,
} from '@/services/autoresearch/defaultConfig';
import { stopExperimentLoop } from '@/services/autoresearch/loopEngine';
import {
  createAutoResearchResumeToken,
  patchAutoResearchResumeToken,
} from '@/services/autoresearch/resumeToken';
import { withSshConfigDefaults } from '@/types/ssh';
import type { ExecMode, SshAuthMode, SshConfig } from '@/types/ssh';
export { flushAutoResearchPersistOnClose } from './autoresearchPersistence';

export type { AutoResearchIterationRecord, AutoResearchRunRecord, AutoResearchRunStatus } from '@/services/autoresearch/history';

// ============== Shared SSH Types ==============
// Imported from centralized types to avoid duplication
export type { SshConfig, ExecMode, SshAuthMode };
export { withSshConfigDefaults };

// ============== Types ==============

const persistedHistory = loadPersistedAutoResearchHistory();
const persistedLastUsedConfig = loadPersistedAutoResearchLastUsedConfig();

export const useAutoResearchStore = create<AutoResearchStore>((set, get) => ({
  ...createEmptySession(),
  runHistory: persistedHistory.runs,
  selectedRunId: persistedHistory.selectedRunId,
  lastUsedConfig: persistedLastUsedConfig,
  showSetupModal: false,

  initSession: (opts) => set((state) => {
    const createdAt = new Date().toISOString();
    const nextRun = buildRunRecordFromInit({
      id: opts.id,
      createdAt,
      maxIterations: opts.maxIterations,
      metricName: opts.metricName,
      metricDirection: opts.metricDirection,
      sshConfig: opts.sshConfig,
      experimentDir: opts.experimentDir,
      sessionFilePath: opts.sessionFilePath,
      livingDocPath: opts.livingDocPath,
      baseline: opts.baseline,
      agentConfigSnapshot: opts.agentConfigSnapshot,
      preferredPythonCommand: opts.preferredPythonCommand,
      repoStatus: opts.repoStatus,
      dirtyFileCount: opts.dirtyFileCount,
      gpuTelemetryAvailable: opts.gpuTelemetryAvailable,
      gpuSummary: opts.gpuSummary,
      gpuTemperatureC: opts.gpuTemperatureC,
      gpuFanSpeedPercent: opts.gpuFanSpeedPercent,
      gpuUtilizationPercent: opts.gpuUtilizationPercent,
      gpuMemoryUsedMb: opts.gpuMemoryUsedMb,
      gpuMemoryTotalMb: opts.gpuMemoryTotalMb,
    });
    nextRun.events = [
      createRunEvent(opts.id, {
        level: 'info',
        phase: 'system',
        type: 'run_started',
        message: 'Run initialized.',
        summary: 'Run initialized.',
        metadata: {
          experimentDir: nextRun.config.experimentDir,
          workdir: nextRun.config.workdir,
          metric: nextRun.config.metric,
          direction: nextRun.config.direction,
        },
      }),
    ];

    return {
      id: opts.id,
      loopState: 'running',
      currentIteration: 0,
      maxIterations: opts.maxIterations,
      bestMetric: opts.baseline ?? null,
      metricDirection: opts.metricDirection,
      metricName: opts.metricName,
      successCriteria: state.successCriteria,
      bootstrapKind: state.bootstrapKind,
      consecutiveFailures: 0,
      experimentDir: opts.experimentDir || opts.sshConfig.remoteWorkDir || '',
      sessionFilePath: opts.sessionFilePath || '',
      livingDocPath: opts.livingDocPath || '',
      startedAt: createdAt,
      experiments: [],
      sshConfig: withSshConfigDefaults(opts.sshConfig),
      agentConfigSnapshot: opts.agentConfigSnapshot,
      telegramConfig: { ...defaultTelegramConfig, ...opts.telegramConfig },
      liveOutput: '',
      selectedExperiment: -1,
      errorMessage: undefined,
      statusMessage: undefined,
      reason: undefined,
      terminalVisible: false,
      terminalReady: false,
      terminalSessionId: null,
      terminalCwd: opts.sshConfig.remoteWorkDir || '',
      runHistory: upsertRunRecord(state.runHistory, nextRun),
      selectedRunId: opts.id,
    };
  }),

  resetSession: () => set((state) => ({
    ...createEmptySession(),
    runHistory: state.runHistory,
    selectedRunId: getFallbackSelectedRunId(state.runHistory, state.selectedRunId),
    lastUsedConfig: state.lastUsedConfig,
    showSetupModal: state.showSetupModal,
  })),

  selectRun: (runId) => set((state) => ({
    selectedRunId: state.runHistory.some((run) => run.id === runId) ? runId : state.selectedRunId,
    selectedExperiment: -1,
  })),

  deleteRun: (runId) => {
    const prior = get();
    if (
      prior.id === runId
      && (prior.loopState === 'running' || prior.loopState === 'paused')
    ) {
      stopExperimentLoop();
    }
    set((state) => {
    const updatedHistory = state.runHistory.filter((run) => run.id !== runId);
    const wasActive = state.id === runId;
    const isSelected = state.selectedRunId === runId;
    const newSelectedRunId = isSelected
      ? (updatedHistory[0]?.id ?? null)
      : state.selectedRunId;
    return {
      runHistory: updatedHistory,
      selectedRunId: newSelectedRunId,
      selectedExperiment: isSelected ? -1 : state.selectedExperiment,
      ...(wasActive ? createEmptySession() : {}),
    };
  });
  },

  deleteRuns: (runIds) => {
    const prior = get();
    if (
      runIds.includes(prior.id)
      && (prior.loopState === 'running' || prior.loopState === 'paused')
    ) {
      stopExperimentLoop();
    }
    set((state) => {
    const updatedHistory = state.runHistory.filter((run) => !runIds.includes(run.id));
    const wasActiveDeleted = runIds.includes(state.id);
    const isSelectedDeleted = state.selectedRunId && runIds.includes(state.selectedRunId);
    const newSelectedRunId = isSelectedDeleted
      ? (updatedHistory[0]?.id ?? null)
      : state.selectedRunId;
    return {
      runHistory: updatedHistory,
      selectedRunId: newSelectedRunId,
      selectedExperiment: isSelectedDeleted ? -1 : state.selectedExperiment,
      ...(wasActiveDeleted ? createEmptySession() : {}),
    };
  });
  },

  setLoopState: (loopState) => set({ loopState }),

  setCurrentPhase: (currentPhase) => set((state) => ({
    ...withActiveRunUpdate(state, (run) => ({
      ...run,
      updatedAt: new Date().toISOString(),
      currentPhase,
    })),
  })),

  setRunStatus: (status, options) => set((state) => {
    const updatedAt = options?.endedAt ?? new Date().toISOString();
    const clearReason = ['running', 'waiting_rate_limit', 'paused', 'completed', 'stopped'].includes(status);
    const clearResumeToken = ['completed', 'stopped', 'failed', 'reflection_failed', 'interrupted'].includes(status);
    const nextReason = options?.reason !== undefined
      ? sanitizeOptionalText(options.reason)
      : clearReason
        ? undefined
        : state.reason;
    const nextSummary = sanitizeOptionalText(options?.summary);
    const nextPhase = status === 'completed' || status === 'stopped' || status === 'interrupted'
      ? 'DONE'
      : status === 'failed' || status === 'reflection_failed'
        ? 'FAILED'
        : undefined;

    return {
      reason: nextReason,
      ...withActiveRunUpdate(state, (run) => ({
        ...run,
        status,
        updatedAt,
        endedAt: options?.endedAt ?? (clearReason ? undefined : run.endedAt ?? updatedAt),
        currentPhase: nextPhase ?? run.currentPhase,
        summary: nextSummary ?? run.summary,
        reason: options?.reason !== undefined
          ? sanitizeOptionalText(options.reason)
          : clearReason
            ? undefined
            : run.reason,
        resumeToken: clearResumeToken
          ? undefined
          : patchAutoResearchResumeToken(
            run.resumeToken,
            status === 'running' || status === 'waiting_rate_limit' || status === 'interrupted' || status === 'paused'
              ? { status }
              : {},
            updatedAt,
          ),
      })),
    };
  }),

  setReflectionFailed: (reason, options) => set((state) => {
    const endedAt = options?.endedAt ?? new Date().toISOString();
    const sanitizedReason = redactAutoResearchSensitiveText(reason);
    const sanitizedSummary = sanitizeOptionalText(options?.summary);
    return {
      loopState: 'error',
      errorMessage: sanitizedReason,
      statusMessage: undefined,
      reason: sanitizedReason,
      terminalReady: false,
      ...withActiveRunUpdate(state, (run) => ({
        ...run,
        status: 'reflection_failed',
        updatedAt: endedAt,
        endedAt,
        currentPhase: 'FAILED',
        summary: sanitizedSummary ?? sanitizedReason,
        reason: sanitizedReason,
        resumeToken: undefined,
        events: [...run.events, createRunEvent(run.id, {
          timestamp: endedAt,
          level: 'error',
          phase: 'system',
          type: 'provider_error',
          message: 'Run state changed: running → reflection_failed',
          summary: sanitizedReason,
          metadata: {
            reason: sanitizedReason,
          },
        })],
      })),
    };
  }),

  acknowledgeReflectionFailure: () => set((state) => {
    const endedAt = new Date().toISOString();
    return {
      loopState: 'stopped' as const,
      errorMessage: undefined,
      statusMessage: undefined,
      reason: undefined,
      ...withActiveRunUpdate(state, (run) => ({
        ...run,
        status: 'stopped' as const,
        updatedAt: endedAt,
        endedAt,
        currentPhase: 'DONE' as const,
        summary: 'Reflection failure acknowledged.',
        reason: undefined,
        resumeToken: undefined,
      })),
    };
  }),

  setError: (msg) => set((state) => {
    const endedAt = new Date().toISOString();
    // AUDIT-FIX [audit-1-ar#4]: Empty error message fallback.
    // Callers occasionally pass `undefined` / null / empty when an
    // upstream error had no message. Without this, the UI shows a blank
    // error panel and the active run's `reason` is persisted as an
    // empty string in localStorage (and silently lost on reload).
    // Normalize the input and substitute a fixed fallback so the user
    // always sees something actionable + the run record is recoverable.
    const normalized = typeof msg === 'string' ? msg.trim() : '';
    const fallback = 'AutoResearch run stopped due to an unknown error. Check the event log for details.';
    const sanitizedMessage = redactAutoResearchSensitiveText(normalized || fallback);
    return {
      loopState: 'error',
      errorMessage: sanitizedMessage,
      statusMessage: undefined,
      reason: sanitizedMessage,
      ...withActiveRunUpdate(state, (run) => ({
        ...run,
        status: 'failed',
        updatedAt: endedAt,
        endedAt,
        currentPhase: 'FAILED',
        summary: sanitizedMessage,
        reason: sanitizedMessage,
        resumeToken: undefined,
        events: [...run.events, createRunEvent(run.id, {
          timestamp: endedAt,
          level: 'error',
          phase: 'system',
          type: 'provider_error',
          message: sanitizedMessage,
          summary: sanitizedMessage,
        })],
      })),
    };
  }),

  setStatusMessage: (msg) => set((state) => ({
    statusMessage: sanitizeOptionalText(msg),
    ...withActiveRunUpdate(state, (run) => ({
      ...run,
      updatedAt: new Date().toISOString(),
      summary: sanitizeOptionalText(msg) ?? run.summary,
    })),
  })),

  patchActiveRunResumeToken: (patch) => set((state) => ({
    ...withActiveRunUpdate(state, (run) => ({
      ...run,
      resumeToken: patchAutoResearchResumeToken(run.resumeToken, patch),
    })),
  })),

  clearActiveRunResumeToken: () => set((state) => ({
    ...withActiveRunUpdate(state, (run) => ({
      ...run,
      resumeToken: undefined,
    })),
  })),

  updateRunPaths: (paths) => set((state) => ({
    sshConfig: paths.sshConfig ? withSshConfigDefaults(paths.sshConfig) : state.sshConfig,
    experimentDir: paths.experimentDir ?? state.experimentDir,
    sessionFilePath: paths.sessionFilePath ?? state.sessionFilePath,
    livingDocPath: paths.livingDocPath ?? state.livingDocPath,
    terminalCwd: paths.terminalCwd ?? state.terminalCwd,
    ...withActiveRunUpdate(state, (run) => ({
      ...run,
      updatedAt: new Date().toISOString(),
      resumeToken: patchAutoResearchResumeToken(run.resumeToken, {
        sshConfig: paths.sshConfig ? withSshConfigDefaults(paths.sshConfig) : run.resumeToken?.sshConfig,
        experimentDir: paths.experimentDir ?? run.resumeToken?.experimentDir,
        sessionFilePath: paths.sessionFilePath ?? run.resumeToken?.sessionFilePath,
        livingDocPath: paths.livingDocPath ?? run.resumeToken?.livingDocPath,
      }),
      config: {
        ...run.config,
        experimentDir: paths.experimentDir ?? run.config.experimentDir,
        workdir: paths.sshConfig?.remoteWorkDir ?? run.config.workdir,
        sessionFilePath: paths.sessionFilePath ?? run.config.sessionFilePath,
        livingDocPath: paths.livingDocPath ?? run.config.livingDocPath,
      },
    })),
  })),

  incrementIteration: () => set((state) => ({
    currentIteration: state.currentIteration + 1,
    ...withActiveRunUpdate(state, (run) => ({
      ...run,
      currentIteration: state.currentIteration + 1,
      updatedAt: new Date().toISOString(),
      status: run.status === 'waiting_rate_limit' ? 'running' : run.status,
      resumeToken: patchAutoResearchResumeToken(run.resumeToken, {
        status: 'running',
        currentIteration: state.currentIteration + 1,
        pendingIteration: state.currentIteration + 1,
        replayIteration: true,
      }),
    })),
  })),

  addExperiment: (entry) => set((state) => ({
    experiments: [...state.experiments, entry],
    runHistory: updateRunRecord(state.runHistory, state.id, (run) => {
      const existing = run.iterations.find((item) => item.index === entry.iteration);
      const nextIteration = toIterationRecord(entry, existing);
      const nextIterations = run.iterations.some((item) => item.index === entry.iteration)
        ? run.iterations.map((item) => (item.index === entry.iteration ? nextIteration : item))
        : [...run.iterations, nextIteration].sort((a, b) => a.index - b.index);

      const shouldUpdateBest = entry.metricValue !== null && isBetterMetric(state.metricDirection, entry.metricValue, run.bestMetricValue);

      // AUDIT-FIX [R5-12]: Do not mutate `failureCount` here.
      // `incrementConsecutiveFailures` / `resetConsecutiveFailures` (and
      // `updateBestMetric`'s reset path) are the single source of truth for
      // both the live `consecutiveFailures` counter and the persisted
      // `run.failureCount`. Updating failureCount from experiment status
      // here raced those helpers and could disagree for auto-stop/backoff.
      return {
        ...run,
        updatedAt: entry.timestamp,
        iterations: nextIterations,
        bestMetricValue: shouldUpdateBest ? entry.metricValue : run.bestMetricValue ?? null,
        bestIteration: shouldUpdateBest ? entry.iteration : run.bestIteration,
        summary: entry.failReason ? redactAutoResearchSensitiveText(entry.failReason) : run.summary,
      };
    }),
  })),

  startIterationRecord: (input) => set((state) => ({
    runHistory: updateRunRecord(state.runHistory, state.id, (run) => {
      const nextRecord: AutoResearchIterationRecord = {
        id: `${run.id}-iter-${input.iteration}`,
        index: input.iteration,
        status: 'running',
        phase: 'INIT',
        startedAt: input.startedAt,
        artifactPaths: input.artifactPaths,
      };
      const nextIterations = run.iterations.some((item) => item.index === input.iteration)
        ? run.iterations.map((item) => (item.index === input.iteration ? { ...item, ...nextRecord } : item))
        : [...run.iterations, nextRecord].sort((a, b) => a.index - b.index);
      return {
        ...run,
        updatedAt: input.startedAt,
        currentIteration: input.iteration,
        iterations: nextIterations,
      };
    }),
  })),

  completeIterationRecord: (input) => set((state) => ({
    runHistory: updateRunRecord(state.runHistory, state.id, (run) => {
      const existing = run.iterations.find((item) => item.index === input.iteration);
      const nextRecord: AutoResearchIterationRecord = {
        id: existing?.id ?? `${run.id}-iter-${input.iteration}`,
        index: input.iteration,
        status: input.status,
        phase: input.phase ?? existing?.phase,
        hypothesis: input.hypothesis ? redactAutoResearchSensitiveText(input.hypothesis) : existing?.hypothesis,
        change: input.change ? redactAutoResearchSensitiveText(input.change) : existing?.change,
        reasoning: input.reasoning ? redactAutoResearchSensitiveText(input.reasoning) : existing?.reasoning,
        narrative: input.narrative ? redactAutoResearchSensitiveText(input.narrative) : existing?.narrative,
        codeChangesSummary: input.codeChangesSummary ? redactAutoResearchSensitiveText(input.codeChangesSummary) : existing?.codeChangesSummary,
        executionCommand: input.executionCommand ? redactAutoResearchSensitiveText(input.executionCommand) : existing?.executionCommand,
        exitCode: input.exitCode ?? existing?.exitCode,
        durationMs: input.durationMs ?? existing?.durationMs,
        parsedMetrics: input.parsedMetrics ?? existing?.parsedMetrics,
        reflectionSummary: input.reflectionSummary ? redactAutoResearchSensitiveText(input.reflectionSummary) : existing?.reflectionSummary,
        metricValue: input.metricValue ?? existing?.metricValue,
        improvement: input.improvement ?? existing?.improvement,
        commitHash: input.commitHash ?? existing?.commitHash,
        error: input.error ? redactAutoResearchSensitiveText(input.error) : existing?.error ?? null,
        startedAt: existing?.startedAt,
        endedAt: input.endedAt ?? existing?.endedAt,
        artifactPaths: input.artifactPaths ?? existing?.artifactPaths,
        recoveryActions: input.recoveryActions ?? existing?.recoveryActions,
      };
      const nextIterations = run.iterations.some((item) => item.index === input.iteration)
        ? run.iterations.map((item) => (item.index === input.iteration ? nextRecord : item))
        : [...run.iterations, nextRecord].sort((a, b) => a.index - b.index);
      return {
        ...run,
        updatedAt: input.endedAt ?? new Date().toISOString(),
        iterations: nextIterations,
        resumeToken: patchAutoResearchResumeToken(run.resumeToken, {
          currentIteration: input.iteration,
          pendingIteration: input.iteration + 1,
          replayIteration: false,
        }, input.endedAt),
      };
    }),
  })),

  patchIterationRecord: (input) => set((state) => ({
    runHistory: updateRunRecord(state.runHistory, state.id, (run) => {
      const existing = run.iterations.find((item) => item.index === input.iteration);
      const nextRecord: AutoResearchIterationRecord = {
        id: existing?.id ?? `${run.id}-iter-${input.iteration}`,
        index: input.iteration,
        status: input.status ?? existing?.status ?? 'running',
        phase: input.phase ?? existing?.phase,
        hypothesis: input.hypothesis ? redactAutoResearchSensitiveText(input.hypothesis) : existing?.hypothesis,
        change: input.change ? redactAutoResearchSensitiveText(input.change) : existing?.change,
        reasoning: input.reasoning ? redactAutoResearchSensitiveText(input.reasoning) : existing?.reasoning,
        narrative: input.narrative ? redactAutoResearchSensitiveText(input.narrative) : existing?.narrative,
        codeChangesSummary: input.codeChangesSummary ? redactAutoResearchSensitiveText(input.codeChangesSummary) : existing?.codeChangesSummary,
        executionCommand: input.executionCommand ? redactAutoResearchSensitiveText(input.executionCommand) : existing?.executionCommand,
        exitCode: input.exitCode ?? existing?.exitCode,
        durationMs: input.durationMs ?? existing?.durationMs,
        parsedMetrics: input.parsedMetrics ?? existing?.parsedMetrics,
        reflectionSummary: input.reflectionSummary ? redactAutoResearchSensitiveText(input.reflectionSummary) : existing?.reflectionSummary,
        metricValue: input.metricValue ?? existing?.metricValue,
        improvement: input.improvement ?? existing?.improvement,
        commitHash: input.commitHash ?? existing?.commitHash,
        error: input.error ? redactAutoResearchSensitiveText(input.error) : existing?.error ?? null,
        startedAt: existing?.startedAt,
        endedAt: input.endedAt ?? existing?.endedAt,
        artifactPaths: input.artifactPaths ?? existing?.artifactPaths,
        recoveryActions: input.recoveryActions ?? existing?.recoveryActions,
      };
      const nextIterations = run.iterations.some((item) => item.index === input.iteration)
        ? run.iterations.map((item) => (item.index === input.iteration ? nextRecord : item))
        : [...run.iterations, nextRecord].sort((a, b) => a.index - b.index);
      return {
        ...run,
        updatedAt: input.endedAt ?? new Date().toISOString(),
        iterations: nextIterations,
      };
    }),
  })),

  addRunEvent: (input) => set((state) => ({
    runHistory: updateRunRecord(state.runHistory, state.id, (run) => ({
      ...run,
      updatedAt: input.timestamp ?? new Date().toISOString(),
      // AUDIT-FIX [audit-2-ar#8]: Aligned with `MAX_PERSISTED_EVENTS_PER_RUN`
      // in history.ts so the persisted shape is always a strict subset
      // of the in-memory shape. Previously 200 vs 100 — every persist
      // truncated the in-memory tail to 100, then `serialized !== raw`
      // detected the difference and triggered a write-back. Now both
      // are 100 and persists are no-ops when nothing has changed.
      events: [...run.events, createRunEvent(run.id, input)].slice(-100),
    })),
  })),

  // AUDIT-FIX [R5-12]: Keep persisted failureCount in lockstep when
  // resetting consecutiveFailures on a new best metric.
  updateBestMetric: (value) => set((state) => ({
    bestMetric: value,
    consecutiveFailures: 0,
    ...withActiveRunUpdate(state, (run) => ({
      ...run,
      updatedAt: new Date().toISOString(),
      bestMetricValue: value,
      bestIteration: state.currentIteration || run.bestIteration,
      failureCount: 0,
    })),
  })),

  setBestMetric: (value) => set((state) => ({
    bestMetric: value,
    ...withActiveRunUpdate(state, (run) => ({
      ...run,
      updatedAt: new Date().toISOString(),
      bestMetricValue: value,
    })),
  })),

  setPrimaryMetric: (metricName) => set((state) => ({
    metricName,
    ...withActiveRunUpdate(state, (run) => ({
      ...run,
      updatedAt: new Date().toISOString(),
      config: {
        ...run.config,
        metric: metricName,
      },
    })),
  })),

  setSuccessCriteria: (successCriteria) => set({ successCriteria }),

  setBootstrapKind: (bootstrapKind) => set({ bootstrapKind }),

  setCurrentIterationValue: (iteration) => set((state) => ({
    currentIteration: iteration,
    ...withActiveRunUpdate(state, (run) => ({
      ...run,
      updatedAt: new Date().toISOString(),
      currentIteration: iteration,
    })),
  })),

  // AUDIT-FIX [R5-12]: Source of truth for stop/backoff counters.
  // Live `consecutiveFailures` and persisted `run.failureCount` are updated
  // together so auto-stop (`consecutiveFailures >= 3`) and resume
  // (`activateHistoricalRun` → consecutiveFailures = failureCount) cannot diverge.
  incrementConsecutiveFailures: () => set((state) => {
    const next = state.consecutiveFailures + 1;
    return {
      consecutiveFailures: next,
      ...withActiveRunUpdate(state, (run) => ({
        ...run,
        updatedAt: new Date().toISOString(),
        failureCount: next,
      })),
    };
  }),

  resetConsecutiveFailures: () => set((state) => ({
    consecutiveFailures: 0,
    ...withActiveRunUpdate(state, (run) => ({
      ...run,
      updatedAt: new Date().toISOString(),
      failureCount: 0,
    })),
  })),

  setExperiments: (entries) => set({ experiments: entries }),

  setLiveOutput: (output) => set((state) => ({
    liveOutput: clipLiveOutputBuffer(output),
    ...withActiveRunUpdate(state, (run) => ({
      ...run,
      updatedAt: new Date().toISOString(),
      // AUDIT-FIX [audit-2-ar#4]: In-memory excerpt path skips secret
      // redaction. `clipLiveOutputExcerptInMemory` is a pure slice;
      // redaction is paid once at persist time via
      // `redactLiveOutputExcerptForStorage` (in `compactRunRecord`).
      // Redacting on every token append was a CPU hotspot: 10+ regex
      // passes × 20KB string × 100+ appends/sec = multi-MB regex work
      // per second of streaming output.
      liveOutputExcerpt: clipLiveOutputExcerptInMemory(output),
    })),
  })),

  appendLiveOutput: (chunk) => set((state) => {
    const liveOutput = clipLiveOutputBuffer(state.liveOutput + chunk);
    return {
      liveOutput,
      ...withActiveRunUpdate(state, (run) => ({
        ...run,
        updatedAt: new Date().toISOString(),
        // AUDIT-FIX [audit-2-ar#4]: No redaction per-append — see setLiveOutput
        // above. The persisted shape is redacted at write time.
        liveOutputExcerpt: clipLiveOutputExcerptInMemory((run.liveOutputExcerpt || '') + chunk),
      })),
    };
  }),

  setSelectedExperiment: (selectedExperiment) => set({ selectedExperiment }),

  openTerminalPanel: (terminalSessionId, terminalCwd) => set({
    terminalVisible: true,
    terminalReady: false,
    terminalSessionId,
    terminalCwd,
  }),
  setTerminalReady: (terminalReady) => set({ terminalReady }),
  setTerminalVisible: (terminalVisible) => set({ terminalVisible }),
  setTerminalCwd: (terminalCwd) => set({ terminalCwd }),

  setSshConfig: (cfg) => set({ sshConfig: withSshConfigDefaults(cfg) }),
  setLastUsedConfig: (config) => {
    const lastUsedConfig = buildAutoResearchDefaultConfig(config);
    persistAutoResearchLastUsedConfig(lastUsedConfig);
    set({ lastUsedConfig });
  },
  clearLastUsedConfig: () => {
    persistAutoResearchLastUsedConfig(null);
    set({ lastUsedConfig: null });
  },
  setTelegramConfig: (cfg) => set((state) => ({
    telegramConfig: { ...state.telegramConfig, ...cfg },
  })),

  activateHistoricalRun: (input) => set((state) => {
    const resumedAt = new Date().toISOString();
    const existingRun = state.runHistory.find((run) => run.id === input.runId);
    if (!existingRun) {
      return {};
    }

    const restoredCurrentIteration = Math.max(0, input.pendingIteration - 1);
    const restoredResumeToken = patchAutoResearchResumeToken(
      input.resumeToken ?? existingRun.resumeToken,
      {
        status: 'running',
        sshConfig: withSshConfigDefaults(input.sshConfig),
        experimentDir: input.experimentDir,
        sessionFilePath: input.sessionFilePath,
        livingDocPath: input.livingDocPath,
        metricName: input.metricName,
        metricDirection: input.metricDirection,
        maxIterations: input.maxIterations,
        baseline: input.baseline ?? existingRun.config.baseline ?? null,
        currentIteration: restoredCurrentIteration,
        pendingIteration: input.pendingIteration,
        replayIteration: true,
      },
      resumedAt,
    );

    return {
      id: input.runId,
      loopState: 'running',
      currentIteration: restoredCurrentIteration,
      maxIterations: input.maxIterations,
      bestMetric: existingRun.bestMetricValue ?? input.baseline ?? null,
      metricDirection: input.metricDirection,
      metricName: input.metricName,
      consecutiveFailures: existingRun.failureCount,
      experimentDir: input.experimentDir,
      sessionFilePath: input.sessionFilePath || '',
      livingDocPath: input.livingDocPath || '',
      startedAt: existingRun.startedAt || existingRun.createdAt,
      experiments: input.experiments ?? [],
      sshConfig: withSshConfigDefaults(input.sshConfig),
      telegramConfig: { ...defaultTelegramConfig, ...input.telegramConfig },
      liveOutput: input.liveOutput ?? existingRun.liveOutputExcerpt ?? '',
      selectedExperiment: -1,
      errorMessage: undefined,
      statusMessage: undefined,
      reason: undefined,
      agentConfigSnapshot: input.agentConfigSnapshot,
      terminalVisible: false,
      terminalReady: false,
      terminalSessionId: null,
      terminalCwd: input.sshConfig.remoteWorkDir || '',
      runHistory: updateRunRecord(state.runHistory, input.runId, (run) => ({
        ...run,
        status: 'running',
        updatedAt: resumedAt,
        endedAt: undefined,
        summary: 'Run resumed from recovery snapshot.',
        reason: undefined,
        currentIteration: restoredCurrentIteration,
        resumeToken: restoredResumeToken,
        events: [...run.events, createRunEvent(run.id, {
          timestamp: resumedAt,
          level: 'info',
          phase: 'system',
          type: 'run_status_changed',
          message: 'Run resumed from recovery token.',
          summary: 'Run resumed from recovery token.',
          metadata: {
            pendingIteration: input.pendingIteration,
          },
          // AUDIT-FIX [audit-2-ar#8]: see `addRunEvent` above — both paths
          // now use the same 100-event cap as `MAX_PERSISTED_EVENTS_PER_RUN`.
        })].slice(-100),
      })),
      selectedRunId: input.runId,
      showSetupModal: false,
    };
  }),

  setShowSetupModal: (showSetupModal) => set({ showSetupModal }),
}));


connectAutoResearchPersistence({
  getState: () => useAutoResearchStore.getState(),
  subscribe: (listener) => useAutoResearchStore.subscribe((state) => listener(state)),
});

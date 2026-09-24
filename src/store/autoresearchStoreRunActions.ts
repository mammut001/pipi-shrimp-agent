import type { StateCreator } from 'zustand';
import type { AutoResearchStore } from './autoresearchStoreTypes';
import {
  buildRunRecordFromInit,
  createEmptySession,
  createRunEvent,
  defaultTelegramConfig,
  getFallbackSelectedRunId,
  updateRunRecord,
  upsertRunRecord,
} from './autoresearchStoreRecords';
import { stopExperimentLoop } from '@/services/autoresearch/loopEngine';
import { patchAutoResearchResumeToken } from '@/services/autoresearch/resumeToken';
import { withSshConfigDefaults } from '@/types/ssh';

type AutoResearchStoreSet = Parameters<StateCreator<AutoResearchStore>>[0];
type AutoResearchStoreGet = Parameters<StateCreator<AutoResearchStore>>[1];
type AutoResearchRunActions = Pick<AutoResearchStore,
  | 'initSession'
  | 'resetSession'
  | 'selectRun'
  | 'deleteRun'
  | 'deleteRuns'
  | 'activateHistoricalRun'
>;

export const createAutoResearchRunActions: (
  set: AutoResearchStoreSet,
  get: AutoResearchStoreGet,
) => AutoResearchRunActions = (set, get) => ({
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
});

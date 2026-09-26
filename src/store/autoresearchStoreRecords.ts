import type { AutoResearchAgentConfigSnapshot } from '@/services/autoresearch/errors';
import {
  redactAutoResearchSensitiveText,
  toHistoryConfigSnapshot,
  type AutoResearchIterationRecord,
  type AutoResearchRunEvent,
  type AutoResearchRunPhase,
  type AutoResearchRunRecord,
  type AutoResearchRunStatus,
} from '@/services/autoresearch/history';
import { createAutoResearchResumeToken } from '@/services/autoresearch/resumeToken';
import type { SshConfig } from '@/types/ssh';
import type {
  AutoResearchSelectedRunContext,
  AutoResearchStore,
  ExperimentEntry,
  ExperimentSession,
  ExperimentStatus,
  LoopState,
  TelegramNotifyConfig,
} from './autoresearchStoreTypes';
import { sortRuns } from '../services/autoresearch/historyNormalize';

export const defaultTelegramConfig: TelegramNotifyConfig = {
  enabled: false,
  chatId: null,
  notifyOnImproved: true,
  notifyOnFailed: true,
  trendReportInterval: 10,
};

export function createEmptySession(): Omit<ExperimentSession, 'runHistory' | 'selectedRunId' | 'lastUsedConfig'> {
  return {
    id: '',
    loopState: 'idle',
    currentIteration: 0,
    maxIterations: 50,
    bestMetric: null,
    metricDirection: 'lower',
    metricName: 'val_bpb',
    successCriteria: '',
    bootstrapKind: null,
    consecutiveFailures: 0,
    experimentDir: '',
    sessionFilePath: '',
    livingDocPath: '',
    startedAt: '',
    experiments: [],
    sshConfig: null,
    telegramConfig: { ...defaultTelegramConfig },
    liveOutput: '',
    selectedExperiment: -1,
    statusMessage: undefined,
    reason: undefined,
    agentConfigSnapshot: undefined,
    terminalVisible: false,
    terminalReady: false,
    terminalSessionId: null,
    terminalCwd: '',
    errorMessage: undefined,
  };
}

export { sortRuns };

export function upsertRunRecord(runs: AutoResearchRunRecord[], record: AutoResearchRunRecord): AutoResearchRunRecord[] {
  const next = runs.some((run) => run.id === record.id)
    ? runs.map((run) => (run.id === record.id ? record : run))
    : [record, ...runs];
  return sortRuns(next);
}

export function updateRunRecord(
  runs: AutoResearchRunRecord[],
  runId: string,
  updater: (run: AutoResearchRunRecord) => AutoResearchRunRecord,
): AutoResearchRunRecord[] {
  let updated = false;
  const next = runs.map((run) => {
    if (run.id !== runId) {
      return run;
    }
    updated = true;
    return updater(run);
  });
  return updated ? sortRuns(next) : runs;
}

export function createRunEvent(
  runId: string,
  input: Omit<AutoResearchRunEvent, 'id' | 'runId' | 'timestamp'> & { timestamp?: string },
): AutoResearchRunEvent {
  const timestamp = input.timestamp ?? new Date().toISOString();
  return {
    id: `${runId}-event-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    runId,
    iterationId: input.iterationId,
    timestamp,
    level: input.level,
    phase: input.phase,
    type: input.type,
    message: redactAutoResearchSensitiveText(input.message),
    summary: sanitizeOptionalText(input.summary),
    detail: input.detail,
    metadata: input.metadata,
  };
}

export function sanitizeOptionalText(value: string | undefined): string | undefined {
  return value === undefined ? undefined : redactAutoResearchSensitiveText(value);
}

export function mapExperimentStatusToIterationStatus(status: ExperimentStatus): AutoResearchIterationRecord['status'] {
  switch (status) {
    case 'FAILED':
      return 'failed';
    case 'IMPROVED':
    case 'NOT_IMPROVED':
    default:
      return 'completed';
  }
}

export function toIterationRecord(entry: ExperimentEntry, existing?: AutoResearchIterationRecord): AutoResearchIterationRecord {
  return {
    id: existing?.id ?? `iter-${entry.iteration}`,
    index: entry.iteration,
    status: mapExperimentStatusToIterationStatus(entry.status),
    hypothesis: redactAutoResearchSensitiveText(entry.hypothesis),
    change: redactAutoResearchSensitiveText(entry.change),
    reasoning: entry.reasoning ? redactAutoResearchSensitiveText(entry.reasoning) : existing?.reasoning,
    metricValue: entry.metricValue,
    error: entry.failReason ? redactAutoResearchSensitiveText(entry.failReason) : existing?.error ?? null,
    commitHash: existing?.commitHash,
    startedAt: existing?.startedAt,
    endedAt: entry.timestamp,
    artifactPaths: existing?.artifactPaths,
    improvement: existing?.improvement,
  };
}

export function isBetterMetric(direction: 'lower' | 'higher', candidate: number, current: number | null | undefined): boolean {
  if (current === null || current === undefined) {
    return true;
  }
  return direction === 'lower' ? candidate < current : candidate > current;
}

export function buildRunRecordFromInit(opts: {
  id: string;
  createdAt: string;
  maxIterations: number;
  metricName: string;
  metricDirection: 'lower' | 'higher';
  sshConfig: SshConfig;
  experimentDir?: string;
  sessionFilePath?: string;
  livingDocPath?: string;
  baseline?: number | null;
  agentConfigSnapshot?: AutoResearchAgentConfigSnapshot;
  preferredPythonCommand?: string;
  repoStatus?: 'clean' | 'dirty';
  dirtyFileCount?: number;
  gpuTelemetryAvailable?: boolean;
  gpuSummary?: string;
  gpuTemperatureC?: number | null;
  gpuFanSpeedPercent?: number | null;
  gpuUtilizationPercent?: number | null;
  gpuMemoryUsedMb?: number | null;
  gpuMemoryTotalMb?: number | null;
}): AutoResearchRunRecord {
  return {
    id: opts.id,
    title: `${opts.metricName} · ${opts.experimentDir || opts.sshConfig.remoteWorkDir || 'AutoResearch'}`,
    status: 'running',
    createdAt: opts.createdAt,
    updatedAt: opts.createdAt,
    startedAt: opts.createdAt,
    currentPhase: 'INIT',
    config: {
      experimentDir: opts.experimentDir || opts.sshConfig.remoteWorkDir || '',
      workdir: opts.sshConfig.remoteWorkDir || '',
      sessionFilePath: opts.sessionFilePath || undefined,
      livingDocPath: opts.livingDocPath || undefined,
      metric: opts.metricName,
      direction: opts.metricDirection,
      iterations: opts.maxIterations,
      baseline: opts.baseline ?? null,
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
      configSnapshot: toHistoryConfigSnapshot(opts.agentConfigSnapshot),
    },
    currentIteration: 0,
    bestMetricValue: opts.baseline ?? null,
    bestIteration: opts.baseline !== null && opts.baseline !== undefined ? 0 : null,
    failureCount: 0,
    iterations: [],
    events: [],
    summary: undefined,
    reason: undefined,
    liveOutputExcerpt: '',
    resumeToken: createAutoResearchResumeToken({
      sessionId: opts.id,
      sshConfig: opts.sshConfig,
      experimentDir: opts.experimentDir || opts.sshConfig.remoteWorkDir || '',
      sessionFilePath: opts.sessionFilePath,
      livingDocPath: opts.livingDocPath,
      metricName: opts.metricName,
      metricDirection: opts.metricDirection,
      maxIterations: opts.maxIterations,
      baseline: opts.baseline ?? null,
      createdAt: opts.createdAt,
    }),
  };
}

export function getFallbackSelectedRunId(runs: AutoResearchRunRecord[], currentId?: string | null): string | null {
  return currentId || runs[0]?.id || null;
}

export function getSortedAutoResearchRuns(state: Pick<ExperimentSession, 'runHistory'>): AutoResearchRunRecord[] {
  return sortRuns(state.runHistory);
}

export function getSelectedAutoResearchRun(
  state: Pick<ExperimentSession, 'runHistory' | 'selectedRunId' | 'id'>,
): AutoResearchRunRecord | null {
  const targetId = state.selectedRunId || state.id;
  if (!targetId) {
    return state.runHistory[0] ?? null;
  }
  return state.runHistory.find((run) => run.id === targetId) ?? state.runHistory[0] ?? null;
}

export function getActiveAutoResearchRun(
  state: Pick<ExperimentSession, 'runHistory' | 'id'>,
): AutoResearchRunRecord | null {
  if (!state.id) {
    return null;
  }
  return state.runHistory.find((run) => run.id === state.id) ?? null;
}

export function isAutoResearchTerminalState(status: AutoResearchRunStatus | null | undefined): boolean {
  return Boolean(status && ['reflection_failed', 'failed', 'completed', 'stopped', 'interrupted'].includes(status));
}

export function getAutoResearchRunReason(
  state: Pick<ExperimentSession, 'runHistory' | 'id' | 'reason' | 'errorMessage'>,
): string | undefined {
  return getActiveAutoResearchRun(state)?.reason ?? state.reason ?? state.errorMessage;
}

export function mapRunStatusToLoopState(status: AutoResearchRunStatus | undefined): LoopState {
  switch (status) {
    case 'running':
    case 'waiting_rate_limit':
      return 'running';
    case 'paused':
      return 'paused';
    case 'reflection_failed':
    case 'failed':
      return 'error';
    case 'stopped':
    case 'completed':
    case 'interrupted':
      return 'stopped';
    case 'draft':
    default:
      return 'idle';
  }
}

export function getSelectedAutoResearchRunContext(
  state: Pick<ExperimentSession, 'runHistory' | 'selectedRunId' | 'id' | 'liveOutput' | 'errorMessage' | 'reason' | 'statusMessage' | 'loopState' | 'selectedExperiment'>,
): AutoResearchSelectedRunContext {
  const run = getSelectedAutoResearchRun(state);
  const isActive = Boolean(run && state.id && run.id === state.id);
  const iterations = run?.iterations ?? [];
  const selectedIterationIndex = state.selectedExperiment >= 0 && state.selectedExperiment < iterations.length
    ? state.selectedExperiment
    : -1;

  return {
    run,
    isActive,
    liveOutput: isActive ? state.liveOutput : (run?.liveOutputExcerpt || ''),
    reason: isActive ? (run?.reason ?? state.reason ?? state.errorMessage) : run?.reason,
    statusMessage: isActive ? state.statusMessage : undefined,
    loopState: isActive ? state.loopState : mapRunStatusToLoopState(run?.status),
    selectedIterationIndex,
  };
}

export function withActiveRunUpdate(
  state: AutoResearchStore,
  updater: (run: AutoResearchRunRecord) => AutoResearchRunRecord,
): Pick<AutoResearchStore, 'runHistory'> {
  if (!state.id) {
    return { runHistory: state.runHistory };
  }
  return {
    runHistory: updateRunRecord(state.runHistory, state.id, updater),
  };
}

/**
 * AutoResearch Store — Zustand state for the autonomous experiment loop.
 *
 * Manages the live run state plus persistent run history used by the
 * AutoResearch page and agent panel.
 */

import { create } from 'zustand';
import type { AutoResearchAgentConfigSnapshot } from '@/services/autoresearch/errors';
import {
  clipLiveOutputExcerpt,
  loadPersistedAutoResearchHistory,
  persistAutoResearchHistory,
  toHistoryConfigSnapshot,
  type AutoResearchIterationRecord,
  type AutoResearchRunEvent,
  type AutoResearchRunRecord,
  type AutoResearchRunStatus,
} from '@/services/autoresearch/history';

export type { AutoResearchIterationRecord, AutoResearchRunRecord, AutoResearchRunStatus } from '@/services/autoresearch/history';

// ============== Types ==============

export type ExperimentStatus = 'IMPROVED' | 'NOT_IMPROVED' | 'FAILED';
export type LoopState = 'idle' | 'running' | 'paused' | 'stopped' | 'error';

export interface ExperimentEntry {
  iteration: number;
  hypothesis: string;
  change: string;
  metricValue: number | null;
  status: ExperimentStatus;
  failReason?: string;
  reasoning: string;
  timestamp: string;
  durationMs: number;
}

export type ExecMode = 'local' | 'ssh';
export type SshAuthMode = 'agent' | 'password' | 'key';

export interface SshConfig {
  mode: ExecMode;
  host: string;
  user: string;
  keyPath: string;
  port: number;
  remoteWorkDir: string;
  authMode: SshAuthMode;
  password: string;
}

export function withSshConfigDefaults(partial: Partial<SshConfig> | null | undefined): SshConfig {
  return {
    mode: partial?.mode ?? 'ssh',
    host: partial?.host ?? '',
    user: partial?.user ?? '',
    keyPath: partial?.keyPath ?? '',
    port: partial?.port ?? 22,
    remoteWorkDir: partial?.remoteWorkDir ?? '',
    authMode: partial?.authMode ?? 'agent',
    password: partial?.password ?? '',
  };
}

export interface TelegramNotifyConfig {
  enabled: boolean;
  chatId: number | null;
  notifyOnImproved: boolean;
  notifyOnFailed: boolean;
  trendReportInterval: number;
}

export interface ExperimentSession {
  id: string;
  loopState: LoopState;
  currentIteration: number;
  maxIterations: number;
  bestMetric: number | null;
  metricDirection: 'lower' | 'higher';
  metricName: string;
  consecutiveFailures: number;
  experimentDir: string;
  sessionFilePath: string;
  livingDocPath: string;
  startedAt: string;
  experiments: ExperimentEntry[];
  sshConfig: SshConfig | null;
  telegramConfig: TelegramNotifyConfig;
  liveOutput: string;
  selectedExperiment: number;
  errorMessage?: string;
  statusMessage?: string;
  agentConfigSnapshot?: AutoResearchAgentConfigSnapshot;
  terminalVisible: boolean;
  terminalReady: boolean;
  terminalSessionId: string | null;
  terminalCwd: string;
  runHistory: AutoResearchRunRecord[];
  selectedRunId: string | null;
}

const defaultTelegramConfig: TelegramNotifyConfig = {
  enabled: false,
  chatId: null,
  notifyOnImproved: true,
  notifyOnFailed: true,
  trendReportInterval: 10,
};

const persistedHistory = loadPersistedAutoResearchHistory();

function createEmptySession(): Omit<ExperimentSession, 'runHistory' | 'selectedRunId'> {
  return {
    id: '',
    loopState: 'idle',
    currentIteration: 0,
    maxIterations: 50,
    bestMetric: null,
    metricDirection: 'lower',
    metricName: 'val_bpb',
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
    agentConfigSnapshot: undefined,
    terminalVisible: false,
    terminalReady: false,
    terminalSessionId: null,
    terminalCwd: '',
    errorMessage: undefined,
  };
}

function sortRuns(runs: AutoResearchRunRecord[]): AutoResearchRunRecord[] {
  return [...runs].sort((a, b) => {
    const byUpdated = b.updatedAt.localeCompare(a.updatedAt);
    return byUpdated !== 0 ? byUpdated : b.createdAt.localeCompare(a.createdAt);
  });
}

function upsertRunRecord(runs: AutoResearchRunRecord[], record: AutoResearchRunRecord): AutoResearchRunRecord[] {
  const next = runs.some((run) => run.id === record.id)
    ? runs.map((run) => (run.id === record.id ? record : run))
    : [record, ...runs];
  return sortRuns(next);
}

function updateRunRecord(
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

function createRunEvent(
  runId: string,
  input: Omit<AutoResearchRunEvent, 'id' | 'runId' | 'timestamp'> & { timestamp?: string },
): AutoResearchRunEvent {
  const timestamp = input.timestamp ?? new Date().toISOString();
  return {
    id: `${runId}-event-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    runId,
    timestamp,
    level: input.level,
    phase: input.phase,
    message: input.message,
    metadata: input.metadata,
  };
}

function mapExperimentStatusToIterationStatus(status: ExperimentStatus): AutoResearchIterationRecord['status'] {
  switch (status) {
    case 'FAILED':
      return 'failed';
    case 'IMPROVED':
    case 'NOT_IMPROVED':
    default:
      return 'completed';
  }
}

function toIterationRecord(entry: ExperimentEntry, existing?: AutoResearchIterationRecord): AutoResearchIterationRecord {
  return {
    id: existing?.id ?? `iter-${entry.iteration}`,
    index: entry.iteration,
    status: mapExperimentStatusToIterationStatus(entry.status),
    hypothesis: entry.hypothesis,
    change: entry.change,
    reasoning: entry.reasoning || existing?.reasoning,
    metricValue: entry.metricValue,
    error: entry.failReason ?? existing?.error ?? null,
    commitHash: existing?.commitHash,
    startedAt: existing?.startedAt,
    endedAt: entry.timestamp,
    artifactPaths: existing?.artifactPaths,
    improvement: existing?.improvement,
  };
}

function isBetterMetric(direction: 'lower' | 'higher', candidate: number, current: number | null | undefined): boolean {
  if (current === null || current === undefined) {
    return true;
  }
  return direction === 'lower' ? candidate < current : candidate > current;
}

function buildRunRecordFromInit(opts: {
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
}): AutoResearchRunRecord {
  return {
    id: opts.id,
    title: `${opts.metricName} · ${opts.experimentDir || opts.sshConfig.remoteWorkDir || 'AutoResearch'}`,
    status: 'running',
    createdAt: opts.createdAt,
    updatedAt: opts.createdAt,
    startedAt: opts.createdAt,
    config: {
      experimentDir: opts.experimentDir || opts.sshConfig.remoteWorkDir || '',
      workdir: opts.sshConfig.remoteWorkDir || '',
      sessionFilePath: opts.sessionFilePath || undefined,
      livingDocPath: opts.livingDocPath || undefined,
      metric: opts.metricName,
      direction: opts.metricDirection,
      iterations: opts.maxIterations,
      baseline: opts.baseline ?? null,
      configSnapshot: toHistoryConfigSnapshot(opts.agentConfigSnapshot),
    },
    currentIteration: 0,
    bestMetricValue: opts.baseline ?? null,
    bestIteration: opts.baseline !== null && opts.baseline !== undefined ? 0 : null,
    failureCount: 0,
    iterations: [],
    events: [],
    summary: undefined,
    liveOutputExcerpt: '',
  };
}

function getFallbackSelectedRunId(runs: AutoResearchRunRecord[], currentId?: string | null): string | null {
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

interface AutoResearchStore extends ExperimentSession {
  initSession: (opts: {
    id: string;
    maxIterations: number;
    metricName: string;
    metricDirection: 'lower' | 'higher';
    sshConfig: SshConfig;
    experimentDir?: string;
    sessionFilePath?: string;
    livingDocPath?: string;
    baseline?: number | null;
    agentConfigSnapshot?: AutoResearchAgentConfigSnapshot;
    telegramConfig?: Partial<TelegramNotifyConfig>;
  }) => void;
  resetSession: () => void;
  selectRun: (runId: string) => void;
  setLoopState: (state: LoopState) => void;
  setRunStatus: (status: AutoResearchRunStatus, options?: { summary?: string; endedAt?: string }) => void;
  setError: (msg: string) => void;
  setStatusMessage: (msg?: string) => void;
  updateRunPaths: (paths: { sshConfig?: SshConfig; experimentDir?: string; sessionFilePath?: string; livingDocPath?: string; terminalCwd?: string }) => void;
  incrementIteration: () => void;
  addExperiment: (entry: ExperimentEntry) => void;
  startIterationRecord: (input: { iteration: number; startedAt: string; artifactPaths: string[] }) => void;
  completeIterationRecord: (input: {
    iteration: number;
    status: AutoResearchIterationRecord['status'];
    hypothesis?: string;
    change?: string;
    reasoning?: string;
    metricValue?: number | null;
    improvement?: number | null;
    commitHash?: string;
    error?: string | null;
    endedAt?: string;
    artifactPaths?: string[];
  }) => void;
  addRunEvent: (input: Omit<AutoResearchRunEvent, 'id' | 'runId' | 'timestamp'> & { timestamp?: string }) => void;
  updateBestMetric: (value: number) => void;
  setBestMetric: (value: number | null) => void;
  setCurrentIterationValue: (iteration: number) => void;
  incrementConsecutiveFailures: () => void;
  resetConsecutiveFailures: () => void;
  setExperiments: (entries: ExperimentEntry[]) => void;
  setLiveOutput: (output: string) => void;
  appendLiveOutput: (chunk: string) => void;
  setSelectedExperiment: (idx: number) => void;
  openTerminalPanel: (sessionId: string, cwd: string) => void;
  setTerminalReady: (ready: boolean) => void;
  setTerminalVisible: (visible: boolean) => void;
  setTerminalCwd: (cwd: string) => void;
  setSshConfig: (cfg: SshConfig) => void;
  setTelegramConfig: (cfg: Partial<TelegramNotifyConfig>) => void;
  showSetupModal: boolean;
  setShowSetupModal: (show: boolean) => void;
}

function withActiveRunUpdate(
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

export const useAutoResearchStore = create<AutoResearchStore>((set) => ({
  ...createEmptySession(),
  runHistory: persistedHistory.runs,
  selectedRunId: persistedHistory.selectedRunId,
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
    });
    nextRun.events = [
      createRunEvent(opts.id, {
        level: 'info',
        phase: 'system',
        message: 'Run initialized.',
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
    showSetupModal: state.showSetupModal,
  })),

  selectRun: (runId) => set((state) => ({
    selectedRunId: state.runHistory.some((run) => run.id === runId) ? runId : state.selectedRunId,
    selectedExperiment: -1,
  })),

  setLoopState: (loopState) => set({ loopState }),

  setRunStatus: (status, options) => set((state) => ({
    ...withActiveRunUpdate(state, (run) => ({
      ...run,
      status,
      updatedAt: options?.endedAt ?? new Date().toISOString(),
      endedAt: options?.endedAt ?? (status === 'running' ? undefined : run.endedAt ?? new Date().toISOString()),
      summary: options?.summary ?? run.summary,
    })),
  })),

  setError: (msg) => set((state) => {
    const endedAt = new Date().toISOString();
    return {
      loopState: 'error',
      errorMessage: msg,
      statusMessage: undefined,
      ...withActiveRunUpdate(state, (run) => ({
        ...run,
        status: 'failed',
        updatedAt: endedAt,
        endedAt,
        summary: msg,
        events: [...run.events, createRunEvent(run.id, {
          timestamp: endedAt,
          level: 'error',
          phase: 'system',
          message: msg,
        })],
      })),
    };
  }),

  setStatusMessage: (msg) => set((state) => ({
    statusMessage: msg,
    ...withActiveRunUpdate(state, (run) => ({
      ...run,
      updatedAt: new Date().toISOString(),
      summary: msg ?? run.summary,
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

      return {
        ...run,
        updatedAt: entry.timestamp,
        failureCount: entry.status === 'FAILED' ? run.failureCount + 1 : 0,
        iterations: nextIterations,
        bestMetricValue: shouldUpdateBest ? entry.metricValue : run.bestMetricValue ?? null,
        bestIteration: shouldUpdateBest ? entry.iteration : run.bestIteration,
        summary: entry.failReason ?? run.summary,
      };
    }),
  })),

  startIterationRecord: (input) => set((state) => ({
    runHistory: updateRunRecord(state.runHistory, state.id, (run) => {
      const nextRecord: AutoResearchIterationRecord = {
        id: `${run.id}-iter-${input.iteration}`,
        index: input.iteration,
        status: 'running',
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
        hypothesis: input.hypothesis ?? existing?.hypothesis,
        change: input.change ?? existing?.change,
        reasoning: input.reasoning ?? existing?.reasoning,
        metricValue: input.metricValue ?? existing?.metricValue,
        improvement: input.improvement ?? existing?.improvement,
        commitHash: input.commitHash ?? existing?.commitHash,
        error: input.error ?? existing?.error ?? null,
        startedAt: existing?.startedAt,
        endedAt: input.endedAt ?? existing?.endedAt,
        artifactPaths: input.artifactPaths ?? existing?.artifactPaths,
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
      events: [...run.events, createRunEvent(run.id, input)].slice(-200),
    })),
  })),

  updateBestMetric: (value) => set((state) => ({
    bestMetric: value,
    consecutiveFailures: 0,
    ...withActiveRunUpdate(state, (run) => ({
      ...run,
      updatedAt: new Date().toISOString(),
      bestMetricValue: value,
      bestIteration: state.currentIteration || run.bestIteration,
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

  setCurrentIterationValue: (iteration) => set((state) => ({
    currentIteration: iteration,
    ...withActiveRunUpdate(state, (run) => ({
      ...run,
      updatedAt: new Date().toISOString(),
      currentIteration: iteration,
    })),
  })),

  incrementConsecutiveFailures: () => set((state) => ({
    consecutiveFailures: state.consecutiveFailures + 1,
    ...withActiveRunUpdate(state, (run) => ({
      ...run,
      updatedAt: new Date().toISOString(),
      failureCount: state.consecutiveFailures + 1,
    })),
  })),

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
    liveOutput: output,
    ...withActiveRunUpdate(state, (run) => ({
      ...run,
      updatedAt: new Date().toISOString(),
      liveOutputExcerpt: clipLiveOutputExcerpt(output),
    })),
  })),

  appendLiveOutput: (chunk) => set((state) => {
    const liveOutput = state.liveOutput + chunk;
    return {
      liveOutput,
      ...withActiveRunUpdate(state, (run) => ({
        ...run,
        updatedAt: new Date().toISOString(),
        liveOutputExcerpt: clipLiveOutputExcerpt((run.liveOutputExcerpt || '') + chunk),
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
  setTelegramConfig: (cfg) => set((state) => ({
    telegramConfig: { ...state.telegramConfig, ...cfg },
  })),

  setShowSetupModal: (showSetupModal) => set({ showSetupModal }),
}));

useAutoResearchStore.subscribe((state) => {
  persistAutoResearchHistory(state.runHistory, state.selectedRunId);
});

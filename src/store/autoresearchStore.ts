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
  redactAutoResearchSensitiveText,
  toHistoryConfigSnapshot,
  type AutoResearchIterationRecord,
  type AutoResearchMode,
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
import {
  createAutoResearchResumeToken,
  patchAutoResearchResumeToken,
} from '@/services/autoresearch/resumeToken';
import { withSshConfigDefaults } from '@/types/ssh';
import type { ExecMode, SshAuthMode, SshConfig } from '@/types/ssh';

export type { AutoResearchIterationRecord, AutoResearchRunRecord, AutoResearchRunStatus } from '@/services/autoresearch/history';

// ============== Shared SSH Types ==============
// Imported from centralized types to avoid duplication
export type { SshConfig, ExecMode, SshAuthMode };
export { withSshConfigDefaults };

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
  successCriteria: string;
  bootstrapKind: 'conversational' | 'manual' | null;
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
  reason?: string;
  agentConfigSnapshot?: AutoResearchAgentConfigSnapshot;
  terminalVisible: boolean;
  terminalReady: boolean;
  terminalSessionId: string | null;
  terminalCwd: string;
  runHistory: AutoResearchRunRecord[];
  selectedRunId: string | null;
  lastUsedConfig: AutoResearchDefaultConfig | null;
  autoResearchMode: AutoResearchMode;
  verificationCommands: string[];
}

const defaultTelegramConfig: TelegramNotifyConfig = {
  enabled: false,
  chatId: null,
  notifyOnImproved: true,
  notifyOnFailed: true,
  trendReportInterval: 10,
};

const persistedHistory = loadPersistedAutoResearchHistory();
const persistedLastUsedConfig = loadPersistedAutoResearchLastUsedConfig();

function createEmptySession(): Omit<ExperimentSession, 'runHistory' | 'selectedRunId' | 'lastUsedConfig'> {
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
    autoResearchMode: 'ml_experiment',
    verificationCommands: ['pnpm run build', 'pnpm test', 'node_modules/.bin/tsc --noEmit'],
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

function sanitizeOptionalText(value: string | undefined): string | undefined {
  return value === undefined ? undefined : redactAutoResearchSensitiveText(value);
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
  autoResearchMode?: AutoResearchMode;
  verificationCommands?: string[];
}): AutoResearchRunRecord {
  const mode = opts.autoResearchMode ?? 'ml_experiment';
  const titlePrefix = mode === 'repo_self_improve' ? 'Self-Improve' : opts.metricName;
  return {
    id: opts.id,
    title: `${titlePrefix} · ${opts.experimentDir || opts.sshConfig.remoteWorkDir || 'AutoResearch'}`,
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
      configSnapshot: toHistoryConfigSnapshot(opts.agentConfigSnapshot),
      mode,
      verificationCommands: opts.verificationCommands,
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

function mapRunStatusToLoopState(status: AutoResearchRunStatus | undefined): LoopState {
  switch (status) {
    case 'running':
    case 'waiting_rate_limit':
      return 'running';
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

export interface AutoResearchSelectedRunContext {
  run: AutoResearchRunRecord | null;
  isActive: boolean;
  liveOutput: string;
  reason?: string;
  statusMessage?: string;
  loopState: LoopState;
  selectedIterationIndex: number;
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
  setAutoResearchMode: (mode: AutoResearchMode) => void;
  setVerificationCommands: (commands: string[]) => void;
  setCurrentPhase: (phase?: AutoResearchRunPhase) => void;
  setRunStatus: (status: AutoResearchRunStatus, options?: { summary?: string; endedAt?: string; reason?: string }) => void;
  setReflectionFailed: (reason: string, options?: { summary?: string; endedAt?: string }) => void;
  setError: (msg: string) => void;
  patchActiveRunResumeToken: (patch: Partial<Omit<AutoResearchResumeToken, 'schemaVersion' | 'sessionId' | 'createdAt'>>) => void;
  clearActiveRunResumeToken: () => void;
  setStatusMessage: (msg?: string) => void;
  updateRunPaths: (paths: { sshConfig?: SshConfig; experimentDir?: string; sessionFilePath?: string; livingDocPath?: string; terminalCwd?: string }) => void;
  incrementIteration: () => void;
  addExperiment: (entry: ExperimentEntry) => void;
  startIterationRecord: (input: { iteration: number; startedAt: string; artifactPaths: string[] }) => void;
  completeIterationRecord: (input: {
    iteration: number;
    status: AutoResearchIterationRecord['status'];
    phase?: AutoResearchIterationRecord['phase'];
    hypothesis?: string;
    change?: string;
    reasoning?: string;
    narrative?: string;
    codeChangesSummary?: string;
    executionCommand?: string;
    exitCode?: number | null;
    durationMs?: number | null;
    parsedMetrics?: Record<string, number | string | boolean | null>;
    reflectionSummary?: string;
    metricValue?: number | null;
    improvement?: number | null;
    commitHash?: string;
    error?: string | null;
    endedAt?: string;
    artifactPaths?: string[];
    recoveryActions?: AutoResearchRecoveryAction[];
  }) => void;
  patchIterationRecord: (input: {
    iteration: number;
    status?: AutoResearchIterationRecord['status'];
    phase?: AutoResearchIterationRecord['phase'];
    hypothesis?: string;
    change?: string;
    reasoning?: string;
    narrative?: string;
    codeChangesSummary?: string;
    executionCommand?: string;
    exitCode?: number | null;
    durationMs?: number | null;
    parsedMetrics?: Record<string, number | string | boolean | null>;
    reflectionSummary?: string;
    metricValue?: number | null;
    improvement?: number | null;
    commitHash?: string;
    error?: string | null;
    endedAt?: string;
    artifactPaths?: string[];
    recoveryActions?: AutoResearchRecoveryAction[];
  }) => void;
  addRunEvent: (input: Omit<AutoResearchRunEvent, 'id' | 'runId' | 'timestamp'> & { timestamp?: string }) => void;
  updateBestMetric: (value: number) => void;
  setBestMetric: (value: number | null) => void;
  setPrimaryMetric: (metricName: string) => void;
  setSuccessCriteria: (successCriteria: string) => void;
  setBootstrapKind: (bootstrapKind: ExperimentSession['bootstrapKind']) => void;
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
  setLastUsedConfig: (config: AutoResearchDefaultConfig) => void;
  clearLastUsedConfig: () => void;
  setTelegramConfig: (cfg: Partial<TelegramNotifyConfig>) => void;
  activateHistoricalRun: (input: {
    runId: string;
    sshConfig: SshConfig;
    experimentDir: string;
    sessionFilePath?: string;
    livingDocPath?: string;
    metricName: string;
    metricDirection: 'lower' | 'higher';
    maxIterations: number;
    baseline?: number | null;
    pendingIteration: number;
    agentConfigSnapshot?: AutoResearchAgentConfigSnapshot;
    resumeToken?: AutoResearchResumeToken;
    experiments?: ExperimentEntry[];
    liveOutput?: string;
    telegramConfig?: Partial<TelegramNotifyConfig>;
  }) => void;
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
      autoResearchMode: state.autoResearchMode,
      verificationCommands: state.verificationCommands,
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

  setLoopState: (loopState) => set({ loopState }),
  setAutoResearchMode: (autoResearchMode) => set({ autoResearchMode }),
  setVerificationCommands: (verificationCommands) => set({ verificationCommands }),

  setCurrentPhase: (currentPhase) => set((state) => ({
    ...withActiveRunUpdate(state, (run) => ({
      ...run,
      updatedAt: new Date().toISOString(),
      currentPhase,
    })),
  })),

  setRunStatus: (status, options) => set((state) => {
    const updatedAt = options?.endedAt ?? new Date().toISOString();
    const clearReason = ['running', 'waiting_rate_limit', 'completed', 'stopped'].includes(status);
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
          : patchAutoResearchResumeToken(run.resumeToken, { status: status as "running" | "paused" | "waiting_rate_limit" | "interrupted" }, updatedAt),
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

  setError: (msg) => set((state) => {
    const endedAt = new Date().toISOString();
    const sanitizedMessage = redactAutoResearchSensitiveText(msg);
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

      return {
        ...run,
        updatedAt: entry.timestamp,
        failureCount: entry.status === 'FAILED' ? run.failureCount + 1 : 0,
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
  setLastUsedConfig: (config) => set({ lastUsedConfig: buildAutoResearchDefaultConfig(config) }),
  clearLastUsedConfig: () => set({ lastUsedConfig: null }),
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
      autoResearchMode: existingRun.config.mode ?? 'ml_experiment',
      verificationCommands: existingRun.config.verificationCommands ?? ['pnpm run build', 'pnpm test', 'node_modules/.bin/tsc --noEmit'],
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
        })].slice(-200),
      })),
      selectedRunId: input.runId,
      showSetupModal: false,
    };
  }),

  setShowSetupModal: (showSetupModal) => set({ showSetupModal }),
}));

useAutoResearchStore.subscribe((state) => {
  persistAutoResearchHistory(state.runHistory, state.selectedRunId);
  persistAutoResearchLastUsedConfig(state.lastUsedConfig);
});

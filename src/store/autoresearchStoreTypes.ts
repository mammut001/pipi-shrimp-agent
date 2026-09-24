import type { AutoResearchAgentConfigSnapshot } from '@/services/autoresearch/errors';
import type {
  AutoResearchIterationRecord,
  AutoResearchRecoveryAction,
  AutoResearchResumeToken,
  AutoResearchRunEvent,
  AutoResearchRunPhase,
  AutoResearchRunRecord,
  AutoResearchRunStatus,
} from '@/services/autoresearch/history';
import type { AutoResearchDefaultConfig } from '@/services/autoresearch/defaultConfig';
import type { SshConfig } from '@/types/ssh';

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

export interface AutoResearchStore extends ExperimentSession {
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
    telegramConfig?: Partial<TelegramNotifyConfig>;
  }) => void;
  resetSession: () => void;
  selectRun: (runId: string) => void;
  deleteRun: (runId: string) => void;
  deleteRuns: (runIds: string[]) => void;
  setLoopState: (state: LoopState) => void;
  setCurrentPhase: (phase?: AutoResearchRunPhase) => void;
  setRunStatus: (status: AutoResearchRunStatus, options?: { summary?: string; endedAt?: string; reason?: string }) => void;
  setReflectionFailed: (reason: string, options?: { summary?: string; endedAt?: string }) => void;
  acknowledgeReflectionFailure: () => void;
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

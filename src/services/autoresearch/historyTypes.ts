import type { AutoResearchAgentConfigSnapshot, AutoResearchConfigSource } from './errors';
import type { SshConfig } from '@/types/ssh';

export type AutoResearchRunStatus =
  | 'draft'
  | 'running'
  | 'waiting_rate_limit'
  | 'paused'
  | 'reflection_failed'
  | 'stopped'
  | 'failed'
  | 'completed'
  | 'interrupted';

export type AutoResearchIterationStatus = 'pending' | 'running' | 'failed' | 'completed' | 'skipped';

export type AutoResearchRunPhase =
  | 'INIT'
  | 'READ_CONTEXT'
  | 'PLAN_HYPOTHESIS'
  | 'EDIT_CODE'
  | 'RUN_EXPERIMENT'
  | 'PARSE_METRICS'
  | 'REFLECT'
  | 'DECIDE_NEXT'
  | 'DONE'
  | 'FAILED';

export type AutoResearchRunEventLevel = 'debug' | 'info' | 'warn' | 'error';

export type AutoResearchRunEventType =
  | 'run_started'
  | 'run_completed'
  | 'run_status_changed'
  | 'iteration_started'
  | 'iteration_completed'
  | 'iteration_failed'
  | 'phase_started'
  | 'agent_plan'
  | 'thinking'
  | 'tool_call_started'
  | 'tool_call_completed'
  | 'tool_call_failed'
  | 'tool_result'
  | 'file_changed'
  | 'experiment_command_started'
  | 'experiment_command_completed'
  | 'metrics_parsed'
  | 'reflection_generated'
  | 'provider_error'
  | 'recovery_suggested'
  | 'raw';

export interface AutoResearchRecoveryAction {
  type:
    | 'retry_failed_phase'
    | 'retry_iteration'
    | 'switch_provider'
    | 'open_raw_request_summary'
    | 'open_logs'
    | 'abort_run'
    | 'increase_tool_budget';
  supported: boolean;
  label?: string;
  reason?: string;
}

export interface AutoResearchResumeToken {
  schemaVersion: 1;
  sessionId: string;
  status: 'running' | 'paused' | 'waiting_rate_limit' | 'interrupted';
  sshConfig: SshConfig;
  experimentDir: string;
  sessionFilePath?: string;
  livingDocPath?: string;
  metricName: string;
  metricDirection: 'higher' | 'lower';
  maxIterations: number;
  baseline?: number | null;
  currentIteration: number;
  pendingIteration: number;
  replayIteration: boolean;
  resumable: boolean;
  createdAt: string;
  lastUpdatedAt: string;
}

export interface AutoResearchConfigSnapshot {
  configId?: string | null;
  configName: string;
  provider: string;
  providerLabel?: string;
  apiFormat?: string;
  baseUrl?: string;
  model: string;
  keyPreview?: string;
  keyPresent: boolean;
  source: AutoResearchConfigSource | 'unknown';
  warning?: string;
}

export interface AutoResearchRunConfig {
  experimentDir: string;
  workdir: string;
  sessionFilePath?: string;
  livingDocPath?: string;
  metric: string;
  direction: 'higher' | 'lower';
  iterations: number;
  baseline?: number | null;
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
  configSnapshot: AutoResearchConfigSnapshot;
}

export interface AutoResearchIterationRecord {
  id: string;
  index: number;
  status: AutoResearchIterationStatus;
  phase?: AutoResearchRunPhase;
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
  startedAt?: string;
  endedAt?: string;
  artifactPaths?: string[];
  recoveryActions?: AutoResearchRecoveryAction[];
}

export interface AutoResearchRunEvent {
  id: string;
  runId: string;
  iterationId?: string;
  timestamp: string;
  level: AutoResearchRunEventLevel;
  phase: AutoResearchRunPhase | 'preflight' | 'agent_execution' | 'evaluation' | 'rate_limit' | 'terminal' | 'system' | 'reflection_parse_failed';
  type?: AutoResearchRunEventType;
  message: string;
  summary?: string;
  detail?: unknown;
  metadata?: Record<string, unknown>;
}

export interface AutoResearchRunRecord {
  id: string;
  title: string;
  status: AutoResearchRunStatus;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  endedAt?: string;
  currentPhase?: AutoResearchRunPhase;
  config: AutoResearchRunConfig;
  currentIteration: number;
  bestMetricValue?: number | null;
  bestIteration?: number | null;
  failureCount: number;
  iterations: AutoResearchIterationRecord[];
  events: AutoResearchRunEvent[];
  summary?: string;
  reason?: string;
  liveOutputExcerpt?: string;
  resumeToken?: AutoResearchResumeToken;
}

export interface PersistedAutoResearchHistory {
  version: 1;
  selectedRunId: string | null;
  runs: AutoResearchRunRecord[];
}

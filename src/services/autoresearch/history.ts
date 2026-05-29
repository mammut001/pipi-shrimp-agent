import type { AutoResearchAgentConfigSnapshot, AutoResearchConfigSource } from './errors';
import type { SshConfig } from '@/types/ssh';

export type AutoResearchRunStatus =
  | 'draft'
  | 'running'
  | 'waiting_rate_limit'
  | 'reflection_failed'
  | 'stopped'
  | 'failed'
  | 'completed'
  | 'interrupted';

export type AutoResearchIterationStatus = 'pending' | 'running' | 'failed' | 'completed' | 'skipped';

export type AutoResearchRunPhase =
  | 'INIT'
  | 'READ_CONTEXT'
  | 'AUDIT'
  | 'PLAN_HYPOTHESIS'
  | 'EDIT_CODE'
  | 'RUN_EXPERIMENT'
  | 'VERIFY'
  | 'PARSE_METRICS'
  | 'REFLECT'
  | 'DECIDE_NEXT'
  | 'DONE'
  | 'FAILED'
  | 'NEEDS_REVIEW';

/** AutoResearch operation mode. */
export type AutoResearchMode = 'ml_experiment' | 'repo_self_improve';

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
  type: 'retry_failed_phase' | 'retry_iteration' | 'switch_provider' | 'open_raw_request_summary' | 'open_logs' | 'abort_run';
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
  configSnapshot: AutoResearchConfigSnapshot;
  mode?: AutoResearchMode;
  verificationCommands?: string[];
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

export const AUTORESEARCH_HISTORY_STORAGE_KEY = 'pipi-shrimp-autoresearch-history-v1';
const MAX_PERSISTED_RUNS = 40;
const MAX_PERSISTED_EVENTS_PER_RUN = 100;
const MAX_PERSISTED_ITERATIONS_PER_RUN = 250;
const MAX_PERSISTED_ARTIFACT_PATHS = 12;
const MAX_PERSISTED_METADATA_ENTRIES = 20;
const MAX_TITLE_CHARS = 160;
const MAX_SUMMARY_CHARS = 2_000;
const MAX_EVENT_MESSAGE_CHARS = 1_000;
const MAX_REASONING_CHARS = 4_000;
const MAX_CHANGE_CHARS = 4_000;
const MAX_HYPOTHESIS_CHARS = 600;
const MAX_ERROR_CHARS = 1_000;
const MAX_PATH_CHARS = 600;
const MAX_CONFIG_VALUE_CHARS = 600;
const MAX_LIVE_OUTPUT_EXCERPT_CHARS = 20_000;
const MAX_REASON_CHARS = 1_000;
const MAX_NARRATIVE_CHARS = 2_000;
const MAX_EVENT_SUMMARY_CHARS = 400;
const REDACTED_VALUE = '[redacted]';

function isRunPhase(value: unknown): value is AutoResearchRunPhase {
  return value === 'INIT'
    || value === 'READ_CONTEXT'
    || value === 'PLAN_HYPOTHESIS'
    || value === 'EDIT_CODE'
    || value === 'RUN_EXPERIMENT'
    || value === 'PARSE_METRICS'
    || value === 'REFLECT'
    || value === 'DECIDE_NEXT'
    || value === 'DONE'
    || value === 'FAILED';
}

function isRecoveryActionType(value: unknown): value is AutoResearchRecoveryAction['type'] {
  return value === 'retry_failed_phase'
    || value === 'retry_iteration'
    || value === 'switch_provider'
    || value === 'open_raw_request_summary'
    || value === 'open_logs'
    || value === 'abort_run';
}

function sanitizeParsedMetrics(value: unknown): Record<string, number | string | boolean | null> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const next: Record<string, number | string | boolean | null> = {};
  for (const [key, entry] of Object.entries(value).slice(0, MAX_PERSISTED_METADATA_ENTRIES)) {
    if (typeof entry === 'number' || typeof entry === 'boolean' || typeof entry === 'string' || entry === null) {
      next[key] = typeof entry === 'string'
        ? truncateString(redactAutoResearchSensitiveText(entry), MAX_EVENT_MESSAGE_CHARS)
        : entry;
    }
  }

  return Object.keys(next).length > 0 ? next : undefined;
}

function normalizeRecoveryActions(value: unknown): AutoResearchRecoveryAction[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const actions = value
    .filter((item): item is Record<string, unknown> => isRecord(item) && isRecoveryActionType(item.type))
    .slice(0, 8)
    .map((item) => ({
      type: item.type as AutoResearchRecoveryAction['type'],
      supported: item.supported !== false,
      label: sanitizeDisplayString(item.label, MAX_CONFIG_VALUE_CHARS),
      reason: sanitizeDisplayString(item.reason, MAX_EVENT_MESSAGE_CHARS),
    }));

  return actions.length > 0 ? actions : undefined;
}

export function redactAutoResearchSensitiveText(value: string): string {
  return value
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s"']+/ig, '$1[redacted]')
    .replace(/(x-api-key\s*[:=]\s*)[^\s"']+/ig, '$1[redacted]')
    .replace(/(api[_ -]?key\s*[:=]\s*)[^\s"']+/ig, '$1[redacted]')
    .replace(/((?:key[_ -]?path|ssh[_ -]?key[_ -]?path|private[_ -]?key[_ -]?path)\s*[:=]\s*)[^\s"']+/ig, '$1[redacted]')
    .replace(/(password\s*[:=]\s*)[^\s"']+/ig, '$1[redacted]')
    .replace(/(secret\s*[:=]\s*)[^\s"']+/ig, '$1[redacted]')
    .replace(/(token\s*[:=]\s*)[^\s"']+/ig, '$1[redacted]')
    .replace(/((?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/)[^\s"']+/ig, '$1[redacted]')
    .replace(/((?:database_url|db_uri|redis_url|mongodb_uri|postgres_url|mysql_url)\s*[:=]\s*)[^\s"']+/ig, '$1[redacted]')
    .replace(/(([A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD|DATABASE_URL|DB_URI)[A-Z0-9_]*)\s*[:=]\s*)[^\s"']+/g, '$1[redacted]');
}

function safeLocalStorage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') {
      return null;
    }
    return localStorage;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

function truncateString(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxChars - 16))}...[truncated]`;
}

function sanitizeDisplayString(value: unknown, maxChars: number): string | undefined {
  return typeof value === 'string'
    ? truncateString(redactAutoResearchSensitiveText(value), maxChars)
    : undefined;
}

function sanitizePath(value: unknown): string | undefined {
  return sanitizeDisplayString(value, MAX_PATH_CHARS);
}

function normalizeResumeToken(value: unknown, runId: string): AutoResearchResumeToken | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const sshRecord = isRecord(value.sshConfig) ? value.sshConfig : null;
  if (!sshRecord) {
    return undefined;
  }

  const mode = sshRecord.mode === 'local' ? 'local' : 'ssh';
  const authMode = sshRecord.authMode === 'key'
    ? 'key'
    : sshRecord.authMode === 'password'
      ? 'password'
      : 'agent';
  const pendingIteration = typeof value.pendingIteration === 'number'
    ? Math.max(1, value.pendingIteration)
    : 1;
  const currentIteration = typeof value.currentIteration === 'number'
    ? Math.max(0, value.currentIteration)
    : 0;

  return {
    schemaVersion: 1,
    sessionId: typeof value.sessionId === 'string' ? value.sessionId : runId,
    status: value.status === 'paused'
      ? 'paused'
      : value.status === 'waiting_rate_limit'
        ? 'waiting_rate_limit'
        : value.status === 'interrupted'
          ? 'interrupted'
          : 'running',
    sshConfig: {
      mode,
      host: sanitizeDisplayString(sshRecord.host, MAX_CONFIG_VALUE_CHARS) || '',
      user: sanitizeDisplayString(sshRecord.user, MAX_CONFIG_VALUE_CHARS) || '',
      keyPath: sanitizePath(sshRecord.keyPath) || '',
      port: typeof sshRecord.port === 'number' ? sshRecord.port : 22,
      remoteWorkDir: sanitizePath(sshRecord.remoteWorkDir) || '',
      authMode,
      password: '',
    },
    experimentDir: sanitizePath(value.experimentDir) || '',
    sessionFilePath: sanitizePath(value.sessionFilePath),
    livingDocPath: sanitizePath(value.livingDocPath),
    metricName: sanitizeDisplayString(value.metricName, MAX_CONFIG_VALUE_CHARS) || '',
    metricDirection: value.metricDirection === 'higher' ? 'higher' : 'lower',
    maxIterations: typeof value.maxIterations === 'number' ? value.maxIterations : 0,
    baseline: typeof value.baseline === 'number' || value.baseline === null ? value.baseline : undefined,
    currentIteration,
    pendingIteration,
    replayIteration: value.replayIteration !== false,
    resumable: value.resumable !== false,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : new Date(0).toISOString(),
    lastUpdatedAt: typeof value.lastUpdatedAt === 'string' ? value.lastUpdatedAt : new Date(0).toISOString(),
  };
}

function isSensitiveMetadataKey(key: string): boolean {
  return /(api.?key|authorization|password|secret|token|key.?path|ssh.?key)/i.test(key);
}

function sanitizeMetadataValue(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    return truncateString(redactAutoResearchSensitiveText(value), MAX_EVENT_MESSAGE_CHARS);
  }

  if (Array.isArray(value)) {
    return value.slice(0, MAX_PERSISTED_METADATA_ENTRIES).map((item) => sanitizeMetadataValue(item, depth + 1));
  }

  if (!isRecord(value) || depth >= 2) {
    return undefined;
  }

  const entries = Object.entries(value).slice(0, MAX_PERSISTED_METADATA_ENTRIES);
  const next: Record<string, unknown> = {};
  for (const [key, entryValue] of entries) {
    next[key] = isSensitiveMetadataKey(key)
      ? REDACTED_VALUE
      : sanitizeMetadataValue(entryValue, depth + 1);
  }
  return next;
}

function normalizeConfigSnapshot(snapshot: unknown): AutoResearchConfigSnapshot {
  if (!isRecord(snapshot)) {
    return {
      configId: null,
      configName: 'Unknown',
      provider: 'unknown',
      providerLabel: undefined,
      model: '',
      keyPresent: false,
      source: 'unknown',
    };
  }

  return {
    configId: typeof snapshot.configId === 'string' ? truncateString(snapshot.configId, MAX_CONFIG_VALUE_CHARS) : null,
    configName: sanitizeDisplayString(snapshot.configName, MAX_CONFIG_VALUE_CHARS) || 'Unknown',
    provider: sanitizeDisplayString(snapshot.provider, MAX_CONFIG_VALUE_CHARS) || 'unknown',
    providerLabel: sanitizeDisplayString(snapshot.providerLabel, MAX_CONFIG_VALUE_CHARS),
    apiFormat: sanitizeDisplayString(snapshot.apiFormat, MAX_CONFIG_VALUE_CHARS),
    baseUrl: sanitizeDisplayString(snapshot.baseUrl, MAX_CONFIG_VALUE_CHARS),
    model: sanitizeDisplayString(snapshot.model, MAX_CONFIG_VALUE_CHARS) || '',
    keyPreview: sanitizeDisplayString(snapshot.keyPreview, MAX_CONFIG_VALUE_CHARS),
    keyPresent: typeof snapshot.keyPresent === 'boolean'
      ? snapshot.keyPresent
      : typeof snapshot.keyPreview === 'string' && snapshot.keyPreview !== '<EMPTY>',
    source: typeof snapshot.source === 'string' ? snapshot.source as AutoResearchConfigSnapshot['source'] : 'unknown',
    warning: sanitizeDisplayString(snapshot.warning, MAX_SUMMARY_CHARS),
  };
}

function normalizeIterationRecord(record: unknown, fallbackRunId: string, index: number): AutoResearchIterationRecord {
  if (!isRecord(record)) {
    return {
      id: `${fallbackRunId}-iter-${index}`,
      index,
      status: 'pending',
    };
  }

  return {
    id: typeof record.id === 'string' ? record.id : `${fallbackRunId}-iter-${index}`,
    index: typeof record.index === 'number' ? record.index : index,
    status: typeof record.status === 'string' ? record.status as AutoResearchIterationStatus : 'pending',
    phase: isRunPhase(record.phase) ? record.phase : undefined,
    hypothesis: sanitizeDisplayString(record.hypothesis, MAX_HYPOTHESIS_CHARS),
    change: sanitizeDisplayString(record.change, MAX_CHANGE_CHARS),
    reasoning: sanitizeDisplayString(record.reasoning, MAX_REASONING_CHARS),
    narrative: sanitizeDisplayString(record.narrative, MAX_NARRATIVE_CHARS),
    codeChangesSummary: sanitizeDisplayString(record.codeChangesSummary, MAX_CHANGE_CHARS),
    executionCommand: sanitizeDisplayString(record.executionCommand, MAX_CHANGE_CHARS),
    exitCode: typeof record.exitCode === 'number' || record.exitCode === null ? record.exitCode : undefined,
    durationMs: typeof record.durationMs === 'number' || record.durationMs === null ? record.durationMs : undefined,
    parsedMetrics: sanitizeParsedMetrics(record.parsedMetrics),
    reflectionSummary: sanitizeDisplayString(record.reflectionSummary, MAX_REASONING_CHARS),
    metricValue: typeof record.metricValue === 'number' || record.metricValue === null ? record.metricValue : undefined,
    improvement: typeof record.improvement === 'number' || record.improvement === null ? record.improvement : undefined,
    commitHash: sanitizeDisplayString(record.commitHash, MAX_CONFIG_VALUE_CHARS),
    error: typeof record.error === 'string'
      ? truncateString(redactAutoResearchSensitiveText(record.error), MAX_ERROR_CHARS)
      : record.error === null ? null : undefined,
    startedAt: typeof record.startedAt === 'string' ? record.startedAt : undefined,
    endedAt: typeof record.endedAt === 'string' ? record.endedAt : undefined,
    artifactPaths: Array.isArray(record.artifactPaths)
      ? record.artifactPaths
        .filter((value): value is string => typeof value === 'string')
        .slice(0, MAX_PERSISTED_ARTIFACT_PATHS)
        .map((value) => truncateString(value, MAX_PATH_CHARS))
      : undefined,
    recoveryActions: normalizeRecoveryActions(record.recoveryActions),
  };
}

function normalizeEvent(event: unknown, runId: string, index: number): AutoResearchRunEvent | null {
  if (!isRecord(event)) {
    return null;
  }

  return {
    id: typeof event.id === 'string' ? event.id : `${runId}-event-${index}`,
    runId: typeof event.runId === 'string' ? event.runId : runId,
    iterationId: typeof event.iterationId === 'string' ? event.iterationId : undefined,
    timestamp: typeof event.timestamp === 'string' ? event.timestamp : new Date(0).toISOString(),
    level: typeof event.level === 'string' ? event.level as AutoResearchRunEvent['level'] : 'info',
    phase: typeof event.phase === 'string' ? event.phase as AutoResearchRunEvent['phase'] : 'system',
    type: typeof event.type === 'string' ? event.type as AutoResearchRunEventType : undefined,
    message: typeof event.message === 'string'
      ? truncateString(redactAutoResearchSensitiveText(event.message), MAX_EVENT_MESSAGE_CHARS)
      : '',
    summary: typeof event.summary === 'string'
      ? truncateString(redactAutoResearchSensitiveText(event.summary), MAX_EVENT_SUMMARY_CHARS)
      : undefined,
    detail: sanitizeMetadataValue(event.detail),
    metadata: isRecord(event.metadata)
      ? sanitizeMetadataValue(event.metadata) as Record<string, unknown> | undefined
      : undefined,
  };
}

function normalizeRunRecord(record: unknown): AutoResearchRunRecord | null {
  if (!isRecord(record) || typeof record.id !== 'string') {
    return null;
  }

  const runId = record.id;
  const configRecord = isRecord(record.config) ? record.config : {};
  const iterations = Array.isArray(record.iterations)
    ? record.iterations.map((item, index) => normalizeIterationRecord(item, runId, index + 1))
    : [];
  const events = Array.isArray(record.events)
    ? record.events
      .map((item, index) => normalizeEvent(item, runId, index + 1))
      .filter((item): item is AutoResearchRunEvent => item !== null)
    : [];

  return {
    id: runId,
    title: typeof record.title === 'string' ? truncateString(record.title, MAX_TITLE_CHARS) : runId,
    status: typeof record.status === 'string' ? record.status as AutoResearchRunStatus : 'draft',
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : new Date(0).toISOString(),
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : new Date(0).toISOString(),
    startedAt: typeof record.startedAt === 'string' ? record.startedAt : undefined,
    endedAt: typeof record.endedAt === 'string' ? record.endedAt : undefined,
    currentPhase: isRunPhase(record.currentPhase) ? record.currentPhase : undefined,
    config: {
      experimentDir: sanitizePath(configRecord.experimentDir) || '',
      workdir: sanitizePath(configRecord.workdir) || '',
      sessionFilePath: sanitizePath(configRecord.sessionFilePath),
      livingDocPath: sanitizePath(configRecord.livingDocPath),
      metric: sanitizeDisplayString(configRecord.metric, MAX_CONFIG_VALUE_CHARS) || '',
      direction: configRecord.direction === 'higher' ? 'higher' : 'lower',
      iterations: typeof configRecord.iterations === 'number' ? configRecord.iterations : 0,
      baseline: typeof configRecord.baseline === 'number' || configRecord.baseline === null ? configRecord.baseline : undefined,
      configSnapshot: normalizeConfigSnapshot(configRecord.configSnapshot),
    },
    currentIteration: typeof record.currentIteration === 'number' ? record.currentIteration : 0,
    bestMetricValue: typeof record.bestMetricValue === 'number' || record.bestMetricValue === null
      ? record.bestMetricValue
      : undefined,
    bestIteration: typeof record.bestIteration === 'number' ? record.bestIteration : undefined,
    failureCount: typeof record.failureCount === 'number' ? record.failureCount : 0,
    iterations: iterations.slice(-MAX_PERSISTED_ITERATIONS_PER_RUN),
    events: events.slice(-MAX_PERSISTED_EVENTS_PER_RUN),
    summary: typeof record.summary === 'string'
      ? truncateString(redactAutoResearchSensitiveText(record.summary), MAX_SUMMARY_CHARS)
      : undefined,
    reason: typeof record.reason === 'string'
      ? truncateString(redactAutoResearchSensitiveText(record.reason), MAX_REASON_CHARS)
      : undefined,
    liveOutputExcerpt: typeof record.liveOutputExcerpt === 'string'
      ? clipLiveOutputExcerpt(record.liveOutputExcerpt)
      : undefined,
    resumeToken: normalizeResumeToken(record.resumeToken, runId),
  };
}

function sortRuns(runs: AutoResearchRunRecord[]): AutoResearchRunRecord[] {
  return [...runs].sort((a, b) => {
    const byUpdated = b.updatedAt.localeCompare(a.updatedAt);
    return byUpdated !== 0 ? byUpdated : b.createdAt.localeCompare(a.createdAt);
  });
}

export function clipLiveOutputExcerpt(value: string): string {
  return redactAutoResearchSensitiveText(value).slice(-MAX_LIVE_OUTPUT_EXCERPT_CHARS);
}

export function toHistoryConfigSnapshot(snapshot?: AutoResearchAgentConfigSnapshot): AutoResearchConfigSnapshot {
  if (!snapshot) {
    return {
      configId: null,
      configName: 'Unknown',
      provider: 'unknown',
      providerLabel: undefined,
      model: '',
      keyPresent: false,
      source: 'unknown',
    };
  }

  return {
    configId: typeof snapshot.configId === 'string' ? truncateString(snapshot.configId, MAX_CONFIG_VALUE_CHARS) : null,
    configName: truncateString(snapshot.configName, MAX_CONFIG_VALUE_CHARS),
    provider: truncateString(snapshot.provider, MAX_CONFIG_VALUE_CHARS),
    providerLabel: snapshot.providerLabel ? truncateString(snapshot.providerLabel, MAX_CONFIG_VALUE_CHARS) : undefined,
    apiFormat: snapshot.apiFormat ? truncateString(snapshot.apiFormat, MAX_CONFIG_VALUE_CHARS) : undefined,
    baseUrl: snapshot.baseUrl ? truncateString(snapshot.baseUrl, MAX_CONFIG_VALUE_CHARS) : undefined,
    model: truncateString(snapshot.model, MAX_CONFIG_VALUE_CHARS),
    keyPreview: snapshot.keyPreview ? truncateString(snapshot.keyPreview, MAX_CONFIG_VALUE_CHARS) : undefined,
    keyPresent: snapshot.keyPresent,
    source: snapshot.source,
    warning: snapshot.warning ? truncateString(snapshot.warning, MAX_SUMMARY_CHARS) : undefined,
  };
}

export function createAutoResearchRunId(): string {
  return `autoresearch-run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function buildAutoResearchRunTitle(metric: string, experimentDir: string): string {
  const trimmedDir = experimentDir.replace(/[\\/]+$/, '');
  const lastSegment = trimmedDir.split('/').filter(Boolean).pop() || 'experiment';
  return truncateString(`${lastSegment} · ${metric}`, MAX_TITLE_CHARS);
}

function compactRunRecord(record: AutoResearchRunRecord): AutoResearchRunRecord {
  return normalizeRunRecord(record) ?? {
    id: record.id,
    title: truncateString(record.title, MAX_TITLE_CHARS),
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    startedAt: record.startedAt,
    endedAt: record.endedAt,
    currentPhase: record.currentPhase,
    config: {
      experimentDir: truncateString(record.config.experimentDir, MAX_PATH_CHARS),
      workdir: truncateString(record.config.workdir, MAX_PATH_CHARS),
      sessionFilePath: record.config.sessionFilePath ? truncateString(record.config.sessionFilePath, MAX_PATH_CHARS) : undefined,
      livingDocPath: record.config.livingDocPath ? truncateString(record.config.livingDocPath, MAX_PATH_CHARS) : undefined,
      metric: truncateString(record.config.metric, MAX_CONFIG_VALUE_CHARS),
      direction: record.config.direction,
      iterations: record.config.iterations,
      baseline: record.config.baseline,
      configSnapshot: toHistoryConfigSnapshot(record.config.configSnapshot as AutoResearchAgentConfigSnapshot),
    },
    currentIteration: record.currentIteration,
    bestMetricValue: record.bestMetricValue,
    bestIteration: record.bestIteration,
    failureCount: record.failureCount,
    iterations: [],
    events: [],
    summary: record.summary ? truncateString(record.summary, MAX_SUMMARY_CHARS) : undefined,
    reason: record.reason ? truncateString(record.reason, MAX_REASON_CHARS) : undefined,
    liveOutputExcerpt: record.liveOutputExcerpt ? clipLiveOutputExcerpt(record.liveOutputExcerpt) : undefined,
    resumeToken: record.resumeToken ? {
      ...record.resumeToken,
      sshConfig: {
        ...record.resumeToken.sshConfig,
        password: '',
      },
      experimentDir: truncateString(record.resumeToken.experimentDir, MAX_PATH_CHARS),
      sessionFilePath: record.resumeToken.sessionFilePath ? truncateString(record.resumeToken.sessionFilePath, MAX_PATH_CHARS) : undefined,
      livingDocPath: record.resumeToken.livingDocPath ? truncateString(record.resumeToken.livingDocPath, MAX_PATH_CHARS) : undefined,
      metricName: truncateString(record.resumeToken.metricName, MAX_CONFIG_VALUE_CHARS),
      currentIteration: Math.max(0, record.resumeToken.currentIteration),
      pendingIteration: Math.max(1, record.resumeToken.pendingIteration),
    } : undefined,
  };
}

function compactHistory(history: PersistedAutoResearchHistory): PersistedAutoResearchHistory {
  const runs = sortRuns(history.runs)
    .slice(0, MAX_PERSISTED_RUNS)
    .map((run) => compactRunRecord(run));
  const selectedRunId = runs.some((run) => run.id === history.selectedRunId)
    ? history.selectedRunId
    : runs[0]?.id ?? null;
  return {
    version: 1,
    selectedRunId,
    runs,
  };
}

export function loadPersistedAutoResearchHistory(now = new Date().toISOString()): PersistedAutoResearchHistory {
  const storage = safeLocalStorage();
  if (!storage) {
    return { version: 1, selectedRunId: null, runs: [] };
  }

  try {
    const raw = storage.getItem(AUTORESEARCH_HISTORY_STORAGE_KEY);
    if (!raw) {
      return { version: 1, selectedRunId: null, runs: [] };
    }

    const parsed = JSON.parse(raw) as Partial<PersistedAutoResearchHistory>;
    const runs = Array.isArray(parsed.runs)
      ? parsed.runs
        .map(normalizeRunRecord)
        .filter((item): item is AutoResearchRunRecord => item !== null)
      : [];

    let didInterruptRunningRun = false;
    const normalizedRuns = sortRuns(runs).map((run) => {
      if (run.status !== 'running' && run.status !== 'waiting_rate_limit') {
        return run;
      }

      didInterruptRunningRun = true;
      return {
        ...run,
        status: 'interrupted',
        updatedAt: now,
        endedAt: run.endedAt ?? now,
        summary: run.summary || 'Interrupted after app restart.',
        resumeToken: run.resumeToken
          ? {
            ...run.resumeToken,
            status: 'interrupted',
            lastUpdatedAt: now,
          }
          : undefined,
        events: [
          ...run.events,
          {
            id: `${run.id}-event-interrupted-${now}`,
            runId: run.id,
            timestamp: now,
            level: 'warn',
            phase: 'system',
            message: 'Run marked interrupted after app restart. Inspect-only mode restored.',
          },
        ],
      } satisfies AutoResearchRunRecord;
    });

    const normalized = compactHistory({
      version: 1,
      selectedRunId: typeof parsed.selectedRunId === 'string'
      ? parsed.selectedRunId
      : normalizedRuns[0]?.id ?? null,
      runs: normalizedRuns,
    });
    const serialized = JSON.stringify(normalized);
    if (didInterruptRunningRun || serialized !== raw) {
      storage.setItem(AUTORESEARCH_HISTORY_STORAGE_KEY, serialized);
    }

    return normalized;
  } catch {
    return { version: 1, selectedRunId: null, runs: [] };
  }
}

export function persistAutoResearchHistory(runs: AutoResearchRunRecord[], selectedRunId: string | null): void {
  const storage = safeLocalStorage();
  if (!storage) {
    return;
  }

  try {
    storage.setItem(AUTORESEARCH_HISTORY_STORAGE_KEY, JSON.stringify(compactHistory({
      version: 1,
      selectedRunId,
      runs: sortRuns(runs),
    } satisfies PersistedAutoResearchHistory)));
  } catch (error) {
    console.error('Failed to persist AutoResearch history:', error);
  }
}

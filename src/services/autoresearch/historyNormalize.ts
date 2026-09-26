import type {
  AutoResearchRunStatus,
  AutoResearchIterationStatus,
  AutoResearchRunPhase,
  AutoResearchRunEventType,
  AutoResearchRecoveryAction,
  AutoResearchResumeToken,
  AutoResearchConfigSnapshot,
  AutoResearchIterationRecord,
  AutoResearchRunEvent,
  AutoResearchRunRecord,
} from './historyTypes';

export const MAX_PERSISTED_EVENTS_PER_RUN = 100;
export const MAX_PERSISTED_ITERATIONS_PER_RUN = 250;
export const MAX_PERSISTED_ARTIFACT_PATHS = 12;
export const MAX_PERSISTED_METADATA_ENTRIES = 20;
export const MAX_TITLE_CHARS = 160;
export const MAX_SUMMARY_CHARS = 2_000;
export const MAX_EVENT_MESSAGE_CHARS = 1_000;
export const MAX_REASONING_CHARS = 4_000;
export const MAX_CHANGE_CHARS = 4_000;
export const MAX_HYPOTHESIS_CHARS = 600;
export const MAX_ERROR_CHARS = 1_000;
export const MAX_PATH_CHARS = 600;
export const MAX_CONFIG_VALUE_CHARS = 600;
export const MAX_LIVE_OUTPUT_EXCERPT_CHARS = 20_000;
// Full live output buffer cap (10x the excerpt) — anything beyond is sliced
// off the front so the store never grows unbounded during long-running
// AutoResearch loops.
export const MAX_LIVE_OUTPUT_BUFFER_CHARS = 200_000;
export const MAX_REASON_CHARS = 1_000;
export const MAX_NARRATIVE_CHARS = 2_000;
export const MAX_EVENT_SUMMARY_CHARS = 400;
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
    || value === 'abort_run'
    || value === 'increase_tool_budget';
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

export function safeLocalStorage(): Storage | null {
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

export function truncateString(value: string, maxChars: number): string {
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

export function normalizeRunRecord(record: unknown): AutoResearchRunRecord | null {
  if (!isRecord(record) || typeof record.id !== 'string') {
    return null;
  }

  const runId = record.id;
  const configRecord = isRecord(record.config) ? record.config : {};
  const runStatus = typeof record.status === 'string' ? record.status as AutoResearchRunStatus : 'draft';
  const rawIterations = Array.isArray(record.iterations)
    ? record.iterations.map((item, index) => normalizeIterationRecord(item, runId, index + 1))
    : [];
  const isTerminalOrInterrupted = ['interrupted', 'failed', 'completed', 'stopped'].includes(runStatus);
  const iterations = isTerminalOrInterrupted
    ? rawIterations.map((iter) => {
      if (iter.status === 'running') {
        return {
          ...iter,
          status: 'failed' as const,
          error: iter.error || 'Run interrupted or stopped after app restart.',
        };
      }
      return iter;
    })
    : rawIterations;
  const events = Array.isArray(record.events)
    ? record.events
      .map((item, index) => normalizeEvent(item, runId, index + 1))
      .filter((item): item is AutoResearchRunEvent => item !== null)
    : [];

  return {
    id: runId,
    title: typeof record.title === 'string' ? truncateString(record.title, MAX_TITLE_CHARS) : runId,
    status: runStatus,
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
      preferredPythonCommand: sanitizeDisplayString(configRecord.preferredPythonCommand, MAX_CONFIG_VALUE_CHARS),
      repoStatus: configRecord.repoStatus === 'dirty' ? 'dirty' : configRecord.repoStatus === 'clean' ? 'clean' : undefined,
      dirtyFileCount: typeof configRecord.dirtyFileCount === 'number' ? configRecord.dirtyFileCount : undefined,
      gpuTelemetryAvailable: typeof configRecord.gpuTelemetryAvailable === 'boolean' ? configRecord.gpuTelemetryAvailable : undefined,
      gpuSummary: sanitizeDisplayString(configRecord.gpuSummary, MAX_SUMMARY_CHARS),
      gpuTemperatureC: typeof configRecord.gpuTemperatureC === 'number' || configRecord.gpuTemperatureC === null ? configRecord.gpuTemperatureC : undefined,
      gpuFanSpeedPercent: typeof configRecord.gpuFanSpeedPercent === 'number' || configRecord.gpuFanSpeedPercent === null ? configRecord.gpuFanSpeedPercent : undefined,
      gpuUtilizationPercent: typeof configRecord.gpuUtilizationPercent === 'number' || configRecord.gpuUtilizationPercent === null ? configRecord.gpuUtilizationPercent : undefined,
      gpuMemoryUsedMb: typeof configRecord.gpuMemoryUsedMb === 'number' || configRecord.gpuMemoryUsedMb === null ? configRecord.gpuMemoryUsedMb : undefined,
      gpuMemoryTotalMb: typeof configRecord.gpuMemoryTotalMb === 'number' || configRecord.gpuMemoryTotalMb === null ? configRecord.gpuMemoryTotalMb : undefined,
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

export function sortRuns(runs: AutoResearchRunRecord[]): AutoResearchRunRecord[] {
  return [...runs].sort((a, b) => {
    const byUpdated = b.updatedAt.localeCompare(a.updatedAt);
    return byUpdated !== 0 ? byUpdated : b.createdAt.localeCompare(a.createdAt);
  });
}

export function clipLiveOutputExcerpt(value: string): string {
  return redactAutoResearchSensitiveText(value).slice(-MAX_LIVE_OUTPUT_EXCERPT_CHARS);
}

/**
 * In-memory excerpt cap without secret redaction. Use this for the
 * streaming `appendLiveOutput` path — redaction is expensive (10+
 * chained regex passes) and running it on every token was a CPU hotspot
 * for long runs. The persisted excerpt is redacted at write time via
 * {@link redactLiveOutputExcerptForStorage} instead.
 */
export function clipLiveOutputExcerptInMemory(value: string): string {
  if (value.length <= MAX_LIVE_OUTPUT_EXCERPT_CHARS) {
    return value;
  }
  return value.slice(-MAX_LIVE_OUTPUT_EXCERPT_CHARS);
}

/**
 * Cap the full live output buffer at {@link MAX_LIVE_OUTPUT_BUFFER_CHARS}.
 *
 * The in-memory buffer drives the streaming terminal panel so the cap is
 * deliberately much larger than the persisted excerpt; we slice from the
 * front so the *latest* output is always preserved.
 *
 * AUDIT-FIX [audit-1-ar#5]: appendLiveOutput unbounded growth.
 * Previously the buffer was appended to indefinitely. A long-running
 * AutoResearch loop streamed output through `appendLiveOutput` for the
 * entire session; after a few hours the state object held tens of MB of
 * plain text, which (a) ballooned React re-render cost on every
 * append, (b) tripped the localStorage quota on the next persist, and
 * (c) risked OOM on low-end machines. The 200KB cap (10x the
 * persisted excerpt) keeps the UI responsive while still preserving
 * recent context.
 */
export function clipLiveOutputBuffer(value: string): string {
  if (value.length <= MAX_LIVE_OUTPUT_BUFFER_CHARS) {
    return value;
  }
  return value.slice(-MAX_LIVE_OUTPUT_BUFFER_CHARS);
}

/**
 * Apply secret redaction on the live output excerpt just before it is
 * written to localStorage. The in-memory `liveOutput` and
 * `liveOutputExcerpt` deliberately skip redaction (P2#4 — doing it on
 * every streaming append was a CPU hotspot). The cost is paid once
 * per persist call instead of once per token.
 */
export function redactLiveOutputExcerptForStorage(value: string): string {
  return redactAutoResearchSensitiveText(value);
}

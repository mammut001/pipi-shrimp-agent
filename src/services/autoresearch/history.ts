import type { AutoResearchAgentConfigSnapshot, AutoResearchConfigSource } from './errors';

export type AutoResearchRunStatus =
  | 'draft'
  | 'running'
  | 'waiting_rate_limit'
  | 'stopped'
  | 'failed'
  | 'completed'
  | 'interrupted';

export type AutoResearchIterationStatus = 'pending' | 'running' | 'failed' | 'completed' | 'skipped';

export interface AutoResearchConfigSnapshot {
  configName: string;
  provider: string;
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
}

export interface AutoResearchIterationRecord {
  id: string;
  index: number;
  status: AutoResearchIterationStatus;
  hypothesis?: string;
  change?: string;
  reasoning?: string;
  metricValue?: number | null;
  improvement?: number | null;
  error?: string | null;
  startedAt?: string;
  endedAt?: string;
  artifactPaths?: string[];
}

export interface AutoResearchRunEvent {
  id: string;
  runId: string;
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  phase: 'preflight' | 'agent_execution' | 'evaluation' | 'rate_limit' | 'terminal' | 'system';
  message: string;
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
  config: AutoResearchRunConfig;
  currentIteration: number;
  bestMetricValue?: number | null;
  bestIteration?: number | null;
  failureCount: number;
  iterations: AutoResearchIterationRecord[];
  events: AutoResearchRunEvent[];
  summary?: string;
  liveOutputExcerpt?: string;
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
const REDACTED_VALUE = '[redacted]';

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
  return typeof value === 'string' ? truncateString(value, maxChars) : undefined;
}

function sanitizePath(value: unknown): string | undefined {
  return sanitizeDisplayString(value, MAX_PATH_CHARS);
}

function isSensitiveMetadataKey(key: string): boolean {
  return /(api.?key|authorization|password|secret|token)/i.test(key);
}

function sanitizeMetadataValue(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    return truncateString(value, MAX_EVENT_MESSAGE_CHARS);
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
      configName: 'Unknown',
      provider: 'unknown',
      model: '',
      keyPresent: false,
      source: 'unknown',
    };
  }

  return {
    configName: sanitizeDisplayString(snapshot.configName, MAX_CONFIG_VALUE_CHARS) || 'Unknown',
    provider: sanitizeDisplayString(snapshot.provider, MAX_CONFIG_VALUE_CHARS) || 'unknown',
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
    hypothesis: sanitizeDisplayString(record.hypothesis, MAX_HYPOTHESIS_CHARS),
    change: sanitizeDisplayString(record.change, MAX_CHANGE_CHARS),
    reasoning: sanitizeDisplayString(record.reasoning, MAX_REASONING_CHARS),
    metricValue: typeof record.metricValue === 'number' || record.metricValue === null ? record.metricValue : undefined,
    improvement: typeof record.improvement === 'number' || record.improvement === null ? record.improvement : undefined,
    error: typeof record.error === 'string'
      ? truncateString(record.error, MAX_ERROR_CHARS)
      : record.error === null ? null : undefined,
    startedAt: typeof record.startedAt === 'string' ? record.startedAt : undefined,
    endedAt: typeof record.endedAt === 'string' ? record.endedAt : undefined,
    artifactPaths: Array.isArray(record.artifactPaths)
      ? record.artifactPaths
        .filter((value): value is string => typeof value === 'string')
        .slice(0, MAX_PERSISTED_ARTIFACT_PATHS)
        .map((value) => truncateString(value, MAX_PATH_CHARS))
      : undefined,
  };
}

function normalizeEvent(event: unknown, runId: string, index: number): AutoResearchRunEvent | null {
  if (!isRecord(event)) {
    return null;
  }

  return {
    id: typeof event.id === 'string' ? event.id : `${runId}-event-${index}`,
    runId: typeof event.runId === 'string' ? event.runId : runId,
    timestamp: typeof event.timestamp === 'string' ? event.timestamp : new Date(0).toISOString(),
    level: typeof event.level === 'string' ? event.level as AutoResearchRunEvent['level'] : 'info',
    phase: typeof event.phase === 'string' ? event.phase as AutoResearchRunEvent['phase'] : 'system',
    message: typeof event.message === 'string' ? truncateString(event.message, MAX_EVENT_MESSAGE_CHARS) : '',
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
    summary: typeof record.summary === 'string' ? truncateString(record.summary, MAX_SUMMARY_CHARS) : undefined,
    liveOutputExcerpt: typeof record.liveOutputExcerpt === 'string'
      ? record.liveOutputExcerpt.slice(-MAX_LIVE_OUTPUT_EXCERPT_CHARS)
      : undefined,
  };
}

function sortRuns(runs: AutoResearchRunRecord[]): AutoResearchRunRecord[] {
  return [...runs].sort((a, b) => {
    const byUpdated = b.updatedAt.localeCompare(a.updatedAt);
    return byUpdated !== 0 ? byUpdated : b.createdAt.localeCompare(a.createdAt);
  });
}

export function clipLiveOutputExcerpt(value: string): string {
  return value.slice(-MAX_LIVE_OUTPUT_EXCERPT_CHARS);
}

export function toHistoryConfigSnapshot(snapshot?: AutoResearchAgentConfigSnapshot): AutoResearchConfigSnapshot {
  if (!snapshot) {
    return {
      configName: 'Unknown',
      provider: 'unknown',
      model: '',
      keyPresent: false,
      source: 'unknown',
    };
  }

  return {
    configName: truncateString(snapshot.configName, MAX_CONFIG_VALUE_CHARS),
    provider: truncateString(snapshot.provider, MAX_CONFIG_VALUE_CHARS),
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
    liveOutputExcerpt: record.liveOutputExcerpt ? clipLiveOutputExcerpt(record.liveOutputExcerpt) : undefined,
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

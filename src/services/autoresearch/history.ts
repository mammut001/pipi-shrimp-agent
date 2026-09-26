import type { AutoResearchAgentConfigSnapshot } from './errors';
import type {
  AutoResearchRunStatus,
  AutoResearchIterationStatus,
  AutoResearchRunPhase,
  AutoResearchRunEventLevel,
  AutoResearchRunEventType,
  AutoResearchRecoveryAction,
  AutoResearchResumeToken,
  AutoResearchConfigSnapshot,
  AutoResearchRunConfig,
  AutoResearchIterationRecord,
  AutoResearchRunEvent,
  AutoResearchRunRecord,
  PersistedAutoResearchHistory,
} from './historyTypes';

export type {
  AutoResearchRunStatus,
  AutoResearchIterationStatus,
  AutoResearchRunPhase,
  AutoResearchRunEventLevel,
  AutoResearchRunEventType,
  AutoResearchRecoveryAction,
  AutoResearchResumeToken,
  AutoResearchConfigSnapshot,
  AutoResearchRunConfig,
  AutoResearchIterationRecord,
  AutoResearchRunEvent,
  AutoResearchRunRecord,
  PersistedAutoResearchHistory,
} from './historyTypes';

import {
  MAX_TITLE_CHARS,
  MAX_SUMMARY_CHARS,
  MAX_PATH_CHARS,
  MAX_CONFIG_VALUE_CHARS,
  MAX_LIVE_OUTPUT_EXCERPT_CHARS,
  MAX_REASON_CHARS,
  safeLocalStorage,
  truncateString,
  redactAutoResearchSensitiveText,
  redactLiveOutputExcerptForStorage,
  normalizeRunRecord,
  sortRuns,
} from './historyNormalize';
export {
  redactAutoResearchSensitiveText,
  clipLiveOutputExcerpt,
  clipLiveOutputExcerptInMemory,
  clipLiveOutputBuffer,
  redactLiveOutputExcerptForStorage,
} from './historyNormalize';

export const AUTORESEARCH_HISTORY_STORAGE_KEY = 'pipi-shrimp-autoresearch-history-v1';
const MAX_PERSISTED_RUNS = 40;

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
      preferredPythonCommand: record.config.preferredPythonCommand
        ? truncateString(record.config.preferredPythonCommand, MAX_CONFIG_VALUE_CHARS)
        : undefined,
      repoStatus: record.config.repoStatus,
      dirtyFileCount: record.config.dirtyFileCount,
      gpuTelemetryAvailable: record.config.gpuTelemetryAvailable,
      gpuSummary: record.config.gpuSummary
        ? truncateString(record.config.gpuSummary, MAX_SUMMARY_CHARS)
        : undefined,
      gpuTemperatureC: record.config.gpuTemperatureC,
      gpuFanSpeedPercent: record.config.gpuFanSpeedPercent,
      gpuUtilizationPercent: record.config.gpuUtilizationPercent,
      gpuMemoryUsedMb: record.config.gpuMemoryUsedMb,
      gpuMemoryTotalMb: record.config.gpuMemoryTotalMb,
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
    liveOutputExcerpt: record.liveOutputExcerpt
      ? redactLiveOutputExcerptForStorage(record.liveOutputExcerpt).slice(-MAX_LIVE_OUTPUT_EXCERPT_CHARS)
      : undefined,
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
        iterations: run.iterations.map((iter) => {
          if (iter.status === 'running') {
            return {
              ...iter,
              status: 'failed' as const,
              error: iter.error || 'Run interrupted after app restart.',
            };
          }
          return iter;
        }),
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

/**
 * Best-effort persist. The browser/Tauri webview's localStorage is typically
 * capped at 5MB. A long AutoResearch run can easily blow past that with
 * `liveOutputExcerpt` + `events` per run. We degrade gracefully: strip the
 * bulk field, then drop the oldest run, then drop all excerpts, then drop
 * the transcript/living doc snapshot fields. If we still fail, surface a
 * single error event on the active run so the user knows their last
 * iteration wasn't saved.
 *
 * AUDIT-FIX [audit-2-ar#2]: Quota-exhausted graceful degradation.
 * Previously a single `console.error` was the only signal of a quota
 * failure, and the user would silently lose iteration data. The
 * 3-step prune ladder is layered on top, with a `setHistoryPersistListener`
 * (registered in the autoresearch store) firing `addRunEvent` so the
 * failure is visible in the UI's run event log.
 *
 * AUDIT-FIX [audit-3-ar#5] further refines this to short-circuit when
 * storage is fundamentally unusable (probe write fails immediately)
 * rather than walking the 3-step ladder to no effect.
 */
export function persistAutoResearchHistory(runs: AutoResearchRunRecord[], selectedRunId: string | null): void {
  const storage = safeLocalStorage();
  if (!storage) {
    return;
  }

  const sorted = sortRuns(runs);
  const tryWrite = (overrides: Partial<AutoResearchRunRecord> = {}): Error | null => {
    try {
      const payload = compactHistory({
        version: 1,
        selectedRunId,
        runs: overrides.liveOutputExcerpt !== undefined
          ? sorted.map((run) => ({ ...run, ...overrides }))
          : sorted,
      } satisfies PersistedAutoResearchHistory);
      const serialized = JSON.stringify(payload);
      storage.setItem(AUTORESEARCH_HISTORY_STORAGE_KEY, serialized);
      return null;
    } catch (error) {
      return error instanceof Error ? error : new Error(String(error));
    }
  };

  const isQuotaError = (error: Error): boolean => {
    if (error.name === 'QuotaExceededError') return true;
    // Tauri webview (WebView2/WKWebView) may surface the quota as a
    // generic DOMException with code 22.
    if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
      return error.code === 22 || error.name === 'QuotaExceededError';
    }
    return false;
  };

  // AUDIT-FIX [audit-3-ar#5]: Storage-broken vs quota-exhausted distinction.
  // Previously any `setItem` failure was treated as a quota issue, then
  // walked through a 3-step prune ladder — which on a storage-broken
  // webview (SecurityError, storage disabled, private mode) generated the
  // same error 3 more times and then reported a misleading "history
  // cleared" to the user. We now write a tiny 1-byte probe first; if THAT
  // fails, storage is fundamentally unavailable and we short-circuit
  // with an honest "memory-only this session" notification.
  // Probe: can we even write a minimal payload? If a 1-key object fails,
  // localStorage is broken (SecurityError, storage disabled by user/admin,
  // private-browsing mode in some browsers). In that case the 3-step
  // prune ladder would just generate the same error 3 more times before
  // we give up — wasted work and misleading 'cleared' notification.
  const probeKey = `${AUTORESEARCH_HISTORY_STORAGE_KEY}::__probe__`;
  let storageIsBroken = false;
  try {
    storage.setItem(probeKey, '1');
    storage.removeItem(probeKey);
  } catch (probeError) {
    storageIsBroken = true;
    const detail = probeError instanceof Error ? probeError.message : String(probeError);
    console.error('AutoResearch localStorage is unusable:', probeError);
    notifyHistoryPersistFailure(
      `AutoResearch localStorage is unavailable (${detail}). `
      + 'Run history will only be kept in memory this session and lost on restart.',
    );
    return;
  }

  // First attempt: write everything as-is.
  let error: Error | null = tryWrite();
  if (!error) return;

  if (!isQuotaError(error)) {
    console.error('Failed to persist AutoResearch history:', error);
    notifyHistoryPersistFailure(`AutoResearch history write failed: ${error.message}`);
    return;
  }

  // Quota exhausted. Try a series of progressively more aggressive prunes.
  const steps: Array<{ label: string; transform: () => void }> = [
    {
      label: 'strip liveOutputExcerpt',
      transform: () => {
        // Mutate `sorted` in place via the override branch above.
        for (let i = 0; i < sorted.length; i += 1) {
          const run = sorted[i];
          sorted[i] = { ...run, liveOutputExcerpt: '' };
        }
      },
    },
    {
      label: 'drop oldest runs',
      transform: () => {
        // Keep the most recent half of runs.
        const keep = Math.max(1, Math.floor(sorted.length / 2));
        sorted.splice(0, sorted.length - keep);
      },
    },
    {
      label: 'drop events for old runs',
      transform: () => {
        for (let i = 0; i < sorted.length - 1; i += 1) {
          sorted[i] = { ...sorted[i], events: [] };
        }
      },
    },
  ];

  for (const step of steps) {
    step.transform();
    error = tryWrite();
    if (!error) {
      // Successfully recovered — notify so the user knows data was truncated.
      notifyHistoryPersistFailure(
        `AutoResearch localStorage quota hit. Auto-recovered by: ${step.label}. `
        + 'Older run data has been discarded to make room.',
      );
      return;
    }
    if (!isQuotaError(error)) {
      console.error('Failed to persist AutoResearch history (non-quota error):', error);
      notifyHistoryPersistFailure(`AutoResearch history write failed: ${error.message}`);
      return;
    }
  }

  // All fallbacks exhausted. Drop the entire history and surface a hard error.
  try {
    storage.removeItem(AUTORESEARCH_HISTORY_STORAGE_KEY);
  } catch (removeError) {
    console.error('Failed to clear AutoResearch history storage:', removeError);
  }
  console.error('AutoResearch history persistence completely failed (quota exhausted):', error);
  notifyHistoryPersistFailure(
    'AutoResearch localStorage is full. Run history has been cleared. '
    + 'Future iterations will not be saved until you free disk space.',
  );
}

let historyPersistFailureListener: ((message: string) => void) | null = null;

/**
 * Lets the AutoResearch store subscribe to persist failures so it can surface
 * them as a run event / status message. Wired in `setHistoryPersistListener`.
 */
export function setHistoryPersistListener(listener: ((message: string) => void) | null): void {
  historyPersistFailureListener = listener;
}

function notifyHistoryPersistFailure(message: string): void {
  if (historyPersistFailureListener) {
    try {
      historyPersistFailureListener(message);
    } catch (listenerError) {
      console.error('History persist listener threw:', listenerError);
    }
  }
}

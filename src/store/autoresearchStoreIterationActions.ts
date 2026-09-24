import type { StateCreator } from 'zustand';
import type { AutoResearchStore } from './autoresearchStoreTypes';
import {
  createRunEvent,
  isBetterMetric,
  toIterationRecord,
  updateRunRecord,
  withActiveRunUpdate,
} from './autoresearchStoreRecords';
import {
  clipLiveOutputBuffer,
  clipLiveOutputExcerptInMemory,
  redactAutoResearchSensitiveText,
  type AutoResearchIterationRecord,
} from '@/services/autoresearch/history';
import { patchAutoResearchResumeToken } from '@/services/autoresearch/resumeToken';

type AutoResearchStoreSet = Parameters<StateCreator<AutoResearchStore>>[0];
type AutoResearchStoreGet = Parameters<StateCreator<AutoResearchStore>>[1];
type AutoResearchIterationActions = Pick<AutoResearchStore,
  | 'incrementIteration'
  | 'addExperiment'
  | 'startIterationRecord'
  | 'completeIterationRecord'
  | 'patchIterationRecord'
  | 'addRunEvent'
  | 'updateBestMetric'
  | 'setBestMetric'
  | 'setPrimaryMetric'
  | 'setCurrentIterationValue'
  | 'incrementConsecutiveFailures'
  | 'resetConsecutiveFailures'
  | 'setExperiments'
  | 'setLiveOutput'
  | 'appendLiveOutput'
>;

export const createAutoResearchIterationActions: (
  set: AutoResearchStoreSet,
  _get: AutoResearchStoreGet,
) => AutoResearchIterationActions = (set, _get) => ({
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

      // AUDIT-FIX [R5-12]: Do not mutate `failureCount` here.
      // `incrementConsecutiveFailures` / `resetConsecutiveFailures` (and
      // `updateBestMetric`'s reset path) are the single source of truth for
      // both the live `consecutiveFailures` counter and the persisted
      // `run.failureCount`. Updating failureCount from experiment status
      // here raced those helpers and could disagree for auto-stop/backoff.
      return {
        ...run,
        updatedAt: entry.timestamp,
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
      // AUDIT-FIX [audit-2-ar#8]: Aligned with `MAX_PERSISTED_EVENTS_PER_RUN`
      // in history.ts so the persisted shape is always a strict subset
      // of the in-memory shape. Previously 200 vs 100 — every persist
      // truncated the in-memory tail to 100, then `serialized !== raw`
      // detected the difference and triggered a write-back. Now both
      // are 100 and persists are no-ops when nothing has changed.
      events: [...run.events, createRunEvent(run.id, input)].slice(-100),
    })),
  })),

  // AUDIT-FIX [R5-12]: Keep persisted failureCount in lockstep when
  // resetting consecutiveFailures on a new best metric.

  updateBestMetric: (value) => set((state) => ({
    bestMetric: value,
    consecutiveFailures: 0,
    ...withActiveRunUpdate(state, (run) => ({
      ...run,
      updatedAt: new Date().toISOString(),
      bestMetricValue: value,
      bestIteration: state.currentIteration || run.bestIteration,
      failureCount: 0,
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

  setCurrentIterationValue: (iteration) => set((state) => ({
    currentIteration: iteration,
    ...withActiveRunUpdate(state, (run) => ({
      ...run,
      updatedAt: new Date().toISOString(),
      currentIteration: iteration,
    })),
  })),

  // AUDIT-FIX [R5-12]: Source of truth for stop/backoff counters.
  // Live `consecutiveFailures` and persisted `run.failureCount` are updated
  // together so auto-stop (`consecutiveFailures >= 3`) and resume
  // (`activateHistoricalRun` → consecutiveFailures = failureCount) cannot diverge.

  incrementConsecutiveFailures: () => set((state) => {
    const next = state.consecutiveFailures + 1;
    return {
      consecutiveFailures: next,
      ...withActiveRunUpdate(state, (run) => ({
        ...run,
        updatedAt: new Date().toISOString(),
        failureCount: next,
      })),
    };
  }),

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
    liveOutput: clipLiveOutputBuffer(output),
    ...withActiveRunUpdate(state, (run) => ({
      ...run,
      updatedAt: new Date().toISOString(),
      // AUDIT-FIX [audit-2-ar#4]: In-memory excerpt path skips secret
      // redaction. `clipLiveOutputExcerptInMemory` is a pure slice;
      // redaction is paid once at persist time via
      // `redactLiveOutputExcerptForStorage` (in `compactRunRecord`).
      // Redacting on every token append was a CPU hotspot: 10+ regex
      // passes × 20KB string × 100+ appends/sec = multi-MB regex work
      // per second of streaming output.
      liveOutputExcerpt: clipLiveOutputExcerptInMemory(output),
    })),
  })),

  appendLiveOutput: (chunk) => set((state) => {
    const liveOutput = clipLiveOutputBuffer(state.liveOutput + chunk);
    return {
      liveOutput,
      ...withActiveRunUpdate(state, (run) => ({
        ...run,
        updatedAt: new Date().toISOString(),
        // AUDIT-FIX [audit-2-ar#4]: No redaction per-append — see setLiveOutput
        // above. The persisted shape is redacted at write time.
        liveOutputExcerpt: clipLiveOutputExcerptInMemory((run.liveOutputExcerpt || '') + chunk),
      })),
    };
  }),
});

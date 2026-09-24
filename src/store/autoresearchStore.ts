/**
 * AutoResearch Store — Zustand state for the autonomous experiment loop.
 *
 * Manages the live run state plus persistent run history used by the
 * AutoResearch page and agent panel.
 */

import { create } from 'zustand';
import { connectAutoResearchPersistence } from './autoresearchPersistence';
import type { AutoResearchStore } from './autoresearchStoreTypes';
import { createAutoResearchIterationActions } from './autoresearchStoreIterationActions';
import {
  createEmptySession,
  createRunEvent,
  sanitizeOptionalText,
  withActiveRunUpdate,
} from './autoresearchStoreRecords';
import { createAutoResearchRunActions } from './autoresearchStoreRunActions';
export {
  getActiveAutoResearchRun,
  getAutoResearchRunReason,
  getSelectedAutoResearchRun,
  getSelectedAutoResearchRunContext,
  getSortedAutoResearchRuns,
  isAutoResearchTerminalState,
  updateRunRecord,
} from './autoresearchStoreRecords';
export type {
  AutoResearchSelectedRunContext,
  AutoResearchStore,
  ExperimentEntry,
  ExperimentSession,
  ExperimentStatus,
  LoopState,
  TelegramNotifyConfig,
} from './autoresearchStoreTypes';
import {
  loadPersistedAutoResearchHistory,
  redactAutoResearchSensitiveText,
} from '@/services/autoresearch/history';
import {
  buildAutoResearchDefaultConfig,
  loadPersistedAutoResearchLastUsedConfig,
  persistAutoResearchLastUsedConfig,
} from '@/services/autoresearch/defaultConfig';
import {
  patchAutoResearchResumeToken,
} from '@/services/autoresearch/resumeToken';
import { withSshConfigDefaults } from '@/types/ssh';
import type { ExecMode, SshAuthMode, SshConfig } from '@/types/ssh';
export { flushAutoResearchPersistOnClose } from './autoresearchPersistence';

export type { AutoResearchIterationRecord, AutoResearchRunRecord, AutoResearchRunStatus } from '@/services/autoresearch/history';

// ============== Shared SSH Types ==============
// Imported from centralized types to avoid duplication
export type { SshConfig, ExecMode, SshAuthMode };
export { withSshConfigDefaults };

// ============== Types ==============

const persistedHistory = loadPersistedAutoResearchHistory();
const persistedLastUsedConfig = loadPersistedAutoResearchLastUsedConfig();

export const useAutoResearchStore = create<AutoResearchStore>((set, get) => ({
  ...createEmptySession(),
  runHistory: persistedHistory.runs,
  selectedRunId: persistedHistory.selectedRunId,
  lastUsedConfig: persistedLastUsedConfig,
  showSetupModal: false,
  ...createAutoResearchRunActions(set, get),
  ...createAutoResearchIterationActions(set, get),

  setLoopState: (loopState) => set({ loopState }),

  setCurrentPhase: (currentPhase) => set((state) => ({
    ...withActiveRunUpdate(state, (run) => ({
      ...run,
      updatedAt: new Date().toISOString(),
      currentPhase,
    })),
  })),

  setRunStatus: (status, options) => set((state) => {
    const updatedAt = options?.endedAt ?? new Date().toISOString();
    const clearReason = ['running', 'waiting_rate_limit', 'paused', 'completed', 'stopped'].includes(status);
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
          : patchAutoResearchResumeToken(
            run.resumeToken,
            status === 'running' || status === 'waiting_rate_limit' || status === 'interrupted' || status === 'paused'
              ? { status }
              : {},
            updatedAt,
          ),
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

  acknowledgeReflectionFailure: () => set((state) => {
    const endedAt = new Date().toISOString();
    return {
      loopState: 'stopped' as const,
      errorMessage: undefined,
      statusMessage: undefined,
      reason: undefined,
      ...withActiveRunUpdate(state, (run) => ({
        ...run,
        status: 'stopped' as const,
        updatedAt: endedAt,
        endedAt,
        currentPhase: 'DONE' as const,
        summary: 'Reflection failure acknowledged.',
        reason: undefined,
        resumeToken: undefined,
      })),
    };
  }),

  setError: (msg) => set((state) => {
    const endedAt = new Date().toISOString();
    // AUDIT-FIX [audit-1-ar#4]: Empty error message fallback.
    // Callers occasionally pass `undefined` / null / empty when an
    // upstream error had no message. Without this, the UI shows a blank
    // error panel and the active run's `reason` is persisted as an
    // empty string in localStorage (and silently lost on reload).
    // Normalize the input and substitute a fixed fallback so the user
    // always sees something actionable + the run record is recoverable.
    const normalized = typeof msg === 'string' ? msg.trim() : '';
    const fallback = 'AutoResearch run stopped due to an unknown error. Check the event log for details.';
    const sanitizedMessage = redactAutoResearchSensitiveText(normalized || fallback);
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

  setSuccessCriteria: (successCriteria) => set({ successCriteria }),

  setBootstrapKind: (bootstrapKind) => set({ bootstrapKind }),

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
  setLastUsedConfig: (config) => {
    const lastUsedConfig = buildAutoResearchDefaultConfig(config);
    persistAutoResearchLastUsedConfig(lastUsedConfig);
    set({ lastUsedConfig });
  },
  clearLastUsedConfig: () => {
    persistAutoResearchLastUsedConfig(null);
    set({ lastUsedConfig: null });
  },
  setTelegramConfig: (cfg) => set((state) => ({
    telegramConfig: { ...state.telegramConfig, ...cfg },
  })),

  setShowSetupModal: (showSetupModal) => set({ showSetupModal }),
}));


connectAutoResearchPersistence({
  getState: () => useAutoResearchStore.getState(),
  subscribe: (listener) => useAutoResearchStore.subscribe((state) => listener(state)),
});

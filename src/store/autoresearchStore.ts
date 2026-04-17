/**
 * AutoResearch Store — Zustand state for the autonomous experiment loop.
 *
 * Manages experiment session lifecycle, iteration tracking, and UI state.
 */

import { create } from 'zustand';

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

export interface SshConfig {
  host: string;
  user: string;
  keyPath: string;
  port: number;
  remoteWorkDir: string;
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
  sessionFilePath: string;
  startedAt: string;
  experiments: ExperimentEntry[];
  sshConfig: SshConfig | null;
  telegramConfig: TelegramNotifyConfig;
  /** Live output from the currently running experiment */
  liveOutput: string;
  /** Currently selected experiment index for detail view (-1 = none) */
  selectedExperiment: number;
  /** Error message if loopState === 'error' */
  errorMessage?: string;
}

// ============== Default values ==============

const defaultTelegramConfig: TelegramNotifyConfig = {
  enabled: false,
  chatId: null,
  notifyOnImproved: true,
  notifyOnFailed: true,
  trendReportInterval: 10,
};

function createEmptySession(): ExperimentSession {
  return {
    id: '',
    loopState: 'idle',
    currentIteration: 0,
    maxIterations: 50,
    bestMetric: null,
    metricDirection: 'lower',
    metricName: 'val_bpb',
    consecutiveFailures: 0,
    sessionFilePath: '~/.pipi-shrimp/autoresearch/session.md',
    startedAt: '',
    experiments: [],
    sshConfig: null,
    telegramConfig: { ...defaultTelegramConfig },
    liveOutput: '',
    selectedExperiment: -1,
  };
}

// ============== Store ==============

interface AutoResearchStore extends ExperimentSession {
  // Session lifecycle
  initSession: (opts: {
    id: string;
    maxIterations: number;
    metricName: string;
    metricDirection: 'lower' | 'higher';
    sshConfig: SshConfig;
    sessionFilePath?: string;
    telegramConfig?: Partial<TelegramNotifyConfig>;
  }) => void;

  resetSession: () => void;

  // Loop control
  setLoopState: (state: LoopState) => void;
  setError: (msg: string) => void;

  // Iteration tracking
  incrementIteration: () => void;
  addExperiment: (entry: ExperimentEntry) => void;
  updateBestMetric: (value: number) => void;
  incrementConsecutiveFailures: () => void;
  resetConsecutiveFailures: () => void;

  // UI state
  setLiveOutput: (output: string) => void;
  appendLiveOutput: (chunk: string) => void;
  setSelectedExperiment: (idx: number) => void;

  // Config
  setSshConfig: (cfg: SshConfig) => void;
  setTelegramConfig: (cfg: Partial<TelegramNotifyConfig>) => void;

  // Setup modal
  showSetupModal: boolean;
  setShowSetupModal: (show: boolean) => void;
}

export const useAutoResearchStore = create<AutoResearchStore>((set) => ({
  ...createEmptySession(),
  showSetupModal: false,

  initSession: (opts) => set({
    id: opts.id,
    loopState: 'running',
    currentIteration: 0,
    maxIterations: opts.maxIterations,
    bestMetric: null,
    metricDirection: opts.metricDirection,
    metricName: opts.metricName,
    consecutiveFailures: 0,
    sessionFilePath: opts.sessionFilePath || '~/.pipi-shrimp/autoresearch/session.md',
    startedAt: new Date().toISOString(),
    experiments: [],
    sshConfig: opts.sshConfig,
    telegramConfig: { ...defaultTelegramConfig, ...opts.telegramConfig },
    liveOutput: '',
    selectedExperiment: -1,
    errorMessage: undefined,
  }),

  resetSession: () => set(createEmptySession()),

  setLoopState: (state) => set({ loopState: state }),
  setError: (msg) => set({ loopState: 'error', errorMessage: msg }),

  incrementIteration: () => set((s) => ({ currentIteration: s.currentIteration + 1 })),

  addExperiment: (entry) => set((s) => ({
    experiments: [...s.experiments, entry],
  })),

  updateBestMetric: (value) => set({ bestMetric: value, consecutiveFailures: 0 }),

  incrementConsecutiveFailures: () => set((s) => ({
    consecutiveFailures: s.consecutiveFailures + 1,
  })),

  resetConsecutiveFailures: () => set({ consecutiveFailures: 0 }),

  setLiveOutput: (output) => set({ liveOutput: output }),
  appendLiveOutput: (chunk) => set((s) => ({ liveOutput: s.liveOutput + chunk })),
  setSelectedExperiment: (idx) => set({ selectedExperiment: idx }),

  setSshConfig: (cfg) => set({ sshConfig: cfg }),
  setTelegramConfig: (cfg) => set((s) => ({
    telegramConfig: { ...s.telegramConfig, ...cfg },
  })),

  setShowSetupModal: (show) => set({ showSetupModal: show }),
}));

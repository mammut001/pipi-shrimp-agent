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

export type ExecMode = 'local' | 'ssh';
export type SshAuthMode = 'agent' | 'password' | 'key';

export interface SshConfig {
  /** Execution mode. Defaults to 'ssh' for backward compatibility. */
  mode: ExecMode;
  host: string;
  user: string;
  /** Used only when mode='ssh' && authMode='key'. */
  keyPath: string;
  port: number;
  /** Target working directory (remote for mode=ssh, local for mode=local). */
  remoteWorkDir: string;
  /** SSH auth strategy. Defaults to 'agent' (plain `ssh user@host`). */
  authMode: SshAuthMode;
  /**
   * Password for authMode='password'. Held in-memory only (Zustand store);
   * never persisted to disk, never sent to remote commands via argv.
   */
  password: string;
}

/** Merge partial config with defaults; also normalizes legacy sessions. */
export function withSshConfigDefaults(partial: Partial<SshConfig> | null | undefined): SshConfig {
  return {
    mode: partial?.mode ?? 'ssh',
    host: partial?.host ?? '',
    user: partial?.user ?? '',
    keyPath: partial?.keyPath ?? '',
    port: partial?.port ?? 22,
    remoteWorkDir: partial?.remoteWorkDir ?? '',
    authMode: partial?.authMode ?? 'agent',
    password: partial?.password ?? '',
  };
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
  experimentDir: string;
  sessionFilePath: string;
  livingDocPath: string;
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
  /** Embedded PTY terminal state for AutoResearch runs */
  terminalVisible: boolean;
  terminalReady: boolean;
  terminalSessionId: string | null;
  terminalCwd: string;
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
    experimentDir: '',
    sessionFilePath: '',
    livingDocPath: '',
    startedAt: '',
    experiments: [],
    sshConfig: null,
    telegramConfig: { ...defaultTelegramConfig },
    liveOutput: '',
    selectedExperiment: -1,
    terminalVisible: false,
    terminalReady: false,
    terminalSessionId: null,
    terminalCwd: '',
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
    experimentDir?: string;
    sessionFilePath?: string;
    livingDocPath?: string;
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
  setBestMetric: (value: number | null) => void;
  setCurrentIterationValue: (iteration: number) => void;
  incrementConsecutiveFailures: () => void;
  resetConsecutiveFailures: () => void;
  setExperiments: (entries: ExperimentEntry[]) => void;

  // UI state
  setLiveOutput: (output: string) => void;
  appendLiveOutput: (chunk: string) => void;
  setSelectedExperiment: (idx: number) => void;
  openTerminalPanel: (sessionId: string, cwd: string) => void;
  setTerminalReady: (ready: boolean) => void;
  setTerminalVisible: (visible: boolean) => void;
  setTerminalCwd: (cwd: string) => void;

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
    experimentDir: opts.experimentDir || opts.sshConfig.remoteWorkDir || '',
    sessionFilePath: opts.sessionFilePath || '',
    livingDocPath: opts.livingDocPath || '',
    startedAt: new Date().toISOString(),
    experiments: [],
    sshConfig: withSshConfigDefaults(opts.sshConfig),
    telegramConfig: { ...defaultTelegramConfig, ...opts.telegramConfig },
    liveOutput: '',
    selectedExperiment: -1,
    errorMessage: undefined,
    terminalVisible: false,
    terminalReady: false,
    terminalSessionId: null,
    terminalCwd: opts.sshConfig.remoteWorkDir || '',
  }),

  resetSession: () => set(createEmptySession()),

  setLoopState: (state) => set({ loopState: state }),
  setError: (msg) => set({ loopState: 'error', errorMessage: msg }),

  incrementIteration: () => set((s) => ({ currentIteration: s.currentIteration + 1 })),

  addExperiment: (entry) => set((s) => ({
    experiments: [...s.experiments, entry],
  })),

  updateBestMetric: (value) => set({ bestMetric: value, consecutiveFailures: 0 }),
  setBestMetric: (value) => set({ bestMetric: value }),
  setCurrentIterationValue: (iteration) => set({ currentIteration: iteration }),

  incrementConsecutiveFailures: () => set((s) => ({
    consecutiveFailures: s.consecutiveFailures + 1,
  })),

  resetConsecutiveFailures: () => set({ consecutiveFailures: 0 }),
  setExperiments: (entries) => set({ experiments: entries }),

  setLiveOutput: (output) => set({ liveOutput: output }),
  appendLiveOutput: (chunk) => set((s) => ({ liveOutput: s.liveOutput + chunk })),
  setSelectedExperiment: (idx) => set({ selectedExperiment: idx }),
  openTerminalPanel: (sessionId, cwd) => set({
    terminalVisible: true,
    terminalReady: false,
    terminalSessionId: sessionId,
    terminalCwd: cwd,
  }),
  setTerminalReady: (ready) => set({ terminalReady: ready }),
  setTerminalVisible: (visible) => set({ terminalVisible: visible }),
  setTerminalCwd: (cwd) => set({ terminalCwd: cwd }),

  setSshConfig: (cfg) => set({ sshConfig: withSshConfigDefaults(cfg) }),
  setTelegramConfig: (cfg) => set((s) => ({
    telegramConfig: { ...s.telegramConfig, ...cfg },
  })),

  setShowSetupModal: (show) => set({ showSetupModal: show }),
}));

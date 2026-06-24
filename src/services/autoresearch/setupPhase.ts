import type { AutoResearchRunStatus } from './history';
import type { AutoResearchConnectionTestStatus } from './setupFlow';

/**
 * Display-oriented lifecycle phase for AutoResearch setup and run UI.
 * Derived from scattered store fields — not a runtime state machine.
 */
export type AutoResearchSetupPhase =
  | 'configuring'
  | 'checking_environment'
  | 'bootstrapping'
  | 'bootstrap_ready'
  | 'starting_run'
  | 'running'
  | 'paused'
  | 'stopped'
  | 'failed'
  | 'completed';

/**
 * Mirrors `LoopState` from `src/store/autoresearchStore.ts`.
 * Defined locally to keep this module free of Zustand/store imports (cycle avoidance).
 */
export type SetupPhaseLoopState = 'idle' | 'running' | 'paused' | 'stopped' | 'error';

export interface DeriveAutoResearchSetupPhaseInput {
  connectionStatus?: AutoResearchConnectionTestStatus | null;
  bootstrapKind?: 'conversational' | 'manual' | null;
  bootstrapStreaming?: boolean;
  bootstrapReady?: boolean;
  startingRun?: boolean;
  loopState?: SetupPhaseLoopState | null;
  activeRunStatus?: AutoResearchRunStatus | null;
  error?: string | null;
}

const TERMINAL_PHASES: ReadonlySet<AutoResearchSetupPhase> = new Set([
  'stopped',
  'failed',
  'completed',
]);

/**
 * Maps existing AutoResearch fields into a single display phase.
 *
 * Precedence (highest wins):
 * 1. `activeRunStatus === 'completed'` → completed (wins over stale `error` banners)
 * 2. Non-empty `error` → failed
 * 3. `activeRunStatus` in failed / reflection_failed / interrupted, or `loopState === 'error'` → failed
 * 4. `activeRunStatus === 'stopped'` or `loopState === 'stopped'` → stopped
 * 5. `loopState === 'paused'` → paused
 * 6. `activeRunStatus` in running / waiting_rate_limit, or `loopState === 'running'` → running
 * 7. `startingRun` → starting_run
 * 8. `bootstrapReady` → bootstrap_ready
 * 9. `bootstrapStreaming` → bootstrapping
 * 10. `connectionStatus === 'testing'` → checking_environment
 * 11. Otherwise → configuring
 *
 * `bootstrapKind` is accepted for forward-compatible callers but does not change the phase yet.
 */
export function deriveAutoResearchSetupPhase(
  input: DeriveAutoResearchSetupPhaseInput,
): AutoResearchSetupPhase {
  const {
    connectionStatus,
    bootstrapStreaming,
    bootstrapReady,
    startingRun,
    loopState,
    activeRunStatus,
    error,
  } = input;

  if (activeRunStatus === 'completed') {
    return 'completed';
  }

  if (error) {
    return 'failed';
  }

  if (
    activeRunStatus === 'failed'
    || activeRunStatus === 'reflection_failed'
    || activeRunStatus === 'interrupted'
    || loopState === 'error'
  ) {
    return 'failed';
  }

  if (activeRunStatus === 'stopped' || loopState === 'stopped') {
    return 'stopped';
  }

  if (loopState === 'paused') {
    return 'paused';
  }

  if (
    activeRunStatus === 'running'
    || activeRunStatus === 'waiting_rate_limit'
    || loopState === 'running'
  ) {
    return 'running';
  }

  if (startingRun) {
    return 'starting_run';
  }

  if (bootstrapReady) {
    return 'bootstrap_ready';
  }

  if (bootstrapStreaming) {
    return 'bootstrapping';
  }

  if (connectionStatus === 'testing') {
    return 'checking_environment';
  }

  return 'configuring';
}

const PHASE_LABELS: Record<'en-US' | 'zh-CN', Record<AutoResearchSetupPhase, string>> = {
  'en-US': {
    configuring: 'Configuring',
    checking_environment: 'Checking environment',
    bootstrapping: 'Bootstrapping',
    bootstrap_ready: 'Bootstrap ready',
    starting_run: 'Starting run',
    running: 'Running',
    paused: 'Paused',
    stopped: 'Stopped',
    failed: 'Failed',
    completed: 'Completed',
  },
  'zh-CN': {
    configuring: '配置中',
    checking_environment: '检查运行环境',
    bootstrapping: '生成脚手架',
    bootstrap_ready: '脚手架已就绪',
    starting_run: '正在启动',
    running: '运行中',
    paused: '已暂停',
    stopped: '已停止',
    failed: '失败',
    completed: '已完成',
  },
};

export function formatAutoResearchSetupPhaseLabel(
  phase: AutoResearchSetupPhase,
  locale: 'en-US' | 'zh-CN' = 'en-US',
): string {
  return PHASE_LABELS[locale][phase];
}

export function isTerminalAutoResearchSetupPhase(phase: AutoResearchSetupPhase): boolean {
  return TERMINAL_PHASES.has(phase);
}

export type AutoResearchSetupPhaseTone = 'neutral' | 'active' | 'success' | 'warning' | 'danger';

const PHASE_TONES: Record<AutoResearchSetupPhase, AutoResearchSetupPhaseTone> = {
  configuring: 'neutral',
  checking_environment: 'active',
  bootstrapping: 'active',
  bootstrap_ready: 'success',
  starting_run: 'active',
  running: 'active',
  paused: 'warning',
  stopped: 'neutral',
  failed: 'danger',
  completed: 'success',
};

export function getAutoResearchSetupPhaseTone(
  phase: AutoResearchSetupPhase,
): AutoResearchSetupPhaseTone {
  return PHASE_TONES[phase];
}
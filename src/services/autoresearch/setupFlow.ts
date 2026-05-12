import { t } from '@/i18n';
import {
  getActiveAutoResearchRun,
  isAutoResearchTerminalState,
  useAutoResearchStore,
  type SshConfig,
} from '@/store/autoresearchStore';
import type { AutoResearchAgentConfigSnapshot } from './errors';
import { formatError } from './errors';
import { createAutoResearchRunId } from './history';
import { assertSupportedPlatform } from './platformGuard';
import { buildAutoResearchDefaultConfig, normalizeDirection, type AutoResearchDefaultConfig } from './defaultConfig';
import { sanitizePathInput } from './pathInput';
import type { AutoResearchPreflightResult } from './preflight';

export type AutoResearchConnectionTestStatus = 'idle' | 'testing' | 'success' | 'error';

export interface AutoResearchSetupDraft {
  sshConfig: SshConfig;
  experimentDir: string;
  metric: string;
  direction: unknown;
  iterations: number;
  baselineInput: string;
  agentConfigError?: string;
  requireConnectionTest?: boolean;
  connectionTestStatus?: AutoResearchConnectionTestStatus;
}

export interface AutoResearchValidatedSetup {
  sshConfig: SshConfig;
  experimentDir: string;
  metric: string;
  direction: 'higher' | 'lower';
  iterations: number;
  baseline: number | null;
}

interface StartCallbacks {
  setSshConfig: (cfg: SshConfig) => void;
  setLastUsedConfig: (config: AutoResearchDefaultConfig) => void;
  initSession: (opts: {
    id: string;
    maxIterations: number;
    metricName: string;
    metricDirection: 'lower' | 'higher';
    sshConfig: SshConfig;
    experimentDir?: string;
    sessionFilePath?: string;
    livingDocPath?: string;
    baseline?: number | null;
    agentConfigSnapshot?: AutoResearchAgentConfigSnapshot;
  }) => void;
}

export interface StartAutoResearchRunResult {
  sessionId: string;
  resolvedConfig: SshConfig;
  preflight: AutoResearchPreflightResult;
}

export function parseOptionalBaseline(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function sanitizeSshConfig(cfg: SshConfig): SshConfig {
  return {
    ...cfg,
    host: cfg.host.trim(),
    user: cfg.user.trim(),
    keyPath: cfg.keyPath.trim(),
    remoteWorkDir: sanitizePathInput(cfg.remoteWorkDir, { trim: true }),
  };
}

export function validateAutoResearchSetupDraft(draft: AutoResearchSetupDraft): {
  error: string | null;
  value: AutoResearchValidatedSetup | null;
} {
  if (draft.agentConfigError) {
    return { error: draft.agentConfigError, value: null };
  }

  const baseline = parseOptionalBaseline(draft.baselineInput);
  if (draft.baselineInput.trim().length > 0 && baseline === null) {
    return { error: t('autoresearch.validationBaselineNumber'), value: null };
  }

  const sshConfig = sanitizeSshConfig(draft.sshConfig);
  const experimentDir = sanitizePathInput(draft.experimentDir, { trim: true });
  const metric = draft.metric.trim();
  const normalizedDefaults = buildAutoResearchDefaultConfig({
    direction: draft.direction,
    iterations: draft.iterations,
  });

  if (sshConfig.mode === 'ssh') {
    if (!sshConfig.host) {
      return { error: t('autoresearch.validationHostRequired'), value: null };
    }
    if (!sshConfig.user) {
      return { error: t('autoresearch.validationUserRequired'), value: null };
    }
    if (sshConfig.authMode === 'password' && !sshConfig.password) {
      return { error: t('autoresearch.validationPasswordRequired'), value: null };
    }
    if (sshConfig.authMode === 'key' && !sshConfig.keyPath) {
      return { error: t('autoresearch.validationKeyPathRequired'), value: null };
    }
  }

  if (!sshConfig.remoteWorkDir) {
    return { error: t('autoresearch.validationWorkdirRequired'), value: null };
  }
  if (!experimentDir) {
    return { error: t('autoresearch.validationExperimentDirRequired'), value: null };
  }
  if (!metric) {
    return { error: t('autoresearch.validationMetricRequired'), value: null };
  }
  if (draft.requireConnectionTest && draft.connectionTestStatus !== 'success') {
    return { error: t('autoresearch.connectionTestRequired'), value: null };
  }

  return {
    error: null,
    value: {
      sshConfig,
      experimentDir,
      metric,
      direction: normalizeDirection(normalizedDefaults.direction),
      iterations: normalizedDefaults.iterations,
      baseline,
    },
  };
}

export function logAutoResearchSetupFailure(phase: string, error: unknown, context?: Record<string, unknown>): string {
  console.error(`[AutoResearch setup] ${phase} failed`, {
    ...context,
    error,
  });
  return formatError(error);
}

function assertNoConcurrentAutoResearchRun(): void {
  const state = useAutoResearchStore.getState();
  const activeRun = getActiveAutoResearchRun(state);
  const activeRunInProgress = Boolean(activeRun && !isAutoResearchTerminalState(activeRun.status));
  const loopBusy = Boolean(state.id) && (state.loopState === 'running' || state.loopState === 'paused');

  if (!activeRunInProgress && !loopBusy) {
    return;
  }

  throw new Error('Another AutoResearch run is already in progress. Stop it or wait for it to finish before starting a new run.');
}

export async function startAutoResearchRun(
  setup: AutoResearchValidatedSetup,
  callbacks: StartCallbacks,
): Promise<StartAutoResearchRunResult> {
  await assertSupportedPlatform();
  assertNoConcurrentAutoResearchRun();

  const sessionId = createAutoResearchRunId();
  const [
    { runAutoResearchPreflight },
    { resolveAutoResearchRunConfig },
    { ensureSessionDir, getSessionRunPaths, writeTargetText },
  ] = await Promise.all([
    import('./preflight'),
    import('./runConfig'),
    import('./runDir'),
  ]);
  const runConfig = resolveAutoResearchRunConfig();
  const preflight = await runAutoResearchPreflight({
    sshConfig: setup.sshConfig,
    experimentDir: setup.experimentDir,
    workDir: setup.sshConfig.remoteWorkDir,
    sessionId,
    agentConfig: runConfig.agentConfig,
  });

  const resolvedConfig = {
    ...setup.sshConfig,
    remoteWorkDir: preflight.resolvedWorkDir,
  };

  await ensureSessionDir(resolvedConfig, sessionId);
  const sessionPaths = getSessionRunPaths(resolvedConfig, sessionId);
  await writeTargetText(
    resolvedConfig,
    sessionPaths.runConfigPath,
    `${JSON.stringify(runConfig.runConfigSnapshot, null, 2)}\n`,
  );

  callbacks.setSshConfig(resolvedConfig);
  callbacks.setLastUsedConfig({
    workdir: preflight.resolvedWorkDir,
    experimentDir: preflight.resolvedExperimentDir,
    metric: setup.metric,
    direction: setup.direction,
    iterations: setup.iterations,
  });
  callbacks.initSession({
    id: sessionId,
    maxIterations: setup.iterations,
    metricName: setup.metric,
    metricDirection: setup.direction,
    baseline: setup.baseline,
    sshConfig: resolvedConfig,
    experimentDir: preflight.resolvedExperimentDir,
    sessionFilePath: preflight.sessionFilePath,
    livingDocPath: preflight.livingDocPath,
    agentConfigSnapshot: runConfig.snapshot,
  });

  const [{ createAutoResearchSendMessage }, { startExperimentLoop }] = await Promise.all([
    import('./chatAdapter'),
    import('./loopEngine'),
  ]);

  const sendMessage = createAutoResearchSendMessage(
    preflight.resolvedExperimentDir,
    runConfig.agentConfig,
    {
      environmentSummary: preflight.environmentSummary,
      metricName: setup.metric,
      direction: setup.direction,
      maxIterations: setup.iterations,
      reflectionConfig: runConfig.reflectionConfig,
    },
  );

  void startExperimentLoop(sendMessage).catch((error) => {
    const message = logAutoResearchSetupFailure('loop-start', error, {
      sessionId,
      experimentDir: preflight.resolvedExperimentDir,
    });
    useAutoResearchStore.getState().setError(message);
  });

  return {
    sessionId,
    resolvedConfig,
    preflight,
  };
}

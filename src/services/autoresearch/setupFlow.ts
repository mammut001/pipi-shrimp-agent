import { t } from '@/i18n';
import {
  getActiveAutoResearchRun,
  isAutoResearchTerminalState,
  useAutoResearchStore,
  type ExperimentEntry,
  type SshConfig,
} from '@/store/autoresearchStore';
import type { AutoResearchAgentConfigSnapshot } from './errors';
import { formatError } from './errors';
import {
  createAutoResearchRunId,
  type AutoResearchIterationRecord,
  type AutoResearchResumeToken,
  type AutoResearchRunRecord,
} from './history';
import { assertSupportedPlatform } from './platformGuard';
import { buildAutoResearchDefaultConfig, normalizeDirection, type AutoResearchDefaultConfig } from './defaultConfig';
import { sanitizePathInput } from './pathInput';
import { assertAutoResearchLifecycleUnlocked } from './runLock';
import type { AutoResearchPreflightResult } from './preflight';
import { sanitizeAutoResearchResumeSshConfig } from './resumeToken';

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
  mode?: 'ml_experiment' | 'repo_self_improve';
  verificationCommands?: string[];
}

export interface AutoResearchValidatedSetup {
  sshConfig: SshConfig;
  experimentDir: string;
  metric: string;
  direction: 'higher' | 'lower';
  iterations: number;
  baseline: number | null;
  mode?: 'ml_experiment' | 'repo_self_improve';
  verificationCommands?: string[];
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
    mode?: 'ml_experiment' | 'repo_self_improve';
    verificationCommands?: string[];
  }) => void;
}

export interface StartAutoResearchRunResult {
  sessionId: string;
  resolvedConfig: SshConfig;
  preflight: AutoResearchPreflightResult;
}

export interface ResumeAutoResearchRunResult {
  sessionId: string;
  resolvedConfig: SshConfig;
  preflight: AutoResearchPreflightResult;
  pendingIteration: number;
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
  const isSelfImprove = draft.mode === 'repo_self_improve';
  const metric = isSelfImprove ? 'repo_health' : draft.metric.trim();
  const normalizedDefaults = buildAutoResearchDefaultConfig({
    direction: draft.direction,
    iterations: draft.iterations,
    mode: draft.mode,
    verificationCommands: draft.verificationCommands,
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
  if (!isSelfImprove && !metric) {
    return { error: t('autoresearch.validationMetricRequired'), value: null };
  }
  if (isSelfImprove) {
    const filteredCommands = (normalizedDefaults.verificationCommands ?? []).map(c => c.trim()).filter(Boolean);
    if (filteredCommands.length === 0) {
      return { error: 'At least one verification command is required in self-improve mode.', value: null };
    }
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
      mode: normalizedDefaults.mode,
      verificationCommands: normalizedDefaults.verificationCommands,
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
  assertAutoResearchLifecycleUnlocked(
    useAutoResearchStore.getState(),
    'start a new run',
  );
}

function toRecoveredExperimentStatus(
  run: AutoResearchRunRecord,
  iteration: AutoResearchIterationRecord,
): ExperimentEntry['status'] {
  if (iteration.status === 'failed') {
    return 'FAILED';
  }
  if (typeof iteration.metricValue === 'number' && run.bestIteration === iteration.index) {
    return 'IMPROVED';
  }
  return 'NOT_IMPROVED';
}

function buildRecoveredExperiments(run: AutoResearchRunRecord): ExperimentEntry[] {
  return run.iterations
    .filter((iteration) => iteration.status === 'completed' || iteration.status === 'failed')
    .map((iteration) => ({
      iteration: iteration.index,
      hypothesis: iteration.hypothesis || 'Recovered iteration',
      change: iteration.change || iteration.codeChangesSummary || 'N/A',
      metricValue: typeof iteration.metricValue === 'number' ? iteration.metricValue : null,
      status: toRecoveredExperimentStatus(run, iteration),
      failReason: iteration.error ?? undefined,
      reasoning: iteration.reasoning || iteration.reflectionSummary || iteration.narrative || '',
      timestamp: iteration.endedAt || iteration.startedAt || run.updatedAt,
      durationMs: iteration.durationMs ?? 0,
    }));
}

function getInterruptedRunForResume(runId: string): {
  run: AutoResearchRunRecord;
  token: AutoResearchResumeToken;
} {
  const state = useAutoResearchStore.getState();
  const run = state.runHistory.find((entry) => entry.id === runId);
  if (!run) {
    throw new Error('Interrupted AutoResearch run not found.');
  }
  if (run.status !== 'interrupted') {
    throw new Error('Only interrupted AutoResearch runs can be resumed.');
  }
  if (!run.resumeToken) {
    throw new Error('This interrupted run does not have a recovery token. Start a new run instead.');
  }
  if (!run.resumeToken.resumable) {
    throw new Error('This interrupted run cannot be resumed automatically. Start a new run instead.');
  }
  return {
    run,
    token: run.resumeToken,
  };
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
    mode: setup.mode ?? 'ml_experiment',
    verificationCommands: setup.verificationCommands ?? ['pnpm run build', 'pnpm test', 'node_modules/.bin/tsc --noEmit'],
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
    mode: setup.mode ?? 'ml_experiment',
    verificationCommands: setup.verificationCommands ?? ['pnpm run build', 'pnpm test', 'node_modules/.bin/tsc --noEmit'],
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

export async function resumeInterruptedAutoResearchRun(
  runId: string,
): Promise<ResumeAutoResearchRunResult> {
  await assertSupportedPlatform();
  assertAutoResearchLifecycleUnlocked(
    useAutoResearchStore.getState(),
    'resume the interrupted run',
  );

  const { run, token } = getInterruptedRunForResume(runId);
  const resumeSshConfig: SshConfig = {
    ...sanitizeAutoResearchResumeSshConfig(token.sshConfig),
    remoteWorkDir: token.sshConfig.remoteWorkDir || run.config.workdir,
  };

  const [
    { runAutoResearchPreflight },
    { resolveAutoResearchRunConfigFromSnapshotFile },
    { createAutoResearchSendMessage },
    { startExperimentLoop },
    { getSessionRunPaths, readTargetText },
  ] = await Promise.all([
    import('./preflight'),
    import('./runConfig'),
    import('./chatAdapter'),
    import('./loopEngine'),
    import('./runDir'),
  ]);

  const sessionPaths = getSessionRunPaths(resumeSshConfig, runId);
  const rawRunConfig = await readTargetText(resumeSshConfig, sessionPaths.runConfigPath);
  if (!rawRunConfig) {
    throw new Error('Saved AutoResearch run config snapshot is missing. Start a new run instead.');
  }

  let parsedRunConfig: Awaited<ReturnType<typeof resolveAutoResearchRunConfigFromSnapshotFile>>['runConfigSnapshot'];
  try {
    parsedRunConfig = JSON.parse(rawRunConfig) as Awaited<ReturnType<typeof resolveAutoResearchRunConfigFromSnapshotFile>>['runConfigSnapshot'];
  } catch (error) {
    throw new Error(`Saved AutoResearch run config snapshot is invalid: ${formatError(error)}`);
  }

  const runConfig = resolveAutoResearchRunConfigFromSnapshotFile(parsedRunConfig);
  const preflight = await runAutoResearchPreflight({
    sshConfig: resumeSshConfig,
    experimentDir: token.experimentDir || run.config.experimentDir,
    workDir: resumeSshConfig.remoteWorkDir,
    sessionId: runId,
    agentConfig: runConfig.agentConfig,
  });

  const resolvedConfig = {
    ...resumeSshConfig,
    remoteWorkDir: preflight.resolvedWorkDir,
  };
  const pendingIteration = Math.max(1, token.pendingIteration || run.currentIteration || 1);
  const nextToken: AutoResearchResumeToken = {
    ...token,
    status: 'running',
    sshConfig: sanitizeAutoResearchResumeSshConfig(resolvedConfig),
    experimentDir: preflight.resolvedExperimentDir,
    sessionFilePath: preflight.sessionFilePath,
    livingDocPath: preflight.livingDocPath,
    currentIteration: Math.max(0, pendingIteration - 1),
    pendingIteration,
    replayIteration: true,
    lastUpdatedAt: new Date().toISOString(),
  };

  useAutoResearchStore.getState().setLastUsedConfig({
    workdir: preflight.resolvedWorkDir,
    experimentDir: preflight.resolvedExperimentDir,
    metric: token.metricName || run.config.metric,
    direction: token.metricDirection || run.config.direction,
    iterations: token.maxIterations || run.config.iterations,
    mode: run.config.mode ?? 'ml_experiment',
    verificationCommands: run.config.verificationCommands ?? ['pnpm run build', 'pnpm test', 'node_modules/.bin/tsc --noEmit'],
  });
  useAutoResearchStore.getState().activateHistoricalRun({
    runId,
    sshConfig: resolvedConfig,
    experimentDir: preflight.resolvedExperimentDir,
    sessionFilePath: preflight.sessionFilePath,
    livingDocPath: preflight.livingDocPath,
    metricName: token.metricName || run.config.metric,
    metricDirection: token.metricDirection || run.config.direction,
    maxIterations: token.maxIterations || run.config.iterations,
    baseline: token.baseline ?? run.config.baseline ?? null,
    pendingIteration,
    agentConfigSnapshot: runConfig.snapshot,
    resumeToken: nextToken,
    experiments: buildRecoveredExperiments(run),
    liveOutput: run.liveOutputExcerpt || '',
  });

  const sendMessage = createAutoResearchSendMessage(
    preflight.resolvedExperimentDir,
    runConfig.agentConfig,
    {
      environmentSummary: preflight.environmentSummary,
      metricName: token.metricName || run.config.metric,
      direction: token.metricDirection || run.config.direction,
      maxIterations: token.maxIterations || run.config.iterations,
      reflectionConfig: runConfig.reflectionConfig,
    },
  );

  void startExperimentLoop(sendMessage).catch((error) => {
    const message = logAutoResearchSetupFailure('resume-loop-start', error, {
      sessionId: runId,
      experimentDir: preflight.resolvedExperimentDir,
      pendingIteration,
    });
    useAutoResearchStore.getState().setError(message);
  });

  return {
    sessionId: runId,
    resolvedConfig,
    preflight,
    pendingIteration,
  };
}

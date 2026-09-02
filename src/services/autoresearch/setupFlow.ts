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
import { isAbsoluteOrHomePath, sanitizePathInput } from './pathInput';
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
    preferredPythonCommand?: string;
    repoStatus?: 'clean' | 'dirty';
    dirtyFileCount?: number;
    gpuTelemetryAvailable?: boolean;
    gpuSummary?: string;
    gpuTemperatureC?: number | null;
    gpuFanSpeedPercent?: number | null;
    gpuUtilizationPercent?: number | null;
    gpuMemoryUsedMb?: number | null;
    gpuMemoryTotalMb?: number | null;
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
  if (!trimmed || !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed)) {
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
  if (!isAbsoluteOrHomePath(sshConfig.remoteWorkDir)) {
    return {
      error: t('autoresearch.validationWorkdirAbsolute') || 'AutoResearch workspace must be an absolute or home (~) path.',
      value: null,
    };
  }
  if (!experimentDir) {
    return { error: t('autoresearch.validationExperimentDirRequired'), value: null };
  }
  if (!isAbsoluteOrHomePath(experimentDir)) {
    return {
      error: t('autoresearch.validationExperimentDirAbsolute') || 'Target project must be an absolute or home (~) path.',
      value: null,
    };
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
  assertAutoResearchLifecycleUnlocked(
    useAutoResearchStore.getState(),
    'start a new run',
  );
}

function recordProjectAdaptationEvent(preflight: AutoResearchPreflightResult): void {
  const actions = preflight.environmentSummary.projectAdaptationActions ?? [];
  if (!preflight.environmentSummary.projectAutoAdapted || actions.length === 0) {
    return;
  }

  useAutoResearchStore.getState().addRunEvent({
    timestamp: new Date().toISOString(),
    level: 'info',
    phase: 'preflight',
    type: 'raw',
    message: `Project auto-adapted before AutoResearch start: ${actions.join('; ')}`,
    summary: 'Project auto-adapted.',
    metadata: {
      experimentDir: preflight.resolvedExperimentDir,
      actions,
      recommendedRunCommand: preflight.environmentSummary.recommendedRunCommand,
      inferredProjectType: preflight.environmentSummary.inferredProjectType,
      detectedEntryScript: preflight.environmentSummary.detectedEntryScript,
      detectedCommand: preflight.environmentSummary.detectedCommand,
      detectedResultFiles: preflight.environmentSummary.detectedResultFiles ?? [],
    },
  });
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
  const isResumable = run.status === 'interrupted' || run.status === 'paused' || run.resumeToken?.status === 'paused';
  if (!isResumable) {
    throw new Error('Only interrupted or paused AutoResearch runs can be resumed.');
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
  await assertSupportedPlatform(setup.sshConfig);
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
    metricName: setup.metric,
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
    preferredPythonCommand: preflight.environmentSummary.preferredPythonCommand,
    repoStatus: preflight.environmentSummary.repoStatus,
    dirtyFileCount: preflight.environmentSummary.dirtyFileCount,
    gpuTelemetryAvailable: preflight.environmentSummary.gpuTelemetryAvailable,
    gpuSummary: preflight.environmentSummary.gpuSummary,
    gpuTemperatureC: preflight.environmentSummary.gpuTemperatureC,
    gpuFanSpeedPercent: preflight.environmentSummary.gpuFanSpeedPercent,
    gpuUtilizationPercent: preflight.environmentSummary.gpuUtilizationPercent,
    gpuMemoryUsedMb: preflight.environmentSummary.gpuMemoryUsedMb,
    gpuMemoryTotalMb: preflight.environmentSummary.gpuMemoryTotalMb,
  });
  recordProjectAdaptationEvent(preflight);

  const [{ createAutoResearchSendMessage }, { startExperimentLoop }] = await Promise.all([
    import('./chatAdapter'),
    import('./loopEngine'),
  ]);

  // Wire a shared AbortController so `stopExperimentLoop()` can cancel an
  // in-flight LLM call (not just wait for the next iteration boundary).
  const abortController = new AbortController();
  const sendMessage = createAutoResearchSendMessage(
    preflight.resolvedExperimentDir,
    runConfig.agentConfig,
    {
      environmentSummary: preflight.environmentSummary,
      metricName: setup.metric,
      direction: setup.direction,
      maxIterations: setup.iterations,
      reflectionConfig: runConfig.reflectionConfig,
      signal: abortController.signal,
    },
  );

  void startExperimentLoop(sendMessage, {
    abortController,
    signal: abortController.signal,
  }).catch((error) => {
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
  const { run, token } = getInterruptedRunForResume(runId);
  const resumeSshConfig: SshConfig = {
    ...sanitizeAutoResearchResumeSshConfig(token.sshConfig),
    remoteWorkDir: token.sshConfig.remoteWorkDir || run.config.workdir,
  };
  await assertSupportedPlatform(resumeSshConfig);
  assertAutoResearchLifecycleUnlocked(
    useAutoResearchStore.getState(),
    'resume the interrupted run',
  );

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
    metricName: token.metricName || run.config.metric,
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
  recordProjectAdaptationEvent(preflight);

  // AUDIT-FIX [audit-2-ar#1]: Resume path AbortSignal wiring.
  // The first audit wired the AbortController in the START path; the
  // resume path was missed because it has its own call site. Without
  // this, clicking Stop on a resumed run only fired the top-of-loop
  // check — the in-flight LLM call inside `sendMessage` would keep
  // running until it returned, with no entry-side abort check (since
  // the signal was never passed in). This controller is shared
  // between `createAutoResearchSendMessage` and `startExperimentLoop`
  // exactly like the start path does.
  // Wire an AbortController that is shared between sendMessage (entry check)
  // and startExperimentLoop (top-of-loop check). Without this, a resumed run
  // would only honour stop signals at iteration boundaries — the in-flight LLM
  // call inside sendMessage would keep running. Mirrors the start path at
  // the top of this file.
  const resumeAbortController = new AbortController();

  const sendMessage = createAutoResearchSendMessage(
    preflight.resolvedExperimentDir,
    runConfig.agentConfig,
    {
      environmentSummary: preflight.environmentSummary,
      metricName: token.metricName || run.config.metric,
      direction: token.metricDirection || run.config.direction,
      maxIterations: token.maxIterations || run.config.iterations,
      reflectionConfig: runConfig.reflectionConfig,
      signal: resumeAbortController.signal,
    },
  );

  void startExperimentLoop(sendMessage, {
    abortController: resumeAbortController,
    signal: resumeAbortController.signal,
  }).catch((error) => {
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

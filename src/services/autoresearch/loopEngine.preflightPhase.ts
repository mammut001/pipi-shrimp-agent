/**
 * AutoResearch Loop Engine — preflight phase.
 *
 * Extracted from `loopEngine.startExperimentLoop` as part of AG-02
 * PR2a to shrink the loop state machine. The preflight is the
 * first half of the loop body: it sets up the run, validates the
 * host, and prepares the run-artifact tree before the first
 * iteration runs. It does not enter the per-iteration body; that
 * is the responsibility of the iteration phase (AG-02 PR2b).
 *
 * The function returns a discriminated union:
 *
 *   - { ok: true,  ctx }   — the iteration body should use `ctx`.
 *   - { ok: false, kind, error? } — the caller is responsible for
 *     surfacing the failure to the user, clearing the
 *     AbortController, and stopping the loop. The `kind` is a
 *     stable discriminator for tests and audit logs.
 *
 * Why a discriminated union and not `throw`? Two reasons:
 *
 *   1. The original code's failure path is *per-step*: each step
 *      has a different user-facing message ("SSH config not set"
 *      vs "sshpass unavailable" vs "Cannot reach remote target").
 *      A `throw` would collapse all of those into a generic error
 *      string the caller would have to re-parse.
 *   2. The preflight is best-effort in exactly one place
 *      (`applyBootstrapIfPresent`), so the test surface wants to
 *      assert the precise boundary where the function stops
 *      caring about a failure.
 *
 * Side effects (all observed by the integration test in
 * `loopEngine.integration.test.ts`):
 *
 *  - emits `run_started` and `phase_started` runtime events;
 *  - mutates the AutoResearch store via `setRunStatus`,
 *    `setCurrentPhase`, `setError`, `addRunEvent`,
 *    `setExperiments`, `setBestMetric`, `setCurrentIterationValue`;
 *  - performs Tauri IO through `prepareLoopStartupContext`,
 *    `getSessionRunPaths`, `hydrateSessionFromDisk`,
 *    `writeTargetText`, `rebuildLivingDoc`,
 *    `inspectAutoResearchEnvironment`, `executeTargetCommand`.
 *
 * The pure-helper extraction rules from
 * `docs/architecture/complexity-governance.md` §5 do not apply
 * here — this function has store/IO side effects by design.
 * The unit tests use `jest.mock` to stub the store and IO calls.
 */

import {
  useAutoResearchStore,
  type ExperimentEntry,
  type SshConfig,
} from '@/store/autoresearchStore';
import { ensureSshpassAvailable } from '@/utils/remoteExec';
import { assertSupportedPlatform } from './platformGuard';
import { applyBootstrapIfPresent } from './bootstrap/applyBootstrap';
import {
  inspectAutoResearchEnvironment,
  prepareLoopStartupContext,
  type AutoResearchEnvironmentSummary,
  type LoopStartupContext,
} from './preflight';
import {
  executeTargetCommand,
  getSessionRunPaths,
  writeTargetText,
  type SessionRunPaths,
} from './runDir';
import { rebuildLivingDoc } from './livingDoc';
import { readAllMetrics, summarize, type IterationMetrics } from './metricsStore';
import { createNotifier } from './notifier';
import { formatError } from './errors';
import { emitAutoResearchRuntimeEvent, setAutoResearchPhase } from './runtimeEvents';

// ---------------------------------------------------------------------------
// Helpers used only by the preflight phase. Kept here (not in a separate
// helpers file) because the iteration body does not call them. The
// `toExperimentEntry` helper is also re-used by the iteration body; we
// re-export it below so the iteration body can keep importing it from one
// stable location.
// ---------------------------------------------------------------------------

export function toExperimentEntry(record: IterationMetrics): ExperimentEntry {
  return {
    iteration: record.iteration,
    hypothesis: record.hypothesis,
    change: record.change || 'Applied via Agent tool calls',
    metricValue: record.metricValue,
    status: record.status,
    failReason: record.failReason,
    reasoning: record.reasoning || '',
    timestamp: record.finishedAt,
    durationMs: record.durationMs,
  };
}

export function buildDirtyRepoMessage(summary: AutoResearchEnvironmentSummary): string {
  return `Experiment repository has ${summary.dirtyFileCount} uncommitted change(s). AutoResearch will not reset a dirty repository automatically. Commit or stash those changes before starting a run.`;
}

export async function assertRemoteLinux(cfg: SshConfig): Promise<void> {
  if (cfg.mode !== 'ssh') {
    return;
  }
  const result = await executeTargetCommand({ ...cfg, remoteWorkDir: '' }, 'uname -s', 30);
  const platform = (result.stdout || '').trim();
  if (platform !== 'Linux') {
    throw new Error('Remote target must be Linux');
  }
}

export async function hydrateSessionFromDisk(
  cfg: SshConfig,
  sessionId: string,
  direction: 'lower' | 'higher',
): Promise<void> {
  const metrics = await readAllMetrics(cfg, sessionId, direction);
  const entries = metrics.map(toExperimentEntry);
  const best = summarize(metrics, direction).best;
  const lastIteration = metrics.reduce((max, entry) => Math.max(max, entry.iteration), 0);

  useAutoResearchStore.getState().setExperiments(entries);
  useAutoResearchStore.getState().setBestMetric(best?.metricValue ?? null);
  useAutoResearchStore.getState().setCurrentIterationValue(lastIteration);
}

// ---------------------------------------------------------------------------
// Preflight result shape.
// ---------------------------------------------------------------------------

export interface PreflightContext {
  cfg: SshConfig;
  notifier: ReturnType<typeof createNotifier>;
  sessionId: string;
  artifactCfg: LoopStartupContext['artifactCfg'];
  experimentCfg: LoopStartupContext['experimentCfg'];
  sessionPaths: SessionRunPaths;
  sessionContent: string;
  environmentSummary: AutoResearchEnvironmentSummary;
  /** workDir from LoopStartupContext — used by the iteration body
   *  to rebuild the living doc between iterations. */
  workDir: string;
  /** experimentDir from LoopStartupContext; iteration body calls it
   *  `bestSnapshotDir` because that is the name it uses downstream. */
  bestSnapshotDir: string;
}

export type PreflightFailure =
  | { ok: false; kind: 'no_ssh_config' }
  | { ok: false; kind: 'unsupported_platform'; error: string }
  | { ok: false; kind: 'remote_not_linux'; error: string }
  | { ok: false; kind: 'sshpass_unavailable'; error: string }
  | { ok: false; kind: 'startup_failed'; error: string }
  | { ok: false; kind: 'session_paths_failed'; error: string }
  | { ok: false; kind: 'artifacts_init_failed'; error: string }
  | { ok: false; kind: 'dirty_repo'; error: string }
  | { ok: false; kind: 'env_unreachable'; error: string };

export type PreflightResult = { ok: true; ctx: PreflightContext } | PreflightFailure;

// ---------------------------------------------------------------------------
// Preflight phase. Side-effect-heavy; returns a discriminated union.
// ---------------------------------------------------------------------------

export async function runExperimentLoopPreflight(): Promise<PreflightResult> {
  const store = useAutoResearchStore.getState();

  if (!store.sshConfig) {
    return { ok: false, kind: 'no_ssh_config' };
  }

  const notifier = createNotifier(store.telegramConfig);
  const sessionId = store.id;
  const cfg = store.sshConfig;

  try {
    await assertSupportedPlatform(cfg);
  } catch (error) {
    return { ok: false, kind: 'unsupported_platform', error: formatError(error) };
  }

  useAutoResearchStore.getState().setRunStatus('running', { summary: 'Run started.' });
  useAutoResearchStore.getState().setCurrentPhase('INIT');
  emitAutoResearchRuntimeEvent({
    level: 'info',
    phase: 'INIT',
    type: 'run_started',
    message: 'AutoResearch loop started.',
    summary: 'Run started.',
  });

  try {
    await assertRemoteLinux(cfg);
  } catch (error) {
    return { ok: false, kind: 'remote_not_linux', error: formatError(error) };
  }

  if (cfg.mode === 'ssh' && cfg.authMode === 'password') {
    const avail = await ensureSshpassAvailable();
    if (!avail.ok) {
      return { ok: false, kind: 'sshpass_unavailable', error: avail.hint ?? 'sshpass unavailable' };
    }
  }

  try {
    await applyBootstrapIfPresent(cfg, sessionId);
  } catch (error) {
    // Best-effort: a broken bootstrap metadata file must not stop the
    // run. Record a warn-level run event and continue.
    useAutoResearchStore.getState().addRunEvent({
      level: 'warn',
      phase: 'preflight',
      message: `Bootstrap metadata could not be applied: ${formatError(error)}`,
    });
  }

  let startup: LoopStartupContext;
  try {
    startup = await prepareLoopStartupContext(store);
  } catch (error) {
    return { ok: false, kind: 'startup_failed', error: formatError(error) };
  }

  const artifactCfg = startup.artifactCfg;
  const experimentCfg = startup.experimentCfg;
  let sessionPaths: SessionRunPaths;
  try {
    sessionPaths = getSessionRunPaths(artifactCfg, sessionId);
  } catch (error) {
    return { ok: false, kind: 'session_paths_failed', error: formatError(error) };
  }
  const sessionContent = startup.sessionContent;

  try {
    await hydrateSessionFromDisk(artifactCfg, sessionId, store.metricDirection);
    await writeTargetText(artifactCfg, sessionPaths.sessionFilePath, sessionContent);
    await rebuildLivingDoc(artifactCfg, sessionId, {
      startedAt: store.startedAt,
      workDir: startup.workDir,
      metricName: store.metricName,
      direction: store.metricDirection,
    });
    setAutoResearchPhase('READ_CONTEXT', {
      summary: 'Run artifacts initialized.',
      message: 'Run artifacts initialized.',
      metadata: {
        sessionDir: sessionPaths.sessionDir,
      },
    });
  } catch (error) {
    return {
      ok: false,
      kind: 'artifacts_init_failed',
      error: `Failed to initialize run artifacts: ${formatError(error)}`,
    };
  }

  let environmentSummary: AutoResearchEnvironmentSummary;
  try {
    environmentSummary = await inspectAutoResearchEnvironment(experimentCfg, startup.experimentDir);
    if (environmentSummary.repoStatus !== 'clean') {
      emitAutoResearchRuntimeEvent({
        level: 'error',
        phase: 'READ_CONTEXT',
        type: 'provider_error',
        message: buildDirtyRepoMessage(environmentSummary),
        summary: 'Preflight failed because the repository is dirty.',
        metadata: {
          experimentDir: environmentSummary.experimentDir,
          dirtyFileCount: environmentSummary.dirtyFileCount,
        },
      });
      return { ok: false, kind: 'dirty_repo', error: buildDirtyRepoMessage(environmentSummary) };
    }
    emitAutoResearchRuntimeEvent({
      level: 'info',
      phase: 'READ_CONTEXT',
      type: 'phase_started',
      message: `Environment ready: ${environmentSummary.preferredPythonCommand}, git ${environmentSummary.repoStatus}.`,
      summary: 'Environment ready.',
      metadata: {
        experimentDir: environmentSummary.experimentDir,
        recommendedRunCommand: environmentSummary.recommendedRunCommand,
        dirtyFileCount: environmentSummary.dirtyFileCount,
      },
    });
  } catch (error) {
    const where = experimentCfg.mode === 'local' ? 'local experiment directory' : 'remote target';
    return { ok: false, kind: 'env_unreachable', error: `Cannot reach ${where}: ${formatError(error)}` };
  }

  return {
    ok: true,
    ctx: {
      cfg,
      notifier,
      sessionId,
      artifactCfg,
      experimentCfg,
      sessionPaths,
      sessionContent,
      environmentSummary,
      workDir: startup.workDir,
      bestSnapshotDir: startup.experimentDir,
    },
  };
}

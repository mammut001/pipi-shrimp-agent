/**
 * AutoResearch Loop Engine — Autonomous experiment cycle state machine.
 */

import { useAutoResearchStore, type ExperimentEntry, type ExperimentStatus, type SshConfig } from '@/store/autoresearchStore';
import { logExperiment } from './expLogger';
import { rollback, isRemoteClean, getRemoteDiff } from './rollback';
import { createNotifier } from './notifier';
import { describeTarget, ensureSshpassAvailable, shellEscapePath } from '@/utils/remoteExec';
import { assertSupportedPlatform } from './platformGuard';
import {
  appendIterationMetrics,
  readAllMetrics,
  summarize,
  type IterationMetrics,
} from './metricsStore';
import {
  captureCommitHash,
  createRunDir,
  getSessionRunPaths,
  pathExistsOnTarget,
  readTargetText,
  writeTargetText,
  executeTargetCommand,
  type RunDir,
} from './runDir';
import { readLivingDoc, rebuildLivingDoc } from './livingDoc';
import { clearCurrentRunDir, setCurrentRunDir } from './terminalRunner';
import { formatError } from './errors';
import {
  getAutoResearchLivingDocPathFromWorkDir,
  getAutoResearchSessionFilePathFromWorkDir,
} from './paths';
import { resolveTargetPath } from './preflight';

interface ParsedResult {
  metricName: string;
  metricValue: number | null;
  status: ExperimentStatus;
  hypothesis: string;
  failReason?: string;
  extra?: Record<string, number | string | boolean>;
}

interface PromptInput {
  sessionContent: string;
  livingDoc: string;
  sshConfig: SshConfig;
  runDir: RunDir;
}

interface StartupContext {
  artifactCfg: SshConfig;
  experimentCfg: SshConfig;
  experimentDir: string;
  workDir: string;
  sessionContent: string;
}

function buildSystemPrompt({
  sessionContent,
  livingDoc,
  sshConfig,
  runDir,
}: PromptInput): string {
  const isLocal = sshConfig.mode === 'local';
  const envLine = isLocal
    ? `Executing directly on the local machine. Working directory: ${sshConfig.remoteWorkDir || '(current)'}.`
    : `Remote host via SSH — ${describeTarget(sshConfig)}.`;
  const toolCfgHint = isLocal
    ? `For every target-side command or file read/write, use ssh_exec / ssh_upload_file / ssh_read_file with mode="local" and remoteWorkDir="${sshConfig.remoteWorkDir}".`
    : `For every target-side command or file read/write, use ssh_exec / ssh_upload_file / ssh_read_file with mode="ssh", host="${sshConfig.host}", user="${sshConfig.user}", port=${sshConfig.port}, authMode="${sshConfig.authMode}"${sshConfig.authMode === 'key' ? `, keyPath="${sshConfig.keyPath}"` : ''}, remoteWorkDir="${sshConfig.remoteWorkDir}". Never ask for credentials.`;

  return `# AutoResearch Agent

## Role
You are running one autonomous experiment iteration inside Pipi-Shrimp AutoResearch.

## Environment
- Execution target: ${envLine}
- Tool config: ${toolCfgHint}
- Available tools: ssh_exec, ssh_upload_file, ssh_read_file, read_file, write_file, execute_command

## Session File
${sessionContent}

## Living AutoResearch Notes
${livingDoc || 'No prior iterations recorded yet.'}

## Iteration Workspace
- Iteration directory: ${runDir.iterDir}
- Hypothesis file: ${runDir.hypothesisPath}
- Metrics file: ${runDir.metricsPath}
- Diff file: ${runDir.diffPath}

## Requirements for this iteration
1. Do exactly one hypothesis/change/run/evaluate cycle.
2. Before making changes, confirm the repo state with ssh_exec("git status --porcelain").
3. Write a short hypothesis summary to ${runDir.hypothesisPath}.
4. Run the experiment command through ssh_exec so the user can watch the live terminal output.
5. After the run, write JSON to ${runDir.metricsPath} with:
   {"metricName":"<name>","metricValue":<number|null>,"status":"IMPROVED|NOT_IMPROVED|FAILED","hypothesis":"<one line>","failReason":"<optional>","extra":{"<optional>":"<optional>"}}
6. Also emit a final fallback line:
   EXPERIMENT_RESULT: metric_value=<number|null> status=<IMPROVED|NOT_IMPROVED|FAILED> hypothesis="<one line>"
   or
   EXPERIMENT_RESULT: metric_value=null status=FAILED fail_reason="<reason>" hypothesis="<one line>"
7. If the change is not improved or the run fails, revert your working tree before finishing.
8. Do not repeat dead ends from the living doc unless you have a materially different reason.
`;
}

function parseMetricNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    if (value.trim().toLowerCase() === 'null') {
      return null;
    }
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeParsedResult(
  candidate: Record<string, unknown>,
  metricName: string,
): ParsedResult | null {
  const hypothesis = String(candidate.hypothesis ?? candidate.hypothesis_text ?? '').trim();
  const status = String(candidate.status ?? '').trim() as ExperimentStatus;
  if (!hypothesis || !['IMPROVED', 'NOT_IMPROVED', 'FAILED'].includes(status)) {
    return null;
  }

  return {
    metricName: String(candidate.metricName ?? candidate.metric_name ?? metricName),
    metricValue: parseMetricNumber(candidate.metricValue ?? candidate.metric_value),
    status,
    hypothesis,
    failReason: candidate.failReason ? String(candidate.failReason) : candidate.fail_reason ? String(candidate.fail_reason) : undefined,
    extra: candidate.extra && typeof candidate.extra === 'object'
      ? candidate.extra as Record<string, number | string | boolean>
      : undefined,
  };
}

function parseExperimentResult(agentOutput: string, metricName: string): ParsedResult | null {
  const match = agentOutput.match(
    /EXPERIMENT_RESULT:\s*metric_value=(\S+)\s+status=(\S+)(?:\s+fail_reason="([^"]*)")?\s+hypothesis="([^"]*)"/,
  );
  if (!match) {
    return null;
  }

  const rawMetric = match[1];
  const parsed = rawMetric === 'null' ? null : Number.parseFloat(rawMetric);
  return {
    metricName,
    metricValue: Number.isFinite(parsed) ? parsed : null,
    status: match[2] as ExperimentStatus,
    failReason: match[3] || undefined,
    hypothesis: match[4],
  };
}

function assertNonEmptyString(fieldName: string, value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Invalid ${fieldName}: expected non-empty string`);
  }
}

async function ensureTargetDirectory(cfg: SshConfig, directoryPath: string): Promise<void> {
  const result = await executeTargetCommand(
    { ...cfg, remoteWorkDir: '' },
    `mkdir -p ${shellEscapePath(directoryPath)}`,
    60,
  );
  if ((result.exit_code ?? 0) !== 0) {
    throw new Error(result.stderr || `Failed to create workdir: ${directoryPath}`);
  }
}

function buildInitialSessionContent(): string {
  return `# AutoResearch Session\nInitialized at: ${new Date().toISOString()}\n`;
}

async function ensureSessionFileInitialized(cfg: SshConfig, sessionFilePath: string): Promise<string> {
  const existing = await readTargetText(cfg, sessionFilePath);
  if (existing !== null) {
    return existing;
  }

  const initialContent = buildInitialSessionContent();
  await writeTargetText(cfg, sessionFilePath, initialContent);
  return initialContent;
}

async function prepareStartupContext(store: ReturnType<typeof useAutoResearchStore.getState>): Promise<StartupContext> {
  const cfg = store.sshConfig;
  if (!cfg) {
    throw new Error('SSH config not set');
  }

  const workDirInput = cfg.remoteWorkDir;
  const experimentDirInput = store.experimentDir;
  const sessionFilePathInput = store.sessionFilePath || getAutoResearchSessionFilePathFromWorkDir(workDirInput);

  assertNonEmptyString('workdir', workDirInput);
  assertNonEmptyString('experimentDir', experimentDirInput);
  assertNonEmptyString('sessionFilePath', sessionFilePathInput);

  const resolvedWorkDir = await resolveTargetPath(cfg, 'workdir', workDirInput);
  const resolvedExperimentDir = await resolveTargetPath(cfg, 'experimentDir', experimentDirInput);
  const resolvedSessionFilePath = await resolveTargetPath(cfg, 'sessionFilePath', sessionFilePathInput);
  const resolvedLivingDocPath = getAutoResearchLivingDocPathFromWorkDir(resolvedWorkDir, store.id);

  const artifactCfg = { ...cfg, remoteWorkDir: resolvedWorkDir };
  const experimentCfg = { ...cfg, remoteWorkDir: resolvedExperimentDir };

  await ensureTargetDirectory(cfg, resolvedWorkDir);

  if (!await pathExistsOnTarget({ ...cfg, remoteWorkDir: '' }, resolvedExperimentDir)) {
    throw new Error(`Experiment directory does not exist: ${resolvedExperimentDir}`);
  }

  const sessionContent = await ensureSessionFileInitialized(artifactCfg, resolvedSessionFilePath);

  console.info('[AutoResearch] Startup paths', {
    resolvedWorkdir: resolvedWorkDir,
    experimentDir: resolvedExperimentDir,
    sessionFilePath: resolvedSessionFilePath,
    livingDocPath: resolvedLivingDocPath,
    metricName: store.metricName,
    direction: store.metricDirection,
    iterations: store.maxIterations,
    typeofSessionFilePath: typeof resolvedSessionFilePath,
    typeofExperimentDir: typeof resolvedExperimentDir,
  });

  useAutoResearchStore.setState({
    sshConfig: artifactCfg,
    experimentDir: resolvedExperimentDir,
    sessionFilePath: resolvedSessionFilePath,
    livingDocPath: resolvedLivingDocPath,
    terminalCwd: resolvedExperimentDir,
  });

  return {
    artifactCfg,
    experimentCfg,
    experimentDir: resolvedExperimentDir,
    workDir: resolvedWorkDir,
    sessionContent,
  };
}

async function parseIterationMetrics(
  cfg: SshConfig,
  runDir: RunDir,
  metricName: string,
  agentOutput: string,
): Promise<ParsedResult | null> {
  const metricsContent = await readTargetText(cfg, runDir.metricsPath);
  if (metricsContent) {
    try {
      const parsed = normalizeParsedResult(JSON.parse(metricsContent) as Record<string, unknown>, metricName);
      if (parsed) {
        return parsed;
      }
    } catch {
      // Fall back to regex parsing below.
    }
  }
  return parseExperimentResult(agentOutput, metricName);
}

function toExperimentEntry(record: IterationMetrics): ExperimentEntry {
  return {
    iteration: record.iteration,
    hypothesis: record.hypothesis,
    change: 'Applied via Agent tool calls',
    metricValue: record.metricValue,
    status: record.status,
    failReason: record.failReason,
    reasoning: '',
    timestamp: record.finishedAt,
    durationMs: record.durationMs,
  };
}

async function hydrateSessionFromDisk(cfg: SshConfig, sessionId: string, direction: 'lower' | 'higher'): Promise<void> {
  const metrics = await readAllMetrics(cfg, sessionId);
  const entries = metrics.map(toExperimentEntry);
  const best = summarize(metrics, direction).best;
  const lastIteration = metrics.reduce((max, entry) => Math.max(max, entry.iteration), 0);

  useAutoResearchStore.getState().setExperiments(entries);
  useAutoResearchStore.getState().setBestMetric(best?.metricValue ?? null);
  useAutoResearchStore.getState().setCurrentIterationValue(lastIteration);
}

async function writeRunStatus(
  cfg: SshConfig,
  runDir: RunDir,
  payload: Record<string, unknown>,
): Promise<void> {
  await writeTargetText(cfg, runDir.statusPath, `${JSON.stringify(payload, null, 2)}\n`);
}

async function assertRemoteLinux(cfg: SshConfig): Promise<void> {
  if (cfg.mode !== 'ssh') {
    return;
  }
  const result = await executeTargetCommand({ ...cfg, remoteWorkDir: '' }, 'uname -s', 30);
  const platform = (result.stdout || '').trim();
  if (platform !== 'Linux') {
    throw new Error('Remote target must be Linux');
  }
}

export async function startExperimentLoop(
  sendMessage: (systemPrompt: string, userMessage: string) => Promise<string>,
): Promise<void> {
  const store = useAutoResearchStore.getState();

  try {
    await assertSupportedPlatform();
  } catch (error) {
    useAutoResearchStore.getState().setError(formatError(error));
    return;
  }

  if (!store.sshConfig) {
    useAutoResearchStore.getState().setError('SSH config not set');
    return;
  }

  const notifier = createNotifier(store.telegramConfig);
  const sessionId = store.id;
  const cfg = store.sshConfig;

  try {
    await assertRemoteLinux(cfg);
  } catch (error) {
    useAutoResearchStore.getState().setError(formatError(error));
    return;
  }

  if (cfg.mode === 'ssh' && cfg.authMode === 'password') {
    const avail = await ensureSshpassAvailable();
    if (!avail.ok) {
      useAutoResearchStore.getState().setError(avail.hint ?? 'sshpass unavailable');
      return;
    }
  }

  let startup: StartupContext;
  try {
    startup = await prepareStartupContext(store);
  } catch (error) {
    useAutoResearchStore.getState().setError(formatError(error));
    return;
  }

  const artifactCfg = startup.artifactCfg;
  const experimentCfg = startup.experimentCfg;
  const sessionPaths = getSessionRunPaths(artifactCfg, sessionId);
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
  } catch (error) {
    useAutoResearchStore.getState().setError(`Failed to initialize run artifacts: ${formatError(error)}`);
    return;
  }

  try {
    const clean = await isRemoteClean(experimentCfg);
    if (!clean) {
      await rollback(experimentCfg);
    }
  } catch (error) {
    const where = experimentCfg.mode === 'local' ? 'local experiment directory' : 'remote target';
    useAutoResearchStore.getState().setError(`Cannot reach ${where}: ${formatError(error)}`);
    return;
  }

  while (true) {
    const state = useAutoResearchStore.getState();

    if (state.loopState === 'stopped' || state.loopState === 'error') {
      break;
    }
    if (state.currentIteration >= state.maxIterations) {
      await notifier.onLoopStopped('Max iterations reached', state);
      useAutoResearchStore.getState().setLoopState('stopped');
      break;
    }
    if (state.consecutiveFailures >= 3) {
      await notifier.onLoopStopped('3 consecutive failures', state);
      useAutoResearchStore.getState().setLoopState('stopped');
      break;
    }
    if (state.loopState === 'paused') {
      await new Promise(resolve => setTimeout(resolve, 1000));
      continue;
    }

    useAutoResearchStore.getState().incrementIteration();
    const iteration = useAutoResearchStore.getState().currentIteration;
    const startedAt = new Date().toISOString();
    const startMs = Date.now();
    useAutoResearchStore.getState().setLiveOutput('');

    let runDir: RunDir;
    try {
      runDir = await createRunDir(artifactCfg, sessionId, iteration, {
        snapshotSourceDir: startup.experimentDir,
      });
    } catch (error) {
      useAutoResearchStore.getState().setError(`Failed to create run directory: ${formatError(error)}`);
      break;
    }
    setCurrentRunDir(runDir);
    await writeRunStatus(artifactCfg, runDir, {
      iteration,
      status: 'RUNNING',
      metricValue: null,
      failReason: null,
      durationMs: 0,
      commitHash: await captureCommitHash(experimentCfg),
    });

    try {
      const livingDoc = await readLivingDoc(artifactCfg, sessionId) || '';
      const systemPrompt = buildSystemPrompt({
        sessionContent,
        livingDoc,
        sshConfig: experimentCfg,
        runDir,
      });

      const userMessage = `Run experiment iteration #${iteration}. Follow the iteration workspace contract exactly.`;
      const agentOutput = await sendMessage(systemPrompt, userMessage);
      const parsed = await parseIterationMetrics(artifactCfg, runDir, state.metricName, agentOutput);
      const diff = await getRemoteDiff(experimentCfg);
      const commitHash = await captureCommitHash(experimentCfg);
      const finishedAt = new Date().toISOString();
      const durationMs = Date.now() - startMs;

      await writeTargetText(artifactCfg, runDir.diffPath, diff);

      if (!parsed) {
        const failedRecord: IterationMetrics = {
          iteration,
          sessionId,
          metricName: state.metricName,
          metricValue: null,
          status: 'FAILED',
          failReason: 'Could not parse iteration metrics',
          hypothesis: 'Unparseable result',
          commitHash,
          durationMs,
          startedAt,
          finishedAt,
        };
        const entry: ExperimentEntry = {
          ...toExperimentEntry(failedRecord),
          change: 'See agent output',
          reasoning: agentOutput.slice(-1000),
        };
        useAutoResearchStore.getState().addExperiment(entry);
        useAutoResearchStore.getState().incrementConsecutiveFailures();
        await appendIterationMetrics(artifactCfg, sessionId, failedRecord);
        await writeRunStatus(artifactCfg, runDir, {
          iteration,
          status: entry.status,
          metricValue: entry.metricValue,
          failReason: entry.failReason ?? null,
          durationMs,
          commitHash,
        });
        await rollback(experimentCfg, { terminal: true });
        await rebuildLivingDoc(artifactCfg, sessionId, {
          startedAt: state.startedAt,
          workDir: startup.workDir,
          metricName: state.metricName,
          direction: state.metricDirection,
        });
        await logExperiment(entry, useAutoResearchStore.getState());
        await notifier.onExperimentComplete(entry, useAutoResearchStore.getState());
        continue;
      }

      const metricsRecord: IterationMetrics = {
        iteration,
        sessionId,
        metricName: parsed.metricName,
        metricValue: parsed.metricValue,
        status: parsed.status,
        failReason: parsed.failReason,
        hypothesis: parsed.hypothesis,
        commitHash,
        durationMs,
        startedAt,
        finishedAt,
        extra: parsed.extra,
      };

      const entry = toExperimentEntry(metricsRecord);
      useAutoResearchStore.getState().addExperiment(entry);

      if (parsed.status === 'IMPROVED' && parsed.metricValue !== null) {
        useAutoResearchStore.getState().updateBestMetric(parsed.metricValue);
        useAutoResearchStore.getState().resetConsecutiveFailures();
      } else if (parsed.status === 'FAILED') {
        useAutoResearchStore.getState().incrementConsecutiveFailures();
      } else {
        useAutoResearchStore.getState().resetConsecutiveFailures();
      }

      await appendIterationMetrics(artifactCfg, sessionId, metricsRecord);
      await writeRunStatus(artifactCfg, runDir, {
        iteration,
        status: parsed.status,
        metricValue: parsed.metricValue,
        failReason: parsed.failReason ?? null,
        durationMs,
        commitHash,
      });
      await rebuildLivingDoc(artifactCfg, sessionId, {
        startedAt: state.startedAt,
        workDir: startup.workDir,
        metricName: state.metricName,
        direction: state.metricDirection,
      });
      await logExperiment(entry, useAutoResearchStore.getState());
      await notifier.onExperimentComplete(entry, useAutoResearchStore.getState());

      const trendInterval = useAutoResearchStore.getState().telegramConfig.trendReportInterval;
      if (iteration % trendInterval === 0) {
        const experiments = useAutoResearchStore.getState().experiments;
        const recent = experiments.slice(-trendInterval);
        const improved = recent.filter(e => e.status === 'IMPROVED').length;
        const failed = recent.filter(e => e.status === 'FAILED').length;
        const report = [
          `最近 ${trendInterval} 轮: ${improved} improved, ${failed} failed, ${trendInterval - improved - failed} not improved`,
          `当前最佳: ${useAutoResearchStore.getState().bestMetric ?? 'N/A'}`,
        ].join('\n');
        await notifier.onTrendReport(report, useAutoResearchStore.getState());
      }

      const icon = parsed.status === 'IMPROVED' ? '✅' : parsed.status === 'FAILED' ? '❌' : '➖';
      const summary = `[Exp ${iteration}] ${parsed.hypothesis} → ${parsed.status} ${icon} (${parsed.metricValue ?? 'N/A'})`;
      useAutoResearchStore.getState().appendLiveOutput(summary + '\n');
    } catch (error) {
      const finishedAt = new Date().toISOString();
      const durationMs = Date.now() - startMs;
      const entry: ExperimentEntry = {
        iteration,
        hypothesis: 'Agent execution error',
        change: 'N/A',
        metricValue: null,
        status: 'FAILED',
        failReason: formatError(error),
        reasoning: 'The Agent failed to complete the iteration.',
        timestamp: finishedAt,
        durationMs,
      };
      const failedRecord: IterationMetrics = {
        iteration,
        sessionId,
        metricName: useAutoResearchStore.getState().metricName,
        metricValue: null,
        status: 'FAILED',
        failReason: formatError(error),
        hypothesis: 'Agent execution error',
        commitHash: await captureCommitHash(experimentCfg),
        durationMs,
        startedAt,
        finishedAt,
      };
      useAutoResearchStore.getState().addExperiment(entry);
      useAutoResearchStore.getState().incrementConsecutiveFailures();
      await appendIterationMetrics(artifactCfg, sessionId, failedRecord);
      await writeRunStatus(artifactCfg, runDir, {
        iteration,
        status: entry.status,
        metricValue: null,
        failReason: entry.failReason ?? null,
        durationMs,
        commitHash: failedRecord.commitHash,
      });
      await rebuildLivingDoc(artifactCfg, sessionId, {
        startedAt: useAutoResearchStore.getState().startedAt,
        workDir: startup.workDir,
        metricName: useAutoResearchStore.getState().metricName,
        direction: useAutoResearchStore.getState().metricDirection,
      });
      await rollback(experimentCfg, { terminal: true });
      await logExperiment(entry, useAutoResearchStore.getState());
      await notifier.onExperimentComplete(entry, useAutoResearchStore.getState());
    } finally {
      clearCurrentRunDir();
    }
  }
}

export function stopExperimentLoop(): void {
  useAutoResearchStore.getState().setLoopState('stopped');
}

export function pauseExperimentLoop(): void {
  useAutoResearchStore.getState().setLoopState('paused');
}

export function resumeExperimentLoop(): void {
  const state = useAutoResearchStore.getState();
  if (state.loopState === 'paused') {
    useAutoResearchStore.getState().setLoopState('running');
  }
}

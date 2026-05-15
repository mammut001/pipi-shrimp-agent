/**
 * AutoResearch Loop Engine — Autonomous experiment cycle state machine.
 */

import { useAutoResearchStore, type ExperimentEntry, type ExperimentStatus, type SshConfig } from '@/store/autoresearchStore';
import { logExperiment } from './expLogger';
import { rollback, getRemoteDiff } from './rollback';
import { createNotifier } from './notifier';
import { describeTarget, ensureSshpassAvailable, shellEscapePath } from '@/utils/remoteExec';
import { assertSupportedPlatform } from './platformGuard';
import {
  appendIterationMetrics,
  readAllMetrics,
  summarize,
  type IterationMetrics,
} from './metricsStore';
import { parseMetricsArtifactPayload } from './metricsSchema';
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
import {
  classifyAutoResearchFailure,
  formatError,
  getRateLimitRetryAfterSeconds,
  isRateLimitError,
  isTerminalFailureError,
} from './errors';
import { isAutoResearchReflectionFailureError } from './reflection';
import {
  getAutoResearchLivingDocPathFromWorkDir,
  getAutoResearchSessionFilePathFromWorkDir,
} from './paths';
import { emitAutoResearchRuntimeEvent, setAutoResearchPhase } from './runtimeEvents';
import {
  inspectAutoResearchEnvironment,
  resolveTargetPath,
  type AutoResearchEnvironmentSummary,
} from './preflight';
import { formatAutoResearchToolCatalog, getAutoResearchToolProfile } from './toolCatalog';
import { formatAutoResearchToolLanes } from './toolLanes';
import { applyBootstrapIfPresent } from './bootstrap/applyBootstrap';

interface ParsedResult {
  metricName: string;
  metricValue: number | null;
  status: ExperimentStatus;
  hypothesis: string;
  change: string;
  reasoning: string;
  artifactPaths: string[];
  parseSource: 'metrics_json' | 'agent_json' | 'deprecated_result_line';
  failReason?: string;
  extra?: Record<string, number | string | boolean>;
}

interface ParsedIterationMetricsResult {
  parsed: ParsedResult | null;
  parseError?: string;
}

interface PromptInput {
  sessionContent: string;
  livingDoc: string;
  sshConfig: SshConfig;
  runDir: RunDir;
  environmentSummary: AutoResearchEnvironmentSummary;
  metricDirection: 'lower' | 'higher';
  metricName: string;
  maxIterations: number;
}

interface StartupContext {
  artifactCfg: SshConfig;
  experimentCfg: SshConfig;
  experimentDir: string;
  workDir: string;
  sessionContent: string;
}

const TOOL_BUDGET_EXHAUSTED_MARKER = '__AUTORESEARCH_TOOL_BUDGET_EXHAUSTED__';
const MAX_CONSECUTIVE_RATE_LIMITS = 3;

// AUDIT-016 FIX: Budget reserve is now calculated dynamically based on remaining iterations.
// This ensures the reserve is meaningful even when maxIterations is small (e.g., 1).
function calculateBudgetReserve(maxIterations: number): number {
  // Reserve 2 rounds or 25% of maxIterations, whichever is smaller but at least 1
  return Math.max(1, Math.min(2, Math.floor(maxIterations * 0.25)));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildSystemPrompt({
  sessionContent,
  livingDoc,
  sshConfig,
  runDir,
  environmentSummary,
  metricDirection,
  metricName,
  maxIterations,
}: PromptInput): string {
  // AUDIT-016 FIX: Calculate budget reserve dynamically based on maxIterations
  const budgetReserve = calculateBudgetReserve(maxIterations);
  const isLocal = sshConfig.mode === 'local';
  const toolProfile = getAutoResearchToolProfile(sshConfig);
  const allowedTools = formatAutoResearchToolCatalog(sshConfig);
  const toolLanes = formatAutoResearchToolLanes(sshConfig);
  const iterationCodeDir = runDir.codeDir;
  const envLine = isLocal
    ? `Executing directly on the local machine. Working directory: ${sshConfig.remoteWorkDir || '(current)'}.`
    : `Remote host via SSH — ${describeTarget(sshConfig)}.`;
  const toolCfgHint = isLocal
    ? `Use ${toolProfile.commandTool} for target-side commands with cwd="${iterationCodeDir}". Use ${toolProfile.readTool} for file reads and ${toolProfile.writeTool} for file writes. Before writing new nested paths, create parent directories with ${toolProfile.commandTool} and \`mkdir -p <path>\`.`
    : `Use ${toolProfile.commandTool} for target-side commands with mode="ssh", host="${sshConfig.host}", user="${sshConfig.user}", port=${sshConfig.port}, authMode="${sshConfig.authMode}"${sshConfig.authMode === 'key' ? `, keyPath="${sshConfig.keyPath}"` : ''}, remoteWorkDir="${sshConfig.remoteWorkDir}". Use ${toolProfile.readTool} for file reads. Use ${toolProfile.uploadTool} for remote file creation or replacement. Only set terminal=true when the command needs a PTY or live terminal output. Never ask for credentials.`;
  const inspectionScope = isLocal
    ? 'Read only the minimum files you need, and use only the local experiment tools listed above.'
    : 'Read only the minimum files you need, and use only the SSH experiment tools listed above.';
  const executionRequirement = isLocal
    ? `Run the experiment command through ${toolProfile.commandTool} with cwd set to ${iterationCodeDir}.`
    : `Run the experiment command through ${toolProfile.commandTool}. Use terminal=true only when the command needs a PTY or live terminal output; otherwise keep it false or omitted.`;
  const toolLaneGuard = isLocal
    ? 'Never call ssh_exec, ssh_read_file, or ssh_upload_file in this local run.'
    : 'Never call execute_command, read_file, write_file, or create_directory in this SSH run.';

  return `# AutoResearch Agent

## Role
You are running one autonomous experiment iteration inside Pipi-Shrimp AutoResearch.

## Environment
- Execution target: ${envLine}
- Tool config: ${toolCfgHint}
- Only permitted experiment tools for this run: ${allowedTools}

## Phase Tool Lanes
${toolLanes}

## Environment Preflight
- Experiment directory: ${environmentSummary.experimentDir}
- Git repository: ${environmentSummary.repoStatus} (${environmentSummary.dirtyFileCount} dirty files before this iteration)
- Preferred Python command: ${environmentSummary.preferredPythonCommand}
- Recommended run command: ${environmentSummary.recommendedRunCommand}
- Required files already confirmed: ${environmentSummary.runScriptPath}, ${environmentSummary.notesPath}
- Workspace writable: ${environmentSummary.worktreeWritable ? 'yes' : 'no'}
- GPU telemetry: ${environmentSummary.gpuSummary || 'not checked'}

## Session File
${sessionContent}

## Living AutoResearch Notes
${livingDoc || 'No prior iterations recorded yet.'}

## Iteration Workspace
- Iteration directory: ${runDir.iterDir}
- Iteration code checkout: ${iterationCodeDir}
- Hypothesis file: ${runDir.hypothesisPath}
- Metrics file: ${runDir.metricsPath}
- Diff file: ${runDir.diffPath}

## WORKSPACE CONTRACT
- Per-iteration code lives in: ${iterationCodeDir} (already a clean git checkout)
- Modify run_experiment.py in ${iterationCodeDir}, NOT in the original experiment dir
- Run the experiment from ${iterationCodeDir} using "python3 run_experiment.py"
- Write hypothesis.md, metrics.json, diff.patch into ${runDir.iterDir}/ (one level above code/)
- The host will diff ${iterationCodeDir} vs the parent run's baseline to produce diff.patch
- Do NOT touch the original experiment directory directly

## Requirements for this iteration
1. Do exactly one hypothesis/change/run/evaluate cycle.
2. Before making changes, do at most one batched inspection pass. ${inspectionScope}
3. Write a short hypothesis summary to ${runDir.hypothesisPath}.
4. ${executionRequirement}
5. Before finishing, write exactly one valid JSON object to ${runDir.metricsPath} with:
  {"schemaVersion":1,"sessionId":"${runDir.sessionId}","runId":"${runDir.sessionId}","iteration":${runDir.iter},"primaryMetric":"${metricName}","direction":"${metricDirection}","timestamp":"<ISO8601>","generator":"agent","metricName":"${metricName}","metricValue":<number|null>,"status":"IMPROVED|NOT_IMPROVED|FAILED","hypothesis":"<one line>","change":"<short summary>","reasoning":"<brief reasoning>","artifactPaths":["<optional path>"],"failReason":"<optional>","extra":{"<optional>":"<optional>"}}
6. If the metric is missing, the command crashes, or the run times out, still write the JSON object with status FAILED, metricValue null, and a concrete failReason.
7. Also emit a final fallback line as a deprecated backup only if the host cannot read metrics.json:
   EXPERIMENT_RESULT: metric_value=<number_or_null> status=<IMPROVED|NOT_IMPROVED|FAILED> hypothesis="<one line>"
   or
   EXPERIMENT_RESULT: metric_value=null status=FAILED fail_reason="<reason>" hypothesis="<one line>"
8. Reserve the last ${budgetReserve} tool calls for reading metrics/logs, writing the final result, and cleanup. If you are near that reserve, stop exploring or modifying code and finalize.
9. Run the expensive experiment or training/evaluation command at most once in this iteration. If it fails, read logs or metrics and emit FAILED instead of patching and rerunning.
10. If the change is not improved or the run fails, revert your working tree before finishing.
11. ${toolLaneGuard}
12. Respect the phase tool lanes above. Once you move into PARSE_METRICS or DECIDE_NEXT, do not go back to editing code or rerunning the experiment in the same iteration.
13. Do not repeat dead ends from the living doc unless you have a materially different reason.
14. If you are still exploring after the first inspection pass, stop exploring and either run the experiment or emit a FAILED result with a concrete failReason.
15. Treat GPU thermal state as a safety constraint. If telemetry shows GPU temperature >= 85C, fan speed is unavailable/0 during a GPU-heavy run, or the target appears thermally unsafe, avoid escalating workload and write a FAILED result with failReason="thermal_guard" instead of pushing another run.
16. Do not change GPU fan speed, power limits, persistence mode, or other hardware controls unless the session file explicitly permits hardware control and the command is safe for the target.
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

function parseMetricValue(value: unknown): { value: number | null; error?: string } {
  if (value === null) {
    return { value: null };
  }

  if (value === undefined) {
    return {
      value: null,
      error: 'Invalid structured result metricValue "<missing>". Expected a finite number or null.',
    };
  }

  const parsed = parseMetricNumber(value);
  if (parsed !== null) {
    return { value: parsed };
  }

  if (typeof value === 'string' && value.trim().toLowerCase() === 'null') {
    return { value: null };
  }

  return {
    value: null,
    error: `Invalid structured result metricValue "${String(value)}". Expected a finite number or null.`,
  };
}

function extractBalancedJsonObjects(text: string): string[] {
  const matches: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') {
      if (depth === 0) {
        start = index;
      }
      depth += 1;
      continue;
    }

    if (char === '}') {
      if (depth === 0) {
        continue;
      }
      depth -= 1;
      if (depth === 0 && start >= 0) {
        matches.push(text.slice(start, index + 1));
        start = -1;
      }
    }
  }

  return matches;
}

function parseStructuredJsonCandidates(
  candidates: string[],
  metricName: string,
): ParsedIterationMetricsResult {
  let parseError: string | undefined;

  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const candidate = candidates[index]?.trim();
    if (!candidate) {
      continue;
    }

    try {
      const raw = JSON.parse(candidate);
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        parseError ??= 'Invalid structured result: expected a JSON object.';
        continue;
      }

      const normalized = normalizeParsedResult(raw as Record<string, unknown>, metricName, 'agent_json');
      if (normalized.parsed) {
        return normalized;
      }
      parseError ??= normalized.parseError;
    } catch (error) {
      parseError ??= `Invalid structured JSON result: ${formatError(error)}`;
    }
  }

  return { parsed: null, parseError };
}

function parseAgentJsonResult(agentOutput: string, metricName: string): ParsedIterationMetricsResult {
  let parseError: string | undefined;
  const fencedBlocks = [...agentOutput.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)]
    .map((match) => match[1])
    .filter((block): block is string => typeof block === 'string' && block.includes('{'));

  if (fencedBlocks.length > 0) {
    const fencedResult = parseStructuredJsonCandidates(
      fencedBlocks.flatMap((block) => extractBalancedJsonObjects(block).length > 0 ? extractBalancedJsonObjects(block) : [block]),
      metricName,
    );
    if (fencedResult.parsed) {
      return fencedResult;
    }
    parseError = fencedResult.parseError;
  }

  const plainResult = parseStructuredJsonCandidates(extractBalancedJsonObjects(agentOutput), metricName);
  if (plainResult.parsed) {
    return plainResult;
  }

  return {
    parsed: null,
    parseError: parseError ?? plainResult.parseError,
  };
}

function normalizeParsedResult(
  candidate: Record<string, unknown>,
  metricName: string,
  parseSource: ParsedResult['parseSource'],
): ParsedIterationMetricsResult {
  const hypothesis = String(candidate.hypothesis ?? candidate.hypothesis_text ?? '').trim();
  if (!hypothesis) {
    return {
      parsed: null,
      parseError: 'Invalid structured result: hypothesis must be a non-empty string.',
    };
  }

  const rawStatus = String(candidate.status ?? '').trim();
  if (!['IMPROVED', 'NOT_IMPROVED', 'FAILED'].includes(rawStatus)) {
    return {
      parsed: null,
      parseError: `Invalid structured result status "${rawStatus || '<missing>'}". Expected IMPROVED, NOT_IMPROVED, or FAILED.`,
    };
  }

  const metric = parseMetricValue(candidate.metricValue ?? candidate.metric_value);
  if (metric.error) {
    return {
      parsed: null,
      parseError: metric.error,
    };
  }

  const change = typeof candidate.change === 'string'
    ? candidate.change.trim()
    : typeof candidate.patchSummary === 'string'
      ? candidate.patchSummary.trim()
      : '';
  const reasoning = typeof candidate.reasoning === 'string'
    ? candidate.reasoning.trim()
    : typeof candidate.analysis === 'string'
      ? candidate.analysis.trim()
      : '';
  const artifactPaths = Array.isArray(candidate.artifactPaths)
    ? candidate.artifactPaths.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : Array.isArray(candidate.artifacts)
      ? candidate.artifacts.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      : [];

  return {
    parsed: {
      metricName: String(candidate.metricName ?? candidate.metric_name ?? metricName),
      metricValue: metric.value,
      status: rawStatus as ExperimentStatus,
      hypothesis,
      change,
      reasoning,
      artifactPaths,
      parseSource,
      failReason: candidate.failReason ? String(candidate.failReason) : candidate.fail_reason ? String(candidate.fail_reason) : undefined,
      extra: candidate.extra && typeof candidate.extra === 'object'
        ? candidate.extra as Record<string, number | string | boolean>
        : undefined,
    },
  };
}

function parseExperimentResult(agentOutput: string, metricName: string): ParsedIterationMetricsResult {
  const match = agentOutput.match(
    /EXPERIMENT_RESULT:\s*metric_value=(\S+)\s+status=(\S+)(?:\s+fail_reason="([^"]*)")?\s+hypothesis="([^"]*)"/,
  );
  if (!match) {
    return { parsed: null };
  }

  const metric = parseMetricValue(match[1]);
  if (metric.error) {
    return { parsed: null, parseError: metric.error };
  }

  const status = match[2]?.trim() ?? '';
  if (!['IMPROVED', 'NOT_IMPROVED', 'FAILED'].includes(status)) {
    return {
      parsed: null,
      parseError: `Invalid structured result status "${status || '<missing>'}". Expected IMPROVED, NOT_IMPROVED, or FAILED.`,
    };
  }

  const hypothesis = match[4]?.trim() ?? '';
  if (!hypothesis) {
    return {
      parsed: null,
      parseError: 'Invalid structured result: hypothesis must be a non-empty string.',
    };
  }

  return {
    parsed: {
      metricName,
      metricValue: metric.value,
      status: status as ExperimentStatus,
      failReason: match[3] || undefined,
      hypothesis,
      change: '',
      reasoning: '',
      artifactPaths: [],
      parseSource: 'deprecated_result_line',
    },
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

  useAutoResearchStore.getState().updateRunPaths({
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
  metricDirection: 'lower' | 'higher',
  agentOutput: string,
): Promise<ParsedIterationMetricsResult> {
  const metricsContent = await readTargetText(cfg, runDir.metricsPath);
  if (metricsContent) {
    try {
      const raw = JSON.parse(metricsContent) as unknown;
      const artifact = parseMetricsArtifactPayload(raw, {
        expectedSessionId: runDir.sessionId,
        expectedRunId: runDir.sessionId,
        expectedIteration: runDir.iter,
        expectedMetricName: metricName,
        expectedDirection: metricDirection,
      });
      if (!artifact.value) {
        return {
          parsed: null,
          parseError: artifact.error ?? 'Invalid metrics artifact.',
        };
      }

      return normalizeParsedResult(
        artifact.value as Record<string, unknown>,
        metricName,
        'metrics_json',
      );
    } catch (error) {
      return {
        parsed: null,
        parseError: `Invalid metrics.json content: ${formatError(error)}`,
      };
    }
  }

  const structuredOutput = parseAgentJsonResult(agentOutput, metricName);
  if (structuredOutput.parsed) {
    return structuredOutput;
  }

  const fallback = parseExperimentResult(agentOutput, metricName);
  if (fallback.parsed) {
    return fallback;
  }

  return {
    parsed: null,
    parseError: structuredOutput.parseError ?? fallback.parseError ?? 'Could not parse metrics.json or structured agent output.',
  };
}

function buildIterationWorkspaceCfg(cfg: SshConfig, runDir: RunDir): SshConfig {
  return {
    ...cfg,
    remoteWorkDir: runDir.codeDir,
  };
}

function isBudgetExhaustedIterationSignal(agentOutput: string): boolean {
  return agentOutput.includes(TOOL_BUDGET_EXHAUSTED_MARKER);
}

async function rollbackIterationWorkspace(
  cfg: SshConfig,
  iteration: number,
  runDir: RunDir,
  options: { terminal?: boolean; reason: string },
): Promise<{ success: boolean; message: string }> {
  useAutoResearchStore.getState().addRunEvent({
    level: 'info',
    phase: 'system',
    message: `rollback_started: iteration ${iteration} rollback requested.`,
    metadata: {
      iteration,
      iterDir: runDir.iterDir,
      reason: options.reason,
    },
  });

  const result = await rollback(cfg, { terminal: options.terminal ?? false });
  useAutoResearchStore.getState().addRunEvent({
    level: result.success ? 'info' : 'error',
    phase: 'system',
    message: result.success
      ? `rollback_completed: iteration ${iteration} workspace reverted.`
      : `rollback_failed: iteration ${iteration} workspace could not be reverted.`,
    metadata: {
      iteration,
      iterDir: runDir.iterDir,
      reason: options.reason,
      rollbackMessage: result.message,
    },
  });

  return result;
}

function buildDirtyRepoMessage(summary: AutoResearchEnvironmentSummary): string {
  return `Experiment repository has ${summary.dirtyFileCount} uncommitted change(s). AutoResearch will not reset a dirty repository automatically. Commit or stash those changes before starting a run.`;
}

function toExperimentEntry(record: IterationMetrics): ExperimentEntry {
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

function mergeArtifactPaths(...groups: Array<string[] | undefined>): string[] {
  return Array.from(new Set(groups.flatMap((group) => group ?? []).filter((value) => value.trim().length > 0)));
}

function buildIterationNarrative(input: {
  hypothesis: string;
  change?: string;
  status: ExperimentStatus;
  metricName: string;
  metricValue: number | null;
  failReason?: string;
  nextStep?: string;
}): string {
  const changeSummary = input.change?.trim() || 'No code change summary recorded.';
  const outcome = input.status === 'FAILED'
    ? `Experiment failed${input.failReason ? `: ${input.failReason}` : '.'}`
    : input.metricValue === null
      ? `Experiment completed without a parsed ${input.metricName}.`
      : `Experiment completed with ${input.metricName}=${input.metricValue}.`;
  const next = input.nextStep?.trim() || 'No follow-up recommendation recorded.';
  return `${input.hypothesis}. Changed: ${changeSummary}. ${outcome} Next: ${next}`;
}

function buildIterationParsedMetrics(
  metricName: string,
  metricValue: number | null,
  extra?: Record<string, number | string | boolean>,
): Record<string, number | string | boolean | null> {
  return {
    [metricName]: metricValue,
    ...(extra ?? {}),
  };
}

function buildIterationRecoveryActions(options: {
  status: ExperimentStatus;
  hasLogs: boolean;
}): Array<{ type: 'retry_failed_phase' | 'retry_iteration' | 'switch_provider' | 'open_raw_request_summary' | 'open_logs' | 'abort_run'; supported: boolean; label?: string; reason?: string }> {
  if (options.status !== 'FAILED') {
    return [];
  }

  return [
    {
      type: 'open_raw_request_summary',
      supported: true,
      label: 'Open raw request summary',
    },
    {
      type: 'open_logs',
      supported: options.hasLogs,
      label: 'Open logs',
      reason: options.hasLogs ? undefined : 'No log artifact is available for this iteration.',
    },
  ];
}

async function hydrateSessionFromDisk(cfg: SshConfig, sessionId: string, direction: 'lower' | 'higher'): Promise<void> {
  const metrics = await readAllMetrics(cfg, sessionId, direction);
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

function getRunArtifactPaths(runDir: RunDir): string[] {
  return [
    runDir.iterDir,
    runDir.systemPromptPath,
    runDir.hypothesisPath,
    runDir.diffPath,
    runDir.metricsPath,
    runDir.statusPath,
    runDir.reflectionInputPath,
    runDir.reflectionRawPath,
    runDir.reflectionParsedPath,
    runDir.transcriptPath,
    `${runDir.logsDir}/stdout.log`,
    `${runDir.logsDir}/stderr.log`,
    `${runDir.logsDir}/combined.log`,
  ];
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

  try {
    await applyBootstrapIfPresent(cfg, sessionId);
  } catch (error) {
    useAutoResearchStore.getState().addRunEvent({
      level: 'warn',
      phase: 'preflight',
      message: `Bootstrap metadata could not be applied: ${formatError(error)}`,
    });
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
  let environmentSummary: AutoResearchEnvironmentSummary;

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
    useAutoResearchStore.getState().setError(`Failed to initialize run artifacts: ${formatError(error)}`);
    return;
  }

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
      useAutoResearchStore.getState().setError(buildDirtyRepoMessage(environmentSummary));
      return;
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
    useAutoResearchStore.getState().setError(`Cannot reach ${where}: ${formatError(error)}`);
    return;
  }

  let consecutiveRateLimitCount = 0;

  while (true) {
    const state = useAutoResearchStore.getState();
    const activeRun = state.runHistory.find((run) => run.id === state.id);

    if (state.loopState === 'stopped' || state.loopState === 'error') {
      break;
    }
    if (state.currentIteration >= state.maxIterations) {
      await notifier.onLoopStopped('Max iterations reached', state);
      if (activeRun?.status !== 'failed' && activeRun?.status !== 'reflection_failed') {
        useAutoResearchStore.getState().setRunStatus('completed', {
          summary: 'Max iterations reached.',
          endedAt: new Date().toISOString(),
        });
        emitAutoResearchRuntimeEvent({
          level: 'info',
          phase: 'DONE',
          type: 'run_completed',
          message: 'Run completed after reaching max iterations.',
          summary: 'Run completed.',
        });
      }
      useAutoResearchStore.getState().setLoopState('stopped');
      break;
    }
    if (state.consecutiveFailures >= 3) {
      await notifier.onLoopStopped('3 consecutive failures', state);
      useAutoResearchStore.getState().setRunStatus('failed', {
        summary: 'Stopped after 3 consecutive failures.',
        endedAt: new Date().toISOString(),
      });
      emitAutoResearchRuntimeEvent({
        level: 'error',
        phase: 'FAILED',
        type: 'run_completed',
        message: 'Run stopped after 3 consecutive failures.',
        summary: 'Run failed after 3 consecutive failures.',
      });
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
    useAutoResearchStore.getState().setStatusMessage(undefined);
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
    const iterationCfg = buildIterationWorkspaceCfg(experimentCfg, runDir);
    useAutoResearchStore.getState().startIterationRecord({
      iteration,
      startedAt,
      artifactPaths: getRunArtifactPaths(runDir),
    });
    setAutoResearchPhase('INIT', {
      iteration,
      summary: `Iteration ${iteration} started.`,
      message: `Iteration ${iteration} started.`,
      metadata: {
        iterDir: runDir.iterDir,
      },
    });
    emitAutoResearchRuntimeEvent({
      level: 'info',
      phase: 'INIT',
      type: 'iteration_started',
      message: `Iteration ${iteration} started.`,
      summary: `Iteration ${iteration} started.`,
      metadata: {
        iterDir: runDir.iterDir,
      },
      iterationId: `${sessionId}-iter-${iteration}`,
    });
    await writeRunStatus(artifactCfg, runDir, {
      iteration,
      status: 'RUNNING',
      metricValue: null,
      failReason: null,
      durationMs: 0,
      commitHash: await captureCommitHash(iterationCfg),
    });

    try {
      setAutoResearchPhase('READ_CONTEXT', {
        iteration,
        summary: `Iteration ${iteration} is loading context and run artifacts.`,
      });
      const livingDoc = await readLivingDoc(artifactCfg, sessionId) || '';
      const systemPrompt = buildSystemPrompt({
        sessionContent,
        livingDoc,
        sshConfig: experimentCfg,
        runDir,
        environmentSummary,
        metricDirection: store.metricDirection,
        metricName: state.metricName,
        maxIterations: store.maxIterations,
      });
      await writeTargetText(artifactCfg, runDir.systemPromptPath, `${systemPrompt}\n`);

      const userMessage = `Run experiment iteration #${iteration}. Follow the iteration workspace contract exactly.`;
      setAutoResearchPhase('PLAN_HYPOTHESIS', {
        iteration,
        summary: `Iteration ${iteration} is planning the next hypothesis.`,
      });
      const agentOutput = await sendMessage(systemPrompt, userMessage);
      consecutiveRateLimitCount = 0;
      const budgetExhausted = isBudgetExhaustedIterationSignal(agentOutput);
      setAutoResearchPhase('PARSE_METRICS', {
        iteration,
        summary: `Iteration ${iteration} is parsing experiment metrics.`,
      });
      const { parsed, parseError } = await parseIterationMetrics(
        artifactCfg,
        runDir,
        state.metricName,
        state.metricDirection,
        agentOutput,
      );
      const diff = await getRemoteDiff(iterationCfg);
      const commitHash = await captureCommitHash(iterationCfg);
      const finishedAt = new Date().toISOString();
      const durationMs = Date.now() - startMs;

      await writeTargetText(artifactCfg, runDir.diffPath, diff);

      if (!parsed) {
        const failureReason = parseError ?? 'Could not parse metrics.json or structured agent output.';
        const failedRecord: IterationMetrics = {
          iteration,
          sessionId,
          runId: sessionId,
          primaryMetric: state.metricName,
          direction: state.metricDirection,
          timestamp: finishedAt,
          generator: 'loop_engine',
          schemaVersion: 1,
          metricName: state.metricName,
          metricValue: null,
          status: 'FAILED',
          failReason: failureReason,
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
        const narrative = buildIterationNarrative({
          hypothesis: entry.hypothesis,
          change: entry.change,
          status: 'FAILED',
          metricName: state.metricName,
          metricValue: null,
          failReason: failureReason,
          nextStep: entry.reasoning,
        });
        useAutoResearchStore.getState().addExperiment(entry);
        useAutoResearchStore.getState().completeIterationRecord({
          iteration,
          status: 'failed',
          phase: 'FAILED',
          hypothesis: entry.hypothesis,
          change: entry.change,
          reasoning: entry.reasoning,
          narrative,
          codeChangesSummary: entry.change,
          durationMs,
          parsedMetrics: buildIterationParsedMetrics(state.metricName, null),
          reflectionSummary: entry.reasoning,
          metricValue: entry.metricValue,
          commitHash,
          error: entry.failReason ?? null,
          endedAt: finishedAt,
          artifactPaths: getRunArtifactPaths(runDir),
          recoveryActions: buildIterationRecoveryActions({
            status: 'FAILED',
            hasLogs: true,
          }),
        });
        setAutoResearchPhase('FAILED', {
          iteration,
          level: 'warn',
          summary: `Iteration ${iteration} failed while parsing metrics.`,
          metadata: {
            failReason: failureReason,
          },
        });
        if (budgetExhausted) {
          emitAutoResearchRuntimeEvent({
            level: 'warn',
            phase: 'FAILED',
            type: 'provider_error',
            message: `iteration_failed_due_to_budget: iteration ${iteration} exhausted the tool budget before evaluation completed.`,
            summary: `Iteration ${iteration} exhausted the tool budget.`,
            metadata: {
              iteration,
              iterDir: runDir.iterDir,
              failReason: failureReason,
            },
            iterationId: `${sessionId}-iter-${iteration}`,
          });
        }
        emitAutoResearchRuntimeEvent({
          level: 'warn',
          phase: 'FAILED',
          type: 'iteration_failed',
          message: `Iteration ${iteration} finished without parseable metrics.`,
          summary: `Iteration ${iteration} failed: no parseable metrics were produced.`,
          metadata: {
            failReason: entry.failReason ?? null,
            iterDir: runDir.iterDir,
          },
          iterationId: `${sessionId}-iter-${iteration}`,
        });
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
        const rollbackResult = await rollbackIterationWorkspace(iterationCfg, iteration, runDir, {
          reason: budgetExhausted ? 'budget_exhaustion_parse_failure' : 'parse_failure',
        });
        await rebuildLivingDoc(artifactCfg, sessionId, {
          startedAt: state.startedAt,
          workDir: startup.workDir,
          metricName: state.metricName,
          direction: state.metricDirection,
        });
        await logExperiment(entry, useAutoResearchStore.getState());
        await notifier.onExperimentComplete(entry, useAutoResearchStore.getState());
        if (!rollbackResult.success) {
          useAutoResearchStore.getState().setError(rollbackResult.message);
          break;
        }
        continue;
      }

      const metricsRecord: IterationMetrics = {
        iteration,
        sessionId,
        runId: sessionId,
        primaryMetric: parsed.metricName,
        direction: state.metricDirection,
        timestamp: finishedAt,
        generator: 'loop_engine',
        schemaVersion: 1,
        metricName: parsed.metricName,
        metricValue: parsed.metricValue,
        status: parsed.status,
        failReason: parsed.failReason,
        hypothesis: parsed.hypothesis,
        change: parsed.change,
        reasoning: parsed.reasoning,
        artifactPaths: parsed.artifactPaths,
        commitHash,
        durationMs,
        startedAt,
        finishedAt,
        extra: parsed.extra,
      };

      const entry = toExperimentEntry(metricsRecord);
      const narrative = buildIterationNarrative({
        hypothesis: parsed.hypothesis,
        change: parsed.change,
        status: parsed.status,
        metricName: parsed.metricName,
        metricValue: parsed.metricValue,
        failReason: parsed.failReason,
        nextStep: parsed.reasoning,
      });
      useAutoResearchStore.getState().addExperiment(entry);
      if (budgetExhausted && parsed.parseSource === 'metrics_json') {
        emitAutoResearchRuntimeEvent({
          level: 'info',
          phase: 'PARSE_METRICS',
          type: 'metrics_parsed',
          message: `evaluation_fallback_from_metrics: iteration ${iteration} completed using metrics.json after tool budget exhaustion.`,
          summary: `Iteration ${iteration} recovered metrics from metrics.json after budget exhaustion.`,
          metadata: {
            iteration,
            iterDir: runDir.iterDir,
            parser: parsed.parseSource,
          },
          iterationId: `${sessionId}-iter-${iteration}`,
        });
      }
      if (budgetExhausted && parsed.status === 'FAILED') {
        emitAutoResearchRuntimeEvent({
          level: 'warn',
          phase: 'FAILED',
          type: 'provider_error',
          message: `iteration_failed_due_to_budget: iteration ${iteration} exhausted the tool budget before evaluation completed.`,
          summary: `Iteration ${iteration} exhausted the tool budget.`,
          metadata: {
            iteration,
            iterDir: runDir.iterDir,
            failReason: parsed.failReason ?? null,
          },
          iterationId: `${sessionId}-iter-${iteration}`,
        });
      }
      if (parsed.parseSource === 'deprecated_result_line') {
        emitAutoResearchRuntimeEvent({
          level: 'warn',
          phase: 'PARSE_METRICS',
          type: 'metrics_parsed',
          message: `Iteration ${iteration} used deprecated EXPERIMENT_RESULT fallback parsing.`,
          summary: `Iteration ${iteration} used deprecated fallback parsing.`,
          metadata: {
            iterDir: runDir.iterDir,
            parser: parsed.parseSource,
          },
          iterationId: `${sessionId}-iter-${iteration}`,
        });
      }
      setAutoResearchPhase('DECIDE_NEXT', {
        iteration,
        summary: `Iteration ${iteration} is deciding the next step.`,
      });
      useAutoResearchStore.getState().completeIterationRecord({
        iteration,
        status: parsed.status === 'FAILED' ? 'failed' : 'completed',
        phase: parsed.status === 'FAILED' ? 'FAILED' : 'DONE',
        hypothesis: entry.hypothesis,
        change: entry.change,
        reasoning: entry.reasoning,
        narrative,
        codeChangesSummary: parsed.change,
        durationMs,
        parsedMetrics: buildIterationParsedMetrics(parsed.metricName, parsed.metricValue, parsed.extra),
        reflectionSummary: parsed.reasoning,
        metricValue: entry.metricValue,
        commitHash,
        error: entry.failReason ?? null,
        endedAt: finishedAt,
        artifactPaths: mergeArtifactPaths(getRunArtifactPaths(runDir), parsed.artifactPaths),
        recoveryActions: buildIterationRecoveryActions({
          status: parsed.status,
          hasLogs: true,
        }),
      });
      emitAutoResearchRuntimeEvent({
        level: parsed.status === 'FAILED' ? 'warn' : 'info',
        phase: parsed.status === 'FAILED' ? 'FAILED' : 'DONE',
        type: 'metrics_parsed',
        message: `Metrics parsed for iteration ${iteration}.`,
        summary: parsed.metricValue === null
          ? `Iteration ${iteration} produced no metric value.`
          : `Iteration ${iteration} reached ${parsed.metricName}=${parsed.metricValue}.`,
        metadata: {
          metricName: parsed.metricName,
          metricValue: parsed.metricValue,
          parser: parsed.parseSource,
          iterDir: runDir.iterDir,
        },
        iterationId: `${sessionId}-iter-${iteration}`,
      });
      emitAutoResearchRuntimeEvent({
        level: parsed.status === 'FAILED' ? 'warn' : 'info',
        phase: parsed.status === 'FAILED' ? 'FAILED' : 'DONE',
        type: parsed.status === 'FAILED' ? 'iteration_failed' : 'iteration_completed',
        message: `Iteration ${iteration} completed with status ${parsed.status}.`,
        summary: `Iteration ${iteration} ${parsed.status === 'FAILED' ? 'failed' : 'completed'}.`,
        metadata: {
          metricValue: parsed.metricValue,
          failReason: parsed.failReason ?? null,
          iterDir: runDir.iterDir,
        },
        iterationId: `${sessionId}-iter-${iteration}`,
      });
      setAutoResearchPhase(parsed.status === 'FAILED' ? 'FAILED' : 'DONE', {
        iteration,
        level: parsed.status === 'FAILED' ? 'warn' : 'info',
        summary: `Iteration ${iteration} ${parsed.status === 'FAILED' ? 'failed' : 'completed'}.`,
      });

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
      const rollbackResult = parsed.status === 'FAILED'
        ? await rollbackIterationWorkspace(iterationCfg, iteration, runDir, {
          reason: budgetExhausted ? 'budget_exhaustion_failed_iteration' : 'failed_iteration',
        })
        : { success: true, message: '' };
      await rebuildLivingDoc(artifactCfg, sessionId, {
        startedAt: state.startedAt,
        workDir: startup.workDir,
        metricName: state.metricName,
        direction: state.metricDirection,
      });
      await logExperiment(entry, useAutoResearchStore.getState());
      await notifier.onExperimentComplete(entry, useAutoResearchStore.getState());
      if (!rollbackResult.success) {
        useAutoResearchStore.getState().setError(rollbackResult.message);
        break;
      }

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
      if (isRateLimitError(error)) {
        consecutiveRateLimitCount += 1;
        const retryAfterSeconds = getRateLimitRetryAfterSeconds(error);
        const cooldownSeconds = retryAfterSeconds ?? Math.min(60, 15 * Math.pow(2, consecutiveRateLimitCount - 1));
        const message = formatError(error);

        useAutoResearchStore.getState().setCurrentIterationValue(Math.max(0, iteration - 1));
        useAutoResearchStore.getState().setRunStatus('waiting_rate_limit', {
          summary: `Provider rate limited the run. Cooling down ${cooldownSeconds}s.`,
        });
        useAutoResearchStore.getState().setStatusMessage(
          `Provider rate limited this run. Waiting ${cooldownSeconds}s before retrying iteration ${iteration}.`,
        );
        setAutoResearchPhase('FAILED', {
          iteration,
          level: 'warn',
          summary: `Iteration ${iteration} is waiting for provider cooldown.`,
          metadata: {
            cooldownSeconds,
          },
        });
        emitAutoResearchRuntimeEvent({
          level: 'warn',
          phase: 'FAILED',
          type: 'provider_error',
          message,
          summary: `Provider rate limited iteration ${iteration}.`,
          metadata: {
            iteration,
            cooldownSeconds,
            iterDir: runDir.iterDir,
          },
          iterationId: `${sessionId}-iter-${iteration}`,
        });
        useAutoResearchStore.getState().appendLiveOutput(
          `[rate-limit] ${message}\n[rate-limit] waiting ${cooldownSeconds}s before retrying iteration ${iteration}\n`,
        );
        await writeRunStatus(artifactCfg, runDir, {
          iteration,
          status: 'RATE_LIMITED',
          metricValue: null,
          failReason: message,
          durationMs: Date.now() - startMs,
          commitHash: await captureCommitHash(iterationCfg),
          retryAfterSeconds: cooldownSeconds,
        });
        const rollbackResult = await rollbackIterationWorkspace(iterationCfg, iteration, runDir, {
          reason: 'rate_limit',
        });
        if (!rollbackResult.success) {
          useAutoResearchStore.getState().setError(rollbackResult.message);
          break;
        }
        if (consecutiveRateLimitCount >= MAX_CONSECUTIVE_RATE_LIMITS) {
          const endedAt = new Date().toISOString();
          const summary = `Provider rate limited the run ${MAX_CONSECUTIVE_RATE_LIMITS} times consecutively. Stopping AutoResearch.`;
          useAutoResearchStore.getState().setRunStatus('failed', {
            summary,
            endedAt,
            reason: message,
          });
          useAutoResearchStore.getState().setStatusMessage(undefined);
          emitAutoResearchRuntimeEvent({
            level: 'error',
            phase: 'FAILED',
            type: 'run_completed',
            message: summary,
            summary,
            metadata: {
              cooldownSeconds,
              consecutiveRateLimitCount,
              iteration,
              iterDir: runDir.iterDir,
            },
          });
          useAutoResearchStore.getState().setLoopState('stopped');
          break;
        }
        await sleep(cooldownSeconds * 1000);
        continue;
      }

      consecutiveRateLimitCount = 0;
      const finishedAt = new Date().toISOString();
      const durationMs = Date.now() - startMs;
      const reflectionFailure = isAutoResearchReflectionFailureError(error);
      const failureMessage = formatError(error);
      const failureKind = reflectionFailure ? 'reflection_failed' : classifyAutoResearchFailure(error);
      const entry: ExperimentEntry = {
        iteration,
        hypothesis: reflectionFailure ? 'Reflection failed' : 'Agent execution error',
        change: 'N/A',
        metricValue: null,
        status: 'FAILED',
        failReason: failureMessage,
        reasoning: reflectionFailure
          ? 'The reflection parser exhausted its contract and AutoResearch marked the iteration failed.'
          : 'The Agent failed to complete the iteration.',
        timestamp: finishedAt,
        durationMs,
      };
      const failedRecord: IterationMetrics = {
        iteration,
        sessionId,
        metricName: useAutoResearchStore.getState().metricName,
        metricValue: null,
        status: 'FAILED',
        failReason: failureMessage,
        hypothesis: entry.hypothesis,
        commitHash: await captureCommitHash(iterationCfg),
        durationMs,
        startedAt,
        finishedAt,
        reflection: reflectionFailure
          ? {
            parserPath: error.decisionResult.parserPath,
            retryCount: error.decisionResult.retryCount,
            reason: failureMessage,
          }
          : undefined,
      };
      const narrative = buildIterationNarrative({
        hypothesis: entry.hypothesis,
        change: entry.change,
        status: 'FAILED',
        metricName: useAutoResearchStore.getState().metricName,
        metricValue: null,
        failReason: failureMessage,
        nextStep: entry.reasoning,
      });
      if (reflectionFailure) {
        useAutoResearchStore.getState().setReflectionFailed(failureMessage, {
          summary: failureMessage,
          endedAt: finishedAt,
        });
      } else {
        useAutoResearchStore.getState().setRunStatus('failed', {
          summary: failureMessage,
          endedAt: finishedAt,
          reason: failureMessage,
        });
      }
      useAutoResearchStore.getState().addExperiment(entry);
      useAutoResearchStore.getState().completeIterationRecord({
        iteration,
        status: 'failed',
        phase: 'FAILED',
        hypothesis: entry.hypothesis,
        change: entry.change,
        reasoning: entry.reasoning,
        narrative,
        codeChangesSummary: entry.change,
        durationMs,
        parsedMetrics: buildIterationParsedMetrics(useAutoResearchStore.getState().metricName, null),
        reflectionSummary: entry.reasoning,
        metricValue: entry.metricValue,
        commitHash: failedRecord.commitHash,
        error: entry.failReason ?? null,
        endedAt: finishedAt,
        artifactPaths: getRunArtifactPaths(runDir),
        recoveryActions: buildIterationRecoveryActions({
          status: 'FAILED',
          hasLogs: true,
        }),
      });
      setAutoResearchPhase('FAILED', {
        iteration,
        level: 'error',
        summary: `Iteration ${iteration} failed during ${reflectionFailure ? 'reflection' : 'agent execution'}.`,
      });
      emitAutoResearchRuntimeEvent({
        level: 'error',
        phase: 'FAILED',
        type: reflectionFailure ? 'provider_error' : 'iteration_failed',
        message: entry.failReason ?? 'Agent execution error',
        summary: `Iteration ${iteration} failed.`,
        metadata: {
          iteration,
          iterDir: runDir.iterDir,
          failureKind,
          parserPath: reflectionFailure ? error.decisionResult.parserPath : undefined,
          retryCount: reflectionFailure ? error.decisionResult.retryCount : undefined,
        },
        iterationId: `${sessionId}-iter-${iteration}`,
      });
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
      const rollbackResult = await rollbackIterationWorkspace(iterationCfg, iteration, runDir, {
        terminal: !isTerminalFailureError(error),
        reason: reflectionFailure ? 'reflection_failure' : 'agent_execution_error',
      });
      await logExperiment(entry, useAutoResearchStore.getState());
      await notifier.onExperimentComplete(entry, useAutoResearchStore.getState());
      if (!rollbackResult.success) {
        useAutoResearchStore.getState().setError(rollbackResult.message);
      }
    } finally {
      clearCurrentRunDir();
    }
  }
}

export function stopExperimentLoop(): void {
  useAutoResearchStore.getState().setRunStatus('stopped', {
    summary: 'Stopped by user.',
    endedAt: new Date().toISOString(),
  });
  emitAutoResearchRuntimeEvent({
    level: 'warn',
    phase: 'DONE',
    type: 'run_status_changed',
    message: 'Run stopped by user.',
    summary: 'Run stopped by user.',
  });
  useAutoResearchStore.getState().setLoopState('stopped');
}

export function pauseExperimentLoop(): void {
  emitAutoResearchRuntimeEvent({
    level: 'info',
    phase: 'DECIDE_NEXT',
    type: 'run_status_changed',
    message: 'Run paused by user.',
    summary: 'Run paused by user.',
  });
  useAutoResearchStore.getState().patchActiveRunResumeToken({ status: 'paused' });
  useAutoResearchStore.getState().setLoopState('paused');
}

export function resumeExperimentLoop(): void {
  const state = useAutoResearchStore.getState();
  if (state.loopState === 'paused') {
    useAutoResearchStore.getState().patchActiveRunResumeToken({ status: 'running' });
    useAutoResearchStore.getState().setRunStatus('running', {
      summary: 'Run resumed.',
    });
    emitAutoResearchRuntimeEvent({
      level: 'info',
      phase: 'DECIDE_NEXT',
      type: 'run_status_changed',
      message: 'Run resumed by user.',
      summary: 'Run resumed by user.',
    });
    useAutoResearchStore.getState().setLoopState('running');
  }
}

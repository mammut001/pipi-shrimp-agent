import {
  formatAgentConfigValidationError,
  getAgentConfigDiagnostics,
  resolveActiveAgentConfig,
  validateResolvedAgentConfig,
  type ResolvedAgentConfig,
} from '@/services/agentConfig';
import { t } from '@/i18n';
import { testResolvedChatConnection } from '@/services/resolvedChatRequest';
import { isAuthConnectionError } from '@/services/settings/settingsConnection';
import type { SshConfig } from '@/store/autoresearchStore';
import { useAutoResearchStore } from '@/store/autoresearchStore';
import { useSettingsStore } from '@/store/settingsStore';
import { shellEscapePath } from '@/utils/remoteExec';
import { formatError } from '@/utils/errorFormat';
import { shellEscape } from '@/utils/remoteExec';
import {
  convertWindowsPathToWsl,
  resolveWindowsShellProfile,
} from '@/utils/windowsShellProfile';
import {
  getAutoResearchLivingDocPathFromWorkDir,
  getAutoResearchSessionFilePathFromWorkDir,
} from './paths';
import { ensureAutoResearchProjectReady } from './projectAdapter';
import {
  executeTargetCommand,
  pathExistsOnTarget,
  readTargetText,
  writeTargetText,
} from './runDir';

export interface AutoResearchPreflightInput {
  sshConfig: SshConfig;
  experimentDir: string;
  workDir: string;
  sessionId: string;
  metricName?: string;
  agentConfig?: ResolvedAgentConfig | null;
  autoAdapt?: boolean;
}

export interface AutoResearchPreflightResult {
  agentConfig: ResolvedAgentConfig;
  resolvedExperimentDir: string;
  resolvedWorkDir: string;
  sessionFilePath: string;
  livingDocPath: string;
  environmentSummary: AutoResearchEnvironmentSummary;
}

const REQUIRED_EXPERIMENT_FILES = ['run_experiment.py', 'AUTORESEARCH.md'] as const;

export interface AutoResearchEnvironmentSummary {
  experimentDir: string;
  gitRepo: boolean;
  repoStatus: 'clean' | 'dirty';
  dirtyFileCount: number;
  preferredPythonCommand: string;
  worktreeWritable: boolean;
  runScriptPath: string;
  notesPath: string;
  recommendedRunCommand: string;
  gpuTelemetryAvailable?: boolean;
  gpuSummary?: string;
  gpuTemperatureC?: number | null;
  gpuFanSpeedPercent?: number | null;
  gpuUtilizationPercent?: number | null;
  gpuMemoryUsedMb?: number | null;
  gpuMemoryTotalMb?: number | null;
  projectAutoAdapted?: boolean;
  projectAdaptationActions?: string[];
  inferredProjectType?: 'python' | 'node' | 'unknown';
  detectedEntryScript?: string | null;
  detectedCommand?: string | null;
  detectedNotebookFiles?: string[];
  detectedResultFiles?: string[];
}

async function resolveTargetHomeDirectory(cfg: SshConfig): Promise<string> {
  const result = await executeTargetCommand(
    { ...cfg, remoteWorkDir: '' },
    `printf '%s' "$HOME"`,
    30,
  );
  if ((result.exit_code ?? 0) !== 0) {
    throw new Error(result.stderr || 'Failed to resolve HOME directory.');
  }

  const homeDir = (result.stdout || '').trim();
  if (!homeDir) {
    throw new Error('Failed to resolve HOME directory.');
  }
  return homeDir;
}

function normalizeLocalTargetPath(path: string): string {
  const windowsShellProfile = useSettingsStore.getState().windowsShellProfile;
  const shellResolution = resolveWindowsShellProfile(windowsShellProfile, path);
  if (!shellResolution.isWindows || shellResolution.resolved !== 'wsl') {
    return path;
  }
  return convertWindowsPathToWsl(path) ?? path;
}

export async function resolveTargetPath(
  cfg: SshConfig,
  fieldName: string,
  value: string,
): Promise<string> {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Invalid ${fieldName}: expected non-empty string`);
  }

  let resolvedPath = trimmed;
  if (trimmed === '~' || trimmed.startsWith('~/')) {
    const homeDir = await resolveTargetHomeDirectory(cfg);
    resolvedPath = trimmed === '~' ? homeDir : `${homeDir}/${trimmed.slice(2)}`;
  }

  if (cfg.mode === 'local') {
    resolvedPath = normalizeLocalTargetPath(resolvedPath);
  }

  return resolvedPath;
}

function buildRequiredPath(parentDir: string, fileName: string): string {
  return `${parentDir.replace(/[\\/]+$/, '')}/${fileName}`;
}

function buildRecommendedRunCommand(preferredPythonCommand: string, metricName?: string): string {
  const normalizedMetric = metricName?.trim();
  if (!normalizedMetric) {
    return `${preferredPythonCommand} run_experiment.py`;
  }
  return `${preferredPythonCommand} run_experiment.py --primary-metric ${normalizedMetric}`;
}

async function probePreferredPythonCommand(cfg: SshConfig): Promise<string> {
  const command = [
    'preferred_python=""',
    'for candidate in python3 python /usr/bin/python3 /usr/local/bin/python3 /bin/python3; do',
    '  if "$candidate" -c \'import sys; print(sys.executable)\' >/dev/null 2>&1; then',
    '    preferred_python="$candidate"',
    '    break',
    '  fi',
    'done',
    'printf \'%s\' "$preferred_python"',
  ].join('\n');

  const result = await executeTargetCommand({ ...cfg, remoteWorkDir: '' }, command, 30);
  if ((result.exit_code ?? 0) !== 0) {
    return '';
  }
  return (result.stdout || '').trim();
}

async function probeGitRepository(cfg: SshConfig, experimentDir: string): Promise<{
  gitRepo: boolean;
  dirtyFileCount: number;
}> {
  const command = [
    `repo=${shellEscape(experimentDir)}`,
    'git_repo=0',
    'dirty_file_count=0',
    'if git -C "$repo" rev-parse --is-inside-work-tree >/dev/null 2>&1; then',
    '  git_repo=1',
    '  dirty_file_count="$(git -C "$repo" status --porcelain | wc -l | tr -d \' \')"',
    'fi',
    'printf \'git_repo\\t%s\\n\' "$git_repo"',
    'printf \'dirty_file_count\\t%s\\n\' "$dirty_file_count"',
  ].join('\n');

  const result = await executeTargetCommand({ ...cfg, remoteWorkDir: '' }, command, 30);
  if ((result.exit_code ?? 0) !== 0) {
    return { gitRepo: false, dirtyFileCount: 0 };
  }

  const values = new Map<string, string>();
  for (const line of (result.stdout || '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const [key, ...rest] = trimmed.split('\t');
    values.set(key, rest.join('\t'));
  }

  const dirtyFileCount = Number.parseInt(values.get('dirty_file_count') || '0', 10);
  return {
    gitRepo: values.get('git_repo') === '1',
    dirtyFileCount: Number.isFinite(dirtyFileCount) ? dirtyFileCount : 0,
  };
}

async function probeWorktreeWritable(cfg: SshConfig, experimentDir: string): Promise<boolean> {
  const command = [
    `repo=${shellEscape(experimentDir)}`,
    'probe_path="$repo/.autoresearch-write-probe-$$"',
    'if touch "$probe_path" >/dev/null 2>&1; then',
    '  rm -f "$probe_path" >/dev/null 2>&1 || true',
    '  printf \'1\'',
    'else',
    '  printf \'0\'',
    'fi',
  ].join('\n');

  const result = await executeTargetCommand({ ...cfg, remoteWorkDir: '' }, command, 30);
  if ((result.exit_code ?? 0) !== 0) {
    return false;
  }
  return (result.stdout || '').trim() === '1';
}

function buildNotGitRepoMessage(experimentDir: string): string {
  return [
    t('autoresearch.preflight.notGitRepoTitle'),
    '',
    t('autoresearch.preflight.notGitRepoDescription'),
    '',
    t('autoresearch.preflight.requiredFiles'),
    '- run_experiment.py',
    '- AUTORESEARCH.md',
    '',
    `cd ${experimentDir}`,
    'git init',
    'git add .',
    'git commit -m "Initial AutoResearch experiment"',
  ].join('\n');
}

async function assertTargetPathExists(
  cfg: SshConfig,
  label: string,
  absolutePath: string,
): Promise<void> {
  if (!await pathExistsOnTarget({ ...cfg, remoteWorkDir: '' }, absolutePath)) {
    throw new Error(`${label} does not exist: ${absolutePath}`);
  }
}

function parseEnvironmentSummary(
  raw: string,
  experimentDir: string,
  metricName?: string,
): AutoResearchEnvironmentSummary {
  const values = new Map<string, string>();
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const [key, ...rest] = trimmed.split('\t');
    values.set(key, rest.join('\t'));
  }

  const preferredPythonCommand = values.get('preferred_python') || '';
  const gitRepo = values.get('git_repo') === '1';

  const worktreeWritable = values.get('worktree_writable') === '1';

  const dirtyFileCount = Number.parseInt(values.get('dirty_file_count') || '0', 10);
  const parsedDirtyFileCount = Number.isFinite(dirtyFileCount) ? dirtyFileCount : 0;
  const gpuRaw = values.get('gpu_raw') || '';
  const gpuValues = gpuRaw.split(',').map((value) => value.trim());
  const gpuTemperatureC = parseOptionalTelemetryNumber(gpuValues[0]);
  const gpuFanSpeedPercent = parseOptionalTelemetryNumber(gpuValues[1]);
  const gpuUtilizationPercent = parseOptionalTelemetryNumber(gpuValues[2]);
  const gpuMemoryUsedMb = parseOptionalTelemetryNumber(gpuValues[3]);
  const gpuMemoryTotalMb = parseOptionalTelemetryNumber(gpuValues[4]);
  const gpuTelemetryAvailable = values.get('gpu_telemetry_available') === '1';

  return {
    experimentDir,
    gitRepo,
    repoStatus: parsedDirtyFileCount > 0 ? 'dirty' : 'clean',
    dirtyFileCount: parsedDirtyFileCount,
    preferredPythonCommand,
    worktreeWritable,
    runScriptPath: buildRequiredPath(experimentDir, 'run_experiment.py'),
    notesPath: buildRequiredPath(experimentDir, 'AUTORESEARCH.md'),
    recommendedRunCommand: buildRecommendedRunCommand(preferredPythonCommand, metricName),
    gpuTelemetryAvailable,
    gpuSummary: gpuTelemetryAvailable
      ? [
        gpuTemperatureC === null ? 'temp=unknown' : `temp=${gpuTemperatureC}C`,
        gpuFanSpeedPercent === null ? 'fan=unknown' : `fan=${gpuFanSpeedPercent}%`,
        gpuUtilizationPercent === null ? 'util=unknown' : `util=${gpuUtilizationPercent}%`,
        gpuMemoryUsedMb === null || gpuMemoryTotalMb === null
          ? 'memory=unknown'
          : `memory=${gpuMemoryUsedMb}/${gpuMemoryTotalMb}MB`,
      ].join(', ')
      : 'nvidia-smi unavailable',
    gpuTemperatureC,
    gpuFanSpeedPercent,
    gpuUtilizationPercent,
    gpuMemoryUsedMb,
    gpuMemoryTotalMb,
  };
}

function parseOptionalTelemetryNumber(value: string | undefined): number | null {
  if (!value || value.toLowerCase() === '[not supported]') {
    return null;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function inspectAutoResearchEnvironment(
  cfg: SshConfig,
  experimentDir: string,
  metricName?: string,
): Promise<AutoResearchEnvironmentSummary> {
  const command = [
    `repo=${shellEscape(experimentDir)}`,
    'preferred_python=""',
    'for candidate in python3 python /usr/bin/python3 /usr/local/bin/python3 /bin/python3; do',
    '  if "$candidate" -c \'import sys; print(sys.executable)\' >/dev/null 2>&1; then',
    '    preferred_python="$candidate"',
    '    break',
    '  fi',
    'done',
    'git_repo=0',
    'dirty_file_count=0',
    `if git -C "$repo" rev-parse --is-inside-work-tree >/dev/null 2>&1; then`,
    '  git_repo=1',
    '  dirty_file_count="$(git -C "$repo" status --porcelain | wc -l | tr -d \' \')"',
    'fi',
    'worktree_writable=0',
    'if [ -w "$repo" ]; then',
    '  worktree_writable=1',
    'fi',
    'gpu_telemetry_available=0',
    'gpu_raw=""',
    'if command -v nvidia-smi >/dev/null 2>&1; then',
    '  gpu_raw="$(nvidia-smi --query-gpu=temperature.gpu,fan.speed,utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits 2>/dev/null | head -n 1 || true)"',
    '  if [ -n "$gpu_raw" ]; then',
    '    gpu_telemetry_available=1',
    '  fi',
    'fi',
    'printf \'preferred_python\\t%s\\n\' "$preferred_python"',
    'printf \'git_repo\\t%s\\n\' "$git_repo"',
    'printf \'dirty_file_count\\t%s\\n\' "$dirty_file_count"',
    'printf \'worktree_writable\\t%s\\n\' "$worktree_writable"',
    'printf \'gpu_telemetry_available\\t%s\\n\' "$gpu_telemetry_available"',
    'printf \'gpu_raw\\t%s\\n\' "$gpu_raw"',
  ].join('\n');
  const result = await executeTargetCommand({ ...cfg, remoteWorkDir: '' }, command, 60);
  if ((result.exit_code ?? 0) !== 0) {
    throw new Error(result.stderr || `Failed to inspect experiment environment: ${experimentDir}`);
  }
  const summary = parseEnvironmentSummary(result.stdout || '', experimentDir, metricName);
  if (summary.preferredPythonCommand) {
    if (summary.gitRepo && summary.worktreeWritable) {
      return summary;
    }
  } else {
    const fallbackPython = await probePreferredPythonCommand(cfg);
    if (fallbackPython) {
      summary.preferredPythonCommand = fallbackPython;
      summary.recommendedRunCommand = buildRecommendedRunCommand(fallbackPython, metricName);
    }
  }

  if (!summary.gitRepo) {
    const fallbackGit = await probeGitRepository(cfg, experimentDir);
    if (fallbackGit.gitRepo) {
      summary.gitRepo = true;
      summary.repoStatus = fallbackGit.dirtyFileCount > 0 ? 'dirty' : 'clean';
      summary.dirtyFileCount = fallbackGit.dirtyFileCount;
    }
  }

  if (!summary.worktreeWritable) {
    summary.worktreeWritable = await probeWorktreeWritable(cfg, experimentDir);
  }

  if (!summary.preferredPythonCommand) {
    throw new Error(
      `AutoResearch target is missing python3/python in PATH: ${experimentDir}`,
    );
  }

  if (!summary.gitRepo) {
    throw new Error(buildNotGitRepoMessage(experimentDir));
  }

  if (!summary.worktreeWritable) {
    throw new Error(`Experiment directory is not writable: ${experimentDir}`);
  }

  return summary;
}

export async function runAutoResearchPreflight(
  input: AutoResearchPreflightInput,
): Promise<AutoResearchPreflightResult> {
  const agentConfig = input.agentConfig ?? resolveActiveAgentConfig();
  const configIssues = validateResolvedAgentConfig(agentConfig);
  if (configIssues.length > 0) {
    throw new Error(formatAgentConfigValidationError(agentConfig, configIssues));
  }

  try {
    await testResolvedChatConnection(agentConfig!, `autoresearch-api-test-${input.sessionId}`);
  } catch (error) {
    if (isAuthConnectionError(error)) {
      throw new Error(
        `Agent API config invalid: selected config '${agentConfig!.name}' failed authentication. Please fix it in Settings.`,
      );
    }
    throw new Error(
      `Agent API config invalid: selected config '${agentConfig!.name}' failed connection test. ${formatError(error)}`,
    );
  }

  const resolvedWorkDir = await resolveTargetPath(input.sshConfig, 'workdir', input.workDir);
  const resolvedExperimentDir = await resolveTargetPath(
    input.sshConfig,
    'experimentDir',
    input.experimentDir,
  );

  await assertTargetPathExists(input.sshConfig, 'Experiment directory', resolvedExperimentDir);

  const adaptation = input.autoAdapt === false
    ? {
      adapted: false,
      actions: [] as string[],
      inferredProjectType: 'unknown' as const,
      detectedEntryScript: null,
      detectedCommand: null,
      detectedNotebookFiles: [] as string[],
      detectedResultFiles: [] as string[],
    }
    : await ensureAutoResearchProjectReady(input.sshConfig, resolvedExperimentDir);

  for (const fileName of REQUIRED_EXPERIMENT_FILES) {
    await assertTargetPathExists(
      input.sshConfig,
      fileName,
      buildRequiredPath(resolvedExperimentDir, fileName),
    );
  }

  const sessionFilePath = getAutoResearchSessionFilePathFromWorkDir(resolvedWorkDir);
  const livingDocPath = getAutoResearchLivingDocPathFromWorkDir(resolvedWorkDir, input.sessionId);
  const environmentSummary = await inspectAutoResearchEnvironment(
    input.sshConfig,
    resolvedExperimentDir,
    input.metricName,
  );
  environmentSummary.projectAutoAdapted = adaptation.adapted;
  environmentSummary.projectAdaptationActions = adaptation.actions;
  environmentSummary.inferredProjectType = adaptation.inferredProjectType;
  environmentSummary.detectedEntryScript = adaptation.detectedEntryScript;
  environmentSummary.detectedCommand = adaptation.detectedCommand;
  environmentSummary.detectedNotebookFiles = adaptation.detectedNotebookFiles;
  environmentSummary.detectedResultFiles = adaptation.detectedResultFiles;

  console.info('[AutoResearch] Startup preflight', {
    ...getAgentConfigDiagnostics(agentConfig!),
    resolvedWorkdir: resolvedWorkDir,
    resolvedExperimentDir,
    sessionFilePath,
    livingDocPath,
    preferredPythonCommand: environmentSummary.preferredPythonCommand,
    repoStatus: environmentSummary.repoStatus,
    dirtyFileCount: environmentSummary.dirtyFileCount,
    gpu: environmentSummary.gpuSummary,
    projectAutoAdapted: environmentSummary.projectAutoAdapted,
    projectAdaptationActions: environmentSummary.projectAdaptationActions,
    inferredProjectType: environmentSummary.inferredProjectType,
    detectedEntryScript: environmentSummary.detectedEntryScript,
    detectedCommand: environmentSummary.detectedCommand,
    detectedResultFiles: environmentSummary.detectedResultFiles,
  });

  return {
    agentConfig: agentConfig!,
    resolvedExperimentDir,
    resolvedWorkDir,
    sessionFilePath,
    livingDocPath,
    environmentSummary,
  };
}

export interface LoopStartupContext {
  artifactCfg: SshConfig;
  experimentCfg: SshConfig;
  experimentDir: string;
  workDir: string;
  sessionContent: string;
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

/** Loop-engine startup path resolution extracted from loopEngine.ts (AG-02). */
export async function prepareLoopStartupContext(
  store: ReturnType<typeof useAutoResearchStore.getState>,
): Promise<LoopStartupContext> {
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

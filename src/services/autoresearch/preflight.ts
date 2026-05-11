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
import { formatError } from '@/utils/errorFormat';
import {
  getAutoResearchLivingDocPathFromWorkDir,
  getAutoResearchSessionFilePathFromWorkDir,
} from './paths';
import { executeTargetCommand, pathExistsOnTarget } from './runDir';

export interface AutoResearchPreflightInput {
  sshConfig: SshConfig;
  experimentDir: string;
  workDir: string;
  sessionId: string;
  agentConfig?: ResolvedAgentConfig | null;
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

export async function resolveTargetPath(
  cfg: SshConfig,
  fieldName: string,
  value: string,
): Promise<string> {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Invalid ${fieldName}: expected non-empty string`);
  }
  if (trimmed === '~' || trimmed.startsWith('~/')) {
    const homeDir = await resolveTargetHomeDirectory(cfg);
    return trimmed === '~' ? homeDir : `${homeDir}/${trimmed.slice(2)}`;
  }
  return trimmed;
}

function buildRequiredPath(parentDir: string, fileName: string): string {
  return `${parentDir.replace(/[\\/]+$/, '')}/${fileName}`;
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

function parseEnvironmentSummary(raw: string, experimentDir: string): AutoResearchEnvironmentSummary {
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
  if (!preferredPythonCommand) {
    throw new Error(
      `AutoResearch target is missing python3/python in PATH: ${experimentDir}`,
    );
  }

  const gitRepo = values.get('git_repo') === '1';
  if (!gitRepo) {
    throw new Error(buildNotGitRepoMessage(experimentDir));
  }

  const worktreeWritable = values.get('worktree_writable') === '1';
  if (!worktreeWritable) {
    throw new Error(`Experiment directory is not writable: ${experimentDir}`);
  }

  const dirtyFileCount = Number.parseInt(values.get('dirty_file_count') || '0', 10);
  const parsedDirtyFileCount = Number.isFinite(dirtyFileCount) ? dirtyFileCount : 0;

  return {
    experimentDir,
    gitRepo,
    repoStatus: parsedDirtyFileCount > 0 ? 'dirty' : 'clean',
    dirtyFileCount: parsedDirtyFileCount,
    preferredPythonCommand,
    worktreeWritable,
    runScriptPath: buildRequiredPath(experimentDir, 'run_experiment.py'),
    notesPath: buildRequiredPath(experimentDir, 'AUTORESEARCH.md'),
    recommendedRunCommand: `${preferredPythonCommand} run_experiment.py`,
  };
}

export async function inspectAutoResearchEnvironment(
  cfg: SshConfig,
  experimentDir: string,
): Promise<AutoResearchEnvironmentSummary> {
  const command = [
    `repo=${JSON.stringify(experimentDir)}`,
    'preferred_python=""',
    'if command -v python3 >/dev/null 2>&1; then',
    '  preferred_python="python3"',
    'elif command -v python >/dev/null 2>&1; then',
    '  preferred_python="python"',
    'fi',
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
    'printf \'preferred_python\\t%s\\n\' "$preferred_python"',
    'printf \'git_repo\\t%s\\n\' "$git_repo"',
    'printf \'dirty_file_count\\t%s\\n\' "$dirty_file_count"',
    'printf \'worktree_writable\\t%s\\n\' "$worktree_writable"',
  ].join('\n');
  const result = await executeTargetCommand({ ...cfg, remoteWorkDir: '' }, command, 60);
  if ((result.exit_code ?? 0) !== 0) {
    throw new Error(result.stderr || `Failed to inspect experiment environment: ${experimentDir}`);
  }

  return parseEnvironmentSummary(result.stdout || '', experimentDir);
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

  for (const fileName of REQUIRED_EXPERIMENT_FILES) {
    await assertTargetPathExists(
      input.sshConfig,
      fileName,
      buildRequiredPath(resolvedExperimentDir, fileName),
    );
  }

  const sessionFilePath = getAutoResearchSessionFilePathFromWorkDir(resolvedWorkDir);
  const livingDocPath = getAutoResearchLivingDocPathFromWorkDir(resolvedWorkDir, input.sessionId);
  const environmentSummary = await inspectAutoResearchEnvironment(input.sshConfig, resolvedExperimentDir);

  console.info('[AutoResearch] Startup preflight', {
    ...getAgentConfigDiagnostics(agentConfig!),
    resolvedWorkdir: resolvedWorkDir,
    resolvedExperimentDir,
    sessionFilePath,
    livingDocPath,
    preferredPythonCommand: environmentSummary.preferredPythonCommand,
    repoStatus: environmentSummary.repoStatus,
    dirtyFileCount: environmentSummary.dirtyFileCount,
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

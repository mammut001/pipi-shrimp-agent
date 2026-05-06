import {
  formatAgentConfigValidationError,
  getAgentConfigDiagnostics,
  resolveActiveAgentConfig,
  validateResolvedAgentConfig,
  type ResolvedAgentConfig,
} from '@/services/agentConfig';
import type { SshConfig } from '@/store/autoresearchStore';
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
}

const REQUIRED_EXPERIMENT_FILES = ['run_experiment.py', 'AUTORESEARCH.md'] as const;

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

async function assertTargetPathExists(
  cfg: SshConfig,
  label: string,
  absolutePath: string,
): Promise<void> {
  if (!await pathExistsOnTarget({ ...cfg, remoteWorkDir: '' }, absolutePath)) {
    throw new Error(`${label} does not exist: ${absolutePath}`);
  }
}

export async function runAutoResearchPreflight(
  input: AutoResearchPreflightInput,
): Promise<AutoResearchPreflightResult> {
  const agentConfig = input.agentConfig ?? resolveActiveAgentConfig();
  const configIssues = validateResolvedAgentConfig(agentConfig);
  if (configIssues.length > 0) {
    throw new Error(formatAgentConfigValidationError(agentConfig, configIssues));
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

  console.info('[AutoResearch] Startup preflight', {
    ...getAgentConfigDiagnostics(agentConfig!),
    resolvedWorkdir: resolvedWorkDir,
    resolvedExperimentDir,
    sessionFilePath,
    livingDocPath,
  });

  return {
    agentConfig: agentConfig!,
    resolvedExperimentDir,
    resolvedWorkDir,
    sessionFilePath,
    livingDocPath,
  };
}

import { buildRemoteBashCommand, shellEscapePath } from '@/utils/remoteExec';

/**
 * Host-side cwd for AutoResearch `execute_bash` probes.
 * Never use `.` — the file sandbox rejects a relative process cwd with
 * `Access denied: path '.'`. `/tmp` is always an allowed root.
 */
export const AUTORESEARCH_SAFE_HOST_CWD = '/tmp';

function assertProbePath(label: string, value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === '.' || trimmed === './') {
    throw new Error(`${label} must be an absolute or home path, not '${value || '.'}'.`);
  }
  return trimmed;
}

export type AutoResearchProbeGitStatus = 'ok' | 'missing' | 'not_installed' | 'unknown';
export type AutoResearchProbePythonStatus = 'ok' | 'missing' | 'unknown';
export type AutoResearchProbeExperimentStatus = 'ok' | 'missing' | 'unknown';
export type AutoResearchProbeWorkspaceStatus = 'ok' | 'failed' | 'unknown';

export interface AutoResearchConnectionProbeInput {
  workDir: string;
  experimentDir: string;
}

export interface AutoResearchConnectionProbeParse {
  platform: string;
  pwd: string;
  targetOk: boolean;
  git: AutoResearchProbeGitStatus;
  python: AutoResearchProbePythonStatus;
  experiment: AutoResearchProbeExperimentStatus;
  workspace: AutoResearchProbeWorkspaceStatus;
  raw: string;
}

export interface AutoResearchConnectionProbeVerdict {
  ok: boolean;
  error?: string;
  warnings: string[];
  parsed: AutoResearchConnectionProbeParse;
  output: string;
}

/**
 * Self-contained probe. Does not `cd` into the workspace first, so a missing
 * `~/autoresearch` is created instead of failing the whole check. Git is
 * inspected with `git -C` and never chained with `&&`, so a non-repo
 * experiment dir reports `git:missing` instead of exit 128.
 */
export function buildAutoResearchConnectionProbeCommand(input: AutoResearchConnectionProbeInput): string {
  const workDir = shellEscapePath(assertProbePath('AutoResearch workspace', input.workDir));
  const experimentDir = shellEscapePath(assertProbePath('Target project', input.experimentDir));

  return [
    'uname -s',
    'pwd',
    `mkdir -p ${workDir}`,
    `if [ -d ${workDir} ]; then printf 'workspace:ok\\n'; else printf 'workspace:failed\\n'; fi`,
    `if [ -d ${experimentDir} ]; then printf 'experiment:ok\\n'; else printf 'experiment:missing\\n'; fi`,
    `if [ -d ${workDir} ]; then printf '__AUTORESEARCH_TARGET_OK__\\n'; fi`,
    'if command -v git >/dev/null 2>&1; then',
    `  if [ -d ${experimentDir} ] && git -C ${experimentDir} rev-parse --is-inside-work-tree >/dev/null 2>&1; then`,
    "    printf 'git:ok\\n'",
    '  else',
    "    printf 'git:missing\\n'",
    '  fi',
    'else',
    "  printf 'git:not_installed\\n'",
    'fi',
    'if command -v python3 >/dev/null 2>&1 || command -v python >/dev/null 2>&1; then',
    "  printf 'python:ok\\n'",
    'else',
    "  printf 'python:missing\\n'",
    'fi',
  ].join('\n');
}

export function buildAutoResearchConnectionProbeInvokeArgs(input: {
  mode: 'local' | 'ssh';
  sshConfig: Parameters<typeof buildRemoteBashCommand>[0];
  workDir: string;
  experimentDir: string;
  timeoutSecs: number;
  windowsShellProfile?: string;
}): {
  command: string;
  workDir: string;
  timeoutSecs: number;
  windowsShellProfile?: string;
} {
  const probe = buildAutoResearchConnectionProbeCommand({
    workDir: input.workDir,
    experimentDir: input.experimentDir,
  });
  const command = input.mode === 'local'
    ? probe
    : buildRemoteBashCommand({ ...input.sshConfig, remoteWorkDir: '' }, probe);

  return {
    command,
    workDir: AUTORESEARCH_SAFE_HOST_CWD,
    timeoutSecs: input.timeoutSecs,
    windowsShellProfile: input.windowsShellProfile,
  };
}

export function parseAutoResearchConnectionProbeOutput(raw: string): AutoResearchConnectionProbeParse {
  const lines = (raw || '').split('\n').map((line) => line.trim()).filter(Boolean);
  const platform = lines.find((line) => /^(Darwin|Linux|Windows_NT|MINGW|MSYS)/i.test(line)) || lines[0] || 'Unknown';
  const pwd = lines.find((line) => line.startsWith('/') || /^[A-Za-z]:[\\/]/.test(line)) || lines[1] || 'Unknown';

  const hasMarker = (value: string) => lines.some((line) => line === value);
  const git: AutoResearchProbeGitStatus = hasMarker('git:ok') || hasMarker('true')
    ? 'ok'
    : hasMarker('git:not_installed')
      ? 'not_installed'
      : hasMarker('git:missing') || hasMarker('false')
        ? 'missing'
        : 'unknown';
  const python: AutoResearchProbePythonStatus = hasMarker('python:ok')
    ? 'ok'
    : hasMarker('python:missing')
      ? 'missing'
      : 'unknown';
  const experiment: AutoResearchProbeExperimentStatus = hasMarker('experiment:ok')
    ? 'ok'
    : hasMarker('experiment:missing')
      ? 'missing'
      : 'unknown';
  const workspace: AutoResearchProbeWorkspaceStatus = hasMarker('workspace:ok')
    ? 'ok'
    : hasMarker('workspace:failed')
      ? 'failed'
      : 'unknown';

  return {
    platform,
    pwd,
    targetOk: hasMarker('__AUTORESEARCH_TARGET_OK__') || workspace === 'ok',
    git,
    python,
    experiment,
    workspace,
    raw,
  };
}

export function interpretAutoResearchConnectionProbe(input: {
  stdout: string;
  stderr: string;
  exitCode: number;
  mode: 'local' | 'ssh';
}): AutoResearchConnectionProbeVerdict {
  const raw = [input.stdout, input.stderr].filter((part) => part && part.trim()).join('\n');
  const parsed = parseAutoResearchConnectionProbeOutput(input.stdout || '');
  const warnings: string[] = [];

  if ((input.exitCode ?? 0) !== 0 && !parsed.targetOk) {
    return {
      ok: false,
      error: (input.stderr || input.stdout || `connection test failed (exit ${input.exitCode})`).trim(),
      warnings,
      parsed,
      output: raw.trim(),
    };
  }

  const platform = parsed.platform.trim();
  if (input.mode === 'ssh' && platform && platform !== 'Linux') {
    return {
      ok: false,
      error: 'Remote target must be Linux',
      warnings,
      parsed,
      output: raw.trim(),
    };
  }
  if (input.mode === 'local' && platform && !['Darwin', 'Linux'].includes(platform)) {
    return {
      ok: false,
      error: 'AutoResearch supports macOS and Linux only',
      warnings,
      parsed,
      output: raw.trim(),
    };
  }

  if (parsed.workspace === 'failed' || !parsed.targetOk) {
    return {
      ok: false,
      error: 'AutoResearch workspace directory could not be created or is not writable.',
      warnings,
      parsed,
      output: raw.trim(),
    };
  }

  if (parsed.git === 'not_installed') {
    return {
      ok: false,
      error: 'Git is not installed on the target. AutoResearch needs Git to snapshot and roll back iterations.',
      warnings,
      parsed,
      output: raw.trim(),
    };
  }

  if (parsed.git === 'missing') {
    warnings.push('git_missing');
  }
  if (parsed.experiment === 'missing') {
    warnings.push('experiment_missing');
  }
  if (parsed.python === 'missing') {
    warnings.push('python_missing');
  }

  const outputLines = [
    parsed.platform,
    parsed.pwd,
    parsed.workspace === 'ok' ? 'workspace:ok' : null,
    parsed.experiment === 'ok' ? 'experiment:ok' : parsed.experiment === 'missing' ? 'experiment:missing' : null,
    '__AUTORESEARCH_TARGET_OK__',
    parsed.git === 'ok' ? 'git:ok' : parsed.git === 'missing' ? 'git:missing' : parsed.git === 'not_installed' ? 'git:not_installed' : null,
    parsed.python === 'ok' ? 'python:ok' : parsed.python === 'missing' ? 'python:missing' : null,
  ].filter((line): line is string => Boolean(line));

  return {
    ok: true,
    warnings,
    parsed,
    output: outputLines.join('\n'),
  };
}

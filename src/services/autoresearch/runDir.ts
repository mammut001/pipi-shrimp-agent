import { invoke } from '@tauri-apps/api/core';
import type { SshConfig } from '@/store/autoresearchStore';
import { useSettingsStore } from '@/store/settingsStore';
import { buildRemoteBashCommand, shellEscape, shellEscapePath } from '@/utils/remoteExec';

interface RawBashResult {
  stdout?: string;
  stderr?: string;
  exit_code?: number;
}

export interface RunDir {
  sessionId: string;
  iter: number;
  iterDir: string;
  codeDir: string;
  logsDir: string;
  transcriptPath: string;
  systemPromptPath: string;
  hypothesisPath: string;
  diffPath: string;
  metricsPath: string;
  statusPath: string;
  reflectionInputPath: string;
  reflectionRawPath: string;
  reflectionParsedPath: string;
}

export interface SessionRunPaths {
  sessionDir: string;
  sessionFilePath: string;
  livingDocPath: string;
  metricsJsonlPath: string;
  runConfigPath: string;
}

const SNAPSHOT_EXCLUDES = ['.git', 'node_modules', 'target', 'runs'] as const;
const DEFAULT_LOCAL_COMMAND_CWD = '/tmp';

function trimTrailingSlash(value: string): string {
  return value.replace(/[\\/]+$/, '');
}

function assertSafeSessionId(sessionId: string): string {
  const normalized = sessionId.trim();
  if (!normalized) {
    throw new Error('Invalid AutoResearch sessionId: expected a non-empty identifier.');
  }
  if (normalized.includes('/') || normalized.includes('\\') || normalized.includes('..')) {
    throw new Error(`Invalid AutoResearch sessionId "${sessionId}": path separators and ".." are not allowed.`);
  }
  return normalized;
}

function assertPositiveIteration(iter: number): number {
  if (!Number.isInteger(iter) || iter < 1) {
    throw new Error(`Invalid AutoResearch iteration "${iter}": expected a positive integer.`);
  }
  return iter;
}

function padIteration(iter: number): string {
  return String(iter).padStart(3, '0');
}

function formatTimestamp(date = new Date()): string {
  return date.toISOString().replace(/:/g, '-').replace(/\.\d{3}Z$/, 'Z');
}

function getParentDirectory(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx > 0 ? path.slice(0, idx) : '.';
}

function buildRunDir(sessionDir: string, sessionId: string, iter: number, directoryName: string): RunDir {
  const safeSessionId = assertSafeSessionId(sessionId);
  const safeIteration = assertPositiveIteration(iter);
  const iterDir = `${sessionDir}/${directoryName}`;
  const codeDir = `${iterDir}/code`;
  return {
    sessionId: safeSessionId,
    iter: safeIteration,
    iterDir,
    codeDir,
    logsDir: `${iterDir}/logs`,
    transcriptPath: `${iterDir}/transcript.md`,
    systemPromptPath: `${iterDir}/system_prompt.txt`,
    hypothesisPath: `${iterDir}/hypothesis.md`,
    diffPath: `${iterDir}/diff.patch`,
    metricsPath: `${iterDir}/metrics.json`,
    statusPath: `${iterDir}/status.json`,
    reflectionInputPath: `${iterDir}/reflection.input.json`,
    reflectionRawPath: `${iterDir}/reflection.raw.txt`,
    reflectionParsedPath: `${iterDir}/reflection.parsed.json`,
  };
}

function buildWriteCommand(path: string, content: string, append = false): string {
  let delimiter = '__PIPI_SHRIMP_EOF__';
  while (content.includes(delimiter)) {
    delimiter += '_X';
  }

  return [
    `mkdir -p ${shellEscapePath(getParentDirectory(path))}`,
    `cat <<'${delimiter}' ${append ? '>>' : '>'} ${shellEscapePath(path)}`,
    content,
    delimiter,
  ].join('\n');
}

function buildSnapshotCopyCommand(sourceDir: string, targetDir: string): string {
  const excludes = SNAPSHOT_EXCLUDES.map((entry) => `--exclude=${entry}`).join(' ');
  return [
    `mkdir -p ${shellEscapePath(targetDir)}`,
    `tar -C ${shellEscapePath(sourceDir)} ${excludes} -cf - . | tar -xf - -C ${shellEscapePath(targetDir)}`,
  ].join('\n');
}

function buildWorktreeCleanupCommand(worktreeDir: string): string {
  return [
    `if [ -d ${shellEscapePath(worktreeDir)} ] && git -C ${shellEscapePath(worktreeDir)} rev-parse --is-inside-work-tree >/dev/null 2>&1; then`,
    `  __git_common_dir="$(git -C ${shellEscapePath(worktreeDir)} rev-parse --git-common-dir 2>/dev/null || true)"`,
    `  git -C ${shellEscapePath(worktreeDir)} worktree remove --force ${shellEscapePath(worktreeDir)} >/dev/null 2>&1 || true`,
    '  if [ -n "$__git_common_dir" ]; then',
    '    git --git-dir="$__git_common_dir" worktree prune >/dev/null 2>&1 || true',
    '  fi',
    'fi',
  ].join('\n');
}

function isSessionChildRunDir(sessionDir: string, iterDir: string): boolean {
  const normalizedSessionDir = trimTrailingSlash(sessionDir);
  const normalizedIterDir = trimTrailingSlash(iterDir);
  if (!normalizedIterDir.startsWith(`${normalizedSessionDir}/`)) {
    return false;
  }

  const relative = normalizedIterDir.slice(normalizedSessionDir.length + 1);
  return /^iter-\d+-/.test(relative);
}

export function getSessionRunPaths(cfg: SshConfig, sessionId: string): SessionRunPaths {
  const safeSessionId = assertSafeSessionId(sessionId);
  const sessionDir = `${trimTrailingSlash(cfg.remoteWorkDir)}/runs/${safeSessionId}`;
  return {
    sessionDir,
    sessionFilePath: `${sessionDir}/session.md`,
    livingDocPath: `${sessionDir}/autoresearch.md`,
    metricsJsonlPath: `${sessionDir}/metrics.jsonl`,
    runConfigPath: `${sessionDir}/run_config.json`,
  };
}

export function getSessionBaselineDir(cfg: SshConfig, sessionId: string): string {
  return `${getSessionRunPaths(cfg, sessionId).sessionDir}/best-baseline`;
}

export async function executeTargetCommand(
  cfg: SshConfig,
  command: string,
  timeoutSecs = 120,
): Promise<RawBashResult> {
  const windowsShellProfile = useSettingsStore.getState().windowsShellProfile;
  const isLocalTarget = cfg.mode === 'local';
  return invoke<RawBashResult>('execute_bash', {
    args: {
      command: isLocalTarget ? command : buildRemoteBashCommand(cfg, command),
      workDir: isLocalTarget ? (cfg.remoteWorkDir || DEFAULT_LOCAL_COMMAND_CWD) : undefined,
      timeoutSecs,
      windowsShellProfile,
    },
  });
}

export async function pathExistsOnTarget(cfg: SshConfig, path: string): Promise<boolean> {
  const result = await executeTargetCommand(
    { ...cfg, remoteWorkDir: '' },
    `[ -e ${shellEscapePath(path)} ] && printf '1' || printf '0'`,
    30,
  );
  return (result.stdout || '').trim() === '1';
}

export async function readTargetText(cfg: SshConfig, path: string): Promise<string | null> {
  const result = await executeTargetCommand(
    { ...cfg, remoteWorkDir: '' },
    `if [ -f ${shellEscapePath(path)} ]; then cat ${shellEscapePath(path)}; else exit 3; fi`,
    60,
  );
  const exitCode = result.exit_code ?? 0;
  if (exitCode === 3) {
    return null;
  }
  if (exitCode !== 0) {
    throw new Error(result.stderr || `Failed to read ${path}`);
  }
  return result.stdout || '';
}

export async function writeTargetText(cfg: SshConfig, path: string, content: string): Promise<void> {
  const result = await executeTargetCommand({ ...cfg, remoteWorkDir: '' }, buildWriteCommand(path, content), 60);
  if ((result.exit_code ?? 0) !== 0) {
    throw new Error(result.stderr || `Failed to write ${path}`);
  }
}

export async function appendTargetText(cfg: SshConfig, path: string, content: string): Promise<void> {
  const result = await executeTargetCommand({ ...cfg, remoteWorkDir: '' }, buildWriteCommand(path, content, true), 60);
  if ((result.exit_code ?? 0) !== 0) {
    throw new Error(result.stderr || `Failed to append ${path}`);
  }
}

export async function ensureSessionDir(cfg: SshConfig, sessionId: string): Promise<string> {
  const { sessionDir } = getSessionRunPaths(cfg, sessionId);
  const result = await executeTargetCommand(
    cfg,
    `mkdir -p ${shellEscapePath(sessionDir)}`,
    60,
  );
  if ((result.exit_code ?? 0) !== 0) {
    throw new Error(result.stderr || `Failed to create session dir ${sessionDir}`);
  }
  return sessionDir;
}

export async function createRunDir(
  cfg: SshConfig,
  sessionId: string,
  iter: number,
  options: { snapshotSourceDir?: string } = {},
): Promise<RunDir> {
  const safeIteration = assertPositiveIteration(iter);
  const sessionDir = await ensureSessionDir(cfg, sessionId);
  const directoryName = `iter-${padIteration(safeIteration)}-${formatTimestamp()}`;
  const runDir = buildRunDir(sessionDir, sessionId, safeIteration, directoryName);
  const snapshotSourceDir = options.snapshotSourceDir || cfg.remoteWorkDir;

  const script = [
    `mkdir -p ${shellEscapePath(runDir.iterDir)} ${shellEscapePath(runDir.logsDir)}`,
    `if [ -d ${shellEscapePath(snapshotSourceDir)} ] && git -C ${shellEscapePath(snapshotSourceDir)} rev-parse --is-inside-work-tree >/dev/null 2>&1; then`,
    `  if ! git -C ${shellEscapePath(snapshotSourceDir)} worktree add --detach ${shellEscapePath(runDir.codeDir)} HEAD >/dev/null 2>&1; then`,
    `    ${buildSnapshotCopyCommand(snapshotSourceDir, runDir.codeDir).replace(/\n/g, '\n    ')}`,
    `  fi`,
    `else`,
    `  ${buildSnapshotCopyCommand(snapshotSourceDir, runDir.codeDir).replace(/\n/g, '\n  ')}`,
    `fi`,
    `: > ${shellEscapePath(runDir.systemPromptPath)}`,
    `: > ${shellEscapePath(runDir.hypothesisPath)}`,
    `: > ${shellEscapePath(runDir.diffPath)}`,
    `: > ${shellEscapePath(runDir.reflectionRawPath)}`,
  ].join('\n');

  const result = await executeTargetCommand({ ...cfg, remoteWorkDir: '' }, script, 300);
  if ((result.exit_code ?? 0) !== 0) {
    throw new Error(result.stderr || `Failed to create iteration dir ${runDir.iterDir}`);
  }
  return runDir;
}

export async function promoteRunDirToBestBaseline(
  cfg: SshConfig,
  sessionId: string,
  sourceDir: string,
): Promise<string> {
  await ensureSessionDir(cfg, sessionId);
  const baselineDir = getSessionBaselineDir(cfg, sessionId);
  const script = [
    `if [ -e ${shellEscapePath(baselineDir)} ]; then`,
    `  rm -rf ${shellEscapePath(baselineDir)}`,
    'fi',
    buildSnapshotCopyCommand(sourceDir, baselineDir),
    `git -C ${shellEscapePath(baselineDir)} init >/dev/null 2>&1`,
    `git -C ${shellEscapePath(baselineDir)} config user.email ${shellEscape('autoresearch@local.invalid')}`,
    `git -C ${shellEscapePath(baselineDir)} config user.name ${shellEscape('AutoResearch Baseline')}`,
    `git -C ${shellEscapePath(baselineDir)} add -A`,
    `git -C ${shellEscapePath(baselineDir)} commit --allow-empty -m ${shellEscape(`AutoResearch baseline ${assertSafeSessionId(sessionId)}`)} >/dev/null 2>&1`,
    `git -C ${shellEscapePath(baselineDir)} worktree prune >/dev/null 2>&1 || true`,
  ].join('\n');

  const result = await executeTargetCommand({ ...cfg, remoteWorkDir: '' }, script, 300);
  if ((result.exit_code ?? 0) !== 0) {
    throw new Error(result.stderr || `Failed to promote ${sourceDir} as the best baseline`);
  }

  return baselineDir;
}

export async function listIterations(cfg: SshConfig, sessionId: string): Promise<RunDir[]> {
  const sessionDir = await ensureSessionDir(cfg, sessionId);
  const result = await executeTargetCommand(
    cfg,
    `find ${shellEscapePath(sessionDir)} -maxdepth 1 -mindepth 1 -type d -name 'iter-*' | sort`,
    60,
  );
  if ((result.exit_code ?? 0) !== 0) {
    throw new Error(result.stderr || `Failed to list iterations for ${sessionId}`);
  }

  return (result.stdout || '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map((iterDir) => {
      const name = iterDir.slice(sessionDir.length + 1);
      const match = name.match(/^iter-(\d+)-/);
      const iter = match ? Number.parseInt(match[1], 10) : 0;
      return buildRunDir(sessionDir, sessionId, iter, name);
    })
    .sort((a, b) => a.iter - b.iter);
}

export async function pruneOldRuns(cfg: SshConfig, sessionId: string, keepLast: number): Promise<void> {
  const runs = await listIterations(cfg, sessionId);
  const { sessionDir } = getSessionRunPaths(cfg, sessionId);
  const stale = runs.slice(0, Math.max(0, runs.length - keepLast));
  for (const run of stale) {
    if (!isSessionChildRunDir(sessionDir, run.iterDir)) {
      throw new Error(`Refusing to prune non-session run directory: ${run.iterDir}`);
    }

    const result = await executeTargetCommand(
      cfg,
      [
        buildWorktreeCleanupCommand(run.codeDir),
        `rm -rf ${shellEscapePath(run.iterDir)}`,
      ].join('\n'),
      120,
    );
    if ((result.exit_code ?? 0) !== 0) {
      throw new Error(result.stderr || `Failed to prune ${run.iterDir}`);
    }
  }
}

export async function captureCommitHash(cfg: SshConfig): Promise<string | undefined> {
  const result = await executeTargetCommand(cfg, 'git rev-parse --short HEAD', 30);
  if ((result.exit_code ?? 0) !== 0) {
    return undefined;
  }
  const hash = (result.stdout || '').trim();
  return hash || undefined;
}

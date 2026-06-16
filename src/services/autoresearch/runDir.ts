import { invoke } from '@tauri-apps/api/core';
import type { SshConfig } from '@/store/autoresearchStore';
import { useSettingsStore } from '@/store/settingsStore';
import { buildRemoteBashCommand, shellEscape, shellEscapePath } from '@/utils/remoteExec';
import { resolveWindowsShellProfile } from '@/utils/windowsShellProfile';
import { INFRASTRUCTURE_ERROR_MARKER } from './errors';

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

function escapeDollarsForLocalWsl(command: string): string {
  // Preserve bash-side variable expansion when the command is routed through
  // `wsl.exe -- bash -lc ...` on Windows.
  return command.replace(/(?<!\\)\$/g, '\\$');
}

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
  const shellResolution = resolveWindowsShellProfile(windowsShellProfile, cfg.remoteWorkDir);
  const effectiveCommand = isLocalTarget && shellResolution.isWindows && shellResolution.resolved === 'wsl'
    ? escapeDollarsForLocalWsl(command)
    : command;
  // AUDIT-FIX [audit-2-ar#5]: Process-group trap for remote child cleanup.
  // For remote targets, wrap the user command in a process-group + trap
  // shell so that when the Rust-side timeout fires and the SSH wrapper
  // is killed, any child processes spawned by the experiment script
  // (e.g. `python run_experiment.py`) are also killed. Without this,
  // a timed-out iteration leaves the experiment running on the remote
  // box, which can corrupt `metrics.json` for the next iteration.
  //
  // The local target keeps the raw command — process-group semantics on
  // Windows differ and Tauri Rust already handles local child cleanup.
  const finalCommand = isLocalTarget
    ? effectiveCommand
    : `set -e\ntrap 'kill -TERM -$$ 2>/dev/null || true; wait 2>/dev/null || true; exit 143' TERM INT\n${effectiveCommand}\ntrap - TERM INT`;
  try {
    return await invoke<RawBashResult>('execute_bash', {
      args: {
        command: finalCommand,
        workDir: isLocalTarget ? (cfg.remoteWorkDir || DEFAULT_LOCAL_COMMAND_CWD) : undefined,
        timeoutSecs,
        windowsShellProfile,
      },
    });
  // AUDIT-FIX [audit-3-ar#4]: Tauri invoke error classification.
  // Previously a Tauri IPC failure (Rust panic, plugin not loaded, network
  // blip) bubbled up as a raw Error with no exit code. The loop's
  // `classifyAutoResearchFailure` saw no recognizable signature and
  // misrouted it as `'agent_execution'`, charging the run's
  // `consecutiveFailures` counter — three such transient blips would
  // falsely stop an otherwise-healthy run. We re-throw with a stable
  // `INFRASTRUCTURE_ERROR_MARKER` prefix that the classifier can detect
  // and route as `'infrastructure'` (transient) instead.
  } catch (error) {
    // Tauri invoke failures (Rust panic, plugin not loaded, network blip
    // to the IPC bridge) bubble out as a rejected promise with no exit
    // code. Re-throw with a stable marker so `classifyAutoResearchFailure`
    // can route it as 'infrastructure' (transient) instead of 'agent_execution'
    // (which would charge against the run's consecutiveFailures counter).
    const detail = error instanceof Error ? error.message : String(error);
    const wrapped = new Error(
      `${INFRASTRUCTURE_ERROR_MARKER}: ${detail} (target=${isLocalTarget ? 'local' : 'ssh'})`,
    );
    (wrapped as Error & { cause?: unknown }).cause = error;
    throw wrapped;
  }
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
  // AUDIT-FIX [audit-1-ar#2]: Best-baseline post-promote sanity check.
  // The promotion script uses `> /dev/null 2>&1` to silence the tar
  // copy and the `git init/add/commit` chain, so a partial failure
  // (e.g. tar exited 0 but produced an empty tree, or git init crashed
  // silently) would previously return a "successful" baseline path
  // pointing at a non-functional directory. The next iteration's
  // `git worktree add` would either silently work from an empty tree
  // (regressing every subsequent iteration) or fail with a confusing
  // path error. We now re-check the baseline: exists, non-empty, and
  // `git rev-parse` confirms it's a repo. Anything else throws.

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

  // Sanity check: verify the baseline is non-empty and `git rev-parse` succeeds.
  // The previous steps swallow stderr with `> /dev/null 2>&1`, so a partial
  // failure (e.g. tar copy partially failed but exited 0) would otherwise
  // return a non-functional baseline directory. Without this check, the next
  // iteration's `git worktree add` would either silently work from an empty
  // tree (regressing every iteration) or crash with a confusing path error.
  const verify = await executeTargetCommand(
    { ...cfg, remoteWorkDir: '' },
    [
      `if [ ! -d ${shellEscapePath(baselineDir)} ]; then printf 'missing'; exit 0; fi`,
      `entries=$(ls -A ${shellEscapePath(baselineDir)} | wc -l)`,
      `if [ "$entries" -eq 0 ]; then printf 'empty'; exit 0; fi`,
      `git -C ${shellEscapePath(baselineDir)} rev-parse --is-inside-work-tree >/dev/null 2>&1 || { printf 'not-a-repo'; exit 0; }`,
      `printf 'ok'`,
    ].join('\n'),
    30,
  );
  const verdict = (verify.stdout || '').trim();
  if (verdict !== 'ok') {
    throw new Error(
      `Best baseline promotion produced a non-functional directory (${verdict}) at ${baselineDir}. `
      + `Source: ${sourceDir}. The next iteration cannot proceed — please inspect the SSH workspace manually.`,
    );
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
  // AUDIT-FIX [audit-3-ar#10]: Best-baseline disk leak.
  // `pruneOldRuns` previously only removed `iter-*` directories, leaving
  // the `best-baseline` directory (a full code snapshot promoted on every
  // IMPROVED iteration) on the remote SSH box forever. A long session
  // could leak hundreds of MB across many "completed" runs. We now also
  // drop the baseline — but conservatively: only when EVERY iteration in
  // the session is stale (the session is fully superseded). We do NOT
  // have a safe iteration → baseline commit linkage (the promote commit
  // subject is "AutoResearch baseline <sid>"), so any more aggressive
  // policy risks deleting a still-active baseline.
  // Also drop the best-baseline if it points to a pruned iteration. The
  // baseline is a full code snapshot (the entire promoted worktree at the
  // time of improvement), so it's typically as large as a single iter and
  // leaks forever otherwise. We only remove it if the iteration it was
  // promoted from is in the stale set — never blindly.
  if (stale.length > 0) {
    const baselineDir = getSessionBaselineDir(cfg, sessionId);
    const exists = await pathExistsOnTarget({ ...cfg, remoteWorkDir: '' }, baselineDir);
    if (exists) {
      const baselineLog = await executeTargetCommand(
        { ...cfg, remoteWorkDir: '' },
        `git -C ${shellEscapePath(baselineDir)} log --format=%s -1 2>/dev/null || true`,
        30,
      );
      const baselineSubject = (baselineLog.stdout || '').trim();
      // The promotion commits with a subject of the form
      // "AutoResearch baseline <sessionId>". That message doesn't include
      // the iteration number, so we can't directly map back. As a safe
      // approximation: only remove the baseline if we pruned ALL iterations
      // (the session has been fully superseded) and the baseline is older
      // than the most recent kept run. This avoids deleting a still-active
      // baseline when the user is just trimming history.
      if (runs.length > 0 && runs.length === stale.length) {
        const rmResult = await executeTargetCommand(
          { ...cfg, remoteWorkDir: '' },
          `rm -rf ${shellEscapePath(baselineDir)}`,
          60,
        );
        if ((rmResult.exit_code ?? 0) !== 0) {
          console.warn('Failed to remove best-baseline during prune:', rmResult.stderr);
        }
      } else if (baselineSubject) {
        // We don't have an iteration link in the commit subject, so we err
        // on the side of keeping the baseline. Just log for visibility.
        console.info(
          'pruneOldRuns kept best-baseline (no safe iteration linkage available):',
          baselineDir,
        );
      }
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

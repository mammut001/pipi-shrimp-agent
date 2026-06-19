/**
 * AutoResearch Rollback — Git-based revert/commit logic on the target.
 *
 * Works transparently for both local and SSH modes via the shared
 * remoteExec helpers.
 */

import type { SshConfig } from '@/store/autoresearchStore';
import { shellEscape } from '@/utils/remoteExec';
import { runSshExec } from '@/tools/impl/SshTool';

interface RawBashResult {
  stdout?: string;
  stderr?: string;
  exit_code?: number;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '');
}

function isAutoResearchWorkspacePath(path: string): boolean {
  const normalized = normalizePath(path);
  return /\/runs\/.+\/iter-\d{3}-[^/]+\/code$/.test(normalized);
}

async function runRemote(
  cfg: SshConfig,
  cmd: string,
  timeout = 30,
  terminal = false,
): Promise<RawBashResult> {
  const result = await runSshExec({
    command: cmd,
    timeout,
    terminal,
    ...cfg,
  });
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exit_code: result.exitCode,
  };
}

/**
 * Check that the remote working directory is clean (no uncommitted changes).
 * Returns true if clean, false otherwise.
 */
export async function isRemoteClean(cfg: SshConfig): Promise<boolean> {
  const result = await runRemote(cfg, 'git status --porcelain');
  const output = (result.stdout || '').trim();
  return output.length === 0;
}

/**
 * Get the current git diff on the remote (useful to verify a patch was applied).
 */
export async function getRemoteDiff(cfg: SshConfig): Promise<string> {
  const result = await runRemote(cfg, 'git diff');
  return result.stdout || '';
}

/**
 * Rollback all uncommitted changes on the remote.
 * Returns true if rollback succeeded and the repo is now clean.
 */
export async function rollback(
  cfg: SshConfig,
  options: { terminal?: boolean } = {},
): Promise<{ success: boolean; message: string }> {
  if (!isAutoResearchWorkspacePath(cfg.remoteWorkDir)) {
    return {
      success: false,
      message: `Refusing to rollback outside the AutoResearch iteration workspace: ${cfg.remoteWorkDir}`,
    };
  }

  // Revert all changes
  await runRemote(cfg, 'git checkout -- .', 30, options.terminal ?? false);
  // Also clean untracked files created by the experiment
  await runRemote(cfg, 'git clean -fd', 30, options.terminal ?? false);

  // Verify clean
  const clean = await isRemoteClean(cfg);
  if (!clean) {
    return { success: false, message: 'Rollback failed — repo still has uncommitted changes after git checkout.' };
  }
  return { success: true, message: 'Rollback successful — repo is clean.' };
}

/**
 * Commit the current changes on the remote with a structured message.
 */
export async function commitExperiment(
  cfg: SshConfig,
  iteration: number,
  description: string,
  metricName: string,
  metricValue: number,
  options: { terminal?: boolean } = {},
): Promise<{ success: boolean; commitHash?: string; message: string }> {
  if (!isAutoResearchWorkspacePath(cfg.remoteWorkDir)) {
    return {
      success: false,
      message: `Refusing to commit outside the AutoResearch iteration workspace: ${cfg.remoteWorkDir}`,
    };
  }

  const msg = `exp-${iteration}: ${description} | ${metricName}=${metricValue}`;

  // Stage all
  await runRemote(cfg, 'git add -A', 30, options.terminal ?? false);

  // Commit — shell-escape the message to survive the local bash wrapper
  // and (if SSH) the second shell on the remote side.
  const escapedMsg = shellEscape(msg);
  const result = await runRemote(cfg, `git commit -m ${escapedMsg}`, 30, options.terminal ?? false);
  const exitCode = result.exit_code ?? 0;

  if (exitCode !== 0) {
    return {
      success: false,
      message: `git commit failed (exit ${exitCode}): ${result.stderr || result.stdout || ''}`,
    };
  }

  // Extract commit hash
  const hashResult = await runRemote(cfg, 'git rev-parse --short HEAD');
  const commitHash = (hashResult.stdout || '').trim();

  return { success: true, commitHash, message: `Committed as ${commitHash}` };
}

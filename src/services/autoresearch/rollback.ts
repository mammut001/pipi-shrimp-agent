/**
 * AutoResearch Rollback — Git-based revert/commit logic on remote VPS.
 *
 * All operations execute via ssh_exec on the remote machine.
 */

import { invoke } from '@tauri-apps/api/core';
import type { SshConfig } from '@/store/autoresearchStore';

interface RawBashResult {
  stdout?: string;
  stderr?: string;
  exit_code?: number;
}

/**
 * Build a full SSH command string.
 */
function sshCmd(cfg: SshConfig, remoteCmd: string): string {
  const port = cfg.port || 22;
  const esc = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'";
  const prefix = `ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 -p ${port} -i ${esc(cfg.keyPath)} ${esc(cfg.user)}@${esc(cfg.host)}`;
  const wrapped = `cd ${esc(cfg.remoteWorkDir)} && ${remoteCmd}`;
  return `${prefix} ${esc(wrapped)}`;
}

async function runRemote(cfg: SshConfig, cmd: string, timeout = 30): Promise<RawBashResult> {
  return invoke<RawBashResult>('execute_bash', {
    command: sshCmd(cfg, cmd),
    timeoutSecs: timeout,
  });
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
export async function rollback(cfg: SshConfig): Promise<{ success: boolean; message: string }> {
  // Revert all changes
  await runRemote(cfg, 'git checkout -- .');
  // Also clean untracked files created by the experiment
  await runRemote(cfg, 'git clean -fd');

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
): Promise<{ success: boolean; commitHash?: string; message: string }> {
  const msg = `exp-${iteration}: ${description} | ${metricName}=${metricValue}`;
  const escapedMsg = msg.replace(/'/g, "'\\''");

  // Stage all
  await runRemote(cfg, 'git add -A');

  // Commit
  const result = await runRemote(cfg, `git commit -m '${escapedMsg}'`);
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

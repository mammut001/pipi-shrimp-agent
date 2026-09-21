/**
 * AUDIT-FIX [R5-06]: SSH bootstrap scaffold upload with best-effort rollback.
 *
 * Uploads scaffold files + autoresearch.bootstrap.json to the remote workdir.
 * Tracks only paths newly written by this attempt (skips remote EXISTS).
 * On any failure before success, deletes those remote files (`rm -f` only —
 * never `rm -rf` the whole remoteWorkDir) so a partial handoff cannot corrupt
 * remote experiment state.
 */

import type { SshConfig } from '@/store/autoresearchStore';
import { runSshExec, runSshUpload } from '@/tools/impl/SshTool';
import { shellEscapePath } from '@/utils/remoteExec';
import { invoke } from '@tauri-apps/api/core';

export interface BootstrapScaffoldFile {
  path: string;
}

export interface UploadBootstrapScaffoldInput {
  sshConfig: SshConfig;
  localWorkDir: string;
  remoteWorkDir: string;
  files: BootstrapScaffoldFile[];
  /** Serialized bootstrap result written to `.pipi-shrimp/autoresearch.bootstrap.json`. */
  bootstrapResultJson: string;
  /** When true (default), run optional `git init` + initial commit if missing. */
  initGitIfMissing?: boolean;
}

export interface UploadBootstrapScaffoldDeps {
  runSshExec: typeof runSshExec;
  runSshUpload: typeof runSshUpload;
  readLocalFile: (localPath: string) => Promise<string | null>;
}

export interface UploadBootstrapScaffoldResult {
  uploadedPaths: string[];
}

function parentRemotePath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const idx = normalized.lastIndexOf('/');
  return idx > 0 ? normalized.slice(0, idx) : '.';
}

function joinRemote(base: string, rel: string): string {
  const root = base.replace(/[\\/]+$/, '');
  const path = rel.replace(/^[/\\]+/, '');
  return `${root}/${path}`;
}

async function defaultReadLocalFile(localPath: string): Promise<string | null> {
  try {
    const localFileResponse = await invoke<{ content: string }>('read_file', {
      path: localPath,
      workDir: null,
    });
    return localFileResponse.content;
  } catch {
    return null;
  }
}

/**
 * Best-effort remove of remote files created by this upload attempt.
 * Uses `rm -f` per path only — never recursive delete of the workdir.
 */
export async function rollbackUploadedBootstrapFiles(
  sshConfig: SshConfig,
  uploadedPaths: readonly string[],
  deps: Pick<UploadBootstrapScaffoldDeps, 'runSshExec'> = { runSshExec },
): Promise<void> {
  // Reverse order so nested files go before parents if we later extend cleanup.
  for (const remotePath of [...uploadedPaths].reverse()) {
    try {
      await deps.runSshExec({
        ...sshConfig,
        command: `rm -f ${shellEscapePath(remotePath)}`,
      });
    } catch {
      // Best-effort: keep trying remaining paths.
    }
  }
}

/**
 * Upload bootstrap scaffold files over SSH with transactional rollback on failure.
 */
export async function uploadBootstrapScaffoldWithRollback(
  input: UploadBootstrapScaffoldInput,
  deps: Partial<UploadBootstrapScaffoldDeps> = {},
): Promise<UploadBootstrapScaffoldResult> {
  const exec = deps.runSshExec ?? runSshExec;
  const upload = deps.runSshUpload ?? runSshUpload;
  const readLocalFile = deps.readLocalFile ?? defaultReadLocalFile;

  const { sshConfig, localWorkDir, remoteWorkDir, files } = input;
  const initGitIfMissing = input.initGitIfMissing !== false;
  const uploadedPaths: string[] = [];

  try {
    await exec({
      ...sshConfig,
      command: `mkdir -p ${shellEscapePath(remoteWorkDir)}`,
    });

    for (const file of files) {
      const localFilePath = joinRemote(localWorkDir, file.path);
      const remoteFilePath = joinRemote(remoteWorkDir, file.path);
      const remoteParent = parentRemotePath(remoteFilePath);
      if (remoteParent && remoteParent !== '.') {
        await exec({
          ...sshConfig,
          command: `mkdir -p ${shellEscapePath(remoteParent)}`,
        });
      }

      const content = await readLocalFile(localFilePath);
      if (content == null) {
        continue;
      }

      // Preserve existing experiment files on remote host (never clobber)
      const checkRemote = await exec({
        ...sshConfig,
        command: `if [ -f ${shellEscapePath(remoteFilePath)} ]; then echo "EXISTS"; fi`,
      });
      if (checkRemote.stdout?.trim() === 'EXISTS') {
        continue;
      }

      await upload({
        ...sshConfig,
        content,
        remotePath: remoteFilePath,
      });
      uploadedPaths.push(remoteFilePath);
    }

    const remoteBootstrapResultPath = joinRemote(
      remoteWorkDir,
      '.pipi-shrimp/autoresearch.bootstrap.json',
    );
    await exec({
      ...sshConfig,
      command: `mkdir -p ${shellEscapePath(parentRemotePath(remoteBootstrapResultPath))}`,
    });
    await upload({
      ...sshConfig,
      content: input.bootstrapResultJson,
      remotePath: remoteBootstrapResultPath,
    });
    uploadedPaths.push(remoteBootstrapResultPath);

    if (initGitIfMissing) {
      await exec({
        ...sshConfig,
        command: [
          `cd ${shellEscapePath(remoteWorkDir)}`,
          'if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then',
          '  git init',
          '  git config user.name "AutoResearch"',
          '  git config user.email "autoresearch@local"',
          '  git add -A',
          '  git commit --allow-empty -m "Initial bootstrap scaffold"',
          'fi',
        ].join('\n'),
      });
    }

    return { uploadedPaths };
  } catch (error) {
    await rollbackUploadedBootstrapFiles(sshConfig, uploadedPaths, { runSshExec: exec });
    throw error;
  }
}

import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { SshConfig } from '@/store/autoresearchStore';
import {
  rollbackUploadedBootstrapFiles,
  uploadBootstrapScaffoldWithRollback,
} from '../uploadBootstrapScaffold';

const baseSshConfig: SshConfig = {
  mode: 'ssh',
  host: 'example.com',
  user: 'ubuntu',
  keyPath: '',
  port: 22,
  remoteWorkDir: '~/autoresearch',
  authMode: 'agent',
  password: '',
};

describe('uploadBootstrapScaffoldWithRollback (R5-06)', () => {
  const runSshExec = jest.fn<typeof import('@/tools/impl/SshTool').runSshExec>();
  const runSshUpload = jest.fn<typeof import('@/tools/impl/SshTool').runSshUpload>();
  const readLocalFile = jest.fn<(localPath: string) => Promise<string | null>>();

  beforeEach(() => {
    runSshExec.mockReset();
    runSshUpload.mockReset();
    readLocalFile.mockReset();

    runSshExec.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
    runSshUpload.mockResolvedValue({ success: true, message: 'ok' });
    readLocalFile.mockImplementation(async (localPath: string) => {
      if (localPath.endsWith('a.py')) return 'print("a")';
      if (localPath.endsWith('b.py')) return 'print("b")';
      if (localPath.endsWith('c.py')) return 'print("c")';
      return null;
    });
  });

  it('uploads all scaffold files + bootstrap.json and returns uploaded paths', async () => {
    const result = await uploadBootstrapScaffoldWithRollback(
      {
        sshConfig: baseSshConfig,
        localWorkDir: '/tmp/local-exp',
        remoteWorkDir: '~/autoresearch/exp',
        files: [{ path: 'a.py' }, { path: 'subdir/b.py' }],
        bootstrapResultJson: '{"status":"ready"}',
        initGitIfMissing: true,
      },
      { runSshExec, runSshUpload, readLocalFile },
    );

    expect(runSshUpload.mock.calls.map((call) => call[0].remotePath)).toEqual([
      '~/autoresearch/exp/a.py',
      '~/autoresearch/exp/subdir/b.py',
      '~/autoresearch/exp/.pipi-shrimp/autoresearch.bootstrap.json',
    ]);
    expect(result.uploadedPaths).toEqual([
      '~/autoresearch/exp/a.py',
      '~/autoresearch/exp/subdir/b.py',
      '~/autoresearch/exp/.pipi-shrimp/autoresearch.bootstrap.json',
    ]);
    // git init attempted
    expect(
      runSshExec.mock.calls.some((call) => String(call[0].command).includes('git init')),
    ).toBe(true);
  });

  it('skips remote EXISTS files and does not track them for rollback', async () => {
    runSshExec.mockImplementation(async (input) => {
      const command = String(input.command);
      if (command.includes('EXISTS') && command.includes('a.py')) {
        return { stdout: 'EXISTS\n', stderr: '', exitCode: 0 };
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    });

    const result = await uploadBootstrapScaffoldWithRollback(
      {
        sshConfig: baseSshConfig,
        localWorkDir: '/tmp/local-exp',
        remoteWorkDir: '~/autoresearch/exp',
        files: [{ path: 'a.py' }, { path: 'b.py' }],
        bootstrapResultJson: '{}',
        initGitIfMissing: false,
      },
      { runSshExec, runSshUpload, readLocalFile },
    );

    const uploaded = runSshUpload.mock.calls.map((call) => call[0].remotePath);
    expect(uploaded).toEqual([
      '~/autoresearch/exp/b.py',
      '~/autoresearch/exp/.pipi-shrimp/autoresearch.bootstrap.json',
    ]);
    expect(result.uploadedPaths).toEqual(uploaded);
  });

  it('rolls back earlier uploads when the Nth file upload fails', async () => {
    runSshUpload.mockImplementation(async (input) => {
      if (String(input.remotePath).endsWith('b.py')) {
        throw new Error('scp failed on 2nd file');
      }
      return { success: true, message: 'ok' };
    });

    await expect(
      uploadBootstrapScaffoldWithRollback(
        {
          sshConfig: baseSshConfig,
          localWorkDir: '/tmp/local-exp',
          remoteWorkDir: '~/autoresearch/exp',
          files: [{ path: 'a.py' }, { path: 'b.py' }, { path: 'c.py' }],
          bootstrapResultJson: '{}',
          initGitIfMissing: false,
        },
        { runSshExec, runSshUpload, readLocalFile },
      ),
    ).rejects.toThrow('scp failed on 2nd file');

    // Only a.py was successfully uploaded before failure — must be removed.
    const rmCommands = runSshExec.mock.calls
      .map((call) => String(call[0].command))
      .filter((cmd) => cmd.startsWith('rm -f '));
    expect(rmCommands).toEqual([`rm -f ~/'autoresearch/exp/a.py'`]);

    // Never uploaded c.py or bootstrap.json
    const uploaded = runSshUpload.mock.calls.map((call) => call[0].remotePath);
    expect(uploaded).toEqual([
      '~/autoresearch/exp/a.py',
      '~/autoresearch/exp/b.py',
    ]);
  });

  it('rolls back scaffold files and bootstrap.json when git init fails', async () => {
    runSshExec.mockImplementation(async (input) => {
      const command = String(input.command);
      if (command.includes('git init')) {
        throw new Error('git init failed');
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    });

    await expect(
      uploadBootstrapScaffoldWithRollback(
        {
          sshConfig: baseSshConfig,
          localWorkDir: '/tmp/local-exp',
          remoteWorkDir: '~/autoresearch/exp',
          files: [{ path: 'a.py' }],
          bootstrapResultJson: '{"ok":true}',
          initGitIfMissing: true,
        },
        { runSshExec, runSshUpload, readLocalFile },
      ),
    ).rejects.toThrow('git init failed');

    const rmCommands = runSshExec.mock.calls
      .map((call) => String(call[0].command))
      .filter((cmd) => cmd.startsWith('rm -f '));
    expect(rmCommands).toEqual([
      `rm -f ~/'autoresearch/exp/.pipi-shrimp/autoresearch.bootstrap.json'`,
      `rm -f ~/'autoresearch/exp/a.py'`,
    ]);
  });

  it('rollbackUploadedBootstrapFiles uses rm -f per path and never rm -rf workdir', async () => {
    await rollbackUploadedBootstrapFiles(
      baseSshConfig,
      ['~/autoresearch/exp/a.py', '~/autoresearch/exp/b.py'],
      { runSshExec },
    );

    const commands = runSshExec.mock.calls.map((call) => String(call[0].command));
    expect(commands).toEqual([
      `rm -f ~/'autoresearch/exp/b.py'`,
      `rm -f ~/'autoresearch/exp/a.py'`,
    ]);
    expect(commands.some((cmd) => cmd.includes('rm -rf'))).toBe(false);
  });
});

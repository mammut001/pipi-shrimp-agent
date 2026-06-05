import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { useSettingsStore } from '@/store/settingsStore';

const mockInvoke = jest.fn();
const mockRunInTerminal = jest.fn();
const mockGetCurrentRunDir = jest.fn();
const mockReadTargetText = jest.fn();

jest.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

jest.mock('@/services/autoresearch/terminalRunner', () => ({
  runInTerminal: (...args: unknown[]) => mockRunInTerminal(...args),
  getCurrentRunDir: () => mockGetCurrentRunDir(),
}));

jest.mock('@/services/autoresearch/runDir', () => ({
  readTargetText: (...args: unknown[]) => mockReadTargetText(...args),
}));

import { runSshExec, runSshUpload } from '../SshTool';

describe('SshTool helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useSettingsStore.setState({ windowsShellProfile: 'auto' });
    mockGetCurrentRunDir.mockReturnValue({ logsDir: '/tmp/autoresearch-logs' });
    mockReadTargetText.mockResolvedValue('');
  });

  it('uses the silent bash path by default even during an active AutoResearch run', async () => {
    useSettingsStore.setState({ windowsShellProfile: 'powershell' });
    mockInvoke.mockResolvedValue({
      stdout: 'ok\n',
      stderr: '',
      exit_code: 0,
    });

    await expect(runSshExec({
      mode: 'local',
      command: 'echo ok',
      remoteWorkDir: '/tmp/work',
    })).resolves.toEqual({
      stdout: 'ok\n',
      stderr: '',
      exitCode: 0,
    });

    expect(mockRunInTerminal).not.toHaveBeenCalled();
    expect(mockInvoke).toHaveBeenCalledWith('execute_bash', expect.objectContaining({
      args: expect.objectContaining({
        command: 'echo ok',
        workDir: '/tmp/work',
        windowsShellProfile: 'powershell',
      }),
    }));
  });

  it('maps PTY allocation timeout to an explicit ssh_exec error when terminal=true', async () => {
    mockRunInTerminal.mockRejectedValue(new Error('Timed out opening AutoResearch terminal session'));

    await expect(runSshExec({
      mode: 'local',
      command: 'python3 run_experiment.py',
      remoteWorkDir: '/tmp/work',
      terminal: true,
    })).rejects.toThrow('Failed to allocate PTY for ssh_exec terminal=true');
  });

  it('uploads inline content through a temporary local file and cleans it up', async () => {
    mockInvoke.mockImplementation(async (command: string, args: Record<string, unknown>) => {
      if (command === 'write_file') {
        return 'File written successfully';
      }
      if (command === 'execute_bash') {
        return { stdout: '', stderr: '', exit_code: 0, args };
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    const result = await runSshUpload({
      mode: 'local',
      remotePath: '/tmp/work/hypothesis.md',
      content: '# hypothesis\n',
    });

    const tempPath = String(mockInvoke.mock.calls[0]?.[1]?.path ?? '');
    expect(tempPath).toContain('/tmp/pipi-shrimp-ssh-upload-');
    expect(mockInvoke).toHaveBeenNthCalledWith(1, 'write_file', expect.objectContaining({
      path: tempPath,
      content: '# hypothesis\n',
      workDir: null,
    }));
    expect(String(mockInvoke.mock.calls[1]?.[1]?.args?.command ?? '')).toContain(tempPath);
    expect(String(mockInvoke.mock.calls[2]?.[1]?.args?.command ?? '')).toContain(`rm -f '${tempPath}'`);
    expect(result).toEqual({
      success: true,
      message: 'Uploaded inline content → /tmp/work/hypothesis.md',
    });
  });
});
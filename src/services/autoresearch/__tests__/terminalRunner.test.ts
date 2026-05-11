import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockInvoke = jest.fn();
const mockListen = jest.fn();

jest.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

jest.mock('@tauri-apps/api/event', () => ({
  listen: (...args: unknown[]) => mockListen(...args),
}));

jest.mock('../runDir', () => ({
  readTargetText: jest.fn(),
}));

import { useAutoResearchStore } from '@/store/autoresearchStore';
import { createLocalSshConfig } from './helpers';
import { ensureAutoResearchTerminal, runInTerminal } from '../terminalRunner';

describe('terminalRunner reflection failure handling', () => {
  const workDir = '/tmp/autoresearch-terminal-test';

  beforeEach(() => {
    jest.useFakeTimers();
    mockInvoke.mockReset();
    mockListen.mockReset();
    mockInvoke.mockResolvedValue(undefined);
    mockListen.mockResolvedValue(() => undefined);
    useAutoResearchStore.getState().resetSession();
    useAutoResearchStore.getState().initSession({
      id: 'autoresearch-terminal-runner',
      maxIterations: 1,
      metricName: 'cv_accuracy',
      metricDirection: 'higher',
      sshConfig: createLocalSshConfig(workDir),
      sessionFilePath: `${workDir}/session.md`,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    useAutoResearchStore.getState().resetSession();
  });

  it('stops waiting for terminal readiness when the run becomes reflection_failed', async () => {
    const promise = ensureAutoResearchTerminal(createLocalSshConfig(workDir), workDir);

    useAutoResearchStore.getState().setReflectionFailed('Reflection did not provide a summary.');
    await jest.advanceTimersByTimeAsync(250);

    await expect(promise).rejects.toThrow('Reflection did not provide a summary.');
  });

  it('does not emit a fake timeout while the terminal watcher sees reflection_failed', async () => {
    useAutoResearchStore.getState().openTerminalPanel('existing-terminal', workDir);
    useAutoResearchStore.getState().setTerminalReady(true);

    const promise = runInTerminal({
      cfg: createLocalSshConfig(workDir),
      cmd: 'python run_experiment.py',
      cwd: workDir,
      logsDir: `${workDir}/logs`,
    });

    await Promise.resolve();
    useAutoResearchStore.getState().setReflectionFailed('Reflection did not provide a summary.');
    await jest.advanceTimersByTimeAsync(250);

    await expect(promise).rejects.toThrow('Reflection did not provide a summary.');
    expect(mockInvoke).toHaveBeenCalledWith('terminal_input', expect.objectContaining({
      sessionId: 'existing-terminal',
    }));
  });
});
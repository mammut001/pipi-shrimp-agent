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
import { readTargetText } from '../runDir';
import { clearCurrentRunDir, ensureAutoResearchTerminal, getCurrentRunDir, runInTerminal, setCurrentRunDir } from '../terminalRunner';

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
    clearCurrentRunDir();
    useAutoResearchStore.getState().resetSession();
  });

  it('hides stale currentRunDir values once a different run becomes active', () => {
    setCurrentRunDir({
      sessionId: 'autoresearch-terminal-runner',
      iter: 1,
      iterDir: `${workDir}/runs/autoresearch-terminal-runner/iter-001-2026-05-12T00-00-00Z`,
      codeDir: `${workDir}/runs/autoresearch-terminal-runner/iter-001-2026-05-12T00-00-00Z/code`,
      logsDir: `${workDir}/runs/autoresearch-terminal-runner/iter-001-2026-05-12T00-00-00Z/logs`,
      transcriptPath: `${workDir}/runs/autoresearch-terminal-runner/iter-001-2026-05-12T00-00-00Z/transcript.md`,
      systemPromptPath: `${workDir}/runs/autoresearch-terminal-runner/iter-001-2026-05-12T00-00-00Z/system_prompt.txt`,
      hypothesisPath: `${workDir}/runs/autoresearch-terminal-runner/iter-001-2026-05-12T00-00-00Z/hypothesis.md`,
      diffPath: `${workDir}/runs/autoresearch-terminal-runner/iter-001-2026-05-12T00-00-00Z/diff.patch`,
      metricsPath: `${workDir}/runs/autoresearch-terminal-runner/iter-001-2026-05-12T00-00-00Z/metrics.json`,
      statusPath: `${workDir}/runs/autoresearch-terminal-runner/iter-001-2026-05-12T00-00-00Z/status.json`,
      reflectionInputPath: `${workDir}/runs/autoresearch-terminal-runner/iter-001-2026-05-12T00-00-00Z/reflection.input.json`,
      reflectionRawPath: `${workDir}/runs/autoresearch-terminal-runner/iter-001-2026-05-12T00-00-00Z/reflection.raw.txt`,
      reflectionParsedPath: `${workDir}/runs/autoresearch-terminal-runner/iter-001-2026-05-12T00-00-00Z/reflection.parsed.json`,
    });

    expect(getCurrentRunDir()?.sessionId).toBe('autoresearch-terminal-runner');

    useAutoResearchStore.getState().initSession({
      id: 'autoresearch-terminal-next-run',
      maxIterations: 1,
      metricName: 'cv_accuracy',
      metricDirection: 'higher',
      sshConfig: createLocalSshConfig(workDir),
      sessionFilePath: `${workDir}/session-next.md`,
    });

    expect(getCurrentRunDir()).toBeNull();
  });

  it('stops waiting for terminal readiness when the run becomes reflection_failed', async () => {
    const promise = ensureAutoResearchTerminal(createLocalSshConfig(workDir), workDir);
    const expectation = expect(promise).rejects.toThrow('Reflection did not provide a summary.');

    useAutoResearchStore.getState().setReflectionFailed('Reflection did not provide a summary.');
    await jest.advanceTimersByTimeAsync(250);

    await expectation;
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
    const expectation = expect(promise).rejects.toThrow('Reflection did not provide a summary.');

    await Promise.resolve();
    useAutoResearchStore.getState().setReflectionFailed('Reflection did not provide a summary.');
    await jest.advanceTimersByTimeAsync(250);

    await expectation;
    expect(mockInvoke).toHaveBeenCalledWith('terminal_input', expect.objectContaining({
      sessionId: 'existing-terminal',
    }));
  });

  it('allows long quiet commands to complete when the exit marker arrives after 60 seconds', async () => {
    let terminalOutputListener: ((event: { payload: { session_id: string; data: string } }) => Promise<void>) | undefined;
    mockListen.mockImplementation(async (_eventName: string, handler: (event: { payload: { session_id: string; data: string } }) => Promise<void>) => {
      terminalOutputListener = handler;
      return () => undefined;
    });
    (readTargetText as jest.Mock).mockResolvedValue('');

    useAutoResearchStore.getState().openTerminalPanel('existing-terminal', workDir);
    useAutoResearchStore.getState().setTerminalReady(true);

    const promise = runInTerminal({
      cfg: createLocalSshConfig(workDir),
      cmd: 'python run_experiment.py',
      cwd: workDir,
      logsDir: `${workDir}/logs`,
      timeoutSecs: 300,
    });

    await Promise.resolve();

    let settled = false;
    void promise.then(() => {
      settled = true;
    }).catch(() => {
      settled = true;
    });

    await jest.advanceTimersByTimeAsync(61_000);
    expect(settled).toBe(false);

    const terminalInputCall = mockInvoke.mock.calls.find(([command]) => command === 'terminal_input');
    expect(terminalInputCall).toBeDefined();
    const fullCommand = String(terminalInputCall?.[1]?.data ?? '');
    const tokenMatch = fullCommand.match(/__PIPI_AUTORESEARCH_EXIT__:(.+?):%s/);
    expect(tokenMatch?.[1]).toBeTruthy();

    await terminalOutputListener?.({
      payload: {
        session_id: 'existing-terminal',
        data: `__PIPI_AUTORESEARCH_EXIT__:${tokenMatch?.[1]}:0\n`,
      },
    });

    await expect(promise).resolves.toEqual(expect.objectContaining({
      exitCode: 0,
      stdoutPath: `${workDir}/logs/stdout.log`,
      stderrPath: `${workDir}/logs/stderr.log`,
      combinedPath: `${workDir}/logs/combined.log`,
    }));
  });
});
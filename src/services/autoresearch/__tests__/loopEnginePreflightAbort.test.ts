import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('@/store/autoresearchStore', () => ({
  useAutoResearchStore: {
    getState: jest.fn(),
  },
}));

jest.mock('../loopEngine.preflightPhase', () => {
  const actual = jest.requireActual('../loopEngine.preflightPhase') as Record<string, unknown>;
  return {
    ...actual,
    runExperimentLoopPreflight: jest.fn(),
  };
});

import { useAutoResearchStore } from '@/store/autoresearchStore';
import { runExperimentLoopPreflight } from '../loopEngine.preflightPhase';
import { getActiveLoopAbortControllerForTest, startExperimentLoop, stopExperimentLoop } from '../loopEngine';

const getStateMock = useAutoResearchStore.getState as jest.MockedFunction<typeof useAutoResearchStore.getState>;
const preflightMock = runExperimentLoopPreflight as jest.MockedFunction<typeof runExperimentLoopPreflight>;

describe('loopEngine preflight abort controller (R5-02)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getStateMock.mockReturnValue({
      sshConfig: null,
      setError: jest.fn(),
      setRunStatus: jest.fn(),
      setLoopState: jest.fn(),
    } as unknown as ReturnType<typeof useAutoResearchStore.getState>);
    // Default: real preflight path via store.sshConfig=null → no_ssh_config.
    // Explicit mock implementations below override for throw / other kinds.
    preflightMock.mockImplementation(async () => ({ ok: false, kind: 'no_ssh_config' }));
  });

  it('clears_active_controller_when_ssh_config_missing', async () => {
    const sendMessage = jest.fn(async () => 'ok');

    await startExperimentLoop(sendMessage);

    expect(getActiveLoopAbortControllerForTest()).toBeNull();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('stop_after_preflight_failure_is_safe_noop', async () => {
    await startExperimentLoop(jest.fn(async () => 'ok'));
    expect(() => stopExperimentLoop()).not.toThrow();
    expect(getActiveLoopAbortControllerForTest()).toBeNull();
  });

  it('registers the provided abortController as the stop handle', async () => {
    const controller = new AbortController();
    const setError = jest.fn();
    getStateMock.mockImplementation(() => {
      expect(getActiveLoopAbortControllerForTest()).toBe(controller);
      return {
        sshConfig: null,
        setError,
        setRunStatus: jest.fn(),
        setLoopState: jest.fn(),
      } as unknown as ReturnType<typeof useAutoResearchStore.getState>;
    });

    await startExperimentLoop(jest.fn(async () => 'ok'), {
      abortController: controller,
      signal: controller.signal,
    });

    expect(controller.signal.aborted).toBe(false);
    expect(getActiveLoopAbortControllerForTest()).toBeNull();
  });

  it('clears_active_controller_when_preflight_throws', async () => {
    const controller = new AbortController();
    preflightMock.mockRejectedValue(new Error('preflight boom'));

    await expect(
      startExperimentLoop(jest.fn(async () => 'ok'), { abortController: controller }),
    ).rejects.toThrow('preflight boom');

    expect(getActiveLoopAbortControllerForTest()).toBeNull();
  });

  it('clears_active_controller_on_dirty_repo_preflight_fail', async () => {
    const setError = jest.fn();
    getStateMock.mockReturnValue({
      sshConfig: { mode: 'local' },
      setError,
      setRunStatus: jest.fn(),
      setLoopState: jest.fn(),
    } as unknown as ReturnType<typeof useAutoResearchStore.getState>);
    preflightMock.mockResolvedValue({
      ok: false,
      kind: 'dirty_repo',
      error: 'Experiment repository has 2 uncommitted change(s).',
    });

    await startExperimentLoop(jest.fn(async () => 'ok'));

    expect(setError).toHaveBeenCalledWith(
      expect.stringContaining('uncommitted change'),
    );
    expect(getActiveLoopAbortControllerForTest()).toBeNull();
  });
});

import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('@/store/autoresearchStore', () => ({
  useAutoResearchStore: {
    getState: jest.fn(),
  },
}));

import { useAutoResearchStore } from '@/store/autoresearchStore';
import { getActiveLoopAbortControllerForTest, startExperimentLoop, stopExperimentLoop } from '../loopEngine';

const getStateMock = useAutoResearchStore.getState as jest.MockedFunction<typeof useAutoResearchStore.getState>;

describe('loopEngine preflight abort controller (R5-02)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getStateMock.mockReturnValue({
      sshConfig: null,
      setError: jest.fn(),
      setRunStatus: jest.fn(),
      setLoopState: jest.fn(),
    } as unknown as ReturnType<typeof useAutoResearchStore.getState>);
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
});
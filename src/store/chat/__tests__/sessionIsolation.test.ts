import { describe, expect, it, jest } from '@jest/globals';

import { resetTransientSessionStateForNewChat } from '../sessionIsolation';

describe('sessionIsolation', () => {
  it('clears transient session state and scrubs old runtime context for a new chat', () => {
    const actions = {
      stopSubprocess: jest.fn(),
      clearAllPermissions: jest.fn(),
      clearQuestionnaire: jest.fn(),
      clearNotificationHistory: jest.fn(),
      clearArtifactId: jest.fn(),
      clearTaskProgress: jest.fn(),
      setActiveSkill: jest.fn(),
      setAgentPanelTab: jest.fn(),
      closeArtifactsPanel: jest.fn(),
      scrubDanglingToolCalls: jest.fn(),
    };

    resetTransientSessionStateForNewChat('session-1', {
      isStreaming: true,
      pendingToolCalls: 1,
      pendingToolResultsLength: 1,
      permissionQueueLength: 0,
    }, actions);

    expect(actions.stopSubprocess).toHaveBeenCalledWith('session-1');
    expect(actions.clearAllPermissions).toHaveBeenCalledTimes(1);
    expect(actions.clearQuestionnaire).toHaveBeenCalledWith('session-1');
    expect(actions.clearNotificationHistory).toHaveBeenCalledWith('session-1');
    expect(actions.clearArtifactId).toHaveBeenCalledTimes(1);
    expect(actions.clearTaskProgress).toHaveBeenCalledTimes(1);
    expect(actions.setActiveSkill).toHaveBeenCalledWith(null);
    expect(actions.setAgentPanelTab).toHaveBeenCalledWith('main');
    expect(actions.closeArtifactsPanel).toHaveBeenCalledTimes(1);
    expect(actions.scrubDanglingToolCalls).toHaveBeenCalledWith('session-1');
  });
});

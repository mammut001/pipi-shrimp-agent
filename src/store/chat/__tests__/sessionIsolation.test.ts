import { describe, expect, it, jest } from '@jest/globals';

import { resetTransientSessionStateForNewChat } from '../sessionIsolation';

describe('sessionIsolation', () => {
  it('clears transient session UI chrome for a new chat without stopping or scrubbing runtime', () => {
    const actions = {
      clearAllPermissions: jest.fn(),
      clearQuestionnaire: jest.fn(),
      clearNotificationHistory: jest.fn(),
      clearArtifactId: jest.fn(),
      clearTaskProgress: jest.fn(),
      setActiveSkill: jest.fn(),
      setAgentPanelTab: jest.fn(),
      closeArtifactsPanel: jest.fn(),
    };

    resetTransientSessionStateForNewChat('session-1', actions);

    expect(actions.clearAllPermissions).toHaveBeenCalledTimes(1);
    expect(actions.clearQuestionnaire).toHaveBeenCalledWith('session-1');
    expect(actions.clearNotificationHistory).toHaveBeenCalledWith('session-1');
    expect(actions.clearArtifactId).toHaveBeenCalledTimes(1);
    expect(actions.clearTaskProgress).toHaveBeenCalledTimes(1);
    expect(actions.setActiveSkill).toHaveBeenCalledWith(null);
    expect(actions.setAgentPanelTab).toHaveBeenCalledWith('main');
    expect(actions.closeArtifactsPanel).toHaveBeenCalledTimes(1);
    expect('stopSubprocess' in actions).toBe(false);
    expect('scrubDanglingToolCalls' in actions).toBe(false);
  });

  it('handles null previousSessionId by only clearing global UI chrome', () => {
    const actions = {
      clearAllPermissions: jest.fn(),
      clearQuestionnaire: jest.fn(),
      clearNotificationHistory: jest.fn(),
      clearArtifactId: jest.fn(),
      clearTaskProgress: jest.fn(),
      setActiveSkill: jest.fn(),
      setAgentPanelTab: jest.fn(),
      closeArtifactsPanel: jest.fn(),
    };

    resetTransientSessionStateForNewChat(null, actions);

    expect(actions.clearAllPermissions).toHaveBeenCalledTimes(1);
    expect(actions.clearArtifactId).toHaveBeenCalledTimes(1);
    expect(actions.clearTaskProgress).toHaveBeenCalledTimes(1);
    expect(actions.setActiveSkill).toHaveBeenCalledWith(null);
    expect(actions.setAgentPanelTab).toHaveBeenCalledWith('main');
    expect(actions.closeArtifactsPanel).toHaveBeenCalledTimes(1);
    expect(actions.clearQuestionnaire).not.toHaveBeenCalled();
    expect(actions.clearNotificationHistory).not.toHaveBeenCalled();
  });
});

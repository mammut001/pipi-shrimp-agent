export interface SessionIsolationRuntimeState {
  isStreaming: boolean;
  pendingToolCalls: number;
  pendingToolResultsLength: number;
  permissionQueueLength: number;
}

export interface SessionIsolationActions {
  stopSubprocess: (sessionId: string) => void;
  clearAllPermissions: () => void;
  clearQuestionnaire: (sessionId: string) => void;
  clearNotificationHistory: (sessionId: string) => void;
  clearArtifactId: () => void;
  clearTaskProgress: () => void;
  setActiveSkill: (name: string | null) => void;
  setAgentPanelTab: (tab: 'main') => void;
  closeArtifactsPanel: () => void;
  scrubDanglingToolCalls: (sessionId: string) => void;
}

export function resetTransientSessionStateForNewChat(
  previousSessionId: string | null,
  runtime: SessionIsolationRuntimeState,
  actions: SessionIsolationActions,
): void {
  if (previousSessionId && runtime.isStreaming) {
    actions.stopSubprocess(previousSessionId);
  }

  actions.clearAllPermissions();
  actions.clearArtifactId();
  actions.clearTaskProgress();
  actions.setActiveSkill(null);
  actions.setAgentPanelTab('main');
  actions.closeArtifactsPanel();

  if (!previousSessionId) {
    return;
  }

  actions.clearQuestionnaire(previousSessionId);
  actions.clearNotificationHistory(previousSessionId);

  if (runtime.pendingToolCalls > 0 || runtime.pendingToolResultsLength > 0 || runtime.permissionQueueLength > 0) {
    actions.scrubDanglingToolCalls(previousSessionId);
  }
}

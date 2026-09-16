export interface SessionIsolationActions {
  clearAllPermissions: () => void;
  clearQuestionnaire: (sessionId: string) => void;
  clearNotificationHistory: (sessionId: string) => void;
  clearArtifactId: () => void;
  clearTaskProgress: () => void;
  setActiveSkill: (name: string | null) => void;
  setAgentPanelTab: (tab: 'main') => void;
  closeArtifactsPanel: () => void;
}

export function resetTransientSessionStateForNewChat(
  previousSessionId: string | null,
  actions: SessionIsolationActions,
): void {
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
}

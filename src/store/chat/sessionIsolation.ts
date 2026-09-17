export interface SessionIsolationActions {
  clearQuestionnaire: (sessionId: string) => void;
  clearNotificationHistory: (sessionId: string) => void;
  clearArtifactId: () => void;
  clearTaskProgress: () => void;
  setActiveSkill: (name: string | null) => void;
  setAgentPanelTab: (tab: 'main') => void;
  closeArtifactsPanel: () => void;
}

/**
 * Reset selected-session UI chrome when starting a new chat.
 *
 * Must NOT deny/clear other sessions' pending permission approvals
 * (`clearAllPermissions` / `clearPermissionsForSession`). Background
 * SessionRuntime tools may still be awaiting user approval on the
 * previous session; new chat only rebinds chrome for the empty session.
 */
export function resetTransientSessionStateForNewChat(
  previousSessionId: string | null,
  actions: SessionIsolationActions,
): void {
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

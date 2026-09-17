import type { Message, Session } from '../../types/chat';

export function selectCurrentSession(
  sessions: Session[],
  currentSessionId: string | null,
): Session | null {
  if (!currentSessionId) {
    return null;
  }

  return sessions.find((session) => session.id === currentSessionId) ?? null;
}

export function selectCurrentMessages(
  sessions: Session[],
  currentSessionId: string | null,
): Message[] {
  return selectCurrentSession(sessions, currentSessionId)?.messages ?? [];
}

export function filterSessionsByProject(
  sessions: Session[],
  projectId: string | null,
): Session[] {
  return sessions.filter((session) => (projectId ? session.projectId === projectId : !session.projectId));
}

/** Busy inputs that should show Stop (stream and/or long tools). */
export type StopControlBusyState = {
  isStreaming: boolean;
  pendingToolCalls: number;
  pendingToolResultsLength: number;
};

/**
 * Stop is visible while the current session turn is busy: active stream OR
 * unresolved/pending tools. Keeps Stop clickable during long tools even if
 * `isStreaming` briefly flickers false.
 */
export function shouldShowStopControl(state: StopControlBusyState): boolean {
  return state.isStreaming
    || state.pendingToolCalls > 0
    || state.pendingToolResultsLength > 0;
}

export const COMPOSER_STOP_CONTROL_TEST_ID = 'composer-stop-control' as const;
export const COMPOSER_SEND_CONTROL_TEST_ID = 'composer-send-control' as const;
export const COMPOSER_STOP_BUSY_HINT_TEST_ID = 'composer-stop-busy-hint' as const;

export type ComposerSendStopReason = 'streaming' | 'pending_tools' | null;

export interface ComposerSendStopAffordance {
  showStop: boolean;
  primaryAction: 'stop' | 'send';
  sendPrimary: boolean;
  stopReason: ComposerSendStopReason;
  stopTitleKey: 'chat.stopStreaming' | 'chat.stopTools' | 'chat.stop';
  sendTitleKey: 'chat.send';
  stopTestId: typeof COMPOSER_STOP_CONTROL_TEST_ID;
  sendTestId: typeof COMPOSER_SEND_CONTROL_TEST_ID;
  busyHintKey: 'chat.stopBusyHint' | null;
}

/**
 * Resolves composer Send vs Stop visual/semantic affordance based on busy state.
 * MUST delegate `showStop` to `shouldShowStopControl`.
 */
export function resolveComposerSendStopAffordance(
  state: StopControlBusyState,
): ComposerSendStopAffordance {
  const showStop = shouldShowStopControl(state);
  const isStreaming = state.isStreaming;
  const hasPendingTools = state.pendingToolCalls > 0
    || state.pendingToolResultsLength > 0;

  const stopReason: ComposerSendStopReason = isStreaming
    ? 'streaming'
    : hasPendingTools
      ? 'pending_tools'
      : null;

  const stopTitleKey = stopReason === 'streaming'
    ? 'chat.stopStreaming'
    : stopReason === 'pending_tools'
      ? 'chat.stopTools'
      : 'chat.stop';

  return {
    showStop,
    primaryAction: showStop ? 'stop' : 'send',
    sendPrimary: !showStop,
    stopReason,
    stopTitleKey,
    sendTitleKey: 'chat.send',
    stopTestId: COMPOSER_STOP_CONTROL_TEST_ID,
    sendTestId: COMPOSER_SEND_CONTROL_TEST_ID,
    busyHintKey: showStop ? 'chat.stopBusyHint' : null,
  };
}


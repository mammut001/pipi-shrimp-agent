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

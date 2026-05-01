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

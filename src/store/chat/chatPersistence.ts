import type { Message, Project, Session } from '../../types/chat';
import {
  messageToDb,
  projectToDb,
  sessionToDb,
  type DbMessage,
  type DbProject,
  type DbSession,
} from '../../utils/chatHelpers';

export function serializeSessionForPersistence(session: Session): DbSession {
  return sessionToDb(session);
}

export function serializeMessageForPersistence(message: Message, sessionId: string): DbMessage {
  return messageToDb(message, sessionId);
}

export function serializeProjectForPersistence(project: Project): DbProject {
  return projectToDb(project);
}

export function shouldPersistMessage(message: Message): boolean {
  // AUDIT-FIX [audit-1#3] — Defence in depth: never persist messages that
  // carry the tool-result transport sentinel. The current call sites only
  // ever invoke addMessage with UI-authored messages, but if anything ever
  // leaks a tool-result message into the store we want it filtered out before
  // it reaches the database (avoiding the DB-bloat + parseThinkContent
  // collision risk documented on QueryEngine.ts).
  if (message.metadata?.hidden === true) {
    return false;
  }
  if (message.metadata?.toolResult === true) {
    return false;
  }
  if (message.role === 'user' && message.content.startsWith('__TOOL_RESULT__:')) {
    return false;
  }
  return true;
}

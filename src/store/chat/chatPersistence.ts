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
  return message.metadata?.hidden !== true;
}

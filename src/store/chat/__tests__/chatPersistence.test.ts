import { describe, expect, it } from '@jest/globals';
import type { Message, Project, Session } from '../../../types/chat';
import {
  serializeMessageForPersistence,
  serializeProjectForPersistence,
  serializeSessionForPersistence,
  shouldPersistMessage,
} from '../chatPersistence';

describe('chatPersistence', () => {
  it('skips hidden transient messages', () => {
    const visible: Message = { id: 'm1', role: 'user', content: 'hi', timestamp: 1 };
    const hidden: Message = { ...visible, id: 'm2', metadata: { hidden: true } };

    expect(shouldPersistMessage(visible)).toBe(true);
    expect(shouldPersistMessage(hidden)).toBe(false);
  });

  it('serializes chat entities through the shared chatHelpers boundary', () => {
    const message: Message = { id: 'm1', role: 'assistant', content: 'ok', timestamp: 123 };
    const session: Session = { id: 's1', title: 'Chat', messages: [message], createdAt: 1, updatedAt: 2, workDir: '/work' };
    const project: Project = { id: 'p1', name: 'Project', createdAt: 3, updatedAt: 4, workDir: '/project' };

    expect(serializeMessageForPersistence(message, session.id)).toMatchObject({ id: 'm1', session_id: 's1' });
    expect(serializeSessionForPersistence(session)).toMatchObject({ id: 's1', title: 'Chat' });
    expect(serializeProjectForPersistence(project)).toMatchObject({ id: 'p1', name: 'Project' });
  });
});

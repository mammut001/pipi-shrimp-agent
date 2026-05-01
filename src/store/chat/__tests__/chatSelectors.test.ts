import { describe, expect, it } from '@jest/globals';
import type { Session } from '../../../types/chat';
import { filterSessionsByProject, selectCurrentMessages, selectCurrentSession } from '../chatSelectors';

const sessions: Session[] = [
  { id: 's1', title: 'One', messages: [{ id: 'm1', role: 'user', content: 'hi', timestamp: 1 }], createdAt: 1, updatedAt: 1 },
  { id: 's2', title: 'Two', messages: [], createdAt: 2, updatedAt: 2, projectId: 'p1' },
];

describe('chatSelectors', () => {
  it('selects the current session and messages by id', () => {
    expect(selectCurrentSession(sessions, 's1')?.title).toBe('One');
    expect(selectCurrentMessages(sessions, 's1')).toHaveLength(1);
  });

  it('returns stable empty values when no session is selected', () => {
    expect(selectCurrentSession(sessions, null)).toBeNull();
    expect(selectCurrentMessages(sessions, 'missing')).toEqual([]);
  });

  it('filters project and unprojected sessions', () => {
    expect(filterSessionsByProject(sessions, 'p1').map((session) => session.id)).toEqual(['s2']);
    expect(filterSessionsByProject(sessions, null).map((session) => session.id)).toEqual(['s1']);
  });
});

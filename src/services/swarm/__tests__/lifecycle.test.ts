jest.mock('../memory/index', () => ({
  initTeamMemory: jest.fn(),
  initAgentMemory: jest.fn(),
  getSwarmBaseDir: jest.fn(),
}));

import * as repo from '../repository';
import { startAgent } from '../lifecycle';

describe('swarm lifecycle', () => {
  beforeEach(async () => {
    const storage = new Map<string, string>();
    Object.defineProperty(global, 'localStorage', {
      configurable: true,
      value: {
        getItem: jest.fn((key: string) => storage.get(key) ?? null),
        setItem: jest.fn((key: string, value: string) => {
          storage.set(key, value);
        }),
        removeItem: jest.fn((key: string) => {
          storage.delete(key);
        }),
      },
    });
    await repo.clearAll();
  });

  it('reassigns a working agent to the newest task and records the reassignment', () => {
    repo.createAgent({
      id: 'agent-1',
      teamId: 'team-1',
      name: 'member-1',
      role: 'member',
      status: 'idle',
      sessionId: 'session-1',
      createdAt: 1,
      updatedAt: 1,
    });

    const first = startAgent('agent-1', 'task-1');
    const second = startAgent('agent-1', 'task-2');

    expect(first?.currentTaskId).toBe('task-1');
    expect(second?.status).toBe('working');
    expect(second?.currentTaskId).toBe('task-2');

    const transcript = repo.getTranscriptForAgent('agent-1');
    expect(transcript[transcript.length - 1]?.content).toContain('reassigned from task-1 to task-2');
  });
});

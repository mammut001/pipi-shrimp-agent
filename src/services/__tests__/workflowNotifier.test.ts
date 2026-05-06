import { clearAll, getUnreadMessages } from '@/services/swarm/repository';
import { notifyOnComplete, readAgentInbox } from '../workflowNotifier';
import type { WorkflowAgent } from '@/types/workflow';

function installLocalStorageMock() {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value); },
      removeItem: (key: string) => { store.delete(key); },
      clear: () => { store.clear(); },
    },
  });
}

function createAgent(id: string, name: string, notifyOnComplete?: string[]): WorkflowAgent {
  return {
    id,
    name,
    position: { x: 0, y: 0 },
    status: 'idle',
    outputRoutes: [],
    execution: { mode: 'single' },
    notifyOnComplete,
    role: 'custom',
  };
}

describe('workflowNotifier', () => {
  beforeAll(() => {
    installLocalStorageMock();
  });

  beforeEach(async () => {
    await clearAll();
  });

  afterEach(async () => {
    await clearAll();
  });

  it('notifyOnComplete writes the expected inbox message', async () => {
    const writer = createAgent('writer', 'Writer', ['coder']);
    const coder = createAgent('coder', 'Coder');
    const agents = [writer, coder];

    await notifyOnComplete(writer, agents, 'A'.repeat(900), 'run-1');

    expect(getUnreadMessages('coder')).toHaveLength(1);

    const inbox = readAgentInbox('coder', 'run-1', agents);
    expect(inbox).toEqual([
      expect.objectContaining({
        fromAgentId: 'writer',
        fromAgentName: 'Writer',
        summary: 'A'.repeat(600),
        fullLength: 900,
      }),
    ]);
    expect(getUnreadMessages('coder')).toHaveLength(0);
  });
});

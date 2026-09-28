import { clearAll, getUnreadMessages } from '@/services/swarm/repository';
import { notifyOnComplete, readAgentInbox } from '../workflowNotifier';
import { MAX_UPSTREAM_CHARS, truncate } from '../workflowPromptBuilder';
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

function createAgent(
  id: string,
  name: string,
  notifyOnComplete?: string[],
  notifyFullOutputAgentIds?: string[],
): WorkflowAgent {
  return {
    id,
    name,
    position: { x: 0, y: 0 },
    status: 'idle',
    outputRoutes: [],
    execution: { mode: 'single' },
    notifyOnComplete,
    notifyFullOutputAgentIds,
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

  it('sends full (capped) output to targets opted into notifyFullOutputAgentIds', async () => {
    const writer = createAgent('writer', 'Writer', ['coder'], ['coder']);
    const coder = createAgent('coder', 'Coder');
    const agents = [writer, coder];
    const output = 'B'.repeat(6000);

    await notifyOnComplete(writer, agents, output, 'run-2');

    const inbox = readAgentInbox('coder', 'run-2', agents);
    expect(inbox).toEqual([
      expect.objectContaining({
        fromAgentId: 'writer',
        summary: 'B'.repeat(600),
        fullLength: 6000,
        full: truncate(output),
      }),
    ]);
    expect(inbox[0].full).toHaveLength(MAX_UPSTREAM_CHARS + '\n\n… [output truncated]'.length);
  });

  it('sends full output unmodified when under the cap', async () => {
    const writer = createAgent('writer', 'Writer', ['coder'], ['coder']);
    const coder = createAgent('coder', 'Coder');
    const agents = [writer, coder];
    const output = 'C'.repeat(100);

    await notifyOnComplete(writer, agents, output, 'run-3');

    const inbox = readAgentInbox('coder', 'run-3', agents);
    expect(inbox[0].full).toBe(output);
  });

  it('ignores a notifyFullOutputAgentIds id that is not also in notifyOnComplete', async () => {
    const writer = createAgent('writer', 'Writer', ['coder'], ['coder', 'reviewer']);
    const coder = createAgent('coder', 'Coder');
    const agents = [writer, coder];

    await expect(notifyOnComplete(writer, agents, 'D'.repeat(10), 'run-4')).resolves.toBeUndefined();

    expect(getUnreadMessages('coder')).toHaveLength(1);
    expect(getUnreadMessages('reviewer')).toHaveLength(0);
  });

  it('sends full output only to the opted-in target when notifying multiple agents', async () => {
    const writer = createAgent('writer', 'Writer', ['coder', 'reviewer'], ['coder']);
    const coder = createAgent('coder', 'Coder');
    const reviewer = createAgent('reviewer', 'Reviewer');
    const agents = [writer, coder, reviewer];

    await notifyOnComplete(writer, agents, 'E'.repeat(10), 'run-5');

    expect(readAgentInbox('coder', 'run-5', agents)[0].full).toBe('E'.repeat(10));
    expect(readAgentInbox('reviewer', 'run-5', agents)[0].full).toBeUndefined();
  });
});

const invokeMock = jest.fn();
const settingsState = {
  apiConfigs: [],
  getActiveConfig: jest.fn(() => ({
    id: 'cfg-1',
    provider: 'anthropic',
    apiKey: 'test-key',
    model: 'claude-sonnet-4-5',
    baseUrl: '',
    apiFormat: 'anthropic',
  })),
};
const workflowStoreState: { current: any } = { current: null };
const addNotification = jest.fn();
const listenHandlers = new Map<string, (event: { payload: any }) => void>();

jest.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

jest.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    listen: jest.fn(async (eventName: string, handler: (event: { payload: any }) => void) => {
      listenHandlers.set(eventName, handler);
      return () => {
        listenHandlers.delete(eventName);
      };
    }),
  }),
}));

jest.mock('@/store/settingsStore', () => ({
  useSettingsStore: {
    getState: () => settingsState,
  },
}));

jest.mock('@/store/workflowStore', () => ({
  useWorkflowStore: {
    getState: () => workflowStoreState.current,
  },
}));

jest.mock('@/store/uiStore', () => ({
  useUIStore: {
    getState: () => ({ addNotification }),
  },
}));

jest.mock('@/store/taskRegistryStore', () => ({
  registerDiagnosticsTask: jest.fn(),
  registerDiagnosticsTaskCancel: jest.fn(),
  updateDiagnosticsTask: jest.fn(),
}));

import WorkflowEngine from '../workflowEngine';
import { WorkflowTranscriptManager, runAgentWithRetry } from '../workflowEngine';
import type { WorkflowAgent, WorkflowConnection, WorkflowInstance } from '@/types/workflow';

function createAgent(overrides: Partial<WorkflowAgent>): WorkflowAgent {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    name: overrides.name ?? 'Agent',
    position: { x: 0, y: 0 },
    status: 'idle',
    outputRoutes: [],
    execution: { mode: 'single' },
    role: overrides.role ?? 'custom',
    notifyOnComplete: overrides.notifyOnComplete ?? [],
    ...overrides,
  };
}

function createInstance(agents: WorkflowAgent[], connections: WorkflowConnection[], maxGoalIterations = 5): WorkflowInstance {
  return {
    id: 'instance-1',
    name: 'Workflow',
    projectGoal: 'Ship the feature',
    successCriteria: 'tests pass',
    goalEvaluatorAgentId: null,
    maxGoalIterations,
    agents,
    connections,
    workflowRuns: [],
    activeRunId: null,
    dirtyAgentIds: [],
    createdAt: 0,
    updatedAt: 0,
  };
}

function installWorkflowStore(instance: WorkflowInstance) {
  const state = {
    instance,
    getCurrentInstance: () => state.instance,
    resetAllStatuses: () => {
      state.instance.agents = state.instance.agents.map((agent: WorkflowAgent) => ({ ...agent, status: 'idle' }));
      state.instance.dirtyAgentIds = [];
    },
    setRunning: jest.fn(),
    addWorkflowRun: (run: any) => {
      state.instance.workflowRuns = [run, ...state.instance.workflowRuns];
      state.instance.activeRunId = run.id;
    },
    updateWorkflowRun: (runId: string, updates: Record<string, unknown>) => {
      state.instance.workflowRuns = state.instance.workflowRuns.map((run: any) => (
        run.id === runId ? { ...run, ...updates } : run
      ));
    },
    renameWorkflowRun: jest.fn(),
    deleteWorkflowRun: jest.fn(),
    updateRunAgent: (runId: string, agentId: string, updates: Record<string, unknown>) => {
      state.instance.workflowRuns = state.instance.workflowRuns.map((run: any) => (
        run.id === runId
          ? {
              ...run,
              agents: run.agents.map((entry: any) => (
                entry.agentId === agentId ? { ...entry, ...updates } : entry
              )),
            }
          : run
      ));
    },
    appendGoalEvaluation: (runId: string, evaluation: any) => {
      state.instance.workflowRuns = state.instance.workflowRuns.map((run: any) => (
        run.id === runId
          ? {
              ...run,
              currentIteration: evaluation.iteration,
              goalEvaluations: [...(run.goalEvaluations || []), evaluation],
              reachedGoal: evaluation.reached,
            }
          : run
      ));
    },
    setAgentStatus: (agentId: string, status: WorkflowAgent['status']) => {
      state.instance.agents = state.instance.agents.map((agent: WorkflowAgent) => (
        agent.id === agentId ? { ...agent, status } : agent
      ));
    },
    markAgentDirty: jest.fn((agentId: string) => {
      state.instance.dirtyAgentIds = Array.from(new Set([...(state.instance.dirtyAgentIds || []), agentId]));
    }),
    clearAgentDirty: jest.fn((agentId: string) => {
      state.instance.dirtyAgentIds = (state.instance.dirtyAgentIds || []).filter((id: string) => id !== agentId);
    }),
  };

  workflowStoreState.current = state;
  return state;
}

describe('WorkflowEngine goal loop', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    listenHandlers.clear();
  });

  it('stops after one iteration when the goal is reached immediately', async () => {
    const writer = createAgent({ id: 'writer', role: 'writer' });
    const coder = createAgent({ id: 'coder', role: 'coder', inputFrom: 'writer' });
    const instance = createInstance(
      [writer, coder],
      [{ id: 'c1', sourceAgentId: 'writer', targetAgentId: 'coder', condition: 'onComplete' }],
    );
    installWorkflowStore(instance);

    const runAgent = jest.fn(async (agent: WorkflowAgent) => `${agent.id}-output`);
    const engine = new WorkflowEngine({
      createRunDirectory: async () => '/tmp/workflow-run',
      writeFile: async () => undefined,
      runAgent,
      evaluateGoal: async () => ({
        iteration: 1,
        reached: true,
        confidence: 0.9,
        missingItems: [],
        reasoning: 'done',
        timestamp: 1,
      }),
      notify: async () => undefined,
      now: (() => {
        let current = 1;
        return () => current++;
      })(),
    });

    await engine.start();

    expect(runAgent.mock.calls.map((call: [WorkflowAgent]) => call[0].id)).toEqual(['writer', 'coder']);
    expect(instance.workflowRuns[0].currentIteration).toBe(1);
    expect(instance.workflowRuns[0].reachedGoal).toBe(true);
    expect(instance.workflowRuns[0].status).toBe('completed');
  });

  it('runs a second iteration only for dirty agents and their downstream', async () => {
    const writer = createAgent({ id: 'writer', role: 'writer' });
    const coder = createAgent({ id: 'coder', role: 'coder', inputFrom: 'writer' });
    const tester = createAgent({ id: 'tester', role: 'tester', inputFrom: 'coder' });
    const instance = createInstance(
      [writer, coder, tester],
      [
        { id: 'c1', sourceAgentId: 'writer', targetAgentId: 'coder', condition: 'onComplete' },
        { id: 'c2', sourceAgentId: 'coder', targetAgentId: 'tester', condition: 'onComplete' },
      ],
    );
    const store = installWorkflowStore(instance);

    const agentCallCounts = new Map<string, number>();
    const runAgent = jest.fn(async (agent: WorkflowAgent) => {
      const nextCount = (agentCallCounts.get(agent.id) ?? 0) + 1;
      agentCallCounts.set(agent.id, nextCount);
      return `${agent.id}-${nextCount}`;
    });
    const evaluateGoal = jest
      .fn()
      .mockResolvedValueOnce({
        iteration: 1,
        reached: false,
        confidence: 0.5,
        missingItems: ['fix code'],
        nextAgentIdHint: 'coder',
        reasoning: 'need another pass',
        timestamp: 1,
      })
      .mockResolvedValueOnce({
        iteration: 2,
        reached: true,
        confidence: 0.9,
        missingItems: [],
        reasoning: 'done',
        timestamp: 2,
      });

    const engine = new WorkflowEngine({
      createRunDirectory: async () => '/tmp/workflow-run',
      writeFile: async () => undefined,
      runAgent,
      evaluateGoal,
      notify: async () => undefined,
      now: (() => {
        let current = 1;
        return () => current++;
      })(),
    });

    await engine.start();

    expect(runAgent.mock.calls.map((call: [WorkflowAgent]) => call[0].id)).toEqual([
      'writer',
      'coder',
      'tester',
      'coder',
      'tester',
    ]);
    expect(store.markAgentDirty).toHaveBeenCalledWith('coder');
    expect(instance.workflowRuns[0].goalEvaluations).toHaveLength(2);
  });

  it('marks run completed with reachedGoal=false after max iterations', async () => {
    const coder = createAgent({ id: 'coder', role: 'coder' });
    const instance = createInstance([coder], [], 2);
    installWorkflowStore(instance);

    const runAgent = jest.fn(async () => 'coder-output');
    const evaluateGoal = jest.fn(async ({ iteration }: { iteration: number }) => ({
      iteration,
      reached: false,
      confidence: 0.2,
      missingItems: ['still missing'],
      nextAgentIdHint: 'coder',
      reasoning: 'keep iterating',
      timestamp: iteration,
    }));

    const engine = new WorkflowEngine({
      createRunDirectory: async () => '/tmp/workflow-run',
      writeFile: async () => undefined,
      runAgent,
      evaluateGoal,
      notify: async () => undefined,
      now: (() => {
        let current = 1;
        return () => current++;
      })(),
    });

    await engine.start();

    expect(runAgent).toHaveBeenCalledTimes(2);
    expect(instance.workflowRuns[0].status).toBe('completed');
    expect(instance.workflowRuns[0].reachedGoal).toBe(false);
    expect(instance.workflowRuns[0].goalEvaluations).toHaveLength(2);
  });

  it('executeMultiRound stops once [[GOAL_COMPLETE]] appears', async () => {
    invokeMock.mockImplementation(async (_command: string, params: { sessionId: string }) => {
      const tokenHandler = listenHandlers.get('claude-token');
      const callCount = invokeMock.mock.calls.length;
      tokenHandler?.({
        payload: {
          session_id: params.sessionId,
          content: callCount === 1 ? 'round-1 output' : 'round-2 [[GOAL_COMPLETE]]',
        },
      });
      return undefined;
    });

    const result = await runAgentWithRetry(
      createAgent({
        id: 'tester',
        role: 'tester',
        execution: { mode: 'multi-round', maxRounds: 3, roundCondition: 'untilComplete' },
      }),
      'prompt',
      {
        runId: 'run-1',
        transcript: new WorkflowTranscriptManager(),
      },
    );

    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(result).toContain('[[GOAL_COMPLETE]]');
  });
});

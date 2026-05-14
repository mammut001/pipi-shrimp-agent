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
interface MockWorkflowStoreState {
  currentInstanceId: string;
  instances: WorkflowInstance[];
  getCurrentInstance: () => WorkflowInstance | null;
  getCurrentInstanceOrThrow: () => WorkflowInstance;
  resetAllStatuses: (instanceId?: string) => void;
  setRunning: jest.Mock;
  addWorkflowRun: (run: WorkflowRun, instanceId?: string) => void;
  updateWorkflowRun: (runId: string, updates: Partial<WorkflowRun>) => void;
  renameWorkflowRun: jest.Mock;
  deleteWorkflowRun: jest.Mock;
  updateRunAgent: (runId: string, agentId: string, updates: Record<string, unknown>) => void;
  appendGoalEvaluation: (runId: string, evaluation: { iteration: number; reached: boolean }) => void;
  setAgentStatus: jest.Mock;
  setAgentStatusInInstance: (instanceId: string, agentId: string, status: WorkflowAgent['status']) => void;
  setActiveRunId: jest.Mock;
  markAgentDirty: jest.Mock;
  markAgentDirtyInInstance: jest.Mock;
  clearAgentDirty: jest.Mock;
  clearAgentDirtyInInstance: jest.Mock;
}

const workflowStoreState: { current: MockWorkflowStoreState | null } = { current: null };
const addNotification = jest.fn();

jest.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

jest.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    listen: jest.fn(async () => () => undefined),
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

import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import WorkflowEngine from '../engine';
import type { WorkflowAgent, WorkflowConnection, WorkflowInstance, WorkflowRun } from '@/types/workflow';

function createAgent(overrides: Partial<WorkflowAgent> = {}): WorkflowAgent {
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

function createInstance(
  id: string,
  agents: WorkflowAgent[],
  connections: WorkflowConnection[],
  overrides: Partial<WorkflowInstance> = {},
): WorkflowInstance {
  return {
    id,
    name: `Workflow ${id}`,
    projectGoal: overrides.projectGoal ?? 'Ship the feature',
    successCriteria: overrides.successCriteria ?? 'tests pass',
    goalEvaluatorAgentId: overrides.goalEvaluatorAgentId ?? null,
    maxGoalIterations: overrides.maxGoalIterations ?? 5,
    agents,
    connections,
    workflowRuns: overrides.workflowRuns ?? [],
    activeRunId: overrides.activeRunId ?? null,
    dirtyAgentIds: overrides.dirtyAgentIds ?? [],
    createdAt: overrides.createdAt ?? 0,
    updatedAt: overrides.updatedAt ?? 0,
  };
}

function installWorkflowStore(instances: WorkflowInstance[], initialCurrentInstanceId: string) {
  const state: MockWorkflowStoreState = {
    currentInstanceId: initialCurrentInstanceId,
    instances,
    getCurrentInstance: () => state.instances.find((instance) => instance.id === state.currentInstanceId) ?? null,
    getCurrentInstanceOrThrow: () => {
      const instance = state.instances.find((item) => item.id === state.currentInstanceId) ?? null;
      if (!instance) {
        throw new Error('No workflow instance');
      }
      return instance;
    },
    resetAllStatuses: (instanceId?: string) => {
      const targetId = instanceId ?? state.currentInstanceId;
      state.instances = state.instances.map((instance) => (
        instance.id === targetId
          ? {
              ...instance,
              agents: instance.agents.map((agent) => ({ ...agent, status: 'idle' })),
              dirtyAgentIds: [],
            }
          : instance
      ));
    },
    setRunning: jest.fn(),
    addWorkflowRun: (run: WorkflowRun, instanceId?: string) => {
      const targetId = instanceId ?? state.currentInstanceId;
      state.instances = state.instances.map((instance) => (
        instance.id === targetId
          ? {
              ...instance,
              workflowRuns: [run, ...instance.workflowRuns],
              activeRunId: run.id,
            }
          : instance
      ));
    },
    updateWorkflowRun: (runId: string, updates: Partial<WorkflowRun>) => {
      state.instances = state.instances.map((instance) => (
        instance.workflowRuns.some((run) => run.id === runId)
          ? {
              ...instance,
              workflowRuns: instance.workflowRuns.map((run) => (
                run.id === runId ? { ...run, ...updates } : run
              )),
            }
          : instance
      ));
    },
    renameWorkflowRun: jest.fn(),
    deleteWorkflowRun: jest.fn(),
    updateRunAgent: (runId: string, agentId: string, updates: Record<string, unknown>) => {
      state.instances = state.instances.map((instance) => (
        instance.workflowRuns.some((run) => run.id === runId)
          ? {
              ...instance,
              workflowRuns: instance.workflowRuns.map((run) => (
                run.id === runId
                  ? {
                      ...run,
                      agents: run.agents.map((entry) => (
                        entry.agentId === agentId ? { ...entry, ...updates } : entry
                      )),
                    }
                  : run
              )),
            }
          : instance
      ));
    },
    appendGoalEvaluation: (runId: string, evaluation: { iteration: number; reached: boolean }) => {
      state.instances = state.instances.map((instance) => (
        instance.workflowRuns.some((run) => run.id === runId)
          ? {
              ...instance,
              workflowRuns: instance.workflowRuns.map((run) => (
                run.id === runId
                  ? {
                      ...run,
                      currentIteration: evaluation.iteration,
                      goalEvaluations: [...(run.goalEvaluations || []), evaluation],
                      reachedGoal: evaluation.reached,
                    }
                  : run
              )),
            }
          : instance
      ));
    },
    setAgentStatus: jest.fn(),
    setAgentStatusInInstance: (instanceId: string, agentId: string, status: WorkflowAgent['status']) => {
      state.instances = state.instances.map((instance) => (
        instance.id === instanceId
          ? {
              ...instance,
              agents: instance.agents.map((agent) => (
                agent.id === agentId ? { ...agent, status } : agent
              )),
            }
          : instance
      ));
    },
    setActiveRunId: jest.fn((runId: string | null, instanceId?: string) => {
      const targetId = instanceId ?? state.currentInstanceId;
      state.instances = state.instances.map((instance) => (
        instance.id === targetId ? { ...instance, activeRunId: runId } : instance
      ));
    }),
    markAgentDirty: jest.fn(),
    markAgentDirtyInInstance: jest.fn((instanceId: string, agentId: string) => {
      state.instances = state.instances.map((instance) => (
        instance.id === instanceId
          ? {
              ...instance,
              dirtyAgentIds: Array.from(new Set([...(instance.dirtyAgentIds ?? []), agentId])),
            }
          : instance
      ));
    }),
    clearAgentDirty: jest.fn(),
    clearAgentDirtyInInstance: jest.fn((instanceId: string, agentId: string) => {
      state.instances = state.instances.map((instance) => (
        instance.id === instanceId
          ? {
              ...instance,
              dirtyAgentIds: (instance.dirtyAgentIds ?? []).filter((id) => id !== agentId),
            }
          : instance
      ));
    }),
  };

  workflowStoreState.current = state;
  return state;
}

describe('WorkflowEngine snapshot behavior', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('keeps run history on the originating instance even after the current instance switches', async () => {
    const writer = createAgent({ id: 'writer', role: 'writer' });
    const evaluator = createAgent({ id: 'evaluator', role: 'goal-evaluator' });
    const origin = createInstance('origin', [writer, evaluator], [], { goalEvaluatorAgentId: 'evaluator' });
    const other = createInstance('other', [createAgent({ id: 'other-agent', role: 'developer' })], []);
    const store = installWorkflowStore([origin, other], origin.id);

    const evaluateGoal = jest.fn(async (context: { instance: WorkflowInstance; iteration: number }) => ({
      iteration: context.iteration,
      reached: true,
      confidence: 0.95,
      missingItems: [],
      reasoning: `evaluated:${context.instance.id}`,
      timestamp: context.iteration,
    }));

    const engine = new WorkflowEngine({
      createRunDirectory: async () => '/tmp/workflow-run',
      writeFile: async () => undefined,
      runAgent: jest.fn(async (agent: WorkflowAgent) => {
        if (agent.id === 'writer') {
          store.currentInstanceId = other.id;
        }
        return `${agent.id}-output`;
      }),
      evaluateGoal,
      notify: async () => undefined,
      now: (() => {
        let current = 1;
        return () => current++;
      })(),
    });

    await engine.start();

    const updatedOrigin = store.instances.find((instance) => instance.id === origin.id)!;
    const updatedOther = store.instances.find((instance) => instance.id === other.id)!;
    expect(evaluateGoal).toHaveBeenCalledWith(
      expect.objectContaining({ instance: expect.objectContaining({ id: origin.id, goalEvaluatorAgentId: 'evaluator' }) }),
      expect.anything(),
    );
    expect(updatedOrigin.workflowRuns[0]).toMatchObject({
      status: 'completed',
      reachedGoal: true,
    });
    expect(updatedOrigin.workflowRuns[0].agents.find((entry) => entry.agentId === 'evaluator')).toMatchObject({
      status: 'completed',
    });
    expect(updatedOther.workflowRuns).toEqual([]);
  });

  it('does not schedule goal-evaluator agents in the executable plan', async () => {
    const writer = createAgent({ id: 'writer', role: 'writer' });
    const evaluator = createAgent({ id: 'evaluator', role: 'goal-evaluator' });
    const instance = createInstance('origin', [writer, evaluator], [], { goalEvaluatorAgentId: 'evaluator' });
    installWorkflowStore([instance], instance.id);

    const runAgent = jest.fn(async (agent: WorkflowAgent) => `${agent.id}-output`);
    const engine = new WorkflowEngine({
      createRunDirectory: async () => '/tmp/workflow-run',
      writeFile: async () => undefined,
      runAgent,
      evaluateGoal: async ({ iteration }: { iteration: number }) => ({
        iteration,
        reached: true,
        confidence: 0.9,
        missingItems: [],
        reasoning: 'done',
        timestamp: iteration,
      }),
      notify: async () => undefined,
      now: (() => {
        let current = 1;
        return () => current++;
      })(),
    });

    await engine.start();

    expect(runAgent.mock.calls.map((call: [WorkflowAgent]) => call[0].id)).toEqual(['writer']);
  });

  it('keeps executing the frozen snapshot even if store topology mutates during the run', async () => {
    const writer = createAgent({ id: 'writer', role: 'writer' });
    const developer = createAgent({ id: 'developer', role: 'developer', inputFrom: 'writer' });
    const origin = createInstance(
      'origin',
      [writer, developer],
      [{ id: 'c1', sourceAgentId: 'writer', targetAgentId: 'developer', condition: 'onComplete', type: 'sequential' }],
    );
    const store = installWorkflowStore([origin], origin.id);

    const runAgent = jest.fn(async (agent: WorkflowAgent) => {
      if (agent.id === 'writer') {
        store.instances = store.instances.map((instance) => (
          instance.id === origin.id
            ? {
                ...instance,
                agents: [writer],
                connections: [],
              }
            : instance
        ));
      }
      return `${agent.id}-output`;
    });

    const engine = new WorkflowEngine({
      createRunDirectory: async () => '/tmp/workflow-run',
      writeFile: async () => undefined,
      runAgent,
      evaluateGoal: async ({ iteration }: { iteration: number }) => ({
        iteration,
        reached: true,
        confidence: 0.9,
        missingItems: [],
        reasoning: 'done',
        timestamp: iteration,
      }),
      notify: async () => undefined,
      now: (() => {
        let current = 1;
        return () => current++;
      })(),
    });

    await engine.start();

    expect(runAgent.mock.calls.map((call: [WorkflowAgent]) => call[0].id)).toEqual(['writer', 'developer']);
    expect(store.instances[0].agents).toHaveLength(1);
    expect(store.instances[0].connections).toEqual([]);
    expect(store.instances[0].workflowRuns[0]).toMatchObject({
      status: 'completed',
      reachedGoal: true,
    });
  });

  it('fails the run after exceeding the total step guard', async () => {
    const developer = createAgent({ id: 'developer', role: 'developer', task: 'Implement the feature' });
    const instance = createInstance('origin', [developer], [], { maxGoalIterations: 60, projectGoal: '' });
    const store = installWorkflowStore([instance], instance.id);

    const runAgent = jest.fn(async () => 'developer-output');
    const engine = new WorkflowEngine({
      createRunDirectory: async () => '/tmp/workflow-run',
      writeFile: async () => undefined,
      runAgent,
      evaluateGoal: async ({ iteration }: { iteration: number }) => ({
        iteration,
        reached: false,
        confidence: 0.1,
        missingItems: ['still missing'],
        nextAgentIdHint: 'developer',
        reasoning: 'keep iterating',
        timestamp: iteration,
      }),
      notify: async () => undefined,
      now: (() => {
        let current = 1;
        return () => current++;
      })(),
    });

    await engine.start();

    expect(runAgent).toHaveBeenCalledTimes(50);
    expect(store.instances[0].workflowRuns[0]).toMatchObject({
      status: 'error',
      reachedGoal: false,
    });
    expect(addNotification).toHaveBeenCalledWith('error', expect.stringContaining('最大步数限制'));
  });

  it('blocks start before creating a run when the workflow graph is invalid', async () => {
    const writer = createAgent({ id: 'writer', role: 'writer' });
    const instance = createInstance(
      'invalid',
      [writer],
      [{ id: 'self-loop', sourceAgentId: 'writer', targetAgentId: 'writer', condition: 'onComplete', type: 'sequential' }],
    );
    const store = installWorkflowStore([instance], instance.id);

    const createRunDirectory = jest.fn(async () => '/tmp/workflow-run');
    const runAgent = jest.fn(async () => 'writer-output');
    const engine = new WorkflowEngine({
      createRunDirectory,
      writeFile: async () => undefined,
      runAgent,
      evaluateGoal: async ({ iteration }: { iteration: number }) => ({
        iteration,
        reached: true,
        confidence: 1,
        missingItems: [],
        reasoning: 'done',
        timestamp: iteration,
      }),
      notify: async () => undefined,
      now: (() => {
        let current = 1;
        return () => current++;
      })(),
    });

    await engine.start();

    expect(createRunDirectory).not.toHaveBeenCalled();
    expect(runAgent).not.toHaveBeenCalled();
    expect(store.instances[0].workflowRuns).toEqual([]);
    expect(store.setRunning).not.toHaveBeenCalled();
    expect(addNotification).toHaveBeenCalledWith('error', expect.stringContaining('不能连接到自己'));
  });
});

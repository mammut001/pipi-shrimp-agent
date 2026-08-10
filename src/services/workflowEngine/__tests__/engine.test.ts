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

    const runAgent = jest.fn(async () => 'developer-output [[WORKFLOW:TESTS_FAIL_CODE]]');
    const engine = new WorkflowEngine({
      createRunDirectory: async () => '/tmp/workflow-run',
      writeFile: async () => undefined,
      runAgent,
      evaluateGoal: async ({ iteration }: { iteration: number }) => ({
        iteration,
        reached: false,
        confidence: 0.1,
        missingItems: ['tests failed with error'],
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

  describe('createRunDirectory failure handling', () => {
    function createRunnableEngine(overrides: {
      createRunDirectory?: jest.Mock;
      runAgent?: jest.Mock;
      writeFile?: jest.Mock;
      writeRunFile?: jest.Mock;
    } = {}) {
      const writer = createAgent({ id: 'writer', role: 'writer' });
      const instance = createInstance('origin', [writer], []);
      const store = installWorkflowStore([instance], instance.id);

      const createRunDirectory = overrides.createRunDirectory ?? jest.fn(async () => '/tmp/workflow-run');
      const runAgent = overrides.runAgent ?? jest.fn(async () => 'writer-output');
      const writeFile = overrides.writeFile ?? jest.fn(async () => undefined);
      const writeRunFile = overrides.writeRunFile ?? jest.fn(async () => '/tmp/workflow-run/output.md');

      const engine = new WorkflowEngine({
        createRunDirectory,
        writeFile,
        writeRunFile,
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

      return { engine, store, createRunDirectory, runAgent, writeFile, writeRunFile };
    }

    it('prevents step execution when createRunDirectory fails', async () => {
      const { engine, runAgent } = createRunnableEngine({
        createRunDirectory: jest.fn(async () => {
          throw new Error('disk full');
        }),
      });

      await engine.start();

      expect(runAgent).not.toHaveBeenCalled();
      expect(engine.getIsRunning()).toBe(false);
    });

    it('marks the workflow run as failed with a run-directory error', async () => {
      const { engine, store } = createRunnableEngine({
        createRunDirectory: jest.fn(async () => {
          throw new Error('permission denied');
        }),
      });

      await engine.start();

      expect(store.instances[0].workflowRuns[0]).toMatchObject({
        status: 'error',
        runDirectory: '',
        reachedGoal: false,
      });
      expect(addNotification).toHaveBeenCalledWith(
        'error',
        expect.stringContaining('Failed to create workflow run directory: permission denied'),
      );
    });

    it('clears running state after createRunDirectory failure', async () => {
      const { engine, store } = createRunnableEngine({
        createRunDirectory: jest.fn(async () => {
          throw new Error('disk full');
        }),
      });

      await engine.start();

      expect(store.setRunning).toHaveBeenCalledWith(false, null);
      expect(engine.getIsRunning()).toBe(false);
      expect(engine.getCurrentRunId()).toBe('');
    });

    it('does not write artifacts when createRunDirectory fails', async () => {
      const writeFile = jest.fn(async () => undefined);
      const writeRunFile = jest.fn(async () => '/tmp/workflow-run/output.md');
      const { engine } = createRunnableEngine({
        createRunDirectory: jest.fn(async () => {
          throw new Error('disk full');
        }),
        writeFile,
        writeRunFile,
      });

      await engine.start();

      expect(writeFile).not.toHaveBeenCalled();
      expect(writeRunFile).not.toHaveBeenCalled();
    });

    it('allows starting again after createRunDirectory failure', async () => {
      let attempts = 0;
      const createRunDirectory = jest.fn(async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error('disk full');
        }
        return '/tmp/workflow-run-2';
      });
      const runAgent = jest.fn(async () => 'writer-output');
      const { engine } = createRunnableEngine({ createRunDirectory, runAgent });

      await engine.start();
      expect(runAgent).not.toHaveBeenCalled();
      expect(engine.getIsRunning()).toBe(false);

      await engine.start();
      expect(runAgent).toHaveBeenCalled();
      expect(engine.getIsRunning()).toBe(false);
    });
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

  describe('stop() cancels in-flight invoke (R6-02)', () => {
    function createTwoAgentEngine(overrides: {
      runAgent?: jest.Mock;
      writeRunFile?: jest.Mock;
      evaluateGoal?: jest.Mock;
    } = {}) {
      const writer = createAgent({ id: 'writer', role: 'writer' });
      const developer = createAgent({
        id: 'developer',
        role: 'developer',
        inputFrom: 'writer',
      });
      const instance = createInstance(
        'origin',
        [writer, developer],
        [{
          id: 'c1',
          sourceAgentId: 'writer',
          targetAgentId: 'developer',
          condition: 'onComplete',
          type: 'sequential',
        }],
      );
      const store = installWorkflowStore([instance], instance.id);

      const runAgent = overrides.runAgent ?? jest.fn(async (agent: WorkflowAgent) => `${agent.id}-output`);
      const writeRunFile = overrides.writeRunFile ?? jest.fn(async () => '/tmp/workflow-run/output.md');
      const evaluateGoal = overrides.evaluateGoal ?? jest.fn(async ({ iteration }: { iteration: number }) => ({
        iteration,
        reached: true,
        confidence: 1,
        missingItems: [],
        reasoning: 'done',
        timestamp: iteration,
      }));

      const engine = new WorkflowEngine({
        createRunDirectory: async () => '/tmp/workflow-run',
        writeRunFile,
        runAgent,
        evaluateGoal,
        notify: async () => undefined,
        now: (() => {
          let current = 1;
          return () => current++;
        })(),
      });

      return { engine, store, instance, runAgent, writeRunFile, evaluateGoal };
    }

    it('stop_aborts_or_ignores_in_flight_invoke_result', async () => {
      let resolveFirstAgent!: (value: string) => void;
      const firstAgentPromise = new Promise<string>((resolve) => {
        resolveFirstAgent = resolve;
      });

      const runAgent = jest.fn((agent: WorkflowAgent) => (
        agent.id === 'writer' ? firstAgentPromise : Promise.resolve('developer-output')
      ));
      const { engine, store } = createTwoAgentEngine({ runAgent });

      const startPromise = engine.start();
      await Promise.resolve();
      await engine.stop();
      resolveFirstAgent('late-writer-output');
      await startPromise;

      expect(store.instances[0].workflowRuns[0].agents.find((entry) => entry.agentId === 'writer')?.output).toBeUndefined();
      expect(runAgent).toHaveBeenCalledTimes(1);
    });

    it('stop_prevents_next_step_start', async () => {
      let resolveFirstAgent!: (value: string) => void;
      const firstAgentPromise = new Promise<string>((resolve) => {
        resolveFirstAgent = resolve;
      });

      const runAgent = jest.fn((agent: WorkflowAgent) => (
        agent.id === 'writer' ? firstAgentPromise : Promise.resolve('developer-output')
      ));
      const { engine } = createTwoAgentEngine({ runAgent });

      const startPromise = engine.start();
      await Promise.resolve();
      await engine.stop();
      resolveFirstAgent('writer-output');
      await startPromise;

      expect(runAgent).toHaveBeenCalledTimes(1);
      expect(runAgent.mock.calls[0][0].id).toBe('writer');
    });

    it('stop_prevents_artifact_write_after_late_result', async () => {
      let resolveFirstAgent!: (value: string) => void;
      const firstAgentPromise = new Promise<string>((resolve) => {
        resolveFirstAgent = resolve;
      });
      const writeRunFile = jest.fn(async () => '/tmp/workflow-run/output.md');
      const runAgent = jest.fn((agent: WorkflowAgent) => (
        agent.id === 'writer' ? firstAgentPromise : Promise.resolve('developer-output')
      ));
      const { engine } = createTwoAgentEngine({ runAgent, writeRunFile });

      const startPromise = engine.start();
      await Promise.resolve();
      await engine.stop();
      resolveFirstAgent('late-writer-output');
      await startPromise;

      expect(writeRunFile).not.toHaveBeenCalled();
    });

    it('stop_keeps_run_status_stopped', async () => {
      let resolveFirstAgent!: (value: string) => void;
      const firstAgentPromise = new Promise<string>((resolve) => {
        resolveFirstAgent = resolve;
      });
      const runAgent = jest.fn((agent: WorkflowAgent) => (
        agent.id === 'writer' ? firstAgentPromise : Promise.resolve('developer-output')
      ));
      const { engine, store } = createTwoAgentEngine({ runAgent });

      const startPromise = engine.start();
      await Promise.resolve();
      await engine.stop();
      resolveFirstAgent('late-writer-output');
      await startPromise;

      expect(store.instances[0].workflowRuns[0]).toMatchObject({
        status: 'stopped',
        reachedGoal: false,
      });
    });

    it('stop_clears_isRunning', async () => {
      let resolveFirstAgent!: (value: string) => void;
      const firstAgentPromise = new Promise<string>((resolve) => {
        resolveFirstAgent = resolve;
      });
      const runAgent = jest.fn(() => firstAgentPromise);
      const { engine } = createTwoAgentEngine({ runAgent });

      const startPromise = engine.start();
      await Promise.resolve();
      await engine.stop();
      expect(engine.getIsRunning()).toBe(false);
      resolveFirstAgent('writer-output');
      await startPromise;
      expect(engine.getIsRunning()).toBe(false);
    });

    it('stop_is_idempotent', async () => {
      let resolveFirstAgent!: (value: string) => void;
      const firstAgentPromise = new Promise<string>((resolve) => {
        resolveFirstAgent = resolve;
      });
      const runAgent = jest.fn(() => firstAgentPromise);
      const { engine, store } = createTwoAgentEngine({ runAgent });

      const startPromise = engine.start();
      await Promise.resolve();
      await expect(engine.stop()).resolves.toBeUndefined();
      await expect(engine.stop()).resolves.toBeUndefined();
      resolveFirstAgent('writer-output');
      await startPromise;

      expect(store.instances[0].workflowRuns[0].status).toBe('stopped');
      expect(engine.getIsRunning()).toBe(false);
    });

    it('success_path_unchanged', async () => {
      const { engine, store } = createTwoAgentEngine();

      await engine.start();

      expect(store.instances[0].workflowRuns[0]).toMatchObject({
        status: 'completed',
        reachedGoal: true,
      });
      expect(engine.getIsRunning()).toBe(false);
    });

    it('can_start_again_after_stop', async () => {
      let resolveFirstAgent!: (value: string) => void;
      const firstAgentPromise = new Promise<string>((resolve) => {
        resolveFirstAgent = resolve;
      });
      const runAgent = jest.fn((agent: WorkflowAgent) => (
        agent.id === 'writer' ? firstAgentPromise : Promise.resolve('developer-output')
      ));
      const { engine, store } = createTwoAgentEngine({ runAgent });

      const firstStart = engine.start();
      await Promise.resolve();
      await engine.stop();
      resolveFirstAgent('writer-output');
      await firstStart;

      await engine.start();

      const runs = store.instances[0].workflowRuns;
      expect(runs).toHaveLength(2);
      expect(runs.find((run) => run.status === 'stopped')).toBeDefined();
      expect(runs.find((run) => run.status === 'completed')).toMatchObject({
        reachedGoal: true,
      });
      expect(engine.getIsRunning()).toBe(false);
    });

    it('signal_is_aborted_on_stop', async () => {
      let resolveFirstAgent!: (value: string) => void;
      const firstAgentPromise = new Promise<string>((resolve) => {
        resolveFirstAgent = resolve;
      });
      let capturedSignal: AbortSignal | undefined;
      const runAgent = jest.fn((_agent: WorkflowAgent, _prompt: string, context: { signal?: AbortSignal }) => {
        capturedSignal = context.signal;
        return firstAgentPromise;
      });
      const { engine } = createTwoAgentEngine({ runAgent });

      const startPromise = engine.start();
      await Promise.resolve();
      expect(capturedSignal?.aborted).toBe(false);
      await engine.stop();
      resolveFirstAgent('writer-output');
      await startPromise;
    });

    it('does not overwrite completed status of task agent during goal evaluation when goalEvaluatorAgentId is set to task agent', async () => {
      const runAgent = jest.fn((agent: WorkflowAgent) => Promise.resolve(`${agent.name}-output`));
      const evaluateGoal = jest.fn(async () => ({
        iteration: 1,
        reached: true,
        confidence: 0.9,
        missingItems: [],
        reasoning: 'Goal met',
        timestamp: Date.now(),
      }));

      const { engine, store } = createTwoAgentEngine({ runAgent, evaluateGoal });
      const instance = store.instances[0];
      instance.goalEvaluatorAgentId = 'writer';

      await engine.start();

      const runWriter = store.instances[0].workflowRuns[0].agents.find((a) => a.agentId === 'writer');
      expect(runWriter?.status).toBe('completed');
      expect(store.instances[0].workflowRuns[0].status).toBe('completed');
    });

    it('resumes and completes execution loop when goal evaluation succeeds after a long response', async () => {
      const runAgent = jest.fn((agent: WorkflowAgent) => Promise.resolve(`${agent.name}-output`));
      const evaluateGoal = jest.fn(async ({ iteration }: { iteration: number }) => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return {
          iteration,
          reached: true,
          confidence: 1,
          missingItems: [],
          reasoning: 'Goal completed after long evaluation response',
          timestamp: Date.now(),
        };
      });

      const { engine, store } = createTwoAgentEngine({ runAgent, evaluateGoal });

      await engine.start();

      expect(evaluateGoal).toHaveBeenCalled();
      expect(store.instances[0].workflowRuns[0].status).toBe('completed');
      expect(store.instances[0].workflowRuns[0].reachedGoal).toBe(true);
      expect(engine.getIsRunning()).toBe(false);
    });

    it('advances execution loop to next agent (B) after goal evaluation promise completes with reached false', async () => {
      const executedAgentIds: string[] = [];
      const runAgent = jest.fn(async (agent: WorkflowAgent) => {
        executedAgentIds.push(agent.id);
        if (agent.id === 'developer' && executedAgentIds.filter((id) => id === 'developer').length === 1) {
          return `${agent.id}-output [[WORKFLOW:TESTS_FAIL_CODE]]`;
        }
        return `${agent.id}-output`;
      });

      const evaluateGoal = jest.fn(async ({ iteration }: { iteration: number }) => ({
        iteration,
        reached: iteration >= 2,
        confidence: iteration >= 2 ? 1 : 0.5,
        missingItems: iteration >= 2 ? [] : ['Step 2 pending error'],
        reasoning: iteration >= 2 ? 'Goal met' : 'Goal not met yet',
        timestamp: Date.now(),
      }));

      const { engine, store } = createTwoAgentEngine({ runAgent, evaluateGoal });

      await engine.start();

      expect(executedAgentIds).toEqual(['writer', 'developer', 'developer']);
      expect(evaluateGoal).toHaveBeenCalledTimes(2);

      const run = store.instances[0].workflowRuns[0];
      expect(run.status).toBe('completed');
      expect(run.reachedGoal).toBe(true);
      expect(run.currentIteration).toBe(2);

      const writerRun = run.agents.find((a) => a.agentId === 'writer');
      const developerRun = run.agents.find((a) => a.agentId === 'developer');
      expect(writerRun?.status).toBe('completed');
      expect(developerRun?.status).toBe('completed');
    });

    it('recovers cleanly from malformed_tool_call in goal evaluator turn without infinite re-entry loop', async () => {
      const executedAgentIds: string[] = [];
      const runAgent = jest.fn(async (agent: WorkflowAgent) => {
        executedAgentIds.push(agent.id);
        return `${agent.id}-output`;
      });

      const evaluateGoal = jest.fn(async ({ iteration }: { iteration: number }) => {
        if (iteration === 1) {
          throw new Error('Chat request failed: malformed_tool_call');
        }
        return {
          iteration,
          reached: true,
          confidence: 1.0,
          missingItems: [],
          reasoning: 'Goal met',
          timestamp: Date.now(),
        };
      });

      const { engine, store } = createTwoAgentEngine({ runAgent, evaluateGoal });

      await engine.start();

      expect(executedAgentIds).toEqual(['writer', 'developer']);
      const run = store.instances[0].workflowRuns[0];
      expect(run.status).toBe('completed');
      expect(run.reachedGoal).toBe(true);
    });
  });
});

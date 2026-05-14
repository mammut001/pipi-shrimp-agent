import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const STORAGE_KEY = 'pipi-workflow-v2';
const addNotification = jest.fn();
const localStorageMock = {
  data: {} as Record<string, string>,
  getItem: jest.fn((key: string) => localStorageMock.data[key] ?? null),
  setItem: jest.fn((key: string, value: string) => {
    localStorageMock.data[key] = value;
  }),
  removeItem: jest.fn((key: string) => {
    delete localStorageMock.data[key];
  }),
};

Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  writable: true,
});

jest.mock('@/store/uiStore', () => ({
  useUIStore: {
    getState: () => ({ addNotification }),
  },
}));

async function loadWorkflowStoreModule() {
  jest.resetModules();
  return import('../workflowStore');
}

describe('workflowStore', () => {
  beforeEach(() => {
    localStorageMock.data = {};
    localStorageMock.getItem.mockClear();
    localStorageMock.setItem.mockClear();
    localStorageMock.removeItem.mockClear();
    addNotification.mockClear();
  });

  it('creates instances with complete default metadata', async () => {
    const { useWorkflowStore } = await loadWorkflowStoreModule();

    const instance = useWorkflowStore.getState().createInstance('Test Workflow');

    expect(instance).toMatchObject({
      name: 'Test Workflow',
      projectGoal: '',
      successCriteria: '',
      goalEvaluatorAgentId: null,
      maxGoalIterations: 5,
      activeRunId: null,
      dirtyAgentIds: [],
    });
    expect(useWorkflowStore.getState().getCurrentInstance()?.id).toBe(instance.id);
  });

  it('persists projectGoal and successCriteria via updateInstanceMeta', async () => {
    const { useWorkflowStore } = await loadWorkflowStoreModule();

    const instance = useWorkflowStore.getState().createInstance('Persistent Workflow');
    useWorkflowStore.getState().updateInstanceMeta(instance.id, {
      projectGoal: 'Ship diagnostics hardening',
      successCriteria: 'Typecheck, tests, and lint pass',
      goalEvaluatorAgentId: null,
      maxGoalIterations: 7,
    });

    const persisted = JSON.parse(localStorageMock.data[STORAGE_KEY]);
    expect(persisted.instances[0]).toMatchObject({
      projectGoal: 'Ship diagnostics hardening',
      successCriteria: 'Typecheck, tests, and lint pass',
      maxGoalIterations: 7,
    });
  });

  it('marks and clears dirty agents without duplicates', async () => {
    const { useWorkflowStore } = await loadWorkflowStoreModule();

    useWorkflowStore.getState().createInstance('Dirty Workflow');
    const agent = useWorkflowStore.getState().addAgent({ name: 'Developer', role: 'developer' });

    useWorkflowStore.getState().markAgentDirty(agent.id);
    useWorkflowStore.getState().markAgentDirty(agent.id);
    expect(useWorkflowStore.getState().getCurrentInstance()?.dirtyAgentIds).toEqual([agent.id]);

    useWorkflowStore.getState().clearAgentDirty(agent.id);
    expect(useWorkflowStore.getState().getCurrentInstance()?.dirtyAgentIds).toEqual([]);
  });

  it('appends goal evaluations to the requested run', async () => {
    const { useWorkflowStore } = await loadWorkflowStoreModule();

    useWorkflowStore.getState().createInstance('Goal Workflow');
    useWorkflowStore.getState().addWorkflowRun({
      id: 'run-1',
      title: 'Run 1',
      projectGoal: 'Ship it',
      successCriteria: 'All checks green',
      status: 'running',
      startTime: 1,
      agents: [],
      currentIteration: 0,
      goalEvaluations: [],
      reachedGoal: false,
    });

    useWorkflowStore.getState().appendGoalEvaluation('run-1', {
      iteration: 2,
      reached: true,
      confidence: 0.9,
      missingItems: [],
      reasoning: 'Goal reached.',
      timestamp: 2,
    });

    const run = useWorkflowStore.getState().getCurrentInstance()?.workflowRuns[0];
    expect(run).toMatchObject({
      id: 'run-1',
      currentIteration: 2,
      reachedGoal: true,
    });
    expect(run?.goalEvaluations).toHaveLength(1);
  });

  it('removing an agent cleans graph edges, dirty ids, routes, and input relations', async () => {
    const {
      selectAgentIncomingConnections,
      useWorkflowStore,
    } = await loadWorkflowStoreModule();

    useWorkflowStore.getState().createInstance('Cleanup Workflow');
    const writer = useWorkflowStore.getState().addAgent({ name: 'Writer', role: 'writer' });
    const developer = useWorkflowStore.getState().addAgent({ name: 'Developer', role: 'developer', inputFrom: writer.id });
    const qa = useWorkflowStore.getState().addAgent({ name: 'QA', role: 'qa' });

    useWorkflowStore.getState().addOutputRoute(writer.id, {
      condition: 'outputContains',
      keyword: '[[WORKFLOW:REVIEW_REJECT]]',
      keywordMode: 'includes',
      targetAgentId: qa.id,
    });
    useWorkflowStore.getState().markAgentDirty(writer.id);
    useWorkflowStore.getState().markAgentDirty(developer.id);
    useWorkflowStore.getState().removeAgent(writer.id);

    const instance = useWorkflowStore.getState().getCurrentInstance();
    expect(instance?.connections).toHaveLength(0);
    expect(instance?.dirtyAgentIds).toEqual([developer.id]);
    expect(instance?.agents.find((agent) => agent.id === developer.id)?.inputFrom).toBeNull();
    expect(selectAgentIncomingConnections(instance ?? null, qa.id)).toHaveLength(0);
  });

  it('supports multi-upstream and one-to-many canonical connections without duplicate edges', async () => {
    const {
      selectAgentIncomingConnections,
      selectAgentOutgoingConnections,
      useWorkflowStore,
    } = await loadWorkflowStoreModule();

    useWorkflowStore.getState().createInstance('Graph Workflow');
    const agentA = useWorkflowStore.getState().addAgent({ name: 'A', role: 'writer' });
    const agentB = useWorkflowStore.getState().addAgent({ name: 'B', role: 'developer' });
    const agentC = useWorkflowStore.getState().addAgent({ name: 'C', role: 'qa' });

    useWorkflowStore.getState().addConnection(agentA.id, agentB.id, 'onComplete');
    useWorkflowStore.getState().addConnection(agentA.id, agentB.id, 'onComplete');
    useWorkflowStore.getState().addConnection(agentA.id, agentC.id, 'onComplete');
    useWorkflowStore.getState().addConnection(agentB.id, agentC.id, 'onComplete');

    const instance = useWorkflowStore.getState().getCurrentInstance();
    expect(instance?.connections).toHaveLength(3);
    expect(selectAgentOutgoingConnections(instance ?? null, agentA.id)).toHaveLength(2);
    expect(selectAgentIncomingConnections(instance ?? null, agentC.id)).toHaveLength(2);
    expect(instance?.agents.find((agent) => agent.id === agentC.id)?.inputFrom).toBeNull();
  });

  it('stores outputContains routes on canonical connections and cleans derived input when an edge is removed', async () => {
    const {
      selectAgentIncomingConnections,
      selectAgentOutputRoutes,
      useWorkflowStore,
    } = await loadWorkflowStoreModule();

    useWorkflowStore.getState().createInstance('Route Workflow');
    const reviewer = useWorkflowStore.getState().addAgent({ name: 'Reviewer', role: 'reviewer' });
    const developer = useWorkflowStore.getState().addAgent({ name: 'Developer', role: 'developer' });

    useWorkflowStore.getState().addOutputRoute(reviewer.id, {
      condition: 'outputContains',
      keyword: '[[WORKFLOW:REVIEW_REJECT]]',
      keywordMode: 'regex',
      targetAgentId: developer.id,
    });

    let instance = useWorkflowStore.getState().getCurrentInstance();
    expect(selectAgentOutputRoutes(instance ?? null, reviewer.id)).toContainEqual(expect.objectContaining({
      condition: 'outputContains',
      keyword: '[[WORKFLOW:REVIEW_REJECT]]',
      keywordMode: 'regex',
      targetAgentId: developer.id,
    }));

    const primaryConnection = useWorkflowStore.getState().addConnection(reviewer.id, developer.id, 'onComplete');
    instance = useWorkflowStore.getState().getCurrentInstance();
    expect(instance?.agents.find((agent) => agent.id === developer.id)?.inputFrom).toBe(reviewer.id);

    useWorkflowStore.getState().removeConnection(primaryConnection.id);
    instance = useWorkflowStore.getState().getCurrentInstance();
    expect(selectAgentIncomingConnections(instance ?? null, developer.id)).toHaveLength(1);
    expect(instance?.agents.find((agent) => agent.id === developer.id)?.inputFrom).toBeNull();
  });

  it('switching inputFrom rewrites the canonical primary edge consistently', async () => {
    const {
      selectAgentIncomingConnections,
      selectAgentOutgoingConnections,
      useWorkflowStore,
    } = await loadWorkflowStoreModule();

    useWorkflowStore.getState().createInstance('Input Rewrite Workflow');
    const writer = useWorkflowStore.getState().addAgent({ name: 'Writer', role: 'writer' });
    const reviewer = useWorkflowStore.getState().addAgent({ name: 'Reviewer', role: 'reviewer' });
    const developer = useWorkflowStore.getState().addAgent({ name: 'Developer', role: 'developer' });

    useWorkflowStore.getState().setAgentInputFrom(developer.id, writer.id);
    useWorkflowStore.getState().setAgentInputFrom(developer.id, reviewer.id);

    const instance = useWorkflowStore.getState().getCurrentInstance();
    expect(instance?.agents.find((agent) => agent.id === developer.id)?.inputFrom).toBe(reviewer.id);
    expect(selectAgentIncomingConnections(instance ?? null, developer.id)).toEqual([
      expect.objectContaining({ sourceAgentId: reviewer.id, targetAgentId: developer.id }),
    ]);
    expect(selectAgentOutgoingConnections(instance ?? null, writer.id)).toHaveLength(0);
  });

  it('deleting the selected latest run falls back to the nearest remaining run', async () => {
    const { useWorkflowStore } = await loadWorkflowStoreModule();

    useWorkflowStore.getState().createInstance('Run History Workflow');
    useWorkflowStore.getState().addWorkflowRun({
      id: 'run-1',
      title: 'Run 1',
      projectGoal: 'Goal 1',
      successCriteria: '',
      status: 'completed',
      startTime: 1,
      agents: [],
      currentIteration: 1,
      goalEvaluations: [],
      reachedGoal: true,
    });
    useWorkflowStore.getState().addWorkflowRun({
      id: 'run-2',
      title: 'Run 2',
      projectGoal: 'Goal 2',
      successCriteria: '',
      status: 'completed',
      startTime: 2,
      agents: [],
      currentIteration: 1,
      goalEvaluations: [],
      reachedGoal: true,
    });

    expect(useWorkflowStore.getState().selectedRunId).toBe('run-2');

    useWorkflowStore.getState().deleteWorkflowRun('run-2');

    expect(useWorkflowStore.getState().selectedRunId).toBe('run-1');
    expect(useWorkflowStore.getState().getCurrentInstance()?.workflowRuns.map((run) => run.id)).toEqual(['run-1']);
  });

  it('updates run history on the originating instance even after switching current instance', async () => {
    const { useWorkflowStore } = await loadWorkflowStoreModule();

    const origin = useWorkflowStore.getState().createInstance('Origin Workflow');
    useWorkflowStore.getState().addWorkflowRun({
      id: 'run-origin',
      title: 'Origin Run',
      projectGoal: 'Ship origin workflow',
      successCriteria: '',
      status: 'running',
      startTime: 1,
      agents: [],
      currentIteration: 0,
      goalEvaluations: [],
      reachedGoal: false,
    });

    const other = useWorkflowStore.getState().createInstance('Other Workflow');
    useWorkflowStore.getState().selectInstance(other.id);
    useWorkflowStore.getState().updateWorkflowRun('run-origin', {
      status: 'completed',
      reachedGoal: true,
    });

    const state = useWorkflowStore.getState();
    const originRun = state.instances.find((instance) => instance.id === origin.id)?.workflowRuns[0];
    const otherRuns = state.instances.find((instance) => instance.id === other.id)?.workflowRuns;

    expect(originRun).toMatchObject({
      id: 'run-origin',
      status: 'completed',
      reachedGoal: true,
    });
    expect(otherRuns).toEqual([]);
  });

  it('blocks topology mutations while a workflow run is active', async () => {
    const { useWorkflowStore } = await loadWorkflowStoreModule();

    useWorkflowStore.getState().createInstance('Locked Workflow');
    const writer = useWorkflowStore.getState().addAgent({ name: 'Writer', role: 'writer' });
    const developer = useWorkflowStore.getState().addAgent({ name: 'Developer', role: 'developer' });

    useWorkflowStore.getState().setRunning(true, writer.id);
    useWorkflowStore.getState().addConnection(writer.id, developer.id, 'onComplete');
    useWorkflowStore.getState().removeAgent(writer.id);

    const instance = useWorkflowStore.getState().getCurrentInstance();
    expect(instance?.agents.map((agent) => agent.id)).toEqual([writer.id, developer.id]);
    expect(instance?.connections).toHaveLength(0);
    expect(addNotification).toHaveBeenCalled();
  });
});
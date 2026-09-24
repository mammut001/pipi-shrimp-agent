/**
 * AG-11: behavior + source-guard tests for the action slices extracted from
 * `src/store/workflowStore.ts` (`workflowAgentActions.ts`, `workflowConnectionActions.ts`).
 */
import fs from 'fs';
import path from 'path';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import * as workflowStoreModule from '../workflowStore';
import { useWorkflowStore } from '../workflowStore';
import type { WorkflowStore } from '../workflowStore';
import { createWorkflowAgentActions } from '../workflowAgentActions';
import { createWorkflowConnectionActions } from '../workflowConnectionActions';

const STORAGE_KEY = 'pipi-workflow-v2';
const addNotification = jest.fn();

jest.mock('@/store/uiStore', () => ({
  useUIStore: {
    getState: () => ({ addNotification }),
  },
}));

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

const pristineState = { ...useWorkflowStore.getState() };

function resetStore() {
  useWorkflowStore.setState({
    ...pristineState,
    instances: [],
    currentInstanceId: null,
    isRunning: false,
    currentRunningAgentId: null,
    selectedRunId: null,
    selectedPreviewFile: null,
  }, true);
}

function persisted() {
  return JSON.parse(localStorageMock.data[STORAGE_KEY] ?? '{}');
}

function currentInstance() {
  return useWorkflowStore.getState().getCurrentInstanceOrThrow();
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    value: localStorageMock,
    writable: true,
    configurable: true,
  });
  localStorageMock.data = {};
  localStorageMock.getItem.mockClear();
  localStorageMock.setItem.mockClear();
  localStorageMock.removeItem.mockClear();
  addNotification.mockClear();
  resetStore();
});

const AGENT_ACTION_KEYS = [
  'addAgent',
  'updateAgent',
  'removeAgent',
  'updateAgentPosition',
  'updateAgentSize',
  'setAgentStatus',
  'setAgentStatusInInstance',
  'setAgentInputFrom',
  'markAgentDirty',
  'markAgentDirtyInInstance',
  'clearAgentDirty',
  'clearAgentDirtyInInstance',
];

const CONNECTION_ACTION_KEYS = [
  'addConnection',
  'removeConnection',
  'addOutputRoute',
  'updateOutputRoute',
  'removeOutputRoute',
];

// Store object key order on main (f73d53c) — the slices are spread at the exact
// position the inline actions used to occupy, so enumeration order is unchanged.
const MAIN_STORE_KEY_ORDER = [
  'instances', 'currentInstanceId', 'isRunning', 'currentRunningAgentId', 'selectedRunId', 'selectedPreviewFile',
  'createInstance', 'deleteInstance', 'deleteInstances', 'renameInstance', 'selectInstance',
  'getCurrentInstance', 'getCurrentInstanceOrThrow', 'updateInstanceMeta',
  ...AGENT_ACTION_KEYS,
  ...CONNECTION_ACTION_KEYS,
  'addWorkflowRun', 'updateWorkflowRun', 'renameWorkflowRun', 'deleteWorkflowRun',
  'updateRunAgent', 'appendGoalEvaluation', 'selectRun', 'setActiveRunId',
  'setRunning', 'resetAllStatuses', 'setSelectedPreviewFile', 'clearCanvas', 'createA_B_C_Workflow',
];

describe('slice factories', () => {
  it('createWorkflowAgentActions returns exactly the agent actions, without touching set/get', () => {
    const set = jest.fn();
    const get = jest.fn();
    const slice = createWorkflowAgentActions(set as never, get as never);
    expect(Object.keys(slice)).toEqual(AGENT_ACTION_KEYS);
    expect(set).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  it('createWorkflowConnectionActions returns exactly the connection/output-route actions', () => {
    const set = jest.fn();
    const get = jest.fn();
    const slice = createWorkflowConnectionActions(set as never, get as never);
    expect(Object.keys(slice)).toEqual(CONNECTION_ACTION_KEYS);
    expect(set).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  it('store keeps the same key set and enumeration order as main', () => {
    expect(Object.keys(useWorkflowStore.getState())).toEqual(MAIN_STORE_KEY_ORDER);
  });

  it('module runtime exports are unchanged', () => {
    expect(Object.keys(workflowStoreModule).sort()).toEqual([
      'dedupeConnections',
      'normalizeWorkflowGraph',
      'rebuildInputFromFromConnections',
      'removeDanglingConnections',
      'selectAgentIncomingConnections',
      'selectAgentOutgoingConnections',
      'selectAgentOutputRoutes',
      'useWorkflowStore',
    ]);
  });
});

describe('agent actions (via useWorkflowStore)', () => {
  it('addAgent reads state via get() before a single synchronous set that persists', () => {
    const state = useWorkflowStore.getState();
    state.createInstance('W');
    localStorageMock.setItem.mockClear();

    const agent = useWorkflowStore.getState().addAgent({ name: 'A' });
    expect(agent).not.toBeInstanceOf(Promise);
    // State + persistence updated synchronously (no microtask needed).
    expect(currentInstance().agents.map((a) => a.id)).toEqual([agent.id]);
    expect(localStorageMock.setItem).toHaveBeenCalledTimes(1);
    expect(persisted().instances[0].agents[0].id).toBe(agent.id);
    expect(agent).toMatchObject({
      name: 'A',
      position: { x: 100, y: 200 },
      status: 'idle',
      inputFrom: null,
      role: 'custom',
      outputRoutes: [],
      notifyOnComplete: [],
    });
    const second = useWorkflowStore.getState().addAgent({ name: '' });
    expect(second.name).toBe('New Agent');
    expect(second.position).toEqual({ x: 360, y: 200 });
  });

  it('topology mutations are blocked while running with the same notification and no persistence', () => {
    useWorkflowStore.getState().createInstance('W');
    const a = useWorkflowStore.getState().addAgent({ name: 'A' });
    useWorkflowStore.getState().setRunning(true);
    localStorageMock.setItem.mockClear();

    const blocked = useWorkflowStore.getState().addAgent({ name: 'B' });
    expect(blocked.name).toBe('B');
    useWorkflowStore.getState().removeAgent(a.id);
    useWorkflowStore.getState().setAgentInputFrom(a.id, null);

    expect(currentInstance().agents.map((x) => x.id)).toEqual([a.id]);
    expect(localStorageMock.setItem).not.toHaveBeenCalled();
    expect(addNotification).toHaveBeenCalledTimes(3);
    expect(addNotification).toHaveBeenCalledWith('warning', '工作流运行中，当前不能修改拓扑结构。');
  });

  it('removeAgent drops its connections and dirty flag', () => {
    useWorkflowStore.getState().createInstance('W');
    const s = useWorkflowStore.getState();
    const a = s.addAgent({ name: 'A' });
    const b = s.addAgent({ name: 'B' });
    s.addConnection(a.id, b.id, 'onComplete');
    s.markAgentDirty(b.id);
    s.markAgentDirty(a.id);
    s.removeAgent(b.id);
    const inst = currentInstance();
    expect(inst.agents.map((x) => x.id)).toEqual([a.id]);
    expect(inst.connections).toEqual([]);
    expect(inst.dirtyAgentIds).toEqual([a.id]);
  });

  it('updateAgent ignores inputFrom/outputRoutes and normalizes', () => {
    useWorkflowStore.getState().createInstance('W');
    const a = useWorkflowStore.getState().addAgent({ name: 'A' });
    useWorkflowStore.getState().updateAgent(a.id, { name: 'Renamed', inputFrom: 'x', outputRoutes: [] });
    const agent = currentInstance().agents[0];
    expect(agent.name).toBe('Renamed');
    expect(agent.inputFrom).toBeNull();
  });

  it('position/size/status updates; status changes are not persisted', () => {
    const inst = useWorkflowStore.getState().createInstance('W');
    const a = useWorkflowStore.getState().addAgent({ name: 'A' });
    useWorkflowStore.getState().updateAgentPosition(a.id, { x: 5, y: 6 });
    useWorkflowStore.getState().updateAgentSize(a.id, 10, 20);
    localStorageMock.setItem.mockClear();
    useWorkflowStore.getState().setAgentStatus(a.id, 'running');
    expect(currentInstance().agents[0]).toMatchObject({ position: { x: 5, y: 6 }, width: 10, height: 20, status: 'running' });
    useWorkflowStore.getState().setAgentStatusInInstance(inst.id, a.id, 'completed');
    expect(currentInstance().agents[0].status).toBe('completed');
    expect(localStorageMock.setItem).not.toHaveBeenCalled();
  });

  it('setAgentInputFrom replaces the sequential onComplete incoming edge', () => {
    useWorkflowStore.getState().createInstance('W');
    const s = useWorkflowStore.getState();
    const a = s.addAgent({ name: 'A' });
    const b = s.addAgent({ name: 'B' });
    const c = s.addAgent({ name: 'C' });
    s.setAgentInputFrom(c.id, a.id);
    s.setAgentInputFrom(c.id, b.id);
    let inst = currentInstance();
    expect(inst.connections.map((x) => [x.sourceAgentId, x.targetAgentId])).toEqual([[b.id, c.id]]);
    expect(inst.agents.find((x) => x.id === c.id)?.inputFrom).toBe(b.id);
    s.addConnection(a.id, b.id, 'onComplete');
    s.setAgentInputFrom(c.id, null);
    inst = currentInstance();
    expect(inst.connections.map((x) => [x.sourceAgentId, x.targetAgentId])).toEqual([[a.id, b.id]]);
    expect(inst.agents.find((x) => x.id === c.id)?.inputFrom).toBeNull();
  });

  it('mark/clear dirty (current + by instance) dedupe and persist', () => {
    const inst = useWorkflowStore.getState().createInstance('W');
    const s = useWorkflowStore.getState();
    s.markAgentDirty('x');
    s.markAgentDirty('x');
    s.markAgentDirtyInInstance(inst.id, 'y');
    expect(currentInstance().dirtyAgentIds).toEqual(['x', 'y']);
    s.clearAgentDirty('x');
    s.clearAgentDirtyInInstance(inst.id, 'y');
    expect(currentInstance().dirtyAgentIds).toEqual([]);
    expect(persisted().instances[0].dirtyAgentIds).toEqual([]);
  });
});

describe('connection + output-route actions (via useWorkflowStore)', () => {
  it('addConnection de-duplicates by signature and returns the existing edge without saving', () => {
    useWorkflowStore.getState().createInstance('W');
    const s = useWorkflowStore.getState();
    const a = s.addAgent({ name: 'A' });
    const b = s.addAgent({ name: 'B' });
    const first = s.addConnection(a.id, b.id, 'onComplete');
    localStorageMock.setItem.mockClear();
    const dup = s.addConnection(a.id, b.id, 'onComplete');
    expect(dup).toBe(currentInstance().connections[0]);
    expect(dup.id).toBe(first.id);
    expect(localStorageMock.setItem).not.toHaveBeenCalled();
    expect(currentInstance().connections).toHaveLength(1);
  });

  it('addConnection while running notifies and returns the unsaved edge', () => {
    useWorkflowStore.getState().createInstance('W');
    useWorkflowStore.getState().setRunning(true);
    const edge = useWorkflowStore.getState().addConnection('a', 'b', 'onComplete', { type: 'parallel' });
    expect(edge).toMatchObject({ sourceAgentId: 'a', targetAgentId: 'b', condition: 'onComplete', type: 'parallel' });
    expect(currentInstance().connections).toEqual([]);
    expect(addNotification).toHaveBeenCalledTimes(1);
  });

  it('addOutputRoute delegates to addConnection via get(); update/remove route', () => {
    useWorkflowStore.getState().createInstance('W');
    const s = useWorkflowStore.getState();
    const a = s.addAgent({ name: 'A' });
    const b = s.addAgent({ name: 'B' });
    const c = s.addAgent({ name: 'C' });
    const keep = s.addConnection(b.id, c.id, 'onComplete');
    s.addOutputRoute(a.id, { targetAgentId: b.id, condition: 'outputContains', keyword: ' ok ', keywordMode: 'includes' });
    const edge = currentInstance().connections[1];
    expect(edge).toMatchObject({ sourceAgentId: a.id, targetAgentId: b.id, condition: 'outputContains', keyword: 'ok', keywordMode: 'includes', type: 'sequential' });

    s.updateOutputRoute(a.id, edge.id, { targetAgentId: c.id, keyword: 'go' });
    expect(currentInstance().connections[1]).toMatchObject({ id: edge.id, targetAgentId: c.id, keyword: 'go', condition: 'outputContains' });

    // Unknown route id is a no-op (no removeConnection call, no persistence)
    localStorageMock.setItem.mockClear();
    s.removeOutputRoute(a.id, 'missing');
    expect(localStorageMock.setItem).not.toHaveBeenCalled();
    expect(currentInstance().connections).toHaveLength(2);

    s.removeOutputRoute(a.id, edge.id);
    expect(currentInstance().connections.map((x) => x.id)).toEqual([keep.id]);
  });

  it('removeConnection removes by id and persists', () => {
    useWorkflowStore.getState().createInstance('W');
    const s = useWorkflowStore.getState();
    const a = s.addAgent({ name: 'A' });
    const b = s.addAgent({ name: 'B' });
    const c = s.addAgent({ name: 'C' });
    const keep = s.addConnection(b.id, c.id, 'onComplete');
    const edge = s.addConnection(a.id, b.id, 'onComplete');
    localStorageMock.setItem.mockClear();
    s.removeConnection(edge.id);
    expect(currentInstance().connections.map((x) => x.id)).toEqual([keep.id]);
    expect(localStorageMock.setItem).toHaveBeenCalledTimes(1);
    expect(persisted().instances[0].connections.map((x: { id: string }) => x.id)).toEqual([keep.id]);
  });

  it('createA_B_C_Workflow still composes slices through get()', () => {
    useWorkflowStore.getState().createInstance('W');
    const result = useWorkflowStore.getState().createA_B_C_Workflow();
    expect(result).not.toBeNull();
    const inst = currentInstance();
    expect(inst.agents.map((a) => a.role)).toEqual(['writer', 'developer', 'qa']);
    expect(inst.connections.map((x) => [x.sourceAgentId, x.targetAgentId])).toEqual([
      [result!.agentA.id, result!.agentB.id],
      [result!.agentB.id, result!.agentC.id],
    ]);
  });
});

describe('AG-11 source guards', () => {
  const storeDir = path.join(__dirname, '..');
  const read = (file: string) => fs.readFileSync(path.join(storeDir, file), 'utf8');
  const loc = (file: string) => read(file).split('\n').length - 1;
  const files = ['workflowStore.ts', 'workflowAgentActions.ts', 'workflowConnectionActions.ts'];

  it.each(files)('%s is under 500 LOC', (file) => {
    expect(loc(file)).toBeLessThan(500);
  });

  it.each(files)('%s uses static imports only (no dynamic import / require)', (file) => {
    const src = read(file);
    expect(src).not.toMatch(/\bimport\s*\(/);
    expect(src).not.toMatch(/\brequire\s*\(/);
  });

  it.each(['workflowAgentActions.ts', 'workflowConnectionActions.ts'])('%s stays synchronous (no async/await)', (file) => {
    const src = read(file);
    expect(src).not.toMatch(/\basync\b/);
    expect(src).not.toMatch(/\bawait\b/);
    expect(src).toMatch(/import type \{ WorkflowStore \} from '\.\/workflowStore';/);
  });

  it('workflowStore.ts keeps its exported API and spreads slices in the original position order', () => {
    const src = read('workflowStore.ts');
    expect(src).toMatch(/export interface WorkflowStore extends WorkflowState \{/);
    expect(src).toMatch(/export const useWorkflowStore = create<WorkflowStore>\(\(set, get\) => \(\{/);
    const idx = (needle: string) => src.indexOf(needle);
    const order = [
      'updateInstanceMeta: (id, updates) =>',
      '...createWorkflowAgentActions(set, get),',
      '...createWorkflowConnectionActions(set, get),',
      '...createWorkflowRunActions(set, get),',
      'setRunning: (running, agentId = null) =>',
    ].map(idx);
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
    const storeBody = src.slice(src.indexOf('export const useWorkflowStore'));
    for (const key of [...AGENT_ACTION_KEYS, ...CONNECTION_ACTION_KEYS]) {
      expect(storeBody).not.toMatch(new RegExp(`^  ${key}: `, 'm'));
    }
  });

  it('interface still declares every extracted action', () => {
    const src = read('workflowStore.ts');
    for (const key of [...AGENT_ACTION_KEYS, ...CONNECTION_ACTION_KEYS]) {
      expect(src).toMatch(new RegExp(`^  ${key}: `, 'm'));
    }
    const typed: Array<keyof WorkflowStore> = [...AGENT_ACTION_KEYS, ...CONNECTION_ACTION_KEYS] as Array<keyof WorkflowStore>;
    expect(typed).toHaveLength(17);
  });
});

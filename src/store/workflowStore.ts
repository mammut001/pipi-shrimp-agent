/**
 * Workflow Store - Zustand state management for multi-instance workflow system
 *
 * Manages:
 * - Multiple workflow instances (each with its own agents, connections, runs)
 * - Execution state (isRunning, currentRunningAgentId)
 * - Instance switching (currentInstanceId)
 *
 * Persistence: instances are saved to localStorage under 'pipi-workflow-v2'
 */

import { create } from 'zustand';
import type {
  WorkflowState, WorkflowInstance, WorkflowAgent, WorkflowConnection,
  WorkflowRun, WorkflowRunAgentEntry, AgentExecutionConfig,
  GoalEvaluationResult, OutputRoute
} from '../types/workflow';
import {
  DEFAULT_EXECUTION_CONFIG,
  DEFAULT_MAX_GOAL_ITERATIONS,
  DEFAULT_RETRY_POLICY,
} from '@/services/workflow/defaults';
import { AGENT_TEMPLATES } from '@/services/workflow/templates/agentTemplates';
import { normalizeWorkflowAgentRole } from '@/services/workflow/templates/roles';
import { useUIStore } from '@/store/uiStore';

const STORAGE_KEY_V2 = 'pipi-workflow-v2';
const STORAGE_KEY_V1 = 'pipi-workflow-v1';

// ============ Persistence ============

function normalizeOutputRoute(route: OutputRoute): OutputRoute {
  return {
    ...route,
    keywordMode: route.keywordMode ?? 'includes',
  };
}

function normalizeAgentBase(agent: WorkflowAgent): WorkflowAgent {
  return {
    ...agent,
    position: agent.position ?? { x: 100, y: 200 },
    status: agent.status ?? 'idle',
    outputRoutes: (agent.outputRoutes ?? []).map(normalizeOutputRoute),
    execution: agent.execution ?? DEFAULT_EXECUTION_CONFIG,
    inputFrom: agent.inputFrom ?? null,
    role: normalizeWorkflowAgentRole(agent.role),
    retryPolicy: {
      ...DEFAULT_RETRY_POLICY,
      ...agent.retryPolicy,
      fallbackConfigIds: agent.retryPolicy?.fallbackConfigIds ?? [],
    },
    notifyOnComplete: agent.notifyOnComplete ?? [],
    visionPolicy: agent.visionPolicy ?? 'inherit',
  };
}

function normalizeAgent(agent: WorkflowAgent): WorkflowAgent {
  return normalizeAgentBase(agent);
}

function normalizeConnection(connection: WorkflowConnection): WorkflowConnection {
  const normalizedCondition = connection.condition ?? 'onComplete';
  const normalizedKeywordMode = normalizedCondition === 'outputContains'
    ? connection.keywordMode ?? 'includes'
    : undefined;

  return {
    ...connection,
    condition: normalizedCondition,
    keyword: normalizedCondition === 'outputContains' ? connection.keyword?.trim() : undefined,
    keywordMode: normalizedKeywordMode,
    type: connection.type ?? 'sequential',
  };
}

function buildConnectionSignature(connection: Pick<WorkflowConnection, 'sourceAgentId' | 'targetAgentId' | 'condition' | 'keyword' | 'keywordMode' | 'type'>): string {
  return [
    connection.sourceAgentId,
    connection.targetAgentId,
    connection.condition,
    connection.keyword?.trim().toLowerCase() ?? '',
    connection.keywordMode ?? '',
    connection.type ?? 'sequential',
  ].join('::');
}

function extractLegacyConnections(agents: WorkflowAgent[]): WorkflowConnection[] {
  const legacyConnections: WorkflowConnection[] = [];

  for (const agent of agents) {
    if (agent.inputFrom) {
      legacyConnections.push(normalizeConnection({
        id: `${agent.inputFrom}->${agent.id}:primary`,
        sourceAgentId: agent.inputFrom,
        targetAgentId: agent.id,
        condition: 'onComplete',
        type: 'sequential',
      }));
    }

    for (const route of agent.outputRoutes ?? []) {
      legacyConnections.push(normalizeConnection({
        id: route.id,
        sourceAgentId: agent.id,
        targetAgentId: route.targetAgentId,
        condition: route.condition,
        keyword: route.keyword,
        keywordMode: route.keywordMode,
        type: 'sequential',
      }));
    }
  }

  return legacyConnections;
}

function mergeConnections(agents: WorkflowAgent[], connections: WorkflowConnection[]): WorkflowConnection[] {
  const connectionMap = new Map<string, WorkflowConnection>();
  const candidates = [...connections, ...extractLegacyConnections(agents)];

  for (const candidate of candidates) {
    const normalized = normalizeConnection(candidate);
    const signature = buildConnectionSignature(normalized);
    if (!connectionMap.has(signature)) {
      connectionMap.set(signature, normalized);
    }
  }

  return Array.from(connectionMap.values());
}

function deriveOutputRoutes(connections: WorkflowConnection[], agentId: string): OutputRoute[] {
  return connections
    .filter((connection) => connection.sourceAgentId === agentId)
    .map((connection) => normalizeOutputRoute({
      id: connection.id,
      condition: connection.condition,
      keyword: connection.keyword,
      keywordMode: connection.keywordMode,
      targetAgentId: connection.targetAgentId,
    }));
}

function derivePrimaryInputFrom(connections: WorkflowConnection[], agentId: string): string | null {
  const incoming = connections.filter((connection) => (
    connection.targetAgentId === agentId
    && connection.condition === 'onComplete'
    && (connection.type ?? 'sequential') === 'sequential'
  ));

  return incoming.length === 1 ? incoming[0].sourceAgentId : null;
}

export function dedupeConnections(instance: WorkflowInstance): WorkflowInstance {
  const deduped = new Map<string, WorkflowConnection>();

  for (const connection of instance.connections ?? []) {
    const normalized = normalizeConnection(connection);
    const signature = buildConnectionSignature(normalized);
    if (!deduped.has(signature)) {
      deduped.set(signature, normalized);
    }
  }

  return {
    ...instance,
    connections: Array.from(deduped.values()),
  };
}

export function removeDanglingConnections(instance: WorkflowInstance): WorkflowInstance {
  const validAgentIds = new Set((instance.agents ?? []).map((agent) => agent.id));

  return {
    ...instance,
    connections: (instance.connections ?? []).filter((connection) => (
      validAgentIds.has(connection.sourceAgentId) && validAgentIds.has(connection.targetAgentId)
    )),
  };
}

export function rebuildInputFromFromConnections(instance: WorkflowInstance): WorkflowInstance {
  const validAgentIds = new Set((instance.agents ?? []).map((agent) => agent.id));

  return {
    ...instance,
    agents: (instance.agents ?? []).map((agent) => normalizeAgent({
      ...agent,
      outputRoutes: deriveOutputRoutes(instance.connections ?? [], agent.id).filter((route) => validAgentIds.has(route.targetAgentId)),
      // Keep the single-source projection only when there is exactly one primary inbound edge.
      // With fan-in or zero inbound edges we intentionally collapse back to null.
      inputFrom: derivePrimaryInputFrom(instance.connections ?? [], agent.id),
    })),
  };
}

export function normalizeWorkflowGraph(instance: WorkflowInstance): WorkflowInstance {
  // `connections` are the canonical graph source of truth. `outputRoutes` and `inputFrom`
  // are synchronized UI projections derived from the normalized connection set.
  const baseAgents = (instance.agents ?? []).map(normalizeAgentBase);
  let normalized: WorkflowInstance = {
    ...instance,
    agents: baseAgents,
    connections: mergeConnections(baseAgents, instance.connections ?? []),
  };

  normalized = dedupeConnections(normalized);
  normalized = removeDanglingConnections(normalized);
  normalized = rebuildInputFromFromConnections(normalized);

  const validAgentIds = new Set(normalized.agents.map((agent) => agent.id));

  return {
    ...normalized,
    dirtyAgentIds: (instance.dirtyAgentIds ?? []).filter((agentId) => validAgentIds.has(agentId)),
  };
}

function reconcileGraphState(
  instance: WorkflowInstance,
  overrides: Partial<Pick<WorkflowInstance, 'agents' | 'connections' | 'dirtyAgentIds'>> = {},
): Pick<WorkflowInstance, 'agents' | 'connections' | 'dirtyAgentIds'> {
  const normalized = normalizeWorkflowGraph({
    ...instance,
    agents: overrides.agents ?? instance.agents,
    connections: overrides.connections ?? instance.connections,
    dirtyAgentIds: overrides.dirtyAgentIds ?? instance.dirtyAgentIds,
  });

  return {
    agents: normalized.agents,
    connections: normalized.connections,
    dirtyAgentIds: normalized.dirtyAgentIds,
  };
}

export function selectAgentIncomingConnections(instance: WorkflowInstance | null, agentId: string): WorkflowConnection[] {
  return (instance?.connections ?? []).filter((connection) => connection.targetAgentId === agentId);
}

export function selectAgentOutgoingConnections(instance: WorkflowInstance | null, agentId: string): WorkflowConnection[] {
  return (instance?.connections ?? []).filter((connection) => connection.sourceAgentId === agentId);
}

export function selectAgentOutputRoutes(instance: WorkflowInstance | null, agentId: string): OutputRoute[] {
  return deriveOutputRoutes(instance?.connections ?? [], agentId);
}

function normalizeRun(run: WorkflowRun): WorkflowRun {
  return {
    ...run,
    successCriteria: run.successCriteria ?? '',
    currentIteration: run.currentIteration ?? 0,
    goalEvaluations: run.goalEvaluations ?? [],
    reachedGoal: run.reachedGoal ?? false,
  };
}

function normalizeInstance(instance: WorkflowInstance): WorkflowInstance {
  const normalizedBase: WorkflowInstance = {
    ...instance,
    projectGoal: instance.projectGoal ?? '',
    successCriteria: instance.successCriteria ?? '',
    goalEvaluatorAgentId: instance.goalEvaluatorAgentId ?? null,
    maxGoalIterations: instance.maxGoalIterations ?? DEFAULT_MAX_GOAL_ITERATIONS,
    activeRunId: instance.activeRunId ?? null,
    dirtyAgentIds: instance.dirtyAgentIds ?? [],
    agents: (instance.agents ?? []).map(normalizeAgentBase),
    connections: (instance.connections ?? []).map(normalizeConnection),
    workflowRuns: (instance.workflowRuns ?? []).map(normalizeRun),
    createdAt: instance.createdAt,
    updatedAt: instance.updatedAt,
  };

  return normalizeWorkflowGraph(normalizedBase);
}

function loadFromStorage(): Partial<WorkflowState> {
  try {
    // Try V2 first
    const v2 = localStorage.getItem(STORAGE_KEY_V2);
    if (v2) {
      const parsed = JSON.parse(v2);
      return {
        instances: (parsed.instances || []).map(normalizeInstance),
        currentInstanceId: parsed.currentInstanceId || null,
      };
    }

    // Migrate from V1
    const v1 = localStorage.getItem(STORAGE_KEY_V1);
    if (v1) {
      const old = JSON.parse(v1);
      const hasData = (old.agents?.length > 0) || (old.connections?.length > 0) || (old.workflowRuns?.length > 0);
      if (hasData) {
        const defaultInstance: WorkflowInstance = {
          id: 'default',
          name: 'My Workflow',
          projectGoal: '',
          successCriteria: '',
          goalEvaluatorAgentId: null,
          maxGoalIterations: DEFAULT_MAX_GOAL_ITERATIONS,
          agents: (old.agents || []).map(normalizeAgentBase),
          connections: (old.connections || []).map(normalizeConnection),
          workflowRuns: (old.workflowRuns || []).map(normalizeRun),
          activeRunId: null,
          dirtyAgentIds: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        return {
          instances: [defaultInstance],
          currentInstanceId: 'default',
        };
      }
    }
  } catch (e) {
    console.warn('Failed to load workflow from localStorage:', e);
  }
  return {};
}

function saveToStorage(state: WorkflowState): void {
  try {
    const toSave = {
      instances: state.instances,
      currentInstanceId: state.currentInstanceId,
    };
    localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(toSave));
  } catch (e) {
    console.error('Failed to save workflow to localStorage:', e);
  }
}

function shouldBlockTopologyMutation(state: WorkflowState): boolean {
  return state.isRunning;
}

function notifyTopologyMutationBlocked(): void {
  useUIStore.getState().addNotification('warning', '工作流运行中，当前不能修改拓扑结构。');
}

function findInstanceContainingRun(state: WorkflowState, runId: string): WorkflowInstance | null {
  return state.instances.find((instance) => instance.workflowRuns.some((run) => run.id === runId)) ?? null;
}

function updateInstanceContainingRun(
  state: WorkflowState,
  runId: string,
  updater: (instance: WorkflowInstance) => Partial<WorkflowInstance>,
): Partial<WorkflowState> {
  const owningInstance = findInstanceContainingRun(state, runId);
  if (!owningInstance) return {};
  return updateInstanceById(state, owningInstance.id, updater);
}

// ============ Helper: mutate instance ============

function updateCurrentInstance(
  state: WorkflowState,
  updater: (instance: WorkflowInstance) => Partial<WorkflowInstance>,
): Partial<WorkflowState> {
  if (!state.currentInstanceId) return {};
  return {
    instances: state.instances.map(inst =>
      inst.id === state.currentInstanceId
        ? { ...inst, ...updater(inst), updatedAt: Date.now() }
        : inst
    ),
  };
}

function updateInstanceById(
  state: WorkflowState,
  instanceId: string,
  updater: (instance: WorkflowInstance) => Partial<WorkflowInstance>,
): Partial<WorkflowState> {
  return {
    instances: state.instances.map(inst =>
      inst.id === instanceId
        ? { ...inst, ...updater(inst), updatedAt: Date.now() }
        : inst
    ),
  };
}

// ============ Initial State ============

const persistedState = loadFromStorage();

const initialState: WorkflowState = {
  instances: persistedState.instances || [],
  currentInstanceId: persistedState.currentInstanceId || null,
  isRunning: false,
  currentRunningAgentId: null,
  selectedRunId: null,
  selectedPreviewFile: null,
};

// ============ Store Interface ============

export interface WorkflowStore extends WorkflowState {
  // Instance management
  createInstance: (name?: string) => WorkflowInstance;
  deleteInstance: (id: string) => void;
  deleteInstances: (ids: string[]) => void;
  renameInstance: (id: string, name: string) => void;
  selectInstance: (id: string) => void;
  getCurrentInstance: () => WorkflowInstance | null;
  getCurrentInstanceOrThrow: () => WorkflowInstance;
  updateInstanceMeta: (
    id: string,
    updates: Pick<WorkflowInstance, 'projectGoal' | 'successCriteria' | 'goalEvaluatorAgentId' | 'maxGoalIterations'>,
  ) => void;

  // Agent CRUD (operates on current instance)
  addAgent: (data: {
    name: string;
    soulPrompt?: string;
    task?: string;
    taskPrompt?: string;
    taskInstruction?: string;
    execution?: AgentExecutionConfig;
    inputFrom?: string | null;
    role?: WorkflowAgent['role'];
  }) => WorkflowAgent;
  updateAgent: (id: string, updates: Partial<Omit<WorkflowAgent, 'id'>>) => void;
  removeAgent: (id: string) => void;
  updateAgentPosition: (id: string, position: { x: number; y: number }) => void;
  updateAgentSize: (id: string, width: number, height: number) => void;
  setAgentStatus: (id: string, status: WorkflowAgent['status']) => void;
  setAgentInputFrom: (agentId: string, fromId: string | null) => void;
  markAgentDirty: (agentId: string) => void;
  clearAgentDirty: (agentId: string) => void;

  // Connection CRUD (operates on current instance)
  addConnection: (
    sourceId: string,
    targetId: string,
    condition: WorkflowConnection['condition'],
    options?: Pick<WorkflowConnection, 'keyword' | 'keywordMode' | 'type'>,
  ) => WorkflowConnection;
  removeConnection: (id: string) => void;

  // OutputRoute management (operates on current instance)
  addOutputRoute: (agentId: string, route: Omit<OutputRoute, 'id'>) => void;
  updateOutputRoute: (agentId: string, routeId: string, updates: Partial<OutputRoute>) => void;
  removeOutputRoute: (agentId: string, routeId: string) => void;

  // Workflow Run (history) — operates on current instance
  addWorkflowRun: (run: WorkflowRun, instanceId?: string) => void;
  updateWorkflowRun: (id: string, updates: Partial<WorkflowRun>) => void;
  renameWorkflowRun: (id: string, title: string) => void;
  deleteWorkflowRun: (id: string) => void;
  updateRunAgent: (runId: string, agentId: string, updates: Partial<WorkflowRunAgentEntry>) => void;
  appendGoalEvaluation: (runId: string, evaluation: GoalEvaluationResult) => void;
  selectRun: (id: string | null) => void;
  setActiveRunId: (id: string | null, instanceId?: string) => void;

  // Execution state
  setRunning: (running: boolean, agentId?: string | null) => void;
  resetAllStatuses: (instanceId?: string) => void;
  setAgentStatusInInstance: (instanceId: string, id: string, status: WorkflowAgent['status']) => void;
  markAgentDirtyInInstance: (instanceId: string, agentId: string) => void;
  clearAgentDirtyInInstance: (instanceId: string, agentId: string) => void;

  // File preview
  setSelectedPreviewFile: (path: string | null) => void;

  // Canvas operations (operates on current instance)
  clearCanvas: () => void;

  // Preset workflows
  createA_B_C_Workflow: () => { agentA: WorkflowAgent; agentB: WorkflowAgent; agentC: WorkflowAgent } | null;
}

export const useWorkflowStore = create<WorkflowStore>((set, get) => ({
  ...initialState,

  // ============ Instance Management ============

  createInstance: (name?: string) => {
    const id = crypto.randomUUID();
    const instance: WorkflowInstance = {
      id,
      name: name || `Workflow ${get().instances.length + 1}`,
      projectGoal: '',
      successCriteria: '',
      goalEvaluatorAgentId: null,
      maxGoalIterations: DEFAULT_MAX_GOAL_ITERATIONS,
      agents: [],
      connections: [],
      workflowRuns: [],
      activeRunId: null,
      dirtyAgentIds: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    set((state) => {
      const newState = {
        ...state,
        instances: [...state.instances, instance],
        currentInstanceId: id,
      };
      saveToStorage(newState);
      return newState;
    });
    return instance;
  },

  deleteInstance: (id: string) => {
    set((state) => {
      const remaining = state.instances.filter(i => i.id !== id);
      let nextId = state.currentInstanceId;
      const shouldClearSelected = nextId === id;
      if (shouldClearSelected) {
        nextId = remaining.length > 0 ? remaining[remaining.length - 1].id : null;
      }
      const newState = {
        ...state,
        instances: remaining,
        currentInstanceId: nextId,
        // Clear selected run/preview when deleting the current instance
        selectedRunId: shouldClearSelected ? null : state.selectedRunId,
        selectedPreviewFile: shouldClearSelected ? null : state.selectedPreviewFile,
      };
      saveToStorage(newState);
      return newState;
    });
  },

  deleteInstances: (ids: string[]) => {
    set((state) => {
      const idSet = new Set(ids);
      const remaining = state.instances.filter(i => !idSet.has(i.id));
      let nextId = state.currentInstanceId;
      const shouldClearSelected = idSet.has(nextId ?? '');
      if (shouldClearSelected) {
        nextId = remaining.length > 0 ? remaining[remaining.length - 1].id : null;
      }
      const newState = {
        ...state,
        instances: remaining,
        currentInstanceId: nextId,
        // Clear selected run/preview when deleting the current instance
        selectedRunId: shouldClearSelected ? null : state.selectedRunId,
        selectedPreviewFile: shouldClearSelected ? null : state.selectedPreviewFile,
      };
      saveToStorage(newState);
      return newState;
    });
  },

  renameInstance: (id: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    set((state) => {
      const newState = {
        ...state,
        ...updateInstanceById(state, id, () => ({ name: trimmed })),
      };
      saveToStorage(newState);
      return newState;
    });
  },

  selectInstance: (id: string) => {
    set((state) => {
      const newState = {
        ...state,
        currentInstanceId: id,
        selectedRunId: null,
      };
      saveToStorage(newState);
      return newState;
    });
  },

  getCurrentInstance: () => {
    const state = get();
    if (!state.currentInstanceId) return null;
    return state.instances.find(i => i.id === state.currentInstanceId) ?? null;
  },

  getCurrentInstanceOrThrow: () => {
    const instance = get().getCurrentInstance();
    if (!instance) {
      throw new Error('当前没有可用的 Workflow 实例。');
    }
    return instance;
  },

  updateInstanceMeta: (id, updates) => {
    set((state) => {
      const newState = {
        ...state,
        ...updateInstanceById(state, id, () => ({
          ...updates,
          maxGoalIterations: updates.maxGoalIterations ?? DEFAULT_MAX_GOAL_ITERATIONS,
        })),
      };
      saveToStorage(newState);
      return newState;
    });
  },

  // ============ Agent CRUD ============

  addAgent: (data) => {
    const state = get();
    const instance = state.getCurrentInstance();
    const agents = instance?.agents ?? [];
    const newAgent: WorkflowAgent = {
      id: crypto.randomUUID(),
      name: data.name || 'New Agent',
      soulPrompt: data.soulPrompt,
      task: data.task,
      taskPrompt: data.taskPrompt,
      taskInstruction: data.taskInstruction,
      position: { x: 100 + agents.length * 260, y: 200 },
      status: 'idle',
      outputRoutes: [],
      execution: data.execution || DEFAULT_EXECUTION_CONFIG,
      inputFrom: data.inputFrom ?? null,
      role: data.role ?? 'custom',
      retryPolicy: { ...DEFAULT_RETRY_POLICY, fallbackConfigIds: [] },
      notifyOnComplete: [],
    };

    if (shouldBlockTopologyMutation(state)) {
      notifyTopologyMutationBlocked();
      return newAgent;
    }

    set((state) => {
      const newState = {
        ...state,
        ...updateCurrentInstance(state, (inst) => ({
          ...reconcileGraphState(inst, { agents: [...inst.agents, newAgent] }),
        })),
      };
      saveToStorage(newState);
      return newState;
    });

    return newAgent;
  },

  updateAgent: (id, updates) => {
    const { inputFrom: _ignoredInputFrom, outputRoutes: _ignoredOutputRoutes, ...safeUpdates } = updates;
    set((state) => {
      const newState = {
        ...state,
        ...updateCurrentInstance(state, (inst) => ({
          agents: inst.agents.map(agent => (
            agent.id === id ? normalizeAgent({ ...agent, ...safeUpdates }) : agent
          )),
        })),
      };
      saveToStorage(newState);
      return newState;
    });
  },

  removeAgent: (id) => {
    if (shouldBlockTopologyMutation(get())) {
      notifyTopologyMutationBlocked();
      return;
    }
    set((state) => {
      const newState = {
        ...state,
        ...updateCurrentInstance(state, (inst) => {
          const newAgents = inst.agents.filter(a => a.id !== id);
          const newConnections = inst.connections.filter(
            c => c.sourceAgentId !== id && c.targetAgentId !== id
          );
          return {
            ...reconcileGraphState(inst, {
              agents: newAgents,
              connections: newConnections,
              dirtyAgentIds: (inst.dirtyAgentIds ?? []).filter((agentId) => agentId !== id),
            }),
          };
        }),
      };
      saveToStorage(newState);
      return newState;
    });
  },

  updateAgentPosition: (id, position) => {
    set((state) => {
      const newState = {
        ...state,
        ...updateCurrentInstance(state, (inst) => ({
          agents: inst.agents.map(agent =>
            agent.id === id ? { ...agent, position } : agent
          ),
        })),
      };
      saveToStorage(newState);
      return newState;
    });
  },

  updateAgentSize: (id, width, height) => {
    set((state) => {
      const newState = {
        ...state,
        ...updateCurrentInstance(state, (inst) => ({
          agents: inst.agents.map(agent =>
            agent.id === id ? { ...agent, width, height } : agent
          ),
        })),
      };
      saveToStorage(newState);
      return newState;
    });
  },

  setAgentStatus: (id, status) => {
    set((state) => ({
      ...state,
      ...updateCurrentInstance(state, (inst) => ({
        agents: inst.agents.map(agent =>
          agent.id === id ? { ...agent, status } : agent
        ),
      })),
    }));
  },

  setAgentStatusInInstance: (instanceId, id, status) => {
    set((state) => ({
      ...state,
      ...updateInstanceById(state, instanceId, (inst) => ({
        agents: inst.agents.map((agent) => (
          agent.id === id ? { ...agent, status } : agent
        )),
      })),
    }));
  },

  setAgentInputFrom: (agentId, fromId) => {
    if (shouldBlockTopologyMutation(get())) {
      notifyTopologyMutationBlocked();
      return;
    }
    set((state) => {
      const inst = state.instances.find(i => i.id === state.currentInstanceId);
      if (!inst) return state;
      const newConnections = inst.connections
        .filter((connection) => !(
          connection.targetAgentId === agentId
          && connection.condition === 'onComplete'
          && (connection.type ?? 'sequential') === 'sequential'
        ));

      if (fromId) {
        newConnections.push(normalizeConnection({
          id: crypto.randomUUID(),
          sourceAgentId: fromId,
          targetAgentId: agentId,
          condition: 'onComplete',
          type: 'sequential',
        }));
      }

      const newState = {
        ...state,
        ...updateCurrentInstance(state, () => ({
          ...reconcileGraphState(inst, {
            connections: newConnections,
          }),
        })),
      };
      saveToStorage(newState);
      return newState;
    });
  },

  markAgentDirty: (agentId) => {
    set((state) => {
      const newState = {
        ...state,
        ...updateCurrentInstance(state, (inst) => ({
          dirtyAgentIds: Array.from(new Set([...(inst.dirtyAgentIds ?? []), agentId])),
        })),
      };
      saveToStorage(newState);
      return newState;
    });
  },

  markAgentDirtyInInstance: (instanceId, agentId) => {
    set((state) => {
      const newState = {
        ...state,
        ...updateInstanceById(state, instanceId, (inst) => ({
          dirtyAgentIds: Array.from(new Set([...(inst.dirtyAgentIds ?? []), agentId])),
        })),
      };
      saveToStorage(newState);
      return newState;
    });
  },

  clearAgentDirty: (agentId) => {
    set((state) => {
      const newState = {
        ...state,
        ...updateCurrentInstance(state, (inst) => ({
          dirtyAgentIds: (inst.dirtyAgentIds ?? []).filter((id) => id !== agentId),
        })),
      };
      saveToStorage(newState);
      return newState;
    });
  },

  clearAgentDirtyInInstance: (instanceId, agentId) => {
    set((state) => {
      const newState = {
        ...state,
        ...updateInstanceById(state, instanceId, (inst) => ({
          dirtyAgentIds: (inst.dirtyAgentIds ?? []).filter((id) => id !== agentId),
        })),
      };
      saveToStorage(newState);
      return newState;
    });
  },

  // ============ Connection CRUD ============

  addConnection: (sourceId, targetId, condition, options) => {
    const newConnection: WorkflowConnection = normalizeConnection({
      id: crypto.randomUUID(),
      sourceAgentId: sourceId,
      targetAgentId: targetId,
      condition,
      keyword: options?.keyword,
      keywordMode: options?.keywordMode,
      type: options?.type ?? 'sequential',
    });
    let createdConnection = newConnection;

    if (shouldBlockTopologyMutation(get())) {
      notifyTopologyMutationBlocked();
      return createdConnection;
    }

    set((state) => {
      const inst = state.instances.find((item) => item.id === state.currentInstanceId);
      if (!inst) return state;

      const existing = inst.connections.find((connection) => (
        buildConnectionSignature(connection) === buildConnectionSignature(newConnection)
      ));
      if (existing) {
        createdConnection = existing;
        return state;
      }

      const newState = {
        ...state,
        ...updateCurrentInstance(state, () => ({
          ...reconcileGraphState(inst, {
            connections: [...inst.connections, newConnection],
          }),
        })),
      };
      saveToStorage(newState);
      return newState;
    });

    return createdConnection;
  },

  removeConnection: (id) => {
    if (shouldBlockTopologyMutation(get())) {
      notifyTopologyMutationBlocked();
      return;
    }
    set((state) => {
      const inst = state.instances.find((item) => item.id === state.currentInstanceId);
      if (!inst) return state;

      const newState = {
        ...state,
        ...updateCurrentInstance(state, () => ({
          ...reconcileGraphState(inst, {
            connections: inst.connections.filter(c => c.id !== id),
          }),
        })),
      };
      saveToStorage(newState);
      return newState;
    });
  },

  // ============ OutputRoute Management ============

  addOutputRoute: (agentId, route) => {
    get().addConnection(agentId, route.targetAgentId, route.condition, {
      keyword: route.keyword,
      keywordMode: route.keywordMode,
      type: 'sequential',
    });
  },

  updateOutputRoute: (agentId, routeId, updates) => {
    if (shouldBlockTopologyMutation(get())) {
      notifyTopologyMutationBlocked();
      return;
    }
    set((state) => {
      const inst = state.instances.find((item) => item.id === state.currentInstanceId);
      if (!inst) return state;

      const newState = {
        ...state,
        ...updateCurrentInstance(state, () => ({
          ...reconcileGraphState(inst, {
            connections: inst.connections.map((connection) => (
              connection.id === routeId && connection.sourceAgentId === agentId
                ? normalizeConnection({
                    ...connection,
                    condition: updates.condition ?? connection.condition,
                    keyword: updates.keyword,
                    keywordMode: updates.keywordMode ?? connection.keywordMode,
                    targetAgentId: updates.targetAgentId ?? connection.targetAgentId,
                  })
                : connection
            )),
          }),
        })),
      };
      saveToStorage(newState);
      return newState;
    });
  },

  removeOutputRoute: (agentId, routeId) => {
    if (shouldBlockTopologyMutation(get())) {
      notifyTopologyMutationBlocked();
      return;
    }
    const instance = get().getCurrentInstance();
    const route = selectAgentOutputRoutes(instance, agentId).find((item) => item.id === routeId);
    if (!route) return;
    get().removeConnection(routeId);
  },

  // ============ Workflow Run (History) ============

  addWorkflowRun: (run, instanceId) => {
    set((state) => {
      const normalizedRun = normalizeRun(run);
      const targetInstanceId = instanceId ?? state.currentInstanceId;
      if (!targetInstanceId) return state;
      const newState = {
        ...state,
        ...updateInstanceById(state, targetInstanceId, (inst) => ({
          workflowRuns: [normalizedRun, ...inst.workflowRuns].slice(0, 50),
          activeRunId: normalizedRun.id,
        })),
        selectedRunId: normalizedRun.id,
      };
      saveToStorage(newState);
      return newState;
    });
  },

  updateWorkflowRun: (id, updates) => {
    set((state) => {
      const owningInstance = findInstanceContainingRun(state, id);
      if (!owningInstance) return state;
      const newState = {
        ...state,
        ...updateInstanceContainingRun(state, id, (inst) => ({
          workflowRuns: inst.workflowRuns.map((run) =>
            run.id === id ? normalizeRun({ ...run, ...updates }) : run
          ),
          activeRunId: inst.activeRunId === id || updates.status === 'running' ? id : inst.activeRunId,
        })),
      };
      saveToStorage(newState);
      return newState;
    });
  },

  renameWorkflowRun: (id, title) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    set((state) => {
      const owningInstance = findInstanceContainingRun(state, id);
      if (!owningInstance) return state;
      const newState = {
        ...state,
        ...updateInstanceContainingRun(state, id, (inst) => ({
          workflowRuns: inst.workflowRuns.map(run =>
            run.id === id ? { ...run, title: trimmed } : run
          ),
        })),
      };
      saveToStorage(newState);
      return newState;
    });
  },

  deleteWorkflowRun: (id) => {
    set((state) => {
      const owningInstance = findInstanceContainingRun(state, id);
      if (!owningInstance) return state;
      const wasSelected = state.selectedRunId === id;
      const runs = owningInstance.workflowRuns ?? [];
      const runsAfterDelete = runs.filter(run => run.id !== id);

      let nextRunId: string | null = null;
      if (wasSelected) {
        const deletedIndex = runs.findIndex(r => r.id === id);
        nextRunId = runsAfterDelete[deletedIndex]?.id ?? runsAfterDelete[runsAfterDelete.length - 1]?.id ?? null;
      }

      const newState = {
        ...state,
        ...updateInstanceById(state, owningInstance.id, (inst) => ({
          workflowRuns: runsAfterDelete,
          activeRunId: inst.activeRunId === id ? (runsAfterDelete[0]?.id ?? null) : inst.activeRunId,
        })),
        selectedRunId: wasSelected ? nextRunId : state.selectedRunId,
      };
      saveToStorage(newState);
      return newState;
    });
  },

  updateRunAgent: (runId, agentId, updates) => {
    set((state) => {
      const owningInstance = findInstanceContainingRun(state, runId);
      if (!owningInstance) return state;
      const newState = {
        ...state,
        ...updateInstanceContainingRun(state, runId, (inst) => ({
          workflowRuns: inst.workflowRuns.map(run =>
            run.id === runId
              ? {
                  ...run,
                  agents: run.agents.map(entry =>
                    entry.agentId === agentId ? { ...entry, ...updates } : entry
                  ),
                }
              : run
          ),
        })),
      };
      saveToStorage(newState);
      return newState;
    });
  },

  appendGoalEvaluation: (runId, evaluation) => {
    set((state) => {
      const owningInstance = findInstanceContainingRun(state, runId);
      if (!owningInstance) return state;
      const newState = {
        ...state,
        ...updateInstanceContainingRun(state, runId, (inst) => ({
          workflowRuns: inst.workflowRuns.map((run) => (
            run.id === runId
              ? normalizeRun({
                  ...run,
                  currentIteration: evaluation.iteration,
                  goalEvaluations: [...(run.goalEvaluations ?? []), evaluation],
                  reachedGoal: evaluation.reached,
                })
              : run
          )),
        })),
      };
      saveToStorage(newState);
      return newState;
    });
  },

  selectRun: (id) => {
    set({ selectedRunId: id });
  },

  setActiveRunId: (id, instanceId) => {
    set((state) => {
      const targetInstanceId = instanceId ?? state.currentInstanceId;
      if (!targetInstanceId) return state;
      const newState = {
        ...state,
        ...updateInstanceById(state, targetInstanceId, () => ({ activeRunId: id })),
      };
      saveToStorage(newState);
      return newState;
    });
  },

  // ============ Execution State ============

  setRunning: (running, agentId = null) => {
    set((state) => ({
      ...state,
      isRunning: running,
      currentRunningAgentId: agentId,
    }));
  },

  resetAllStatuses: (instanceId) => {
    set((state) => {
      const targetInstanceId = instanceId ?? state.currentInstanceId;
      if (!targetInstanceId) return state;
      return {
        ...state,
        ...updateInstanceById(state, targetInstanceId, (inst) => ({
          agents: inst.agents.map((agent) => ({ ...agent, status: 'idle' as const })),
          dirtyAgentIds: [],
        })),
      };
    });
  },

  setSelectedPreviewFile: (path) => {
    set({ selectedPreviewFile: path });
  },

  // ============ Canvas Operations ============

  clearCanvas: () => {
    if (shouldBlockTopologyMutation(get())) {
      notifyTopologyMutationBlocked();
      return;
    }
    set((state) => {
      const inst = state.instances.find((item) => item.id === state.currentInstanceId);
      if (!inst) return state;
      const newState = {
        ...state,
        ...updateCurrentInstance(state, () => ({
          ...reconcileGraphState(inst, {
            agents: [],
            connections: [],
            dirtyAgentIds: [],
          }),
        })),
      };
      saveToStorage(newState);
      return newState;
    });
  },

  // ============ Preset Workflow ============

  createA_B_C_Workflow: () => {
    if (shouldBlockTopologyMutation(get())) {
      notifyTopologyMutationBlocked();
      return null;
    }
    const { addAgent, addConnection } = get();

    const writerTemplate = AGENT_TEMPLATES.find(t => t.id === 'tech-writer');
    const devTemplate = AGENT_TEMPLATES.find(t => t.id === 'fullstack-dev');
    const qaTemplate = AGENT_TEMPLATES.find(t => t.id === 'qa-engineer');

    const agentA = addAgent({
      name: 'A - Technical Writer',
      task: writerTemplate?.task || '编写需求文档',
      taskPrompt: writerTemplate?.taskPrompt,
      taskInstruction: writerTemplate?.taskInstruction,
      soulPrompt: writerTemplate?.soulPrompt || '',
      execution: { mode: 'single' },
      inputFrom: null,
      role: 'writer',
    });

    const agentB = addAgent({
      name: 'B - Full Stack Developer',
      task: devTemplate?.task || '编写代码',
      taskPrompt: devTemplate?.taskPrompt,
      taskInstruction: devTemplate?.taskInstruction,
      soulPrompt: devTemplate?.soulPrompt || '',
      execution: { mode: 'single' },
      inputFrom: agentA.id,
      role: 'developer',
    });

    const agentC = addAgent({
      name: 'C - QA Engineer',
      task: qaTemplate?.task || '执行测试',
      taskPrompt: qaTemplate?.taskPrompt,
      taskInstruction: qaTemplate?.taskInstruction,
      soulPrompt: qaTemplate?.soulPrompt || '',
      execution: { mode: 'multi-round', maxRounds: 3, roundCondition: 'untilComplete' },
      inputFrom: agentB.id,
      role: 'qa',
    });

    addConnection(agentA.id, agentB.id, 'onComplete');
    addConnection(agentB.id, agentC.id, 'onComplete');

    return { agentA, agentB, agentC };
  },
}));

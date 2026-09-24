import type {
  WorkflowState,
  WorkflowInstance,
  WorkflowAgent,
  WorkflowConnection,
  WorkflowRun,
  OutputRoute,
} from '../types/workflow';
import {
  DEFAULT_EXECUTION_CONFIG,
  DEFAULT_MAX_GOAL_ITERATIONS,
  DEFAULT_RETRY_POLICY,
} from '@/services/workflow/defaults';
import { normalizeWorkflowAgentRole } from '@/services/workflow/templates/roles';
import { useUIStore } from '@/store/uiStore';
import { normalizeSuccessCriteria } from '@/services/goal/types';

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

export function normalizeAgent(agent: WorkflowAgent): WorkflowAgent {
  return normalizeAgentBase(agent);
}

export function normalizeConnection(connection: WorkflowConnection): WorkflowConnection {
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

export function buildConnectionSignature(connection: Pick<WorkflowConnection, 'sourceAgentId' | 'targetAgentId' | 'condition' | 'keyword' | 'keywordMode' | 'type'>): string {
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
  const legacyExtras = connections.length > 0 ? [] : extractLegacyConnections(agents);
  const candidates = [...connections, ...legacyExtras];

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

export function reconcileGraphState(
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

export function normalizeRun(run: WorkflowRun): WorkflowRun {
  return {
    ...run,
    successCriteria: normalizeSuccessCriteria(run.successCriteria as unknown as string | string[]),
    currentIteration: run.currentIteration ?? 0,
    goalEvaluations: run.goalEvaluations ?? [],
    reachedGoal: run.reachedGoal ?? false,
  };
}

function normalizeInstance(instance: WorkflowInstance): WorkflowInstance {
  const normalizedBase: WorkflowInstance = {
    ...instance,
    projectGoal: instance.projectGoal ?? '',
    successCriteria: normalizeSuccessCriteria(instance.successCriteria as unknown as string | string[]),
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
      const instances = (parsed.instances || []).map(normalizeInstance);
      const currentInstanceId = parsed.currentInstanceId || null;
      // Persist the normalized representation immediately so legacy string
      // criteria are migrated even before the user edits the workflow.
      localStorage.setItem(STORAGE_KEY_V2, JSON.stringify({ instances, currentInstanceId }));
      return { instances, currentInstanceId };
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
          successCriteria: [],
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

export function saveToStorage(state: WorkflowState): void {
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

export function shouldBlockTopologyMutation(state: WorkflowState): boolean {
  return state.isRunning;
}

export function notifyTopologyMutationBlocked(): void {
  useUIStore.getState().addNotification('warning', '工作流运行中，当前不能修改拓扑结构。');
}

export function findInstanceContainingRun(state: WorkflowState, runId: string): WorkflowInstance | null {
  return state.instances.find((instance) => instance.workflowRuns.some((run) => run.id === runId)) ?? null;
}

export function updateInstanceContainingRun(
  state: WorkflowState,
  runId: string,
  updater: (instance: WorkflowInstance) => Partial<WorkflowInstance>,
): Partial<WorkflowState> {
  const owningInstance = findInstanceContainingRun(state, runId);
  if (!owningInstance) return {};
  return updateInstanceById(state, owningInstance.id, updater);
}

// ============ Helper: mutate instance ============

export function updateCurrentInstance(
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

export function updateInstanceById(
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

export const initialState: WorkflowState = {
  instances: persistedState.instances || [],
  currentInstanceId: persistedState.currentInstanceId || null,
  isRunning: false,
  currentRunningAgentId: null,
  selectedRunId: null,
  selectedPreviewFile: null,
};

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
import { DEFAULT_MAX_GOAL_ITERATIONS } from '@/services/workflow/defaults';
import { AGENT_TEMPLATES } from '@/services/workflow/templates/agentTemplates';
import { createWorkflowAgentActions } from './workflowAgentActions';
import { createWorkflowConnectionActions } from './workflowConnectionActions';
import { createWorkflowRunActions } from './workflowRunActions';
import {
  initialState,
  reconcileGraphState,
  saveToStorage,
  shouldBlockTopologyMutation,
  notifyTopologyMutationBlocked,
  updateCurrentInstance,
  updateInstanceById,
} from './workflowStoreHelpers';
export {
  dedupeConnections,
  removeDanglingConnections,
  rebuildInputFromFromConnections,
  normalizeWorkflowGraph,
  selectAgentIncomingConnections,
  selectAgentOutgoingConnections,
  selectAgentOutputRoutes,
} from './workflowStoreHelpers';


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
      successCriteria: [],
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

  ...createWorkflowAgentActions(set, get),

  ...createWorkflowConnectionActions(set, get),

  ...createWorkflowRunActions(set, get),

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
          activeRunId: null,
        })),
        selectedRunId: null,
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

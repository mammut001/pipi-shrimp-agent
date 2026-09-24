/**
 * Workflow Store — agent CRUD action slice (AG-11).
 *
 * Mechanical extract from workflowStore.ts: bodies are verbatim, operating on the
 * same zustand `set` / `get` passed in by `useWorkflowStore`, so set/get call order,
 * persistence (saveToStorage) and topology-mutation guards are unchanged.
 */

import type { StateCreator } from 'zustand';
import type { WorkflowAgent } from '../types/workflow';
import type { WorkflowStore } from './workflowStore';
import {
  DEFAULT_EXECUTION_CONFIG,
  DEFAULT_RETRY_POLICY,
} from '@/services/workflow/defaults';
import {
  normalizeAgent,
  normalizeConnection,
  reconcileGraphState,
  saveToStorage,
  shouldBlockTopologyMutation,
  notifyTopologyMutationBlocked,
  updateCurrentInstance,
  updateInstanceById,
} from './workflowStoreHelpers';

type WorkflowStoreSet = Parameters<StateCreator<WorkflowStore>>[0];
type WorkflowStoreGet = Parameters<StateCreator<WorkflowStore>>[1];
export type WorkflowAgentActions = Pick<WorkflowStore,
  | 'addAgent'
  | 'updateAgent'
  | 'removeAgent'
  | 'updateAgentPosition'
  | 'updateAgentSize'
  | 'setAgentStatus'
  | 'setAgentStatusInInstance'
  | 'setAgentInputFrom'
  | 'markAgentDirty'
  | 'markAgentDirtyInInstance'
  | 'clearAgentDirty'
  | 'clearAgentDirtyInInstance'
>;

export const createWorkflowAgentActions: (
  set: WorkflowStoreSet,
  get: WorkflowStoreGet,
) => WorkflowAgentActions = (set, get) => ({
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
});

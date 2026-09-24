/**
 * Workflow Store — connection + output-route action slice (AG-11).
 *
 * Mechanical extract from workflowStore.ts: bodies are verbatim, operating on the
 * same zustand `set` / `get` passed in by `useWorkflowStore`, so set/get call order,
 * connection de-duplication, persistence (saveToStorage) and topology-mutation guards
 * are unchanged.
 */

import type { StateCreator } from 'zustand';
import type { WorkflowConnection } from '../types/workflow';
import type { WorkflowStore } from './workflowStore';
import {
  buildConnectionSignature,
  normalizeConnection,
  reconcileGraphState,
  saveToStorage,
  shouldBlockTopologyMutation,
  notifyTopologyMutationBlocked,
  updateCurrentInstance,
  selectAgentOutputRoutes,
} from './workflowStoreHelpers';

type WorkflowStoreSet = Parameters<StateCreator<WorkflowStore>>[0];
type WorkflowStoreGet = Parameters<StateCreator<WorkflowStore>>[1];
export type WorkflowConnectionActions = Pick<WorkflowStore,
  | 'addConnection'
  | 'removeConnection'
  | 'addOutputRoute'
  | 'updateOutputRoute'
  | 'removeOutputRoute'
>;

export const createWorkflowConnectionActions: (
  set: WorkflowStoreSet,
  get: WorkflowStoreGet,
) => WorkflowConnectionActions = (set, get) => ({
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
});

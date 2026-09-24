import type { StateCreator } from 'zustand';
import type { WorkflowStore } from './workflowStore';
import {
  findInstanceContainingRun,
  normalizeRun,
  saveToStorage,
  updateInstanceById,
  updateInstanceContainingRun,
} from './workflowStoreHelpers';

type WorkflowStoreSet = Parameters<StateCreator<WorkflowStore>>[0];
type WorkflowStoreGet = Parameters<StateCreator<WorkflowStore>>[1];
type WorkflowRunActions = Pick<WorkflowStore,
  | 'addWorkflowRun'
  | 'updateWorkflowRun'
  | 'renameWorkflowRun'
  | 'deleteWorkflowRun'
  | 'updateRunAgent'
  | 'appendGoalEvaluation'
  | 'selectRun'
  | 'setActiveRunId'
>;

export const createWorkflowRunActions: (
  set: WorkflowStoreSet,
  get: WorkflowStoreGet,
) => WorkflowRunActions = (set, get) => ({
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


});

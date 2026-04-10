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
  OutputRoute
} from '../types/workflow';
import { DEFAULT_EXECUTION_CONFIG, AGENT_TEMPLATES } from '../types/workflow';

const STORAGE_KEY_V2 = 'pipi-workflow-v2';
const STORAGE_KEY_V1 = 'pipi-workflow-v1';

// ============ Persistence ============

function loadFromStorage(): Partial<WorkflowState> {
  try {
    // Try V2 first
    const v2 = localStorage.getItem(STORAGE_KEY_V2);
    if (v2) {
      const parsed = JSON.parse(v2);
      return {
        instances: parsed.instances || [],
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
          agents: old.agents || [],
          connections: old.connections || [],
          workflowRuns: old.workflowRuns || [],
          activeRunId: null,
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

  // Agent CRUD (operates on current instance)
  addAgent: (data: { name: string; soulPrompt?: string; task?: string; taskPrompt?: string; taskInstruction?: string; execution?: AgentExecutionConfig; inputFrom?: string | null }) => WorkflowAgent;
  updateAgent: (id: string, updates: Partial<Omit<WorkflowAgent, 'id'>>) => void;
  removeAgent: (id: string) => void;
  updateAgentPosition: (id: string, position: { x: number; y: number }) => void;
  updateAgentSize: (id: string, width: number, height: number) => void;
  setAgentStatus: (id: string, status: WorkflowAgent['status']) => void;
  setAgentInputFrom: (agentId: string, fromId: string | null) => void;

  // Connection CRUD (operates on current instance)
  addConnection: (sourceId: string, targetId: string, condition: string) => WorkflowConnection;
  removeConnection: (id: string) => void;

  // OutputRoute management (operates on current instance)
  addOutputRoute: (agentId: string, route: Omit<OutputRoute, 'id'>) => void;
  updateOutputRoute: (agentId: string, routeId: string, updates: Partial<OutputRoute>) => void;
  removeOutputRoute: (agentId: string, routeId: string) => void;

  // Workflow Run (history) — operates on current instance
  addWorkflowRun: (run: WorkflowRun) => void;
  updateWorkflowRun: (id: string, updates: Partial<WorkflowRun>) => void;
  renameWorkflowRun: (id: string, title: string) => void;
  deleteWorkflowRun: (id: string) => void;
  updateRunAgent: (runId: string, agentId: string, updates: Partial<WorkflowRunAgentEntry>) => void;
  selectRun: (id: string | null) => void;

  // Execution state
  setRunning: (running: boolean, agentId?: string | null) => void;
  resetAllStatuses: () => void;

  // File preview
  setSelectedPreviewFile: (path: string | null) => void;

  // Canvas operations (operates on current instance)
  clearCanvas: () => void;

  // Preset workflows
  createA_B_C_Workflow: () => { agentA: WorkflowAgent; agentB: WorkflowAgent; agentC: WorkflowAgent };
}

export const useWorkflowStore = create<WorkflowStore>((set, get) => ({
  ...initialState,

  // ============ Instance Management ============

  createInstance: (name?: string) => {
    const id = crypto.randomUUID();
    const instance: WorkflowInstance = {
      id,
      name: name || `Workflow ${get().instances.length + 1}`,
      agents: [],
      connections: [],
      workflowRuns: [],
      activeRunId: null,
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
      if (nextId === id) {
        nextId = remaining.length > 0 ? remaining[remaining.length - 1].id : null;
      }
      const newState = {
        ...state,
        instances: remaining,
        currentInstanceId: nextId,
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
      if (idSet.has(nextId ?? '')) {
        nextId = remaining.length > 0 ? remaining[remaining.length - 1].id : null;
      }
      const newState = {
        ...state,
        instances: remaining,
        currentInstanceId: nextId,
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
    };

    set((state) => {
      const newState = {
        ...state,
        ...updateCurrentInstance(state, (inst) => ({
          agents: [...inst.agents, newAgent],
        })),
      };
      saveToStorage(newState);
      return newState;
    });

    return newAgent;
  },

  updateAgent: (id, updates) => {
    set((state) => {
      const newState = {
        ...state,
        ...updateCurrentInstance(state, (inst) => ({
          agents: inst.agents.map(agent =>
            agent.id === id ? { ...agent, ...updates } : agent
          ),
        })),
      };
      saveToStorage(newState);
      return newState;
    });
  },

  removeAgent: (id) => {
    set((state) => {
      const newState = {
        ...state,
        ...updateCurrentInstance(state, (inst) => {
          const newAgents = inst.agents.filter(a => a.id !== id);
          const newConnections = inst.connections.filter(
            c => c.sourceAgentId !== id && c.targetAgentId !== id
          );
          const newAgentsWithCleanRoutes = newAgents.map(agent => ({
            ...agent,
            outputRoutes: agent.outputRoutes.filter(r => r.targetAgentId !== id),
            inputFrom: agent.inputFrom === id ? null : agent.inputFrom,
          }));
          return { agents: newAgentsWithCleanRoutes, connections: newConnections };
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

  setAgentInputFrom: (agentId, fromId) => {
    set((state) => {
      const inst = state.instances.find(i => i.id === state.currentInstanceId);
      if (!inst) return state;

      const currentAgent = inst.agents.find(a => a.id === agentId);
      if (!currentAgent) return state;

      const previousFromId = currentAgent.inputFrom;

      let newConnections = inst.connections.filter(
        c => !(c.sourceAgentId === previousFromId && c.targetAgentId === agentId)
      );

      let newAgents = inst.agents.map(agent => {
        if (agent.id === previousFromId) {
          return {
            ...agent,
            outputRoutes: agent.outputRoutes.filter(r => r.targetAgentId !== agentId),
          };
        }
        if (agent.id === agentId) {
          return { ...agent, inputFrom: fromId };
        }
        return agent;
      });

      if (fromId) {
        const newConnection: WorkflowConnection = {
          id: crypto.randomUUID(),
          sourceAgentId: fromId,
          targetAgentId: agentId,
          condition: 'onComplete',
          type: 'sequential',
        };
        newConnections = [...newConnections, newConnection];

        newAgents = newAgents.map(agent => {
          if (agent.id === fromId) {
            const newRoute: OutputRoute = {
              id: crypto.randomUUID(),
              condition: 'onComplete',
              targetAgentId: agentId,
            };
            return { ...agent, outputRoutes: [...agent.outputRoutes, newRoute] };
          }
          return agent;
        });
      }

      const newState = {
        ...state,
        ...updateCurrentInstance(state, () => ({
          agents: newAgents,
          connections: newConnections,
        })),
      };
      saveToStorage(newState);
      return newState;
    });
  },

  // ============ Connection CRUD ============

  addConnection: (sourceId, targetId, condition) => {
    const newConnection: WorkflowConnection = {
      id: crypto.randomUUID(),
      sourceAgentId: sourceId,
      targetAgentId: targetId,
      condition,
      type: 'sequential',
    };

    set((state) => {
      const newState = {
        ...state,
        ...updateCurrentInstance(state, (inst) => ({
          connections: [...inst.connections, newConnection],
        })),
      };
      saveToStorage(newState);
      return newState;
    });

    return newConnection;
  },

  removeConnection: (id) => {
    set((state) => {
      const newState = {
        ...state,
        ...updateCurrentInstance(state, (inst) => ({
          connections: inst.connections.filter(c => c.id !== id),
        })),
      };
      saveToStorage(newState);
      return newState;
    });
  },

  // ============ OutputRoute Management ============

  addOutputRoute: (agentId, route) => {
    const newRoute: OutputRoute = { ...route, id: crypto.randomUUID() };

    set((state) => {
      const newConnection: WorkflowConnection = {
        id: crypto.randomUUID(),
        sourceAgentId: agentId,
        targetAgentId: route.targetAgentId,
        condition: route.condition,
        type: 'sequential',
      };

      const newState = {
        ...state,
        ...updateCurrentInstance(state, (inst) => {
          const newAgents = inst.agents.map(agent => {
            if (agent.id === agentId) {
              return { ...agent, outputRoutes: [...agent.outputRoutes, newRoute] };
            }
            if (agent.id === route.targetAgentId) {
              return { ...agent, inputFrom: agentId };
            }
            return agent;
          });

          const newConnections = [
            ...inst.connections.filter(
              c => !(c.sourceAgentId === agentId && c.targetAgentId === route.targetAgentId)
            ),
            newConnection,
          ];

          return { agents: newAgents, connections: newConnections };
        }),
      };
      saveToStorage(newState);
      return newState;
    });
  },

  updateOutputRoute: (agentId, routeId, updates) => {
    set((state) => {
      const newState = {
        ...state,
        ...updateCurrentInstance(state, (inst) => ({
          agents: inst.agents.map(agent =>
            agent.id === agentId
              ? {
                  ...agent,
                  outputRoutes: agent.outputRoutes.map(route =>
                    route.id === routeId ? { ...route, ...updates } : route
                  ),
                }
              : agent
          ),
        })),
      };
      saveToStorage(newState);
      return newState;
    });
  },

  removeOutputRoute: (agentId, routeId) => {
    set((state) => {
      const inst = state.instances.find(i => i.id === state.currentInstanceId);
      if (!inst) return state;

      const routeToRemove = inst.agents
        .find(a => a.id === agentId)
        ?.outputRoutes.find(r => r.id === routeId);
      const targetAgentId = routeToRemove?.targetAgentId;

      const newState = {
        ...state,
        ...updateCurrentInstance(state, (innerInst) => {
          const newConnections = innerInst.connections.filter(
            c => !(c.sourceAgentId === agentId && c.targetAgentId === targetAgentId)
          );
          const newAgents = innerInst.agents.map(agent => {
            if (agent.id === agentId) {
              return {
                ...agent,
                outputRoutes: agent.outputRoutes.filter(r => r.id !== routeId),
              };
            }
            if (agent.id === targetAgentId && agent.inputFrom === agentId) {
              return { ...agent, inputFrom: null };
            }
            return agent;
          });
          return { agents: newAgents, connections: newConnections };
        }),
      };
      saveToStorage(newState);
      return newState;
    });
  },

  // ============ Workflow Run (History) ============

  addWorkflowRun: (run) => {
    set((state) => {
      const newState = {
        ...state,
        ...updateCurrentInstance(state, (inst) => ({
          workflowRuns: [run, ...inst.workflowRuns].slice(0, 50),
        })),
      };
      saveToStorage(newState);
      return newState;
    });
  },

  updateWorkflowRun: (id, updates) => {
    set((state) => {
      const newState = {
        ...state,
        ...updateCurrentInstance(state, (inst) => ({
          workflowRuns: inst.workflowRuns.map(run =>
            run.id === id ? { ...run, ...updates } : run
          ),
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
      const newState = {
        ...state,
        ...updateCurrentInstance(state, (inst) => ({
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
      const wasSelected = state.selectedRunId === id;
      const inst = state.instances.find(i => i.id === state.currentInstanceId);
      const runs = inst?.workflowRuns ?? [];
      const runsAfterDelete = runs.filter(run => run.id !== id);

      let nextRunId: string | null = null;
      if (wasSelected) {
        const deletedIndex = runs.findIndex(r => r.id === id);
        nextRunId = runsAfterDelete[deletedIndex]?.id ?? runsAfterDelete[runsAfterDelete.length - 1]?.id ?? null;
      }

      const newState = {
        ...state,
        ...updateCurrentInstance(state, () => ({
          workflowRuns: runsAfterDelete,
        })),
        selectedRunId: wasSelected ? nextRunId : state.selectedRunId,
      };
      saveToStorage(newState);
      return newState;
    });
  },

  updateRunAgent: (runId, agentId, updates) => {
    set((state) => {
      const newState = {
        ...state,
        ...updateCurrentInstance(state, (inst) => ({
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

  selectRun: (id) => {
    set({ selectedRunId: id });
  },

  // ============ Execution State ============

  setRunning: (running, agentId = null) => {
    set((state) => ({
      ...state,
      isRunning: running,
      currentRunningAgentId: agentId,
    }));
  },

  resetAllStatuses: () => {
    set((state) => ({
      ...state,
      ...updateCurrentInstance(state, (inst) => ({
        agents: inst.agents.map(agent => ({ ...agent, status: 'idle' as const })),
      })),
    }));
  },

  setSelectedPreviewFile: (path) => {
    set({ selectedPreviewFile: path });
  },

  // ============ Canvas Operations ============

  clearCanvas: () => {
    set((state) => {
      const newState = {
        ...state,
        ...updateCurrentInstance(state, () => ({
          agents: [],
          connections: [],
        })),
      };
      saveToStorage(newState);
      return newState;
    });
  },

  // ============ Preset Workflow ============

  createA_B_C_Workflow: () => {
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
    });

    const agentB = addAgent({
      name: 'B - Full Stack Developer',
      task: devTemplate?.task || '编写代码',
      taskPrompt: devTemplate?.taskPrompt,
      taskInstruction: devTemplate?.taskInstruction,
      soulPrompt: devTemplate?.soulPrompt || '',
      execution: { mode: 'single' },
      inputFrom: agentA.id,
    });

    const agentC = addAgent({
      name: 'C - QA Engineer',
      task: qaTemplate?.task || '执行测试',
      taskPrompt: qaTemplate?.taskPrompt,
      taskInstruction: qaTemplate?.taskInstruction,
      soulPrompt: qaTemplate?.soulPrompt || '',
      execution: { mode: 'multi-round', maxRounds: 3, roundCondition: 'untilComplete' },
      inputFrom: agentB.id,
    });

    addConnection(agentA.id, agentB.id, 'A → B');
    addConnection(agentB.id, agentC.id, 'B → C');

    return { agentA, agentB, agentC };
  },
}));

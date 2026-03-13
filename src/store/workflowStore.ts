/**
 * Workflow Store - Zustand state management for multi-agent workflow system
 *
 * Manages:
 * - Workflow graph (agents + connections)
 * - Execution state (isRunning, currentRunningAgentId)
 * - Historical run records (workflowRuns)
 *
 * Persistence: agents, connections, workflowRuns are saved to localStorage
 */

import { create } from 'zustand';
import type {
  WorkflowState, WorkflowAgent, WorkflowConnection,
  WorkflowRun, WorkflowRunAgentEntry, AgentExecutionConfig,
  OutputRoute
} from '../types/workflow';
import { DEFAULT_EXECUTION_CONFIG } from '../types/workflow';

const STORAGE_KEY = 'pipi-workflow-v1';

// Load state from localStorage
function loadFromStorage(): Partial<WorkflowState> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.warn('Failed to load workflow from localStorage:', e);
  }
  return {};
}

// Save state to localStorage (only persist agents, connections, workflowRuns)
function saveToStorage(state: WorkflowState): void {
  try {
    const toSave = {
      agents: state.agents,
      connections: state.connections,
      workflowRuns: state.workflowRuns,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  } catch (e) {
    console.error('Failed to save workflow to localStorage:', e);
  }
}

// Initial state
const initialState: WorkflowState = {
  agents: [],
  connections: [],
  isRunning: false,
  currentRunningAgentId: null,
  workflowRuns: [],
};

// Load persisted state
const persistedState = loadFromStorage();
const initialStateWithPersistence: WorkflowState = {
  ...initialState,
  agents: persistedState.agents || [],
  connections: persistedState.connections || [],
  workflowRuns: persistedState.workflowRuns || [],
};

// Store interface includes both state and actions
export interface WorkflowStore extends WorkflowState {
  // Agent CRUD
  addAgent: (data: { name: string; soulPrompt?: string; task?: string; execution?: AgentExecutionConfig }) => WorkflowAgent;
  updateAgent: (id: string, updates: Partial<Omit<WorkflowAgent, 'id'>>) => void;
  removeAgent: (id: string) => void;
  updateAgentPosition: (id: string, position: { x: number; y: number }) => void;
  updateAgentSize: (id: string, width: number, height: number) => void;
  setAgentStatus: (id: string, status: WorkflowAgent['status']) => void;

  // Connection CRUD
  addConnection: (sourceId: string, targetId: string, condition: string) => WorkflowConnection;
  removeConnection: (id: string) => void;

  // OutputRoute management
  addOutputRoute: (agentId: string, route: Omit<OutputRoute, 'id'>) => void;
  updateOutputRoute: (agentId: string, routeId: string, updates: Partial<OutputRoute>) => void;
  removeOutputRoute: (agentId: string, routeId: string) => void;

  // Workflow Run (history)
  addWorkflowRun: (run: WorkflowRun) => void;
  updateWorkflowRun: (id: string, updates: Partial<WorkflowRun>) => void;
  updateRunAgent: (runId: string, agentId: string, updates: Partial<WorkflowRunAgentEntry>) => void;

  // Execution state
  setRunning: (running: boolean, agentId?: string | null) => void;
  resetAllStatuses: () => void;

  // Canvas operations
  clearCanvas: () => void;
}

export const useWorkflowStore = create<WorkflowStore>((set, get) => ({
  ...initialStateWithPersistence,

  // Add a new agent
  addAgent: (data) => {
    const state = get();
    const newAgent: WorkflowAgent = {
      id: crypto.randomUUID(),
      name: data.name || 'New Agent',
      soulPrompt: data.soulPrompt,
      task: data.task,
      position: { x: 100 + state.agents.length * 260, y: 200 },
      status: 'idle',
      outputRoutes: [],
      execution: data.execution || DEFAULT_EXECUTION_CONFIG,
    };

    set((state) => {
      const newState = {
        ...state,
        agents: [...state.agents, newAgent],
      };
      saveToStorage(newState);
      return newState;
    });

    return newAgent;
  },

  // Update an agent
  updateAgent: (id, updates) => {
    set((state) => {
      const newState = {
        ...state,
        agents: state.agents.map((agent) =>
          agent.id === id ? { ...agent, ...updates } : agent
        ),
      };
      saveToStorage(newState);
      return newState;
    });
  },

  // Remove an agent and clean up related connections and routes
  removeAgent: (id) => {
    set((state) => {
      // Remove agent
      const newAgents = state.agents.filter((a) => a.id !== id);

      // Remove connections related to this agent
      const newConnections = state.connections.filter(
        (c) => c.sourceAgentId !== id && c.targetAgentId !== id
      );

      // Remove outputRoutes that target this agent from other agents
      const newAgentsWithCleanRoutes = newAgents.map((agent) => ({
        ...agent,
        outputRoutes: agent.outputRoutes.filter((r) => r.targetAgentId !== id),
      }));

      const newState = {
        ...state,
        agents: newAgentsWithCleanRoutes,
        connections: newConnections,
      };
      saveToStorage(newState);
      return newState;
    });
  },

  // Update agent position
  updateAgentPosition: (id, position) => {
    set((state) => {
      const newState = {
        ...state,
        agents: state.agents.map((agent) =>
          agent.id === id ? { ...agent, position } : agent
        ),
      };
      saveToStorage(newState);
      return newState;
    });
  },

  // Update agent size
  updateAgentSize: (id, width, height) => {
    set((state) => {
      const newState = {
        ...state,
        agents: state.agents.map((agent) =>
          agent.id === id ? { ...agent, width, height } : agent
        ),
      };
      saveToStorage(newState);
      return newState;
    });
  },

  // Set agent status
  setAgentStatus: (id, status) => {
    set((state) => ({
      ...state,
      agents: state.agents.map((agent) =>
        agent.id === id ? { ...agent, status } : agent
      ),
    }));
  },

  // Add a connection between agents
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
        connections: [...state.connections, newConnection],
      };
      saveToStorage(newState);
      return newState;
    });

    return newConnection;
  },

  // Remove a connection
  removeConnection: (id) => {
    set((state) => {
      const newState = {
        ...state,
        connections: state.connections.filter((c) => c.id !== id),
      };
      saveToStorage(newState);
      return newState;
    });
  },

  // Add an output route to an agent
  addOutputRoute: (agentId, route) => {
    const newRoute: OutputRoute = {
      ...route,
      id: crypto.randomUUID(),
    };

    set((state) => {
      const newState = {
        ...state,
        agents: state.agents.map((agent) =>
          agent.id === agentId
            ? { ...agent, outputRoutes: [...agent.outputRoutes, newRoute] }
            : agent
        ),
      };
      saveToStorage(newState);
      return newState;
    });
  },

  // Update an output route
  updateOutputRoute: (agentId, routeId, updates) => {
    set((state) => {
      const newState = {
        ...state,
        agents: state.agents.map((agent) =>
          agent.id === agentId
            ? {
                ...agent,
                outputRoutes: agent.outputRoutes.map((route) =>
                  route.id === routeId ? { ...route, ...updates } : route
                ),
              }
            : agent
        ),
      };
      saveToStorage(newState);
      return newState;
    });
  },

  // Remove an output route
  removeOutputRoute: (agentId, routeId) => {
    set((state) => {
      const newState = {
        ...state,
        agents: state.agents.map((agent) =>
          agent.id === agentId
            ? {
                ...agent,
                outputRoutes: agent.outputRoutes.filter((r) => r.id !== routeId),
              }
            : agent
        ),
      };
      saveToStorage(newState);
      return newState;
    });
  },

  // Add a workflow run
  addWorkflowRun: (run) => {
    set((state) => {
      const newState = {
        ...state,
        workflowRuns: [run, ...state.workflowRuns].slice(0, 50), // Keep last 50 runs
      };
      saveToStorage(newState);
      return newState;
    });
  },

  // Update a workflow run
  updateWorkflowRun: (id, updates) => {
    set((state) => {
      const newState = {
        ...state,
        workflowRuns: state.workflowRuns.map((run) =>
          run.id === id ? { ...run, ...updates } : run
        ),
      };
      saveToStorage(newState);
      return newState;
    });
  },

  // Update an agent entry within a workflow run
  updateRunAgent: (runId, agentId, updates) => {
    set((state) => {
      const newState = {
        ...state,
        workflowRuns: state.workflowRuns.map((run) =>
          run.id === runId
            ? {
                ...run,
                agents: run.agents.map((entry) =>
                  entry.agentId === agentId ? { ...entry, ...updates } : entry
                ),
              }
            : run
        ),
      };
      saveToStorage(newState);
      return newState;
    });
  },

  // Set running state
  setRunning: (running, agentId = null) => {
    set((state) => ({
      ...state,
      isRunning: running,
      currentRunningAgentId: agentId,
    }));
  },

  // Reset all agent statuses to idle
  resetAllStatuses: () => {
    set((state) => ({
      ...state,
      agents: state.agents.map((agent) => ({ ...agent, status: 'idle' })),
    }));
  },

  // Clear canvas (agents and connections, but keep history)
  clearCanvas: () => {
    set((state) => {
      const newState = {
        ...state,
        agents: [],
        connections: [],
      };
      saveToStorage(newState);
      return newState;
    });
  },
}));

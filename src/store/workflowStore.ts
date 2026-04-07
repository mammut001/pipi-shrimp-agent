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
import { DEFAULT_EXECUTION_CONFIG, AGENT_TEMPLATES } from '../types/workflow';

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
  selectedRunId: null,
};

// Load persisted state
const persistedState = loadFromStorage();
const initialStateWithPersistence: WorkflowState = {
  ...initialState,
  agents: persistedState.agents || [],
  connections: persistedState.connections || [],
  workflowRuns: persistedState.workflowRuns || [],
  selectedRunId: null, // always start null (latest) on page load
};

// Store interface includes both state and actions
export interface WorkflowStore extends WorkflowState {
  // Agent CRUD
  addAgent: (data: { name: string; soulPrompt?: string; task?: string; execution?: AgentExecutionConfig; inputFrom?: string | null }) => WorkflowAgent;
  updateAgent: (id: string, updates: Partial<Omit<WorkflowAgent, 'id'>>) => void;
  removeAgent: (id: string) => void;
  updateAgentPosition: (id: string, position: { x: number; y: number }) => void;
  updateAgentSize: (id: string, width: number, height: number) => void;
  setAgentStatus: (id: string, status: WorkflowAgent['status']) => void;
  setAgentInputFrom: (agentId: string, fromId: string | null) => void;

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
  renameWorkflowRun: (id: string, title: string) => void;
  deleteWorkflowRun: (id: string) => void;
  updateRunAgent: (runId: string, agentId: string, updates: Partial<WorkflowRunAgentEntry>) => void;
  selectRun: (id: string | null) => void;

  // Execution state
  setRunning: (running: boolean, agentId?: string | null) => void;
  resetAllStatuses: () => void;

  // Canvas operations
  clearCanvas: () => void;

  // Preset workflows
  createA_B_C_Workflow: () => { agentA: WorkflowAgent; agentB: WorkflowAgent; agentC: WorkflowAgent };
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
      inputFrom: data.inputFrom ?? null,
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
      // Also reset inputFrom for any agent that pointed to the deleted agent
      const newAgentsWithCleanRoutes = newAgents.map((agent) => ({
        ...agent,
        outputRoutes: agent.outputRoutes.filter((r) => r.targetAgentId !== id),
        inputFrom: agent.inputFrom === id ? null : agent.inputFrom,
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

  // Set agent's upstream (inputFrom)
  // This also automatically creates/removes corresponding connection and outputRoute
  setAgentInputFrom: (agentId, fromId) => {
    set((state) => {
      const currentAgent = state.agents.find((a) => a.id === agentId);
      if (!currentAgent) return state;

      const previousFromId = currentAgent.inputFrom;

      // Remove previous connection and outputRoute if exists
      let newConnections = state.connections.filter(
        (c) => !(c.sourceAgentId === previousFromId && c.targetAgentId === agentId)
      );

      let newAgents = state.agents.map((agent) => {
        // Remove outputRoute from previous source agent
        if (agent.id === previousFromId) {
          return {
            ...agent,
            outputRoutes: agent.outputRoutes.filter((r) => r.targetAgentId !== agentId),
          };
        }
        // Update inputFrom for current agent
        if (agent.id === agentId) {
          return { ...agent, inputFrom: fromId };
        }
        return agent;
      });

      // Create new connection and outputRoute if fromId is provided
      if (fromId) {
        const newConnection: WorkflowConnection = {
          id: crypto.randomUUID(),
          sourceAgentId: fromId,
          targetAgentId: agentId,
          condition: 'onComplete',
          type: 'sequential',
        };
        newConnections = [...newConnections, newConnection];

        newAgents = newAgents.map((agent) => {
          if (agent.id === fromId) {
            const newRoute: OutputRoute = {
              id: crypto.randomUUID(),
              condition: 'onComplete',
              targetAgentId: agentId,
            };
            return {
              ...agent,
              outputRoutes: [...agent.outputRoutes, newRoute],
            };
          }
          return agent;
        });
      }

      const newState = {
        ...state,
        agents: newAgents,
        connections: newConnections,
      };
      saveToStorage(newState);
      return newState;
    });
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
  // This also automatically sets the target agent's inputFrom and creates a connection
  addOutputRoute: (agentId, route) => {
    const newRoute: OutputRoute = {
      ...route,
      id: crypto.randomUUID(),
    };

    set((state) => {
      // Create the connection
      const newConnection: WorkflowConnection = {
        id: crypto.randomUUID(),
        sourceAgentId: agentId,
        targetAgentId: route.targetAgentId,
        condition: route.condition,
        type: 'sequential',
      };

      // Update agents: add route to source, set inputFrom on target
      const newAgents = state.agents.map((agent) => {
        if (agent.id === agentId) {
          // Add route to source agent
          return { ...agent, outputRoutes: [...agent.outputRoutes, newRoute] };
        }
        if (agent.id === route.targetAgentId) {
          // Set target agent's inputFrom to this agent
          return { ...agent, inputFrom: agentId };
        }
        return agent;
      });

      // Remove any existing connection between these two agents
      const newConnections = [
        ...state.connections.filter(
          (c) => !(c.sourceAgentId === agentId && c.targetAgentId === route.targetAgentId)
        ),
        newConnection,
      ];

      const newState = {
        ...state,
        agents: newAgents,
        connections: newConnections,
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
  // This also clears the target agent's inputFrom and removes the connection
  removeOutputRoute: (agentId, routeId) => {
    set((state) => {
      // Find the route to get the targetAgentId
      const routeToRemove = state.agents
        .find((a) => a.id === agentId)
        ?.outputRoutes.find((r) => r.id === routeId);

      const targetAgentId = routeToRemove?.targetAgentId;

      // Remove connection
      const newConnections = state.connections.filter(
        (c) => !(c.sourceAgentId === agentId && c.targetAgentId === targetAgentId)
      );

      // Update agents
      const newAgents = state.agents.map((agent) => {
        if (agent.id === agentId) {
          // Remove route from source agent
          return {
            ...agent,
            outputRoutes: agent.outputRoutes.filter((r) => r.id !== routeId),
          };
        }
        if (agent.id === targetAgentId && agent.inputFrom === agentId) {
          // Clear target agent's inputFrom if it was pointing to this agent
          return { ...agent, inputFrom: null };
        }
        return agent;
      });

      const newState = {
        ...state,
        agents: newAgents,
        connections: newConnections,
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

  renameWorkflowRun: (id, title) => {
    const trimmed = title.trim();
    if (!trimmed) return; // reject empty / whitespace-only titles
    set((state) => {
      const newState = {
        ...state,
        workflowRuns: state.workflowRuns.map((run) =>
          run.id === id ? { ...run, title: trimmed } : run
        ),
      };
      saveToStorage(newState);
      return newState;
    });
  },

  deleteWorkflowRun: (id) => {
    set((state) => {
      const wasSelected = state.selectedRunId === id;
      const runsAfterDelete = state.workflowRuns.filter((run) => run.id !== id);
      // Auto-select the run that followed the deleted one, or the new last item
      let nextRunId: string | null = null;
      if (wasSelected) {
        const deletedIndex = state.workflowRuns.findIndex((r) => r.id === id);
        nextRunId = runsAfterDelete[deletedIndex]?.id ?? runsAfterDelete[runsAfterDelete.length - 1]?.id ?? null;
      }
      const newState = {
        ...state,
        workflowRuns: runsAfterDelete,
        selectedRunId: nextRunId,
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

  // Select a run for output display (null = auto: latest run)
  selectRun: (id) => {
    set((state) => ({ ...state, selectedRunId: id }));
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

  // Preset workflow: A (Writer) → B (Developer) → C (QA with feedback loop)
  createA_B_C_Workflow: () => {
    const { addAgent, addConnection } = get();

    // Find templates
    const writerTemplate = AGENT_TEMPLATES.find(t => t.id === 'tech-writer');
    const devTemplate = AGENT_TEMPLATES.find(t => t.id === 'fullstack-dev');
    const qaTemplate = AGENT_TEMPLATES.find(t => t.id === 'qa-engineer');

    // Create Agent A (Writer) - entry node
    const agentA = addAgent({
      name: 'A - Technical Writer',
      task: writerTemplate?.task || '编写需求文档',
      soulPrompt: writerTemplate?.soulPrompt || '',
      execution: { mode: 'single' },
      inputFrom: null,
    });

    // Create Agent B (Developer)
    const agentB = addAgent({
      name: 'B - Full Stack Developer',
      task: devTemplate?.task || '编写代码',
      soulPrompt: devTemplate?.soulPrompt || '',
      execution: { mode: 'single' },
      inputFrom: agentA.id,
    });

    // Create Agent C (QA) - multi-round execution
    const agentC = addAgent({
      name: 'C - QA Engineer',
      task: qaTemplate?.task || '执行测试',
      soulPrompt: qaTemplate?.soulPrompt || '',
      execution: { mode: 'multi-round', maxRounds: 3, roundCondition: 'untilComplete' },
      inputFrom: agentB.id,
    });

    // Add sequential connections
    addConnection(agentA.id, agentB.id, 'A → B');
    addConnection(agentB.id, agentC.id, 'B → C');

    // Note: <REJECT:CODE> and <REJECT:DOC> routing is handled by evaluateNextAgent fallback
    // No need to add explicit outputRoutes since fallback finds agents by name

    return { agentA, agentB, agentC };
  },
}));

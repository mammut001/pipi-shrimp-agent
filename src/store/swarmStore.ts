/**
 * Swarm Store — Zustand state for swarm runtime UI binding
 *
 * This store provides reactive state derived from the swarm repository.
 * UI components subscribe to this store instead of querying the repository directly.
 *
 * Design:
 * - Subscribes to repository event bus for automatic sync
 * - Provides computed/derived views (team summaries, agent details, etc.)
 * - Handles initialization (restore from localStorage) and cleanup
 * - Single source of truth for all swarm-related UI state
 */

import { create } from 'zustand';
import type {
  SwarmTeam,
  SwarmAgent,
  SwarmTask,
  SwarmMessage,
  SwarmRun,
  SwarmPermissionRequest,
  TranscriptEntry,
} from '../services/swarm/types';
import * as repo from '../services/swarm/repository';
import {
  getTeamTaskSummary,
} from '../services/swarm/taskManager';
import {
  getInboxSummary,
} from '../services/swarm/messageService';
import { stopAllPolling } from '../services/swarm/inboxCoordinator';
import {
  getTranscriptSummary,
} from '../services/swarm/transcript';

// =============================================================================
// Constants
// =============================================================================

/** Maximum messages to keep in memory to prevent unbounded growth */
const MAX_MESSAGES = 500;

/** Maximum agents to keep in memory */
const MAX_AGENTS = 200;

/** Maximum tasks to keep in memory */
const MAX_TASKS = 500;

// =============================================================================
// State interface
// =============================================================================

export interface SwarmStoreState {
  // ===== Runtime data =====
  runs: SwarmRun[];
  teams: SwarmTeam[];
  agents: SwarmAgent[];
  tasks: SwarmTask[];
  messages: SwarmMessage[];
  pendingPermissions: SwarmPermissionRequest[];

  // ===== UI selection state =====
  selectedTeamId: string | null;
  selectedAgentId: string | null;
  /** Whether the swarm panel is expanded */
  panelExpanded: boolean;

  // ===== Derived counts (updated on sync) =====
  totalUnreadCount: number;
  totalPendingPermissions: number;
  activeAgentCount: number;

  // ===== Initialization =====
  initialized: boolean;

  // ===== Actions =====
  /** Initialize store: restore from storage and subscribe to events */
  init: () => void;
  /** Manual sync from repository (called on events) */
  sync: () => void;
  /** Cleanup: unsubscribe and stop pollers */
  cleanup: () => void;
  /** Select a team for inspection */
  selectTeam: (teamId: string | null) => void;
  /** Select an agent for inspection */
  selectAgent: (agentId: string | null) => void;
  /** Toggle panel expansion */
  togglePanel: () => void;

  // ===== Derived selectors =====
  /** Get agents for the selected team */
  getSelectedTeamAgents: () => SwarmAgent[];
  /** Get tasks for the selected team */
  getSelectedTeamTasks: () => SwarmTask[];
  /** Get messages for the selected team */
  getSelectedTeamMessages: () => SwarmMessage[];
  /** Get transcript for the selected agent */
  getSelectedAgentTranscript: () => TranscriptEntry[];
  /** Get task summary for a team */
  getTeamTaskSummary: (teamId: string) => ReturnType<typeof getTeamTaskSummary>;
  /** Get inbox summary for an agent */
  getAgentInboxSummary: (agentId: string) => ReturnType<typeof getInboxSummary>;
  /** Get transcript summary for an agent */
  getAgentTranscriptSummary: (agentId: string) => ReturnType<typeof getTranscriptSummary>;
}

// =============================================================================
// Helper: Trim arrays to prevent memory leaks
// =============================================================================

/**
 * Trim array to max length, keeping most recent items
 */
function trimArray<T>(arr: T[], maxLength: number): T[] {
  if (arr.length <= maxLength) return arr;
  return arr.slice(-maxLength);
}

/**
 * Enforce memory limits on store arrays
 */
function enforceMemoryLimits(state: {
  messages: SwarmMessage[];
  agents: SwarmAgent[];
  tasks: SwarmTask[];
}): { messages: SwarmMessage[]; agents: SwarmAgent[]; tasks: SwarmTask[] } {
  return {
    messages: trimArray(state.messages, MAX_MESSAGES),
    agents: trimArray(state.agents, MAX_AGENTS),
    tasks: trimArray(state.tasks, MAX_TASKS),
  };
}

// =============================================================================
// Store implementation
// =============================================================================

let unsubscribe: (() => void) | null = null;

export const useSwarmStore = create<SwarmStoreState>((set, get) => ({
  // Initial state
  runs: [],
  teams: [],
  agents: [],
  tasks: [],
  messages: [],
  pendingPermissions: [],
  selectedTeamId: null,
  selectedAgentId: null,
  panelExpanded: false,
  totalUnreadCount: 0,
  totalPendingPermissions: 0,
  activeAgentCount: 0,
  initialized: false,

  init: async () => {
    if (get().initialized) return;

    // Restore persisted state (now async via persistence bridge)
    await repo.restoreFromStorage();

    // Subscribe to repository events for live sync
    unsubscribe = repo.subscribe(() => {
      get().sync();
    });

    // Initial sync
    get().sync();

    set({ initialized: true });
    console.log('[SwarmStore] Initialized');
  },

  sync: () => {
    const prevActiveCount = get().activeAgentCount;
    const allAgents = repo.getAllAgents();
    const pendingPerms = repo.getPendingPermissions();

    // Compute total unread across all agents
    let totalUnread = 0;
    for (const agent of allAgents) {
      totalUnread += repo.getUnreadMessages(agent.id).length;
    }

    const newActiveCount = allAgents.filter(a => a.status === 'working').length;

    // Auto-expand the panel the first time active agents appear (e.g., when delegation starts).
    // This ensures the user sees runtime activity without having to click manually.
    const panelExpanded = (!get().panelExpanded && prevActiveCount === 0 && newActiveCount > 0)
      ? true
      : get().panelExpanded;

    // Get raw data from repository
    const rawMessages = repo.getAllMessages();
    const rawAgents = allAgents;
    const rawTasks = repo.getAllTasks();

    // Enforce memory limits to prevent unbounded growth
    const { messages, agents, tasks } = enforceMemoryLimits({
      messages: rawMessages,
      agents: rawAgents,
      tasks: rawTasks,
    });

    set({
      runs: repo.getAllRuns(),
      teams: repo.getAllTeams(),
      agents,
      tasks,
      messages,
      pendingPermissions: pendingPerms,
      totalUnreadCount: totalUnread,
      totalPendingPermissions: pendingPerms.length,
      activeAgentCount: newActiveCount,
      panelExpanded,
    });
  },

  cleanup: () => {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
    // Stop all inbox pollers to prevent memory leaks
    stopAllPolling();
    set({ initialized: false });
  },

  selectTeam: (teamId) => set({ selectedTeamId: teamId, selectedAgentId: null }),
  selectAgent: (agentId) => set({ selectedAgentId: agentId }),
  togglePanel: () => set((s) => ({ panelExpanded: !s.panelExpanded })),

  // Derived selectors
  getSelectedTeamAgents: () => {
    const { selectedTeamId, agents } = get();
    if (!selectedTeamId) return [];
    return agents.filter(a => a.teamId === selectedTeamId);
  },

  getSelectedTeamTasks: () => {
    const { selectedTeamId, tasks } = get();
    if (!selectedTeamId) return [];
    return tasks.filter(t => t.teamId === selectedTeamId);
  },

  getSelectedTeamMessages: () => {
    const { selectedTeamId, messages } = get();
    if (!selectedTeamId) return [];
    return messages.filter(m => m.teamId === selectedTeamId);
  },

  getSelectedAgentTranscript: () => {
    const { selectedAgentId } = get();
    if (!selectedAgentId) return [];
    return repo.getTranscriptForAgent(selectedAgentId);
  },

  getTeamTaskSummary: (teamId: string) => getTeamTaskSummary(teamId),
  getAgentInboxSummary: (agentId: string) => getInboxSummary(agentId),
  getAgentTranscriptSummary: (agentId: string) => getTranscriptSummary(agentId),
}));

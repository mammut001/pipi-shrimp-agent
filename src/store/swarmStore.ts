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
import {
  getTranscriptSummary,
} from '../services/swarm/transcript';

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

  init: () => {
    if (get().initialized) return;

    // Restore persisted state
    repo.restoreFromStorage();

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
    const allAgents = repo.getAllAgents();
    const pendingPerms = repo.getPendingPermissions();

    // Compute total unread across all agents
    let totalUnread = 0;
    for (const agent of allAgents) {
      totalUnread += repo.getUnreadMessages(agent.id).length;
    }

    set({
      runs: repo.getAllRuns(),
      teams: repo.getAllTeams(),
      agents: allAgents,
      tasks: repo.getAllTasks(),
      messages: repo.getAllMessages(),
      pendingPermissions: pendingPerms,
      totalUnreadCount: totalUnread,
      totalPendingPermissions: pendingPerms.length,
      activeAgentCount: allAgents.filter(a => a.status === 'working').length,
    });
  },

  cleanup: () => {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
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

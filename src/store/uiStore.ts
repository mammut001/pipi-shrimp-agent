/**
 * UI store - Zustand state management for UI state
 */

import { create } from 'zustand';
import type { UIState, PermissionRequest, Notification } from '../types/ui';
import { NOTIFICATION_TIMEOUT } from '../types/ui';

/**
 * Storage key for persisting agent instructions
 */
const AGENT_INSTRUCTIONS_STORAGE_KEY = 'ai-agent-instructions';

/**
 * UI store using Zustand
 */
export const useUIStore = create<UIState>((set) => ({
  // ========== Initial State ==========
  sidebarVisible: true,
  settingsOpen: false,
  currentView: 'chat',
  currentArtifactId: undefined,
  pendingPermission: undefined,
  notifications: [],
  showApiKey: false,

  // Agentic UI State
  permissionMode: 'standard',
  rightPanelVisible: true,
  agentInstructions: localStorage.getItem(AGENT_INSTRUCTIONS_STORAGE_KEY) || 'You are a powerful AI Agent designed by the Google Deepmind team.',
  taskProgress: [],

  // ========== Action Methods ==========

  /**
   * Set current view (chat or workflow)
   */
  setCurrentView: (view: 'chat' | 'workflow') =>
    set({ currentView: view }),

  /**
   * Toggle sidebar visibility
   */
  toggleSidebar: () =>
    set((state) => ({ sidebarVisible: !state.sidebarVisible })),

  /**
   * Toggle settings panel
   */
  toggleSettings: () =>
    set((state) => ({ settingsOpen: !state.settingsOpen })),

  /**
   * Toggle API key visibility
   */
  toggleShowApiKey: () =>
    set((state) => ({ showApiKey: !state.showApiKey })),

  /**
   * Set current preview artifact ID
   */
  setArtifactId: (id: string) =>
    set({ currentArtifactId: id }),

  /**
   * Clear artifact ID
   */
  clearArtifactId: () =>
    set({ currentArtifactId: undefined }),

  /**
   * Set pending permission request
   */
  setPermissionRequest: (req: PermissionRequest) =>
    set({ pendingPermission: req }),

  /**
   * Clear permission request
   */
  clearPermissionRequest: () =>
    set({ pendingPermission: undefined }),

  /**
   * Add notification with auto-dismiss
   */
  addNotification: (type: Notification['type'], message: string) => {
    const id = crypto.randomUUID();

    set((state) => ({
      notifications: [
        ...state.notifications,
        { id, type, message, timestamp: Date.now() },
      ],
    }));

    // Auto-remove notification after timeout
    setTimeout(() => {
      set((state) => ({
        notifications: state.notifications.filter((n) => n.id !== id),
      }));
    }, NOTIFICATION_TIMEOUT);
  },

  /**
   * Remove notification by ID
   */
  removeNotification: (id: string) =>
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id),
    })),

  /**
   * Clear all notifications
   */
  clearNotifications: () =>
    set({ notifications: [] }),

  // Agentic Actions
  setPermissionMode: (mode) => set({ permissionMode: mode }),
  toggleRightPanel: () => set((state) => ({ rightPanelVisible: !state.rightPanelVisible })),
  setAgentInstructions: (agentInstructions) => {
    set({ agentInstructions });
    localStorage.setItem(AGENT_INSTRUCTIONS_STORAGE_KEY, agentInstructions);
  },
  addTaskStep: (label) => set((state) => ({
    taskProgress: [...state.taskProgress, { id: crypto.randomUUID(), label, status: 'pending' }]
  })),
  updateTaskStep: (id, status) => set((state) => ({
    taskProgress: state.taskProgress.map(step => step.id === id ? { ...step, status } : step)
  })),
  clearTaskProgress: () => set({ taskProgress: [] }),
}));

export type { PermissionRequest, Notification, TaskStep } from '../types/ui';

/**
 * UI store - Zustand state management for UI state
 */

import { create } from 'zustand';
import type { UIState, PermissionRequest, Notification } from '../types/ui';
import { NOTIFICATION_TIMEOUT } from '../types/ui';

/**
 * UI store using Zustand
 */
export const useUIStore = create<UIState>((set) => ({
  // ========== Initial State ==========
  sidebarVisible: true,
  settingsOpen: false,
  currentArtifactId: undefined,
  pendingPermission: undefined,
  notifications: [],
  showApiKey: false,

  // ========== Action Methods ==========

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
}));

export type { PermissionRequest, Notification } from '../types/ui';

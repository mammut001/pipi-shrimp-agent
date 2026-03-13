/**
 * UI-related type definitions
 * Includes PermissionRequest and UIState interfaces
 */

// ============= Type Definitions =============

/** Permission request dialog */
export interface PermissionRequest {
  id: string;
  toolName: string;        // Tool name (e.g., "execute_code")
  toolInput: string;       // Tool input (JSON string)
  description?: string;    // User-friendly description
}

/** Notification item */
export interface Notification {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  message: string;
  timestamp?: number;
}

/** UI store state interface */
export interface UIState {
  // ========== Data State ==========
  sidebarVisible: boolean;
  settingsOpen: boolean;
  currentArtifactId?: string;
  pendingPermission?: PermissionRequest;
  notifications: Notification[];
  showApiKey: boolean;

  // ========== Action Methods ==========

  /**
   * Toggle sidebar visibility
   */
  toggleSidebar: () => void;

  /**
   * Toggle settings panel
   */
  toggleSettings: () => void;

  /**
   * Toggle API key visibility
   */
  toggleShowApiKey: () => void;

  /**
   * Set current preview artifact ID
   */
  setArtifactId: (id: string) => void;

  /**
   * Clear artifact ID
   */
  clearArtifactId: () => void;

  /**
   * Set pending permission request
   */
  setPermissionRequest: (req: PermissionRequest) => void;

  /**
   * Clear permission request
   */
  clearPermissionRequest: () => void;

  /**
   * Add notification
   */
  addNotification: (type: Notification['type'], message: string) => void;

  /**
   * Remove notification
   */
  removeNotification: (id: string) => void;

  /**
   * Clear all notifications
   */
  clearNotifications: () => void;
}

// ============= Constants =============

/** Default notification auto-dismiss timeout in ms */
export const NOTIFICATION_TIMEOUT = 3000;

/** Notification types */
export const NOTIFICATION_TYPES = ['info', 'success', 'warning', 'error'] as const;

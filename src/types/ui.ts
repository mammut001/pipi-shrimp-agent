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

/** Task step for progress tracking */
export interface TaskStep {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'done' | 'failed';
}

/** UI store state interface */
export interface UIState {
  // ========== Data State ==========
  sidebarVisible: boolean;
  settingsOpen: boolean;
  currentView: 'chat' | 'workflow' | 'skill';
  currentArtifactId?: string;
  pendingPermission?: PermissionRequest;
  notifications: Notification[];
  showApiKey: boolean;
  
  // Agentic UI State
  permissionMode: 'standard' | 'auto-edits' | 'bypass' | 'plan-only';
  rightPanelVisible: boolean;
  agentInstructions: string;
  taskProgress: TaskStep[];

  // ========== Action Methods ==========

  /**
   * Set current view (chat, workflow, or skill)
   */
  setCurrentView: (view: 'chat' | 'workflow' | 'skill') => void;

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

  // Agentic Actions
  setPermissionMode: (mode: UIState['permissionMode']) => void;
  toggleRightPanel: () => void;
  setAgentInstructions: (instructions: string) => void;
  addTaskStep: (label: string) => void;
  updateTaskStep: (id: string, status: TaskStep['status']) => void;
  clearTaskProgress: () => void;
}

// ============= Constants =============

/** Default notification auto-dismiss timeout in ms */
export const NOTIFICATION_TIMEOUT = 3000;

/** Notification types */
export const NOTIFICATION_TYPES = ['info', 'success', 'warning', 'error'] as const;

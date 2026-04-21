/**
 * UI-related type definitions
 * Includes PermissionRequest and UIState interfaces
 */

// ============= Type Definitions =============

/** Browser dock mode - defines how browser is displayed in the app */
export type BrowserDockMode =
  | 'hidden'    // no in-app browser visible
  | 'panel'     // browser represented only inside right panel browser tab
  | 'split'     // browser occupies a dedicated workspace pane next to chat
  | 'external'; // actual browser lives in separate window

/** Split focus - determines which split pane is visually emphasized */
export type SplitFocus = 'browser' | 'chat';

/** Permission request dialog */
export interface PermissionRequest {
  id: string;
  toolName: string;        // Tool name (e.g., "execute_code")
  toolInput: string;       // Tool input (JSON string)
  description?: string;    // User-friendly description
  _resolve?: (approved: boolean) => void; // Used by QueryEngine to wait for user decision
}

/** Notification item */
export interface Notification {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error' | 'skill';
  message: string;
  timestamp?: number;
  sessionId?: string;
}

/** Task step for progress tracking */
export interface TaskStep {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'done' | 'failed';
}

/** Questionnaire field definition */
export interface QuestionnaireField {
  id: string;
  label: string;
  type: 'text' | 'textarea' | 'select' | 'boolean';
  required: boolean;
  placeholder?: string;
  options?: string[];
}

/** Active questionnaire data */
export interface QuestionnaireData {
  toolCallId: string;
  sessionId?: string;
  title: string;
  description: string;
  fields: QuestionnaireField[];
  _resolve?: (response: string) => void;
}

/** Project fingerprint - result from project analysis */
export interface ProjectFingerprint {
  name: string;
  description: string;
  tech_stack: string[];
  key_files: Array<{ name: string; path: string; is_directory: boolean }>;
  structure_summary: string;
  language_stats: Record<string, number>;
}

/** UI store state interface */
export interface UIState {
  // ========== Data State ==========
  sidebarVisible: boolean;
  settingsOpen: boolean;
  // NOTE: 'browser' as a view is deprecated - use browserDockMode instead
  currentView: 'chat' | 'workflow' | 'skill' | 'browser';
  currentArtifactId?: string;
  permissionQueue: PermissionRequest[];  // FIFO queue — supports multiple concurrent tool calls
  notifications: Notification[];
  notificationHistory: Notification[];
  showApiKey: boolean;
  activeQuestionnaireSessionId: string | null;
  selectedResumeTemplates: Record<string, string>;

  // Agentic UI State
  rightPanelVisible: boolean;
  agentInstructions: string;
  taskProgress: TaskStep[];

  // Terminal Panel State (bottom panel, VS Code-style)
  terminalPanelVisible: boolean;
  terminalPanelHeight: number;

  /** Name of the skill currently being invoked (shown in AgentPanel, clears after 3s) */
  activeSkill: string | null;

  // Right panel active tab (global so external triggers like browser intent can switch it)
  agentPanelTab: 'main' | 'browser' | 'roadmap' | 'files' | 'artifact-preview' | 'autoresearch';

  // Browser Dock State (see browser-docked-layout-design.md)
  browserDockMode: BrowserDockMode;
  browserSplitFocus: SplitFocus;
  browserPaneWidth: number;
  browserPaneVisible: boolean;

  // Chrome connect prompt (shown when task complexity requires real Chrome)
  chromePromptVisible: boolean;
  chromePromptTargetUrl: string | null;
  showChromePrompt: (targetUrl: string) => Promise<boolean>;
  resolveChromePrompt: (useCdp: boolean) => void;

  // Questionnaire state
  activeQuestionnaire: QuestionnaireData | null;
  showQuestionnaire: (sessionId: string, data: Omit<QuestionnaireData, '_resolve' | 'sessionId'>) => Promise<string>;
  submitQuestionnaire: (response: string, sessionId?: string) => void;
  clearQuestionnaire: (sessionId?: string) => void;

  // Project Analysis State
  isAnalyzingProject: boolean;
  analysisProgress: string;
  projectFingerprint: ProjectFingerprint | null;
  setAnalyzingProject: (analyzing: boolean, progress?: string) => void;
  setProjectFingerprint: (fingerprint: ProjectFingerprint | null) => void;

  // ========== Action Methods ==========

  /**
   * Set current view (chat, workflow, or skill)
   */
  setCurrentView: (view: 'chat' | 'workflow' | 'skill' | 'browser') => void;

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
   * Clear ALL pending permission requests (used when switching sessions)
   */
  clearAllPermissions: () => void;

  /**
   * Wait for user permission for a specific tool call. Resolves with true if approved.
   */
  waitForPermission: (tool: { id: string; name: string; arguments: string }) => Promise<boolean>;

  /**
   * Add notification
   */
  addNotification: (type: Notification['type'], message: string, sessionId?: string) => void;

  /**
   * Remove notification
   */
  removeNotification: (id: string) => void;

  /**
   * Clear all notifications
   */
  clearNotifications: () => void;

  /**
   * Clear notification history
   */
  clearNotificationHistory: (sessionId?: string) => void;

  /**
   * Persist the selected resume template for a session so carousel state survives rerenders.
   */
  setSelectedResumeTemplate: (sessionId: string, templateId: string | null) => void;

  /**
   * Set/clear the currently active skill name (for AgentPanel highlight)
   */
  setActiveSkill: (name: string | null) => void;

  // Agentic Actions
  toggleRightPanel: () => void;
  setAgentInstructions: (instructions: string) => void;
  addTaskStep: (label: string, id?: string) => void;
  updateTaskStep: (id: string, status: TaskStep['status']) => void;
  setTaskProgress: (steps: TaskStep[]) => void;
  clearTaskProgress: () => void;
  setAgentPanelTab: (tab: UIState['agentPanelTab']) => void;

  // Terminal Panel Actions
  toggleTerminalPanel: () => void;
  setTerminalPanelHeight: (height: number) => void;

  // Browser Dock Actions (see browser-docked-layout-design.md)
  setBrowserDockMode: (mode: BrowserDockMode) => void;
  expandBrowserToSplit: () => void;
  collapseBrowserToPanel: () => void;
  focusBrowserPane: () => void;
  focusChatPane: () => void;
  openBrowserExternal: () => void;
  closeBrowserDock: () => void;
  setBrowserPaneWidth: (width: number) => void;
}

// ============= Constants =============

/** Default notification auto-dismiss timeout in ms */
export const NOTIFICATION_TIMEOUT = 3000;

/** Maximum number of notifications to retain in history */
export const NOTIFICATION_HISTORY_LIMIT = 20;

/** Notification types */
export const NOTIFICATION_TYPES = ['info', 'success', 'warning', 'error'] as const;

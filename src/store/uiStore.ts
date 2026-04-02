/**
 * UI store - Zustand state management for UI state
 */

import { create } from 'zustand';
import type { UIState, PermissionRequest, Notification, BrowserDockMode, SplitFocus } from '../types/ui';
import { NOTIFICATION_TIMEOUT } from '../types/ui';

/**
 * Storage key for persisting agent instructions
 */
const AGENT_INSTRUCTIONS_STORAGE_KEY = 'ai-agent-instructions';

/**
 * Storage key for persisting current view (chat, workflow, skill)
 */
const CURRENT_VIEW_STORAGE_KEY = 'ai-agent-current-view';

/**
 * Get persisted current view, default to 'chat'
 */
const getInitialCurrentView = (): 'chat' | 'workflow' | 'skill' | 'browser' => {
  const saved = localStorage.getItem(CURRENT_VIEW_STORAGE_KEY);
  if (saved === 'chat' || saved === 'workflow' || saved === 'skill' || saved === 'browser') {
    return saved;
  }
  return 'chat';
};

// Promise resolver for the Chrome connect prompt (module-level, one at a time)
let _chromePromptResolver: ((useCdp: boolean) => void) | null = null;

/**
 * UI store using Zustand
 */
export const useUIStore = create<UIState>((set) => ({
  // ========== Initial State ==========
  sidebarVisible: true,
  settingsOpen: false,
  currentView: getInitialCurrentView(),
  currentArtifactId: undefined,
  permissionQueue: [],
  notifications: [],
  showApiKey: false,

  // Agentic UI State
  rightPanelVisible: true,
  agentPanelTab: 'main' as const,
  agentInstructions: localStorage.getItem(AGENT_INSTRUCTIONS_STORAGE_KEY) || 'You are a powerful AI Agent designed by the Google Deepmind team.',
  taskProgress: [],

  // Browser Dock State (see browser-docked-layout-design.md)
  browserDockMode: 'hidden' as BrowserDockMode,
  browserSplitFocus: 'chat' as SplitFocus,
  browserPaneWidth: 400,
  browserPaneVisible: false,

  // Chrome connect prompt
  chromePromptVisible: false,
  chromePromptTargetUrl: null,

  // Project Analysis State
  isAnalyzingProject: false,
  analysisProgress: '',
  projectFingerprint: null,

  // ========== Action Methods ==========

  /**
   * Set current view (chat, workflow, or skill)
   */
  setCurrentView: (view: 'chat' | 'workflow' | 'skill' | 'browser') => {
    localStorage.setItem(CURRENT_VIEW_STORAGE_KEY, view);
    set({ currentView: view });
  },

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
   * Enqueue a permission request (supports multiple concurrent tool calls)
   */
  setPermissionRequest: (req: PermissionRequest) =>
    set((state) => ({ permissionQueue: [...state.permissionQueue, req] })),

  /**
   * Dequeue the front permission request (called after approve or deny)
   */
  clearPermissionRequest: () =>
    set((state) => ({ permissionQueue: state.permissionQueue.slice(1) })),

  /**
   * Clear ALL pending permission requests (used when switching sessions)
   */
  clearAllPermissions: () =>
    set({ permissionQueue: [] }),

  /**
   * Block and wait for user's permission (used by QueryEngine's generator)
   */
  waitForPermission: (tool: { id: string; name: string; arguments: string }) => {
    return new Promise<boolean>((resolve) => {
      set((state) => ({
        permissionQueue: [
          ...state.permissionQueue,
          {
            id: tool.id,
            toolName: tool.name,
            toolInput: tool.arguments,
            description: `Execute ${tool.name}?`,
            _resolve: resolve, // Stores the promise resolver
          },
        ],
      }));
    });
  },

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
  toggleRightPanel: () => set((state) => ({ rightPanelVisible: !state.rightPanelVisible })),
  setAgentInstructions: (agentInstructions) => {
    set({ agentInstructions });
    localStorage.setItem(AGENT_INSTRUCTIONS_STORAGE_KEY, agentInstructions);
  },
  addTaskStep: (label, id) => set((state) => ({
    taskProgress: [...state.taskProgress, { id: id ?? crypto.randomUUID(), label, status: 'pending' }]
  })),
  updateTaskStep: (id, status) => set((state) => ({
    taskProgress: state.taskProgress.map(step => step.id === id ? { ...step, status } : step)
  })),
  clearTaskProgress: () => set({ taskProgress: [] }),
  setAgentPanelTab: (tab) => set({ agentPanelTab: tab }),

  // Browser Dock Actions (see browser-docked-layout-design.md)
  setBrowserDockMode: (mode: BrowserDockMode) =>
    set({
      browserDockMode: mode,
      browserPaneVisible: mode !== 'hidden',
    }),

  expandBrowserToSplit: () =>
    set({
      browserDockMode: 'split' as BrowserDockMode,
      browserPaneVisible: true,
      browserSplitFocus: 'browser' as SplitFocus,
    }),

  collapseBrowserToPanel: () =>
    set({
      browserDockMode: 'panel' as BrowserDockMode,
      browserPaneVisible: false,
    }),

  focusBrowserPane: () =>
    set({ browserSplitFocus: 'browser' as SplitFocus }),

  focusChatPane: () =>
    set({ browserSplitFocus: 'chat' as SplitFocus }),

  openBrowserExternal: () =>
    set({
      browserDockMode: 'external' as BrowserDockMode,
      browserPaneVisible: false,
    }),

  closeBrowserDock: () =>
    set({
      browserDockMode: 'hidden' as BrowserDockMode,
      browserPaneVisible: false,
      browserSplitFocus: 'chat' as SplitFocus,
    }),

  setBrowserPaneWidth: (width: number) =>
    set({ browserPaneWidth: Math.max(200, Math.min(800, width)) }),

  // Chrome prompt: show dialog and return a promise resolved by user's choice
  showChromePrompt: (targetUrl: string): Promise<boolean> => {
    return new Promise((resolve) => {
      _chromePromptResolver = resolve;
      set({ chromePromptVisible: true, chromePromptTargetUrl: targetUrl });
    });
  },

  resolveChromePrompt: (useCdp: boolean) => {
    set({ chromePromptVisible: false, chromePromptTargetUrl: null });
    if (_chromePromptResolver) {
      _chromePromptResolver(useCdp);
      _chromePromptResolver = null;
    }
  },

  // Project analysis actions
  setAnalyzingProject: (analyzing: boolean, progress?: string) =>
    set({ isAnalyzingProject: analyzing, analysisProgress: progress || '' }),

  setProjectFingerprint: (fingerprint) =>
    set({ projectFingerprint: fingerprint }),
}));

export type { PermissionRequest, Notification, TaskStep, BrowserDockMode, SplitFocus } from '../types/ui';

/**
 * UI store - Zustand state management for UI state
 */

import { create } from 'zustand';
import type { UIState, PermissionRequest, Notification, BrowserDockMode, SplitFocus, QuestionnaireData } from '../types/ui';
import { NOTIFICATION_HISTORY_LIMIT, NOTIFICATION_TIMEOUT } from '../types/ui';

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

// Questionnaire resolvers grouped by session so repeated tool calls resolve together.
const _questionnaireResolvers = new Map<string, Array<(response: string) => void>>();

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
  notificationHistory: [],
  showApiKey: false,
  activeQuestionnaireSessionId: null,
  selectedResumeTemplates: {},

  // Agentic UI State
  rightPanelVisible: true,
  agentPanelTab: 'main' as const,
  agentInstructions: localStorage.getItem(AGENT_INSTRUCTIONS_STORAGE_KEY) || 'You are a powerful AI Agent designed by the Google Deepmind team.',
  taskProgress: [],

  // Terminal Panel State
  terminalPanelVisible: false,
  terminalPanelHeight: 250,

  // Active skill (skill currently being invoked, shown in AgentPanel)
  activeSkill: null,

  // Browser Dock State (see browser-docked-layout-design.md)
  browserDockMode: 'hidden' as BrowserDockMode,
  browserSplitFocus: 'chat' as SplitFocus,
  browserPaneWidth: 400,
  browserPaneVisible: false,

  // Chrome connect prompt
  chromePromptVisible: false,
  chromePromptTargetUrl: null,

  // Questionnaire state
  activeQuestionnaire: null,

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
  addNotification: (type: Notification['type'], message: string, sessionId?: string) => {
    const id = crypto.randomUUID();
    const entry = { id, type, message, timestamp: Date.now(), sessionId };

    set((state) => ({
      notifications: [...state.notifications, entry],
      notificationHistory: [entry, ...state.notificationHistory].slice(0, NOTIFICATION_HISTORY_LIMIT),
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

  /**
   * Clear notification history
   */
  clearNotificationHistory: (sessionId?: string) =>
    set((state) => ({
      notificationHistory: sessionId
        ? state.notificationHistory.filter((n) => n.sessionId !== sessionId)
        : [],
    })),

  // Agentic Actions
  toggleRightPanel: () => set((state) => ({ rightPanelVisible: !state.rightPanelVisible })),
  setAgentInstructions: (agentInstructions) => {
    set({ agentInstructions });
    localStorage.setItem(AGENT_INSTRUCTIONS_STORAGE_KEY, agentInstructions);
  },

  // Active skill action
  setActiveSkill: (name: string | null) => set({ activeSkill: name }),

  // Terminal Panel Actions
  toggleTerminalPanel: () => set((state) => ({ terminalPanelVisible: !state.terminalPanelVisible })),
  setTerminalPanelHeight: (terminalPanelHeight: number) => set({ terminalPanelHeight }),
  addTaskStep: (label, id) => set((state) => ({
    taskProgress: [...state.taskProgress, { id: id ?? crypto.randomUUID(), label, status: 'pending' }]
  })),
  updateTaskStep: (id, status) => set((state) => ({
    taskProgress: state.taskProgress.map(step => step.id === id ? { ...step, status } : step)
  })),
  setTaskProgress: (steps) => set({ taskProgress: steps }),
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

  // Questionnaire actions: show form and return a promise resolved by user's submission
  showQuestionnaire: (sessionId: string, data: Omit<QuestionnaireData, '_resolve' | 'sessionId'>): Promise<string> => {
    return new Promise((resolve) => {
      const existingResolvers = _questionnaireResolvers.get(sessionId) ?? [];
      _questionnaireResolvers.set(sessionId, [...existingResolvers, resolve]);

      const { activeQuestionnaireSessionId } = useUIStore.getState();
      if (activeQuestionnaireSessionId === sessionId) {
        return;
      }

      set({
        activeQuestionnaire: { ...data, sessionId, _resolve: resolve },
        activeQuestionnaireSessionId: sessionId,
      });
    });
  },

  submitQuestionnaire: (response: string, sessionId?: string) => {
    const targetSessionId = sessionId ?? useUIStore.getState().activeQuestionnaireSessionId;
    set({ activeQuestionnaire: null, activeQuestionnaireSessionId: null });
    if (!targetSessionId) return;

    const resolvers = _questionnaireResolvers.get(targetSessionId) ?? [];
    for (const resolve of resolvers) {
      resolve(response);
    }
    _questionnaireResolvers.delete(targetSessionId);
  },

  clearQuestionnaire: (sessionId?: string) => {
    const targetSessionId = sessionId ?? useUIStore.getState().activeQuestionnaireSessionId;
    set({ activeQuestionnaire: null, activeQuestionnaireSessionId: null });
    if (!targetSessionId) return;

    const resolvers = _questionnaireResolvers.get(targetSessionId) ?? [];
    for (const resolve of resolvers) {
      resolve(JSON.stringify({ _cancelled: true }));
    }
    _questionnaireResolvers.delete(targetSessionId);
  },

  setSelectedResumeTemplate: (sessionId: string, templateId: string | null) =>
    set((state) => {
      if (!templateId) {
        const next = { ...state.selectedResumeTemplates };
        delete next[sessionId];
        return { selectedResumeTemplates: next };
      }

      return {
        selectedResumeTemplates: {
          ...state.selectedResumeTemplates,
          [sessionId]: templateId,
        },
      };
    }),

  // Project analysis actions
  setAnalyzingProject: (analyzing: boolean, progress?: string) =>
    set({ isAnalyzingProject: analyzing, analysisProgress: progress || '' }),

  setProjectFingerprint: (fingerprint) =>
    set({ projectFingerprint: fingerprint }),
}));

export type { PermissionRequest, Notification, TaskStep, BrowserDockMode, SplitFocus } from '../types/ui';

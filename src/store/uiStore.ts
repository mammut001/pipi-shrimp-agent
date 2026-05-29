/**
 * UI store - Zustand state management for UI state
 */

import { create } from 'zustand';
import { getCurrentLocale } from '@/i18n';
import type { UIState, PermissionRequest, Notification, BrowserDockMode, SplitFocus, QuestionnaireData } from '../types/ui';
import { NOTIFICATION_HISTORY_LIMIT, NOTIFICATION_TIMEOUT } from '../types/ui';
import { normalizePersistedCurrentView, type PersistedCurrentView } from '@/utils/storageMigrations';
import { addOrReplaceTaskStep, dedupeTaskSteps, updateTaskStepStatus } from './taskLifecycle';
import {
  createPermissionLedgerEntry,
  createPermissionRequest,
  prependPermissionLedgerEntry,
} from './permissionLedger';

/**
 * Storage key for persisting agent instructions
 */
const AGENT_INSTRUCTIONS_STORAGE_KEY = 'ai-agent-instructions';

/**
 * Storage key for persisting current view (chat, workflow, skill, diagnostics)
 */
const CURRENT_VIEW_STORAGE_KEY = 'ai-agent-current-view';

const DEFAULT_AGENT_INSTRUCTIONS = {
  'zh-CN': '你是 PiPi Shrimp Agent，一个本地优先的 AI 助手，专注于清晰、安全、高效地帮助用户完成任务。',
  'en-US': 'You are PiPi Shrimp Agent, a local-first AI assistant focused on helping users complete tasks clearly, safely, and efficiently.',
} as const;

const getDefaultAgentInstructions = (): string => {
  if (typeof getCurrentLocale !== 'function') return DEFAULT_AGENT_INSTRUCTIONS['zh-CN'];
  return DEFAULT_AGENT_INSTRUCTIONS[getCurrentLocale()];
};

function safeLocalStorageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeLocalStorageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Ignore storage failures so startup and navigation remain functional.
  }
}

type CurrentView = 'chat' | 'workflow' | 'skill' | 'browser' | 'diagnostics';

const persistCurrentView = (view: PersistedCurrentView): void => {
  safeLocalStorageSet(CURRENT_VIEW_STORAGE_KEY, view);
};

/**
 * Get persisted current view, default to 'chat'
 */
const getInitialCurrentView = (): PersistedCurrentView => {
  const saved = safeLocalStorageGet(CURRENT_VIEW_STORAGE_KEY);
  const { currentView, migratedFromBrowser } = normalizePersistedCurrentView(saved);

  if (migratedFromBrowser) {
    console.warn('Migrating deprecated browser view from localStorage to chat.');
    persistCurrentView(currentView);
  }

  return currentView;
};

// Promise resolver for the Chrome connect prompt (module-level, one at a time)
let _chromePromptResolver: ((useCdp: boolean) => void) | null = null;
let _newChatProjectPickerResolver: ((projectId: string | null | undefined) => void) | null = null;

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
  permissionLedger: [],
  notifications: [],
  notificationHistory: [],
  showApiKey: false,
  activeQuestionnaireSessionId: null,
  selectedResumeTemplates: {},

  // Agentic UI State
  rightPanelVisible: true,
  agentPanelTab: 'main' as const,
  agentInstructions: safeLocalStorageGet(AGENT_INSTRUCTIONS_STORAGE_KEY) || getDefaultAgentInstructions(),
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
  newChatProjectPickerVisible: false,
  newChatProjectPickerSource: null,

  // Questionnaire state
  activeQuestionnaire: null,

  // Project Analysis State
  isAnalyzingProject: false,
  analysisProgress: '',
  projectFingerprint: null,

  // ========== Action Methods ==========

  /**
   * Set current view. Deprecated browser requests are redirected to chat.
   */
  setCurrentView: (view: CurrentView) => {
    const { currentView, migratedFromBrowser } = normalizePersistedCurrentView(view);

    persistCurrentView(currentView);

    if (migratedFromBrowser) {
      console.warn('Deprecated browser view requested. Redirecting to chat workspace.');
      set({
        currentView,
        browserDockMode: 'split' as BrowserDockMode,
        browserPaneVisible: true,
        browserSplitFocus: 'chat' as SplitFocus,
      });
      return;
    }

    set({ currentView });
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
    set((state) => ({ permissionQueue: [...state.permissionQueue, createPermissionRequest(req)] })),

  /**
   * Dequeue the front permission request (called after approve or deny)
   */
  clearPermissionRequest: () =>
    set((state) => ({ permissionQueue: state.permissionQueue.slice(1) })),

  /**
   * Clear ALL pending permission requests (used when switching sessions)
   */
  clearAllPermissions: () => {
    const pendingPermissions = useUIStore.getState().permissionQueue;
    for (const permission of pendingPermissions) {
      permission._resolve?.(false);
    }

    set((state) => ({
      permissionQueue: [],
      permissionLedger: pendingPermissions.reduce(
        (ledger, permission) => prependPermissionLedgerEntry(
          ledger,
          createPermissionLedgerEntry(permission, 'cancelled'),
        ),
        state.permissionLedger,
      ),
    }));
  },

  resolvePermissionRequest: (approved: boolean) => {
    const permission = useUIStore.getState().permissionQueue[0];
    if (!permission) return;

    permission._resolve?.(approved);
    set((state) => ({
      permissionQueue: state.permissionQueue.slice(1),
      permissionLedger: prependPermissionLedgerEntry(
        state.permissionLedger,
        createPermissionLedgerEntry(permission, approved ? 'approved' : 'denied'),
      ),
    }));
  },

  clearPermissionLedger: () => set({ permissionLedger: [] }),

  /**
   * Block and wait for user's permission (used by QueryEngine's generator)
   */
  waitForPermission: (tool: {
    id: string;
    name: string;
    arguments: string;
    description?: string;
    source?: string;
    workingDirectory?: string | null;
    commandPreview?: string | null;
    riskReason?: string | null;
    approvalToken?: string | null;
  }) => {
    return new Promise<boolean>((resolve) => {
      set((state) => ({
        permissionQueue: [
          ...state.permissionQueue,
          createPermissionRequest({
            id: tool.id,
            toolName: tool.name,
            toolInput: tool.arguments,
            description: tool.description ?? `Execute ${tool.name}?`,
            source: tool.source,
            workingDirectory: tool.workingDirectory,
            commandPreview: tool.commandPreview,
            riskReason: tool.riskReason,
            approvalToken: tool.approvalToken,
            _resolve: resolve, // Stores the promise resolver
          }),
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
    taskProgress: addOrReplaceTaskStep(state.taskProgress, label, id),
  })),
  updateTaskStep: (id, status) => set((state) => ({
    taskProgress: updateTaskStepStatus(state.taskProgress, id, status),
  })),
  setTaskProgress: (steps) => set({ taskProgress: dedupeTaskSteps(steps) }),
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

  showNewChatProjectPicker: (source: string): Promise<string | null | undefined> => {
    return new Promise((resolve) => {
      _newChatProjectPickerResolver = resolve;
      set({
        newChatProjectPickerVisible: true,
        newChatProjectPickerSource: source,
      });
    });
  },

  resolveNewChatProjectPicker: (projectId: string | null | undefined) => {
    set({
      newChatProjectPickerVisible: false,
      newChatProjectPickerSource: null,
    });
    if (_newChatProjectPickerResolver) {
      _newChatProjectPickerResolver(projectId);
      _newChatProjectPickerResolver = null;
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

  /**
   * Recover to a safe chat view state after an error boundary catch.
   * Resets transient UI that may have caused the crash while preserving user data.
   */
  recoverToChatView: () => {
    const pendingPermissions = useUIStore.getState().permissionQueue;
    for (const permission of pendingPermissions) {
      permission._resolve?.(false);
    }

    persistCurrentView('chat');
    set((state) => ({
      currentView: 'chat',
      settingsOpen: false,
      currentArtifactId: undefined,
      permissionQueue: [],
      permissionLedger: pendingPermissions.reduce(
        (ledger, permission) => prependPermissionLedgerEntry(
          ledger,
          createPermissionLedgerEntry(permission, 'cancelled'),
        ),
        state.permissionLedger,
      ),
      activeQuestionnaire: null,
      activeQuestionnaireSessionId: null,
      chromePromptVisible: false,
      chromePromptTargetUrl: null,
      newChatProjectPickerVisible: false,
      newChatProjectPickerSource: null,
      browserDockMode: 'hidden' as BrowserDockMode,
      browserPaneVisible: false,
      terminalPanelVisible: false,
    }));
  },
}));

export type { PermissionRequest, PermissionLedgerEntry, Notification, TaskStep, BrowserDockMode, SplitFocus } from '../types/ui';

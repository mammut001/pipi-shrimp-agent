/**
 * Browser Agent Store - Zustand state management for PageAgent
 *
 * Extended with auth handoff support:
 * - Multiple session states (needs_login, waiting_user_resume, ready_for_agent, etc.)
 * - Control modes (manual_handoff, agent_controlled)
 * - Site profile matching
 * - Inspection-based auth detection
 */

import { create } from 'zustand';
import { listen } from '@tauri-apps/api/event';
import { useSettingsStore } from './settingsStore';
import { useUIStore } from './uiStore';
import {
  openEmbeddedSurface,
  closeEmbeddedSurface,
  executeAgentTask,
  inspectEmbeddedSurface,
  showBrowserWindow,
  moveBrowserSurface,
  captureScreenshot,
  type AgentLog,
  type AgentTaskComplete,
} from '../utils/browserCommands';
import type {
  BrowserSessionStatus,
  BrowserControlMode,
  BrowserAuthState,
  BrowserBlockReason,
  BrowserTaskEnvelope,
  BrowserInspectionResult,
  BrowserConnectorType,
  BrowserPresentationMode,
  BrowserHandoffState,
  LogEntry,
} from '../types/browser';
import {
  parseInspectionResult,
} from '../utils/browserInspection';
import {
  matchProfileByUrl,
} from '../utils/browserProfiles';

/**
 * Format timestamp for log entries
 */
const formatTimestamp = (): string => {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false });
};

/**
 * Extended browser agent state interface
 */
interface BrowserAgentState {
  // ========== Core State ==========
  status: BrowserSessionStatus;
  isWindowOpen: boolean;
  currentUrl: string;
  error: string | null;

  // ========== Auth & Control State ==========
  mode: BrowserControlMode;
  authState: BrowserAuthState;
  blockReason: BrowserBlockReason | null;

  // ========== Task & Profile State ==========
  pendingTask: BrowserTaskEnvelope | null;
  inspection: BrowserInspectionResult | null;
  siteProfileId: string | null;
  connectorType: BrowserConnectorType;
  waitingForUserResume: boolean;
  lastCompletedTaskId: string | null;

  // ========== Execution State ==========
  logs: LogEntry[];
  screenshots: string[];
  _abortController: AbortController | null;
  _screenshotInterval: ReturnType<typeof setInterval> | null;
  _isLivePreviewEnabled: boolean;

  // ========== Presentation State ==========
  presentationMode: BrowserPresentationMode;
  handoffState: BrowserHandoffState;

  // Removed explicit embedded mode flag; rely on real runtime when available
}

/**
 * Extended browser agent actions interface
 */
interface BrowserAgentActions {
  // ========== Window Actions ==========
  openWindow: (url: string) => Promise<void>;
  closeWindow: () => Promise<void>;

  // ========== Task Actions ==========
  executeTask: (task: string) => Promise<void>;
  executeTaskEnvelope: (envelope: BrowserTaskEnvelope) => Promise<void>;
  stopTask: () => void;
  bindTask: (task: BrowserTaskEnvelope) => void;
  clearTask: () => void;
  resumePendingTask: () => Promise<void>;

  // ========== Inspection Actions ==========
  inspectCurrentPage: () => Promise<void>;
  requestLogin: () => void;
  confirmLoginAndResume: () => Promise<void>;

  // ========== Control Mode Actions ==========
  switchToManualMode: () => void;
  switchToAgentMode: () => void;
  handleBlockedState: (reason: BrowserBlockReason) => void;

  // ========== Utility Actions ==========
  clearLogs: () => void;
  addLog: (level: LogEntry['level'], message: string) => void;
  setupEventListeners: () => Promise<() => void>;

  // ========== Presentation Actions ==========
  setPresentationMode: (mode: BrowserPresentationMode) => void;
  expandBrowser: () => void;
  collapseBrowser: () => void;
  showMiniBrowser: () => void;
  hideBrowser: () => void;

  // Embedded mode actions removed in favor of runtime capability-based embedding
  refreshScreenshot: (screenshot: string) => void;

  // Live preview actions
  _startLivePreview: () => void;
  _stopLivePreview: () => void;
  _toggleLivePreview: (enabled: boolean) => void;
}

/**
 * Main store
 */
export const useBrowserAgentStore = create<BrowserAgentState & BrowserAgentActions>((set, get) => ({
  // ========== Initial State ==========
  status: 'uninitialized',
  isWindowOpen: false,
  currentUrl: '',
  error: null,

  // Auth & Control
  mode: 'manual_handoff',
  authState: 'unknown',
  blockReason: null,

  // Task & Profile
  pendingTask: null,
  inspection: null,
  siteProfileId: null,
  connectorType: 'browser_web',
  waitingForUserResume: false,
  lastCompletedTaskId: null,

  // Execution
  logs: [],
  screenshots: [],
  _abortController: null,
  _screenshotInterval: null,
  _isLivePreviewEnabled: true,

  // Presentation
  presentationMode: 'hidden',
  handoffState: 'no_handoff',

  // Embedded Mode: no dedicated toggle flag; embedding is based on runtime capability

  // ========== Utility Actions ==========

  addLog: (level: LogEntry['level'], message: string) => {
    const entry: LogEntry = {
      timestamp: formatTimestamp(),
      message,
      level,
    };
    set((state) => ({
      logs: [...state.logs, entry],
    }));
  },

  /**
   * Setup event listeners for browser events
   */
  setupEventListeners: async () => {
    const { addLog } = get();

    // Listen for agent log events from the browser window
    const unlistenLog = await listen<AgentLog>('agent_log', (event) => {
      const { level, message } = event.payload;
      console.log(`[BrowserAgent ${level}]`, message);
      addLog(level, message);
    });

    // Listen for task completion events
    const unlistenComplete = await listen<AgentTaskComplete>('agent_task_complete', (event) => {
      const { success, final_url, result } = event.payload;
      if (success) {
        addLog('success', `任务完成！最终URL: ${final_url}`);
        set((state) => ({
          status: 'completed',
          lastCompletedTaskId: state.pendingTask?.id || null,
        }));
      } else {
        addLog('error', `任务失败: ${result}`);
        set({ status: 'error', error: result });
      }
    });

    // Listen for screenshot events from the backend (dataUrl)
    const unlistenScreenshot = await listen<{ dataUrl: string }>('screenshot_captured', (event) => {
      const url = event.payload?.dataUrl;
      if (typeof url === 'string' && url.length > 0) {
        set((state) => ({ screenshots: [...state.screenshots, url].slice(-20) }));
      }
    });

    const unlistenScreenshotError = await listen<{ message: string }>('screenshot_error', (event) => {
      const message = event.payload?.message ?? 'unknown';
      addLog('error', `截图错误: ${message}`);
    });

    // Return cleanup function
    return () => {
      unlistenLog();
      unlistenComplete();
      unlistenScreenshot();
      unlistenScreenshotError();
    };
  },

  // ========== Window Actions ==========

  openWindow: async (url: string) => {
    const { addLog } = get();

    try {
      // Auto-add protocol if missing
      let normalizedUrl = url.trim();
      if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
        normalizedUrl = `https://${normalizedUrl}`;
      }

      // Update status to opening
      set({ status: 'opening' });
      addLog('info', `正在打开嵌入式浏览器: ${normalizedUrl}`);

      // Use embedded surface as the primary browser surface
      await openEmbeddedSurface(normalizedUrl);

      // Match profile by URL
      const profile = matchProfileByUrl(normalizedUrl);

      set({
        isWindowOpen: true,
        currentUrl: normalizedUrl,
        status: 'idle',
        error: null,
        siteProfileId: profile.id,
        connectorType: profile.connectorType,
        authState: 'unknown',
        blockReason: null,
        inspection: null,
        presentationMode: 'mini',
        handoffState: 'no_handoff',
      });

      addLog('success', `嵌入式浏览器已打开 (${profile.label})`);

      // Start live preview for real-time screenshot updates
      get()._startLivePreview();

      // Auto-inspect after opening
      try {
        // We need to wait a bit for the page to load
        setTimeout(async () => {
          await get().inspectCurrentPage();
        }, 1500);
      } catch {
        // Ignore errors when getting URL
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      addLog('error', `打开窗口失败: ${errorMessage}`);
      set({ error: errorMessage, status: 'error' });
    }
  },

  closeWindow: async () => {
    const { addLog } = get();

    try {
      addLog('info', '正在关闭嵌入式浏览器');

      // Stop live preview
      get()._stopLivePreview();

      await closeEmbeddedSurface();
      set({
        isWindowOpen: false,
        currentUrl: '',
        status: 'uninitialized',
        pendingTask: null,
        inspection: null,
        siteProfileId: null,
        authState: 'unknown',
        blockReason: null,
        waitingForUserResume: false,
        mode: 'manual_handoff',
        presentationMode: 'hidden',
        handoffState: 'no_handoff',
      });
      addLog('info', '嵌入式浏览器已关闭');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      addLog('error', `关闭窗口失败: ${errorMessage}`);
    }
  },

  // ========== Inspection Actions ==========

  /**
   * Inspect the current page to determine auth state
   * Returns structured inspection result and updates status accordingly
   */
  inspectCurrentPage: async () => {
    const { addLog, siteProfileId } = get();

    if (!get().isWindowOpen) {
      addLog('error', '浏览器窗口未打开');
      return;
    }

    try {
      set({ status: 'inspecting' });
      addLog('info', '正在检查页面状态...');

      // Get raw inspection from backend - use embedded surface inspection
      const raw = await inspectEmbeddedSurface();

      // Parse into structured result
      const result = parseInspectionResult(raw, siteProfileId || undefined);

      // Determine new status based on inspection
      let newStatus: BrowserSessionStatus = 'idle';
      let newMode: BrowserControlMode = get().mode;

      if (!result.safeForAgent) {
        if (result.authState === 'auth_required' || result.authState === 'mfa_required') {
          // Inspection found auth wall - transition to waiting state
          newStatus = 'waiting_user_resume';
          newMode = 'manual_handoff';
        } else if (result.authState === 'captcha_required') {
          newStatus = 'blocked_captcha';
        } else if (result.authState === 'expired') {
          newStatus = 'blocked_auth';
        }
      } else if (result.authState === 'authenticated') {
        newStatus = 'ready_for_agent';
      }

      set({
        status: newStatus,
        mode: newMode,
        inspection: result,
        authState: result.authState,
        blockReason: result.blockReason || null,
        currentUrl: result.url,
        waitingForUserResume: newStatus === 'waiting_user_resume',
      });

      // Log the result
      if (result.authState === 'authenticated') {
        addLog('success', '页面已登录，可以执行自动化任务');
      } else if (result.authState === 'auth_required' || result.authState === 'mfa_required') {
        addLog('warning', '检测到需要登录，请完成登录后继续');
      } else if (result.authState === 'captcha_required') {
        addLog('warning', '检测到验证码，请先完成验证');
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      addLog('error', `检查页面状态失败: ${errorMessage}`);
      set({ status: 'error', error: errorMessage });
    }
  },

  /**
   * Request user to log in manually
   * Transitions from idle/inspecting to waiting for user to complete login
   */
  requestLogin: () => {
    const { addLog, presentationMode } = get();

    // This is called when inspection detects auth is required
    // User needs to manually log in, so we transition to waiting state
    set({
      status: 'waiting_user_resume',
      mode: 'manual_handoff',
      waitingForUserResume: true,
      handoffState: 'waiting_for_login',
    });

    // Ensure browser is visible in mini or expanded mode for login
    if (presentationMode === 'hidden') {
      set({ presentationMode: 'mini' });
    }

    void showBrowserWindow().catch((error) => {
      console.error('Failed to show browser window for login:', error);
    });

    addLog('info', '请在浏览器中完成登录');
    addLog('info', '登录完成后，点击"我已登录"按钮继续');
  },

  /**
   * Confirm login and resume agent execution
   */
  confirmLoginAndResume: async () => {
    const { addLog, inspectCurrentPage } = get();

    addLog('info', '正在验证登录状态...');

    // Re-inspect the page
    await inspectCurrentPage();

    // Get fresh state after inspection
    const { authState, inspection, pendingTask } = get();

    if (authState === 'authenticated' && inspection?.safeForAgent) {
      set({
        status: 'ready_for_agent',
        waitingForUserResume: false,
        mode: 'agent_controlled',
        handoffState: 'no_handoff',
      });

      addLog('success', '登录验证通过，可以执行任务');

      // If there's a pending task, execute it using fresh pendingTask value
      if (pendingTask) {
        addLog('info', '正在恢复执行任务...');
        await get().executeTask(pendingTask.executionPrompt);
      }
    } else {
      // Still not authenticated - keep waiting for login
      set({
        status: 'waiting_user_resume',
        waitingForUserResume: true,
        mode: 'manual_handoff',
        handoffState: 'waiting_for_login',
      });
      addLog('warning', '登录验证失败，请确认已正确登录');
    }
  },

  // ========== Task Actions ==========

  executeTask: async (task: string) => {
    const { isWindowOpen, addLog, status, authState, inspection } = get();

    if (!isWindowOpen) {
      addLog('error', '请先打开浏览器窗口');
      return;
    }

    // Execution is ONLY allowed when explicitly ready_for_agent
    if (status !== 'ready_for_agent') {
      addLog('error', `当前状态 (${status}) 不允许执行任务。请先完成登录检查。`);
      return;
    }

    // Additional safety check - verify auth state
    if (authState !== 'authenticated' || !inspection?.safeForAgent) {
      addLog('error', '页面未通过安全检查，无法执行任务');
      return;
    }

    // Create abort controller for this task
    const controller = new AbortController();
    set({ _abortController: controller, status: 'running' });

    try {
      // Get config from settings
      const config = useSettingsStore.getState().getActiveConfig();
      if (!config?.apiKey) {
        addLog('error', '请先配置 API 设置');
        set({ status: 'idle', _abortController: null });
        return;
      }

      addLog('info', `开始执行任务: ${task.substring(0, 50)}${task.length > 50 ? '...' : ''}`);

      await executeAgentTask(task, config.apiKey, config.model || 'claude-3-5-sonnet-20241022', {
        baseUrl: config.baseUrl,
      });

      // The browser window will emit completion events
      // Status will be updated by event listener
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        addLog('info', '任务已停止');
        set({ status: 'idle', _abortController: null });
        return;
      }
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      addLog('error', `执行失败: ${errorMessage}`);
      set({ status: 'error', error: errorMessage, _abortController: null });
    }
  },

  /**
   * Execute a task envelope (with profile and auth policy)
   */
  executeTaskEnvelope: async (envelope: BrowserTaskEnvelope) => {
    const { openWindow, inspectCurrentPage, requestLogin, handleBlockedState } = get();

    // Bind the task
    get().bindTask(envelope);

    // If window not open, open it
    if (!get().isWindowOpen) {
      await openWindow(envelope.targetUrl);
      // Wait for page to load
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    // Inspect the page
    await inspectCurrentPage();

    const { authState, inspection, status } = get();

    // If already in a blocked state, don't proceed
    if (status === 'blocked_auth' || status === 'blocked_captcha' || status === 'blocked_manual_step') {
      get().addLog('warning', '当前任务被阻塞，请先解决阻塞问题');
      return;
    }

    // Gate based on authState and inspection.safeForAgent
    if (!envelope.requiresLogin) {
      // No login required - proceed directly
      await get().confirmLoginAndResume();
      return;
    }

    // Handle different auth states
    switch (authState) {
      case 'authenticated':
        // Good to go - proceed with execution
        if (inspection?.safeForAgent) {
          await get().confirmLoginAndResume();
        } else {
          // Authenticated but not safe for agent (edge case)
          handleBlockedState('manual_confirmation_required');
        }
        break;

      case 'auth_required':
      case 'mfa_required':
        // Need login - request manual handoff
        requestLogin();
        break;

      case 'captcha_required':
        // Blocked by captcha
        handleBlockedState('captcha_required');
        break;

      case 'expired':
        // Session expired - need re-auth
        handleBlockedState('login_required');
        break;

      case 'unknown':
      default:
        // Unknown state - be conservative and require confirmation
        if (inspection?.safeForAgent) {
          await get().confirmLoginAndResume();
        } else {
          requestLogin();
        }
        break;
    }
  },

  /**
   * Bind a task to the store
   */
  bindTask: (task: BrowserTaskEnvelope) => {
    set({ pendingTask: task });
  },

  /**
   * Clear the pending task
   */
  clearTask: () => {
    set({
      pendingTask: null,
      waitingForUserResume: false,
    });
  },

  /**
   * Resume the pending task after login
   */
  resumePendingTask: async () => {
    const { pendingTask, addLog } = get();

    if (!pendingTask) {
      addLog('error', '没有待执行的任务');
      return;
    }

    await get().confirmLoginAndResume();
  },

  stopTask: () => {
    const { addLog, _abortController } = get();

    if (_abortController) {
      _abortController.abort();
      set({ _abortController: null });
      addLog('info', '正在停止任务...');
    } else {
      addLog('info', '没有正在执行的任务');
    }
  },

  // ========== Control Mode Actions ==========

  /**
   * Switch to manual control mode
   */
  switchToManualMode: () => {
    const { addLog, status } = get();

    if (status === 'running') {
      addLog('warning', '任务执行中，无法切换模式');
      return;
    }

    set({ mode: 'manual_handoff' });
    addLog('info', '已切换到手动控制模式');
  },

  /**
   * Switch to agent control mode
   */
  switchToAgentMode: () => {
    const { addLog, authState, inspection, status } = get();

    // Check if ready
    if (status === 'needs_login' || status === 'waiting_user_resume') {
      addLog('error', '请先完成登录');
      return;
    }

    if (authState !== 'authenticated' || !inspection?.safeForAgent) {
      addLog('error', '当前页面状态不适合自动化');
      return;
    }

    set({ mode: 'agent_controlled' });
    addLog('info', '已切换到 Agent 控制模式');
  },

  /**
   * Handle blocked state
   */
  handleBlockedState: (reason: BrowserBlockReason) => {
    const { addLog, pendingTask, presentationMode } = get();

    let status: BrowserSessionStatus = 'blocked_auth';
    let handoff: BrowserHandoffState = 'no_handoff';

    if (reason === 'captcha_required') {
      status = 'blocked_captcha';
      handoff = 'waiting_for_captcha';
    } else if (reason === 'manual_confirmation_required') {
      status = 'blocked_manual_step';
      handoff = 'waiting_for_manual_confirmation';
    } else if (reason === 'login_required' || reason === 'mfa_required') {
      handoff = 'waiting_for_login';
    }

    // Ensure browser is visible when blocked
    if (presentationMode === 'hidden') {
      set({ presentationMode: 'mini' });
    }

    set({
      status,
      blockReason: reason,
      mode: 'manual_handoff',
      handoffState: handoff,
    });

    addLog('warning', `任务被阻塞: ${reason}`);

    // Keep the pending task for potential resume
    if (pendingTask) {
      addLog('info', '任务已保存，可以在登录后恢复');
    }

    if (reason === 'login_required' || reason === 'captcha_required' || reason === 'mfa_required') {
      void showBrowserWindow().catch((error) => {
        console.error('Failed to show browser window for blocked state:', error);
      });
    }
  },

  clearLogs: () => {
    set({ logs: [] });
  },

  // ========== Presentation Actions ==========

  setPresentationMode: (mode: BrowserPresentationMode) => {
    const { addLog } = get();
    const currentMode = get().presentationMode;
    const uiStore = useUIStore.getState();

    if (currentMode === mode) return;

    // Sync with UI store for layout changes
    if (mode === 'hidden') {
      uiStore.closeBrowserDock();
    } else if (mode === 'mini') {
      uiStore.setBrowserDockMode('panel');
    } else if (mode === 'expanded') {
      uiStore.expandBrowserToSplit();
    } else if (mode === 'external') {
      uiStore.openBrowserExternal();
    }

    set({ presentationMode: mode });
    addLog('info', `浏览器切换到 ${mode} 模式`);

    // Handle mode-specific actions
    if (mode === 'hidden') {
      // Optionally close window when hiding
    } else if (mode === 'mini' || mode === 'expanded') {
      // Ensure browser window is open when entering these modes
      if (!get().isWindowOpen && get().currentUrl) {
        get().openWindow(get().currentUrl);
      }
    }
  },

  expandBrowser: async () => {
    const { addLog, presentationMode } = get();

    if (presentationMode === 'expanded') {
      addLog('info', '浏览器已在展开模式');
      return;
    }

    // Sync with UI store
    useUIStore.getState().expandBrowserToSplit();

    // Move embedded surface to expanded mode
    try {
      await moveBrowserSurface('expanded');
    } catch (e) {
      // Ignore errors - fallback to UI-only control
    }

    set({ presentationMode: 'expanded' });
    addLog('info', '浏览器已展开到主工作区');
  },

  collapseBrowser: async () => {
    const { addLog, presentationMode } = get();

    if (presentationMode === 'mini') {
      addLog('info', '浏览器已在迷你模式');
      return;
    }

    // Move embedded surface to mini mode
    try {
      await moveBrowserSurface('mini');
    } catch (e) {
      // Ignore errors - fallback to UI-only control
    }

    // Sync with UI store
    useUIStore.getState().collapseBrowserToPanel();
    set({ presentationMode: 'mini' });
    addLog('info', '浏览器已折叠到右侧面板');
  },

  showMiniBrowser: () => {
    const { addLog, isWindowOpen, currentUrl } = get();

    // If no URL, can't show mini browser
    if (!currentUrl && !isWindowOpen) {
      addLog('info', '请先打开一个网页');
      return;
    }

    // Sync with UI store
    useUIStore.getState().setBrowserDockMode('panel');
    set({ presentationMode: 'mini' });
    addLog('info', '显示迷你浏览器');
  },

  hideBrowser: () => {
    const { addLog } = get();
    // Sync with UI store
    useUIStore.getState().closeBrowserDock();
    set({ presentationMode: 'hidden' });
    addLog('info', '隐藏浏览器');
  },

  // Embedded mode toggling removed; runtime embedding will be inferred from actual capability

  refreshScreenshot: (screenshot: string) => {
    const { screenshots } = get();
    // Add new screenshot and keep only last 10
    const newScreenshots = [...screenshots, screenshot].slice(-10);
    set({ screenshots: newScreenshots });
  },

  // Live preview - periodically capture screenshots for real-time preview
  _startLivePreview: () => {
    const { _screenshotInterval, _isLivePreviewEnabled } = get();

    // Don't start if already running or disabled
    if (_screenshotInterval || !_isLivePreviewEnabled) return;

    // NOTE: captureScreenshot() returns "Screenshot capture initiated" (acknowledgment string),
    // NOT the actual image data. Screenshot data ONLY arrives via screenshot_captured events.
    // We trigger capture to request screenshot, then rely on event listener to update screenshots.
    const interval = setInterval(async () => {
      try {
        await captureScreenshot();
        // Screenshot will be updated via screenshot_captured event listener
        // DO NOT use return value as image data - it's just an acknowledgment
      } catch (e) {
        // Ignore screenshot errors during live preview
      }
    }, 2000); // Update every 2 seconds

    set({ _screenshotInterval: interval });
  },

  _stopLivePreview: () => {
    const { _screenshotInterval } = get();

    if (_screenshotInterval) {
      clearInterval(_screenshotInterval);
      set({ _screenshotInterval: null });
    }
  },

  _toggleLivePreview: (enabled: boolean) => {
    const { _screenshotInterval } = get();

    if (enabled && !_screenshotInterval) {
      get()._startLivePreview();
    } else if (!enabled && _screenshotInterval) {
      get()._stopLivePreview();
    }

    set({ _isLivePreviewEnabled: enabled });
  },
}));

// Export types for external use
export type {
  BrowserAgentState,
  BrowserAgentActions,
};

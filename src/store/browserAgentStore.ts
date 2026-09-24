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
import { t } from '../i18n';

import { useUIStore } from './uiStore';
import { useCdpStore } from './cdpStore';
import {
  executeOnEmbeddedSurface,
  captureScreenshot,
  setEmbeddedSurfaceVisibility,
} from '../utils/browserCommands';
import { getBrowserLivePreviewIntervalMs } from '../utils/browserFeatureFlags';
// AG-05: imported at the spot where the notification plugin and the inspection parser used
// to be imported, so ES module evaluation order is unchanged.
import { createBrowserAgentInspectionActions } from './browserAgentInspectionActions';
import type {
  BrowserBlockReason,
  BrowserHandoffState,
  BrowserPresentationMode,
  BrowserSessionStatus,
  LogEntry,
} from '../types/browser';
import { createBrowserAgentEventActions } from './browserAgentEventActions';
import { createBrowserAgentTaskActions } from './browserAgentTaskActions';
import type { BrowserAgentStore } from './browserAgentStore.types';

/**
 * Format timestamp for log entries
 */
const formatTimestamp = (): string => {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false });
};


/**
 * Main store
 */
export const useBrowserAgentStore = create<BrowserAgentStore>((set, get) => ({
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
  lastTaskResult: null,

  // Execution
  logs: [],
  screenshots: [],
  _abortController: null,
  _taskRunToken: 0,
  _screenshotInterval: null,
  _isLivePreviewEnabled: true,

  // Inspection guard
  _isInspecting: false,
  pendingBrowserActionApproval: null,

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
      logs: [...state.logs, entry].slice(-500),
    }));
  },

  ...createBrowserAgentEventActions(set, get),

  ...createBrowserAgentInspectionActions(set, get),

  ...createBrowserAgentTaskActions(set, get),

  // ========== Control Mode Actions ==========

  /**
   * Switch to manual control mode
   */
  switchToManualMode: () => {
    const { addLog, status } = get();

    if (status === 'running') {
      addLog('warning', t('browserAgent.log.taskRunningCannotSwitch'));
      return;
    }

    set({ mode: 'manual_handoff' });
    addLog('info', t('browserAgent.log.switchedToManual'));
  },

  /**
   * Switch to agent control mode
   */
  switchToAgentMode: () => {
    const { addLog, authState, inspection, status } = get();

    // Check if ready
    if (status === 'needs_login' || status === 'waiting_user_resume') {
      addLog('error', t('browserAgent.log.completeLoginFirst'));
      return;
    }

    if (authState !== 'authenticated' || !inspection?.safeForAgent) {
      addLog('error', t('browserAgent.log.pageNotSuitable'));
      return;
    }

    set({ mode: 'agent_controlled' });
    addLog('info', t('browserAgent.log.switchedToAgent'));
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

    addLog('warning', t('browserAgent.log.taskBlockedWithReason').replace('{reason}', reason));

    // Keep the pending task for potential resume
    if (pendingTask) {
      addLog('info', t('browserAgent.log.taskSavedForLater'));
    }
    // Note: Browser surface visibility is handled by BrowserSurfaceViewport based on presentationMode.
    // If presentationMode was 'hidden', it was set to 'mini' above, which will show the embedded surface.
  },

  /**
   * Reset status from 'completed' (or any non-running state) to 'ready_for_agent'
   * This allows executing a new task after the previous one finished.
   */
  resetToReady: () => {
    const { addLog, status } = get();

    // Only reset if currently in a terminal state that blocks execution
    if (status === 'running' || status === 'ready_for_agent') {
      addLog('info', t('browserAgent.log.alreadyExecutable'));
      return;
    }

    set({
      status: 'ready_for_agent',
      lastTaskResult: null,
      pendingTask: null,
    });
    addLog('info', t('browserAgent.log.stateReset'));
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
      void setEmbeddedSurfaceVisibility(false).catch(() => {});
    } else if (mode === 'mini') {
      uiStore.setBrowserDockMode('panel');
    } else if (mode === 'expanded') {
      uiStore.expandBrowserToSplit();
    } else if (mode === 'external') {
      uiStore.openBrowserExternal();
    }

    set({ presentationMode: mode });
    addLog('info', t('browserAgent.log.browserModeSwitch').replace('{mode}', mode));

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

  expandBrowser: () => {
    const { addLog, presentationMode } = get();

    const cdpState = useCdpStore.getState();
    const isCdpBackedSession =
      cdpState.status === 'connected' ||
      get().pendingTask?.executionMode === 'cdp';

    if (isCdpBackedSession) {
      if (presentationMode === 'expanded') {
        addLog('info', t('browserAgent.log.alreadyExpanded'));
        return;
      }
      useUIStore.getState().expandBrowserToSplit();
      useUIStore.getState().setAgentPanelTab('browser');
      set({ presentationMode: 'expanded' });
      addLog('info', t('browserAgent.log.expandedToMain'));
      return;
    }

    if (presentationMode === 'expanded') {
      addLog('info', t('browserAgent.log.alreadyExpanded'));
      return;
    }

    // Update state — BrowserSurfaceViewport with mode="expanded" will take over positioning
    useUIStore.getState().expandBrowserToSplit();
    // Keep AgentPanel on browser tab so user sees controls + logs
    useUIStore.getState().setAgentPanelTab('browser');
    set({ presentationMode: 'expanded' });
    addLog('info', t('browserAgent.log.expandedToMain'));
  },

  collapseBrowser: () => {
    const { addLog, presentationMode } = get();

    if (presentationMode === 'mini') {
      addLog('info', t('browserAgent.log.alreadyMini'));
      return;
    }

    // Update state — BrowserSurfaceViewport with mode="mini" will take over positioning
    useUIStore.getState().collapseBrowserToPanel();
    // Re-open browser tab in AgentPanel
    useUIStore.getState().setAgentPanelTab('browser');
    set({ presentationMode: 'mini' });
    addLog('info', t('browserAgent.log.dockedToPanel'));
  },

  showMiniBrowser: () => {
    const { addLog, isWindowOpen, currentUrl } = get();

    // If no URL, can't show mini browser
    if (!currentUrl && !isWindowOpen) {
      addLog('info', t('browserAgent.log.openPageFirst'));
      return;
    }

    // Sync with UI store
    useUIStore.getState().setBrowserDockMode('panel');
    set({ presentationMode: 'mini' });
    addLog('info', t('browserAgent.log.showMiniBrowser'));
  },

  hideBrowser: () => {
    const { addLog } = get();
    // Sync with UI store
    useUIStore.getState().closeBrowserDock();
    void setEmbeddedSurfaceVisibility(false).catch(() => {});
    set({ presentationMode: 'hidden' });
    addLog('info', t('browserAgent.log.hideBrowser'));
  },

  // Embedded mode toggling removed; runtime embedding will be inferred from actual capability

  refreshScreenshot: (screenshot: string) => {
    const { screenshots } = get();
    // Add new screenshot and keep only last 5 — large base64 PNGs accumulate
    // fast and bloat Zustand.
    const newScreenshots = [...screenshots, screenshot].slice(-5);
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
    }, getBrowserLivePreviewIntervalMs()); // Update per flag (default 2s)

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
export type { BrowserAgentState, BrowserAgentActions } from './browserAgentStore.types';

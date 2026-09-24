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
  inspectEmbeddedSurface,
  captureScreenshot,
  setEmbeddedSurfaceVisibility,
} from '../utils/browserCommands';
import { getBrowserLivePreviewIntervalMs } from '../utils/browserFeatureFlags';
import { sendNotification, requestPermission, isPermissionGranted } from '@tauri-apps/plugin-notification';
import type {
  BrowserBlockReason,
  BrowserPresentationMode,
  LogEntry,
} from '../types/browser';
import { parseInspectionResult } from '../utils/browserInspection';
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

  // ========== Inspection Actions ==========

  /**
   * Inspect the current page to determine auth state
   * Returns structured inspection result and updates status accordingly
   */
  inspectCurrentPage: async () => {
    const { addLog, siteProfileId } = get();

    if (!get().isWindowOpen) {
      addLog('error', t('browserAgent.log.windowNotOpen'));
      return;
    }

    // Guard: if another inspection is already running, skip this call.
    // Concurrent inspections both register app.once() listeners for the same event;
    // whichever fires first wins, the other always times out.
    if (get()._isInspecting) {
      addLog('info', t('browserAgent.log.checkingDuplicate'));
      return;
    }

    try {
      set({ status: 'inspecting', _isInspecting: true });
      addLog('info', t('browserAgent.log.checkingPageStatus'));

      // Get raw inspection from backend with one retry on timeout.
      // Heavy SPAs (e.g. Apple ID redirect) may still be loading on first attempt.
      let raw: Awaited<ReturnType<typeof inspectEmbeddedSurface>>;
      try {
        raw = await inspectEmbeddedSurface();
      } catch (firstErr) {
        const msg = firstErr instanceof Error ? firstErr.message : String(firstErr);
        if (msg.includes('Timed out') || msg.includes('timeout')) {
          addLog('info', t('browserAgent.log.pageStillLoading'));
          await new Promise(r => setTimeout(r, 2000));
          raw = await inspectEmbeddedSurface();
        } else {
          throw firstErr;
        }
      }

      // Parse into structured result
      const result = parseInspectionResult(raw, siteProfileId || undefined);

      // Determine new status based on inspection.
      // IMPORTANT: Don't clobber status if the task is already running or has been explicitly
      // cleared for execution (ready_for_agent). Inspection fires async (1.5s after open) and
      // could race with executeTaskEnvelope setting status:'ready_for_agent'.
      const currentStatus = get().status;
      const taskIsActive = currentStatus === 'running' || currentStatus === 'ready_for_agent';

      let newStatus: BrowserSessionStatus = taskIsActive ? currentStatus : 'idle';
      let newMode: BrowserControlMode = get().mode;

      if (!taskIsActive) {
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
      }

      set({
        status: newStatus,
        mode: newMode,
        inspection: result,
        // Don't clobber authState if task is already active — a stale auth signal shouldn't
        // interrupt an in-progress execution that was explicitly cleared for agent use.
        authState: taskIsActive ? get().authState : result.authState,
        blockReason: result.blockReason || null,
        currentUrl: result.url,
        waitingForUserResume: newStatus === 'waiting_user_resume',
        _isInspecting: false,
      });

      // Log the result
      if (result.authState === 'authenticated') {
        addLog('success', t('browserAgent.log.pageLoggedIn'));
      } else if (result.authState === 'auth_required' || result.authState === 'mfa_required') {
        addLog('warning', t('browserAgent.log.loginRequired'));
      } else if (result.authState === 'captcha_required') {
        addLog('warning', t('browserAgent.log.captchaDetected'));
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      addLog('warning', t('browserAgent.log.pageCheckFailed').replace('{error}', errorMessage));

      // Fallback: treat as safe/unknown so execution can still proceed
      const fallbackInspection: BrowserInspectionResult = {
        url: get().currentUrl,
        title: '',
        authState: 'unknown',
        safeForAgent: true,
        matchedSignals: [],
      };
      set({
        status: 'idle',
        inspection: fallbackInspection,
        authState: 'unknown',
        blockReason: null,
        error: null,
        _isInspecting: false,
      });
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
    // Use setPresentationMode so uiStore is also updated (dock becomes visible)
    if (presentationMode === 'hidden') {
      get().setPresentationMode('mini');
    }

    // Send OS notification to alert user that login is needed
    void (async () => {
      try {
        let permissionGranted = await isPermissionGranted();
        if (!permissionGranted) {
          const permission = await requestPermission();
          permissionGranted = permission === 'granted';
        }
        if (permissionGranted) {
          const siteId = get().siteProfileId || t('browserAgent.log.targetWebsite');
          sendNotification({
            title: t('browserAgent.log.loginNotificationTitle'),
            body: t('browserAgent.log.loginNotificationBody').replace('{siteId}', siteId),
          });
        }
      } catch (e) {
        console.warn('[BrowserAgent] Failed to send notification:', e);
      }
    })();

    addLog('info', t('browserAgent.log.completeLoginInBrowser'));
    addLog('info', t('browserAgent.log.clickAfterLogin'));
  },

  /**
   * Confirm login and resume agent execution
   */
  confirmLoginAndResume: async () => {
    const { addLog, inspectCurrentPage } = get();

    addLog('info', t('browserAgent.log.verifyingLogin'));

    // Only re-inspect if we have NO inspection result yet (e.g. called directly
    // without a prior inspectCurrentPage). If inspection already ran (even as a
    // timeout-fallback), reuse the result to avoid a redundant round-trip that
    // always times out on sites like Apple/appstoreconnect whose IPC never fires.
    if (!get().inspection) {
      await inspectCurrentPage();
    }

    // Get fresh state after inspection
    const { authState, inspection, pendingTask } = get();

    const canProceed = authState === 'authenticated' ||
      (authState === 'unknown' && (inspection?.safeForAgent !== false));

    if (canProceed) {
      set({
        status: 'ready_for_agent',
        waitingForUserResume: false,
        mode: 'agent_controlled',
        handoffState: 'no_handoff',
      });

      addLog('success', t('browserAgent.log.loginVerified'));

      // If there's a pending task, execute it using fresh pendingTask value
      if (pendingTask) {
        addLog('info', t('browserAgent.log.resumingTask'));
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
      addLog('warning', t('browserAgent.log.loginVerifyFailed'));
    }
  },

  /**
   * Force resume without auth check - bypasses the login detection
   * Use this when you know you're logged in but detection keeps failing
   */
  forceResumeWithoutAuth: async () => {
    const { addLog, pendingTask } = get();

    addLog('info', t('browserAgent.log.skippingLoginCheck'));

    set({
      status: 'ready_for_agent',
      mode: 'agent_controlled',
      waitingForUserResume: false,
      handoffState: 'no_handoff',
      authState: 'unknown', // Treat as unknown to allow execution
    });

    // If there's a pending task, execute it
    if (pendingTask) {
      addLog('info', t('browserAgent.log.executingTask'));
      await get().executeTask(pendingTask.executionPrompt);
    } else {
      addLog('success', t('browserAgent.log.readyForTask'));
    }
  },

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

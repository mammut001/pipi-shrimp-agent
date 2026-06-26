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
import { t } from '../i18n';

import { useSettingsStore } from './settingsStore';
import {
  registerDiagnosticsTask,
  registerDiagnosticsTaskCancel,
  updateDiagnosticsTask,
} from './taskRegistryStore';
import { useUIStore } from './uiStore';
import { useCdpStore } from './cdpStore';
import { useBrowserObservabilityStore } from './browserObservabilityStore';
import {
  openEmbeddedSurface,
  closeEmbeddedSurface,
  executeAgentTask,
  executeOnEmbeddedSurface,
  inspectEmbeddedSurface,
  captureScreenshot,
  setEmbeddedSurfaceVisibility,
  type AgentLog,
  type AgentTaskComplete,
} from '../utils/browserCommands';
import {
  isBrowserPageAgentLegacyEnabled,
  isBrowserVisionFallbackEnabled,
  getBrowserLivePreviewIntervalMs,
  resolveBrowserActionPermissionMode,
} from '../utils/browserFeatureFlags';
import { resolveBrowserEngine } from '../utils/browserEngine';
import type { BrowserAutomationEngine } from '../types/browserEngine';
import { sendNotification, requestPermission, isPermissionGranted } from '@tauri-apps/plugin-notification';
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
// CDP mode: tiered dispatch for complex/authenticated tasks
import {
  executeNativeBrowserTask as executeCdpTask,
  type NativeAgentOptions,
  type NativeAgentRunSummary,
} from '../utils/nativeBrowserAgent';
import type {
  BrowserActionPolicyContext,
  BrowserActionPolicyVerdict,
} from '../utils/browserActionPolicy';
import {
  cancelAllPendingBrowserActionApprovals,
  createBrowserActionApprovalId,
  resolveBrowserActionApproval,
  summarizeBrowserActionApproval,
  waitForBrowserActionApproval,
  type BrowserPendingActionApproval,
} from './browser/browserActionApproval';
import {
  evaluateBrowserAgentStartGate,
  evaluateCdpSurfaceMatchGate,
  resolvePreviewSurfaceUrl,
  type BrowserAgentStartGateResult,
} from './browser/browserAgentStartGate';
import { getCurrentBrowserUrl } from '../utils/browserPageStateClient';
import {
  parseInspectionResult,
} from '../utils/browserInspection';
import {
  matchProfileByUrl,
} from '../utils/browserProfiles';
import { registerWithRefCount, clearListeners } from './listenerGuard';
import { clearPendingTimers } from './timerGuard';

/**
 * Format timestamp for log entries
 */
const formatTimestamp = (): string => {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false });
};

/**
 * Map a resolved engine into the legacy envelope `executionMode` value so the
 * downstream dispatcher can stay backwards compatible with the older string
 * switch. New code should read `resolveBrowserEngine(...)` directly instead.
 */
const engineToExecutionMode = (engine: BrowserAutomationEngine): 'cdp' | 'pageagent' => {
  switch (engine) {
    case 'cdp_native':
      return 'cdp';
    case 'legacy_page_agent':
      return 'pageagent';
    case 'vision_fallback':
      // Until the vision runtime lands, vision callers still flow through the
      // native loop; the engine tag is what differentiates them in logs.
      return 'cdp';
    default:
      return 'cdp';
  }
};

/**
 * Decide which `executionMode` a brand-new envelope should default to. The
 * default is CDP Native — page-agent WebView injection is opt-in only.
 */
const resolveExecutionMode = (): 'cdp' | 'pageagent' => {
  if (isBrowserPageAgentLegacyEnabled()) {
    return 'pageagent';
  }
  if (isBrowserVisionFallbackEnabled()) {
    // Surface the user's intent even though we still run through CDP today.
    return 'cdp';
  }
  return engineToExecutionMode(resolveBrowserEngine().engine);
};

/**
 * Public guard so callers that explicitly want the legacy path can be told
 * when it has been disabled. The agent store still routes through executeTask
 * but the actual legacy call below will refuse to run unless this returns
 * true. This keeps the store's surface area unchanged while preventing the
 * default flow from injecting page-agent into the WebView.
 */
const isLegacyPathAllowed = (): boolean => isBrowserPageAgentLegacyEnabled();

let _listenerRefCount = 0;
let _listenerCleanup: (() => void) | null = null;
let _listenerSetupPromise: Promise<(() => void) | null> | null = null;
let _completionTimerId: ReturnType<typeof setTimeout> | null = null;
let _completionTimerTaskId: string | null = null;
let _errorTimerId: ReturnType<typeof setTimeout> | null = null;
let _errorTimerTaskId: string | null = null;

const createBrowserApproveAction = (
  get: () => BrowserAgentState & BrowserAgentActions,
  set: (partial: Partial<BrowserAgentState>) => void,
  controller: AbortController,
  localRunToken: number,
  shouldAcceptTaskCompletion: () => boolean,
): NonNullable<NativeAgentOptions['approveAction']> => {
  return async (
    verdict: BrowserActionPolicyVerdict,
    context: BrowserActionPolicyContext,
  ): Promise<boolean> => {
    if (!shouldAcceptTaskCompletion() || controller.signal.aborted) {
      return false;
    }

    const taskId = get().pendingTask?.id ?? 'browser-task';
    const id = createBrowserActionApprovalId();
    const summaryFields = summarizeBrowserActionApproval(verdict, context);

    set({
      pendingBrowserActionApproval: {
        id,
        taskId,
        taskRunToken: localRunToken,
        ...summaryFields,
        createdAt: Date.now(),
      },
    });

    try {
      return await waitForBrowserActionApproval({
        id,
        signal: controller.signal,
        isStillValid: () => (
          shouldAcceptTaskCompletion()
          && get().pendingBrowserActionApproval?.id === id
          && get().pendingBrowserActionApproval?.taskRunToken === localRunToken
        ),
      });
    } finally {
      const pending = get().pendingBrowserActionApproval;
      if (pending?.id === id) {
        set({ pendingBrowserActionApproval: null });
      }
    }
  };
};

const buildCdpTaskRunSummaryHandler = (
  shouldAcceptTaskCompletion: () => boolean,
  addLog: BrowserAgentActions['addLog'],
): NonNullable<NativeAgentOptions['onRunSummary']> => (
  summary: NativeAgentRunSummary,
) => {
  if (!shouldAcceptTaskCompletion()) {
    return;
  }
  try {
    const obs = useBrowserObservabilityStore.getState();
    obs.setNativeRunStats({
      total_steps: summary.steps.length,
      full_snapshots: summary.fullSnapshots,
      light_observations: summary.lightObservations,
      interactive_observations: summary.interactiveObservations,
      screenshots: summary.screenshots,
      loop_detections: summary.loopDetections,
      malformed_responses: summary.malformedResponses,
      llm_retries: summary.llmRetries,
      cache_hits: summary.cacheHits,
      cache_misses: summary.cacheMisses,
      policy_approvals: summary.policyApprovals,
      policy_denials: summary.policyDenials,
      average_step_ms: summary.steps.length > 0
        ? Math.round(summary.steps.reduce((acc, step) => acc + step.totalStepMs, 0) / summary.steps.length)
        : null,
      slowest_step_ms: summary.steps.reduce((max, step) => Math.max(max, step.totalStepMs), 0) || null,
      total_runtime_ms: summary.totalMs,
      outcome: summary.outcome,
      steps: summary.steps.map((step) => ({
        step: step.step,
        engine: step.engine,
        url: step.url,
        navigation_id: step.navigationId,
        observation_level: step.observationLevel,
        observation_ms: step.observationMs,
        prompt_chars: step.promptChars,
        llm_ms: step.llmMs,
        action_name: step.actionName,
        action_ms: step.actionMs,
        post_wait_ms: step.postWaitMs,
        screenshot_ms: step.screenshotMs,
        total_step_ms: step.totalStepMs,
        success: step.success,
        error_code: step.errorCode ?? null,
        reused_cache: step.reusedCache,
      })),
    });
  } catch (error) {
    addLog('warning', `[NativeAgent] Failed to publish run summary: ${error}`);
  }
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
  /** Raw result string returned by PageAgent on task completion */
  lastTaskResult: string | null;

  // ========== Execution State ==========
  logs: LogEntry[];
  screenshots: string[];
  _abortController: AbortController | null;
  _taskRunToken: number;
  _screenshotInterval: ReturnType<typeof setInterval> | null;
  _isLivePreviewEnabled: boolean;

  // ========== Presentation State ==========
  presentationMode: BrowserPresentationMode;
  handoffState: BrowserHandoffState;

  // Removed explicit embedded mode flag; rely on real runtime when available

  /** Guard against concurrent inspections — only one at a time */
  _isInspecting: boolean;

  /** Pending sensitive-action approval surfaced to the browser panel UI (R3-01). */
  pendingBrowserActionApproval: BrowserPendingActionApproval | null;
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
  approveBrowserAction: (id?: string) => boolean;
  rejectBrowserAction: (id?: string) => boolean;
  bindTask: (task: BrowserTaskEnvelope) => void;
  clearTask: () => void;
  resumePendingTask: () => Promise<void>;

  // ========== Inspection Actions ==========
  inspectCurrentPage: () => Promise<void>;
  requestLogin: () => void;
  confirmLoginAndResume: () => Promise<void>;
  forceResumeWithoutAuth: () => Promise<void>;

  // ========== Control Mode Actions ==========
  switchToManualMode: () => void;
  switchToAgentMode: () => void;
  handleBlockedState: (reason: BrowserBlockReason) => void;
  resetToReady: () => void;

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

  /**
   * Setup event listeners for browser events.
   * Uses a ref-count so multiple callers (ChatBrowserWorkspaceShell, BrowserPanel,
   * BrowserMiniPreview) share a single set of Tauri listeners instead of registering
   * duplicate handlers that fire multiple times per event.
   *
   * Also guards against concurrent async registration: if two callers invoke
   * setupEventListeners() before the first await completes, both will share the
   * same in-flight promise instead of registering duplicate listeners.
   */
  setupEventListeners: async () => {
    _listenerRefCount += 1;

    // If listeners are already registered, return a cleanup that just decrements count
    if (_listenerCleanup) {
      return () => {
        _listenerRefCount = Math.max(0, _listenerRefCount - 1);
        if (_listenerRefCount === 0 && _listenerCleanup) {
          _listenerCleanup();
        }
      };
    }

    // If registration is already in-flight, await the same promise
    if (_listenerSetupPromise) {
      await _listenerSetupPromise;
      // Return a wrapper that decrements our ref count
      return () => {
        _listenerRefCount = Math.max(0, _listenerRefCount - 1);
        if (_listenerRefCount === 0 && _listenerCleanup) {
          _listenerCleanup();
        }
      };
    }

    const { addLog } = get();

    // Create the setup promise so concurrent callers can await it
    _listenerSetupPromise = (async () => {
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
          addLog('success', t('browserAgent.log.taskCompleted').replace('{url}', final_url));
          const completedTaskId = get().pendingTask?.id || null;
          if (completedTaskId) {
            updateDiagnosticsTask(completedTaskId, {
              state: 'completed',
              cancelable: false,
              detail: result || final_url,
            });
          }
          set(() => ({
            status: 'completed',
            lastCompletedTaskId: completedTaskId,
            lastTaskResult: result || null,
          }));
          // Auto-reset to idle after 5s so the next task can start cleanly.
          // 'completed' blocks direct executeTask() calls; resetting ensures
          // manual Run and any other entry points work without stale state.
          // Clear any pending timers first to prevent race conditions.
          clearPendingTimers(completedTaskId);
          _completionTimerId = setTimeout(() => {
            // Only reset if still in completed state AND this timer belongs to the current task
            if (get().status === 'completed' && _completionTimerTaskId === completedTaskId) {
              set({ status: 'idle', pendingTask: null });
              _completionTimerTaskId = null;
            }
            _completionTimerId = null;
          }, 5000);
          _completionTimerTaskId = completedTaskId;
        } else {
          addLog('error', t('browserAgent.log.taskFailed').replace('{error}', result));
          const failedTaskId = get().pendingTask?.id || null;
          if (failedTaskId) {
            updateDiagnosticsTask(failedTaskId, {
              state: 'failed',
              cancelable: false,
              error: result,
            });
          }
          set({ status: 'error', error: result, lastTaskResult: null });
          // Also reset error state after 5s so next task isn't blocked
          clearPendingTimers(failedTaskId);
          _errorTimerId = setTimeout(() => {
            if (get().status === 'error' && _errorTimerTaskId === failedTaskId) {
              set({ status: 'idle', error: null });
              _errorTimerTaskId = null;
            }
            _errorTimerId = null;
          }, 5000);
          _errorTimerTaskId = failedTaskId;
        }
      });

      // Listen for screenshot events from the backend (dataUrl). Keep only
      // the last few — large base64 PNGs accumulate fast and bloat Zustand.
      const unlistenScreenshot = await listen<{ dataUrl: string }>('screenshot_captured', (event) => {
        const url = event.payload?.dataUrl;
        if (typeof url === 'string' && url.length > 0) {
          set((state) => ({ screenshots: [...state.screenshots, url].slice(-5) }));
        }
      });

      const unlistenScreenshotError = await listen<{ message: string }>('screenshot_error', (event) => {
        const message = event.payload?.message ?? 'unknown';
        addLog('error', t('browserAgent.log.screenshotError').replace('{error}', message));
      });

      // Store the real cleanup so subsequent callers can share it
      _listenerCleanup = () => {
        unlistenLog();
        unlistenComplete();
        unlistenScreenshot();
        unlistenScreenshotError();
        _listenerCleanup = null;
        _listenerSetupPromise = null;
      };

      return _listenerCleanup;
    })();

    try {
      await _listenerSetupPromise;
    } catch (err) {
      // Registration failed — reset guard so next caller can retry
      _listenerSetupPromise = null;
      _listenerRefCount = Math.max(0, _listenerRefCount - 1);
      throw err;
    }

    // Return cleanup function — only the last ref actually tears down listeners
    return () => {
      _listenerRefCount = Math.max(0, _listenerRefCount - 1);
      if (_listenerRefCount === 0 && _listenerCleanup) {
        _listenerCleanup();
      }
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
      addLog('info', t('browserAgent.log.openingBrowser').replace('{url}', normalizedUrl));

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

      addLog('success', t('browserAgent.log.browserOpened').replace('{profile}', profile.label));

      // Start live preview for real-time screenshot updates
      get()._startLivePreview();

      // NOTE: Do NOT auto-inspect here. executeTaskEnvelope() always calls
      // inspectCurrentPage() after a 2000ms wait, which is the authoritative
      // inspection. A second auto-inspection here creates concurrent inspections
      // that fight over the same app.once() event listener → one always times out.
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      addLog('error', t('browserAgent.log.openWindowFailed').replace('{error}', errorMessage));
      set({ error: errorMessage, status: 'error' });
    }
  },

  closeWindow: async () => {
    const { addLog, _abortController, status } = get();

    try {
      if (_abortController || status === 'running') {
        get().stopTask();
      }

      addLog('info', t('browserAgent.log.closingBrowser'));

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
      addLog('info', t('browserAgent.log.browserClosed'));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      addLog('error', t('browserAgent.log.closeWindowFailed').replace('{error}', errorMessage));
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

  // ========== Task Actions ==========

  executeTask: async (task: string) => {
    const { isWindowOpen, addLog, status, authState, inspection } = get();
    let currentTask = get().pendingTask;

    if (!currentTask) {
      currentTask = {
        id: `browser:${Date.now()}`,
        connectorType: get().connectorType,
        siteProfileId: get().siteProfileId || 'manual-browser',
        targetUrl: get().currentUrl || 'embedded-surface',
        userIntent: task,
        executionPrompt: task,
        requiresLogin: false,
        authPolicy: 'none',
        executionMode: resolveExecutionMode(),
        allowedControlMode: get().mode,
      };
      get().bindTask(currentTask);
    }

    registerDiagnosticsTask({
      id: currentTask.id,
      kind: 'browser',
      source: currentTask.targetUrl || get().currentUrl || 'browser',
      state: 'created',
      cancelable: true,
      title: task.slice(0, 120),
    });
    registerDiagnosticsTaskCancel(currentTask.id, () => {
      get().stopTask();
    });

    if (!isWindowOpen) {
      addLog('error', t('browserAgent.log.windowNotOpen'));
      // Set error so startBrowserStateListener can finalize the progress bubble
      set({ status: 'error', error: t('browserAgent.log.windowNotOpen') });
      updateDiagnosticsTask(currentTask.id, {
        state: 'failed',
        cancelable: false,
        error: t('browserAgent.log.windowNotOpen'),
      });
      return;
    }

    // Execution is ONLY allowed when explicitly ready_for_agent
    if (status !== 'ready_for_agent') {
      addLog('error', t('browserAgent.log.statusNotAllowed').replace('{status}', status));
      set({ status: 'error', error: t('browserAgent.log.statusError').replace('{status}', status) });
      updateDiagnosticsTask(currentTask.id, {
        state: 'failed',
        cancelable: false,
        error: t('browserAgent.log.statusError').replace('{status}', status),
      });
      return;
    }

    const pendingTaskForStart = get().pendingTask ?? currentTask;
    const useCdp = pendingTaskForStart?.executionMode === 'cdp';

    const rejectAgentStart = (gate: Extract<BrowserAgentStartGateResult, { allowed: false }>) => {
      const errorMessage = t(gate.messageKey);
      const logMessage = gate.logParams
        ? t(gate.logKey).replace('{authState}', gate.logParams.authState)
        : t(gate.logKey);
      addLog('error', logMessage);
      set({ status: 'error', error: errorMessage });
      updateDiagnosticsTask(currentTask.id, {
        state: 'failed',
        cancelable: false,
        error: errorMessage,
      });
    };

    if (useCdp) {
      const previewUrl = resolvePreviewSurfaceUrl(
        inspection,
        get().currentUrl,
        pendingTaskForStart,
      );
      const surfaceGate = await evaluateCdpSurfaceMatchGate(previewUrl, getCurrentBrowserUrl);
      if (!surfaceGate.allowed) {
        rejectAgentStart(surfaceGate);
        return;
      }
    }

    const startGate = evaluateBrowserAgentStartGate(authState, inspection);
    if (!startGate.allowed) {
      rejectAgentStart(startGate);
      return;
    }

    const { pendingTask } = get();

    // Create abort controller for this task
    const controller = new AbortController();
    const localRunToken = get()._taskRunToken + 1;
    const shouldAcceptTaskCompletion = (): boolean => (
      get()._taskRunToken === localRunToken && get()._abortController === controller
    );

    set({
      _abortController: controller,
      _taskRunToken: localRunToken,
      status: 'running',
    });
    updateDiagnosticsTask(currentTask.id, {
      state: 'running',
      cancelable: true,
      detail: task.slice(0, 240),
    });

    try {
      const config = useSettingsStore.getState().getActiveConfig();
      if (!config?.apiKey) {
        addLog('error', t('browserAgent.log.configureApiFirst'));
        set({ status: 'idle', _abortController: null });
        updateDiagnosticsTask(currentTask.id, {
          state: 'failed',
          cancelable: false,
          error: t('browserAgent.log.configureApiFirst'),
        });
        return;
      }

      // Determine execution engine from current envelope
      if (useCdp) {
        // CDP Tier: use external Chrome via nativeBrowserAgent
        addLog('info', t('browserAgent.log.cdpModeStart').replace('{task}', task.substring(0, 50)));
        void useCdpStore.getState().refreshCdpRuntimeState();
        const targetUrl = get().pendingTask?.targetUrl;
        const permissionMode = resolveBrowserActionPermissionMode();
        if (permissionMode === 'observe_only') {
          addLog('info', t('browserAgent.log.observeOnlyModeActive'));
        }
        const resultText = await executeCdpTask(task, config.apiKey, config.model || 'claude-3-5-sonnet-20241022', {
          baseUrl: config.baseUrl,
          onLog: addLog,
          targetUrl,
          signal: controller.signal,
          permissionMode,
          approveAction: createBrowserApproveAction(
            get,
            set,
            controller,
            localRunToken,
            shouldAcceptTaskCompletion,
          ),
          onRunSummary: buildCdpTaskRunSummaryHandler(shouldAcceptTaskCompletion, addLog),
        });
        if (!shouldAcceptTaskCompletion()) {
          return;
        }
        addLog('success', t('browserAgent.log.cdpModeComplete').replace('{result}', resultText));
        const completedTaskId = get().pendingTask?.id || null;
        if (completedTaskId) {
          updateDiagnosticsTask(completedTaskId, {
            state: 'completed',
            cancelable: false,
            detail: resultText || undefined,
          });
        }
        const cdpStore = useCdpStore.getState();
        void cdpStore.refreshCdpRuntimeState();
        const resolvedUrl = cdpStore.runtime.currentUrl || get().currentUrl;
        cdpStore.setCdpRuntimeTaskCompleted({
          result: resultText || t('browser.guidance.completedDescription'),
          currentUrl: resolvedUrl,
        });
        if (completedTaskId) {
          useBrowserObservabilityStore.getState().dismissFailureSnapshot?.(completedTaskId);
        }
        set({
          status: 'completed',
          currentUrl: resolvedUrl,
          lastCompletedTaskId: completedTaskId,
          lastTaskResult: resultText || null,
          _abortController: null,
        });
        return;
      }

      // PageAgent Tier: use embedded WebView (original logic). The legacy
      // engine is intentionally off by default — see isLegacyPathAllowed().
      addLog('info', t('browserAgent.log.startExecuting').replace('{task}', task.substring(0, 50) + (task.length > 50 ? '...' : '')));

      if (!isLegacyPathAllowed()) {
        // Legacy PageAgent is disabled. Fall back to the CDP Native path
        // automatically so the user request still completes instead of
        // silently failing. This keeps the store's surface stable while we
        // deprecate the IIFE injection.
        addLog('warning', '[LegacyPageAgent] Deprecated engine disabled by default; rerouting to CDP Native.');
        const cdpResult = await executeCdpTask(task, config.apiKey, config.model || 'claude-3-5-sonnet-20241022', {
          baseUrl: config.baseUrl,
          onLog: addLog,
          targetUrl: pendingTask?.targetUrl,
          signal: controller.signal,
          permissionMode: resolveBrowserActionPermissionMode(),
          approveAction: createBrowserApproveAction(
            get,
            set,
            controller,
            localRunToken,
            shouldAcceptTaskCompletion,
          ),
        });
        if (!shouldAcceptTaskCompletion()) {
          return;
        }
        const cdpTaskId = get().pendingTask?.id || null;
        if (cdpTaskId) {
          updateDiagnosticsTask(cdpTaskId, {
            state: 'completed',
            cancelable: false,
            detail: cdpResult || undefined,
          });
        }
        const cdpStore = useCdpStore.getState();
        void cdpStore.refreshCdpRuntimeState();
        const resolvedUrl = cdpStore.runtime.currentUrl || get().currentUrl;
        cdpStore.setCdpRuntimeTaskCompleted({
          result: cdpResult || t('browser.guidance.completedDescription'),
          currentUrl: resolvedUrl,
        });
        if (cdpTaskId) {
          useBrowserObservabilityStore.getState().dismissFailureSnapshot?.(cdpTaskId);
        }
        set({
          status: 'completed',
          currentUrl: resolvedUrl,
          lastCompletedTaskId: cdpTaskId,
          lastTaskResult: cdpResult || null,
          _abortController: null,
        });
        return;
      }

      addLog('warning', '[LegacyPageAgent] This engine is deprecated and may be slower. Prefer CDP Native.');

      const pageAgentSystemPrompt = `You are a browser automation agent. You MUST only use the following actions — do not invent or use any other action names:
- done: { text: string, success: boolean } — mark the task as complete
- wait: { seconds: number } — wait briefly (1-10 seconds)
- ask_user: { question: string } — ask the user a question if stuck
- click_element_by_index: { index: number } — click an element by its index
- input_text: { index: number, text: string } — type text into an input field
- select_dropdown_option: { index: number, text: string } — select dropdown option
- scroll: { down: boolean, num_pages?: number } — scroll vertically (down=true for down, down=false for up)
- scroll_horizontally: { right: boolean, pixels: number } — scroll horizontally

IMPORTANT: Do NOT use action names like "navigate", "open_url", "scroll_down", "scroll_up" — they do not exist.
Complete the task efficiently and call "done" when finished.`;

      await executeAgentTask(task, config.apiKey, config.model || 'claude-3-5-sonnet-20241022', {
        baseUrl: config.baseUrl,
        systemPrompt: pageAgentSystemPrompt,
      });

      // The browser window will emit completion events via Tauri event listener
      // Status will be updated by the event listener in setupEventListeners()
    } catch (error) {
      const pendingTaskForFailure = get().pendingTask ?? currentTask;
      const useCdpFailure = pendingTaskForFailure?.executionMode === 'cdp';

      if ((error as Error).name === 'AbortError') {
        addLog('info', t('browserAgent.log.taskStopped'));
        if (useCdpFailure) {
          void useCdpStore.getState().refreshCdpRuntimeState();
        }
        set({ status: 'idle', _abortController: null });
        updateDiagnosticsTask(currentTask.id, {
          state: 'cancelled',
          cancelable: false,
        });
        return;
      }
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      addLog('error', t('browserAgent.log.executionFailed').replace('{error}', errorMessage));
      if (useCdpFailure) {
        const cdpStore = useCdpStore.getState();
        void cdpStore.refreshCdpRuntimeState();
        cdpStore.setCdpRuntimeTaskFailed({
          error: errorMessage,
          currentUrl: cdpStore.runtime.currentUrl || get().currentUrl,
        });
      }
      set({ status: 'error', error: errorMessage, _abortController: null });
      updateDiagnosticsTask(currentTask.id, {
        state: 'failed',
        cancelable: false,
        error: errorMessage,
      });
    }
  },

  /**
   * Execute a task envelope (with profile and auth policy).
   *
   * Uses tiered dispatch based on executionMode:
   * - 'pageagent' (default): embedded Tauri WebView for simple/public pages
   * - 'cdp': external Chrome via remote debugging port for complex/authenticated pages
   * - 'auto': reserved for future smart routing (currently defaults to pageagent)
   */
  executeTaskEnvelope: async (envelope: BrowserTaskEnvelope) => {
    const { openWindow, inspectCurrentPage, requestLogin, handleBlockedState } = get();
    const { addLog } = get();

    // Bind the task and clear stale result from any previous task
    get().bindTask(envelope);
    registerDiagnosticsTask({
      id: envelope.id,
      kind: 'browser',
      source: envelope.targetUrl,
      state: 'created',
      cancelable: true,
      title: envelope.executionPrompt.slice(0, 120),
    });
    registerDiagnosticsTaskCancel(envelope.id, () => {
      get().stopTask();
    });
    set({ lastTaskResult: null });

    // Tiered dispatch: explicitly select execution engine based on executionMode.
    // Default to CDP Native — the legacy page-agent IIFE injection is opt-in only.
    const mode = envelope.executionMode ?? resolveExecutionMode();

    if (mode === 'cdp') {
      // CDP Tier: connect to external Chrome, bypass embedded WebView
      addLog('info', t('browserAgent.log.cdpModeConnecting'));
      const cdpStore = useCdpStore.getState();
      cdpStore.setCdpRuntimeTaskStarted({
        label: envelope.executionPrompt,
        targetUrl: envelope.targetUrl,
      });
      void cdpStore.refreshCdpRuntimeState();
      set({
        isWindowOpen: true,     // mock so executeTask gate passes
        currentUrl: envelope.targetUrl,
        status: 'ready_for_agent',
        mode: 'agent_controlled',
        waitingForUserResume: false,
        handoffState: 'no_handoff',
        authState: 'authenticated',
      });
      await get().executeTask(envelope.executionPrompt);
      return;
    }

    // mode === 'pageagent' or 'auto' (auto defaults to pageagent for now)
    // ... existing openWindow → inspectCurrentPage → auth routing logic ...

    // If window not open, open it and wait for initial page load
    if (!get().isWindowOpen) {
      await openWindow(envelope.targetUrl);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    // Inspect the page to determine auth state
    await inspectCurrentPage();

    const { authState, inspection, status } = get();

    // If already in a blocked state, don't proceed
    if (status === 'blocked_auth' || status === 'blocked_captcha' || status === 'blocked_manual_step') {
      get().addLog('warning', t('browserAgent.log.taskBlocked'));
      set({ status: 'error', error: t('browserAgent.log.taskBlocked') });
      updateDiagnosticsTask(envelope.id, {
        state: 'failed',
        cancelable: false,
        error: t('browserAgent.log.taskBlocked'),
      });
      return;
    }

    // Gate based on authState and inspection.safeForAgent
    if (!envelope.requiresLogin) {
      // No login required — reset authState to 'unknown' so auth walls on optional
      // sign-in prompts (e.g. grok.com "Sign in to continue") don't block execution.
      get().addLog('info', t('browserAgent.log.noLoginRequired'));
      set({
        status: 'ready_for_agent',
        mode: 'agent_controlled',
        waitingForUserResume: false,
        handoffState: 'no_handoff',
        authState: 'unknown',
      });
      await get().executeTask(envelope.executionPrompt);
      return;
    }

    // Handle different auth states
    switch (authState) {
      case 'authenticated':
        if (inspection?.safeForAgent) {
          await get().confirmLoginAndResume();
        } else {
          handleBlockedState('manual_confirmation_required');
        }
        break;

      case 'auth_required':
      case 'mfa_required':
        requestLogin();
        break;

      case 'captcha_required':
        handleBlockedState('captcha_required');
        break;

      case 'expired':
        handleBlockedState('login_required');
        break;

      case 'unknown':
      default:
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
    // Clear any pending auto-reset timers from previous tasks
    clearPendingTimers(task.id);
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
      addLog('error', t('browserAgent.log.noPendingTask'));
      return;
    }

    await get().confirmLoginAndResume();
  },

  approveBrowserAction: (id?: string) => {
    const pending = get().pendingBrowserActionApproval;
    const targetId = id ?? pending?.id;
    if (!targetId || !pending || pending.id !== targetId) {
      return false;
    }
    if (pending.taskRunToken !== get()._taskRunToken || !get()._abortController) {
      resolveBrowserActionApproval(targetId, false);
      set({ pendingBrowserActionApproval: null });
      return false;
    }
    const resolved = resolveBrowserActionApproval(targetId, true);
    if (resolved) {
      set({ pendingBrowserActionApproval: null });
      get().addLog('info', t('browserAgent.approval.allowed'));
    }
    return resolved;
  },

  rejectBrowserAction: (id?: string) => {
    const pending = get().pendingBrowserActionApproval;
    const targetId = id ?? pending?.id;
    if (!targetId || !pending || pending.id !== targetId) {
      return false;
    }
    const resolved = resolveBrowserActionApproval(targetId, false);
    if (resolved) {
      set({ pendingBrowserActionApproval: null });
      get().addLog('info', t('browserAgent.approval.denied'));
    }
    return resolved;
  },

  stopTask: () => {
    const { addLog, _abortController } = get();
    const taskId = get().pendingTask?.id;

    if (!_abortController) {
      addLog('info', t('browserAgent.log.noRunningTask'));
      return;
    }

    cancelAllPendingBrowserActionApprovals();
    _abortController.abort();
    set({ _abortController: null, pendingBrowserActionApproval: null, status: 'idle' });
    addLog('info', t('browserAgent.log.stoppingTask'));
    if (taskId) {
      updateDiagnosticsTask(taskId, {
        state: 'cancelled',
        cancelable: false,
      });
    }
  },

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
export type {
  BrowserAgentState,
  BrowserAgentActions,
};

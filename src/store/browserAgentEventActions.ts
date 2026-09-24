import { listen } from '@tauri-apps/api/event';
import { t } from '../i18n';
import { updateDiagnosticsTask } from './taskRegistryStore';
import {
  openEmbeddedSurface,
  closeEmbeddedSurface,
  type AgentLog,
  type AgentTaskComplete,
} from '../utils/browserCommands';
import { matchProfileByUrl } from '../utils/browserProfiles';
import { clearPendingTimers } from './timerGuard';
import type {
  BrowserAgentActionFactory,
  BrowserAgentEventActions,
} from './browserAgentStore.types';

let _listenerRefCount = 0;
let _listenerCleanup: (() => void) | null = null;
let _listenerSetupPromise: Promise<(() => void) | null> | null = null;
let _completionTimerId: ReturnType<typeof setTimeout> | null = null;
let _completionTimerTaskId: string | null = null;
let _errorTimerId: ReturnType<typeof setTimeout> | null = null;
let _errorTimerTaskId: string | null = null;

export const createBrowserAgentEventActions:
  BrowserAgentActionFactory<BrowserAgentEventActions> = (set, get) => ({
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
    const { addLog } = get();

    try {
      // R3-08: always stop the CDP/LLM loop before tearing down the panel so
      // closing the browser surface cannot leave an orphan agent run.
      // stopTask is idempotent when no controller is active.
      get().stopTask();

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
});

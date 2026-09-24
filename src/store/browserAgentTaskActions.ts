import { t } from '../i18n';
import { useSettingsStore } from './settingsStore';
import {
  registerDiagnosticsTask,
  registerDiagnosticsTaskCancel,
  updateDiagnosticsTask,
} from './taskRegistryStore';
import { useCdpStore } from './cdpStore';
import { useBrowserObservabilityStore } from './browserObservabilityStore';
import { executeAgentTask } from '../utils/browserCommands';
import {
  isBrowserPageAgentLegacyEnabled,
  isBrowserVisionFallbackEnabled,
  resolveBrowserActionPermissionMode,
} from '../utils/browserFeatureFlags';
import { resolveBrowserEngine } from '../utils/browserEngine';
import type { BrowserAutomationEngine } from '../types/browserEngine';
import type { BrowserTaskEnvelope } from '../types/browser';
import { removeBrowserAgentOverlay } from '../utils/nativeBrowserAgent';
import { runBrowserCdpTask } from './browser/browserCdpTaskRunner';
import {
  cancelAllPendingBrowserActionApprovals,
  resolveBrowserActionApproval,
} from './browser/browserActionApproval';
import {
  evaluateBrowserAgentStartGate,
  evaluateCdpSurfaceMatchGate,
  resolvePreviewSurfaceUrl,
  type BrowserAgentStartGateResult,
} from './browser/browserAgentStartGate';
import { getCurrentBrowserUrl } from '../utils/browserPageStateClient';
import { clearPendingTimers } from './timerGuard';
import type {
  BrowserAgentActionFactory,
  BrowserAgentTaskActions,
} from './browserAgentStore.types';

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

export const createBrowserAgentTaskActions:
  BrowserAgentActionFactory<BrowserAgentTaskActions> = (set, get) => ({
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
      const apiKey = config?.apiKey;
      if (!apiKey) {
        addLog('error', t('browserAgent.log.configureApiFirst'));
        set({ status: 'idle', _abortController: null });
        updateDiagnosticsTask(currentTask.id, {
          state: 'failed',
          cancelable: false,
          error: t('browserAgent.log.configureApiFirst'),
        });
        return;
      }

      const runCdpTask = (
        targetUrl: string | undefined,
        permissionMode: ReturnType<typeof resolveBrowserActionPermissionMode>,
        publishRunSummary: boolean,
      ): Promise<string> => runBrowserCdpTask({
        task,
        apiKey,
        model: config?.model || 'claude-3-5-sonnet-20241022',
        baseUrl: config?.baseUrl,
        targetUrl,
        signal: controller.signal,
        permissionMode,
        taskRunToken: localRunToken,
        shouldAcceptTaskCompletion,
        onLog: addLog,
        publishRunSummary,
        bridge: {
          getPendingTaskId: () => get().pendingTask?.id ?? null,
          getPendingApproval: () => get().pendingBrowserActionApproval,
          setPendingApproval: (approval) => set({ pendingBrowserActionApproval: approval }),
          setNativeRunStats: (stats) => useBrowserObservabilityStore.getState().setNativeRunStats(stats),
        },
      });

      const completeCdpTask = (resultText: string): void => {
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
      };

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
        const resultText = await runCdpTask(targetUrl, permissionMode, true);
        if (!shouldAcceptTaskCompletion()) {
          return;
        }
        addLog('success', t('browserAgent.log.cdpModeComplete').replace('{result}', resultText));
        completeCdpTask(resultText);
        return;
      }

      // PageAgent Tier: use embedded WebView (original logic). The legacy
      // engine is intentionally off by default — see isLegacyPathAllowed().
      addLog('info', t('browserAgent.log.startExecuting').replace('{task}', task.substring(0, 50) + (task.length > 50 ? '...' : '')));

      if (!isLegacyPathAllowed()) {
        // Legacy PageAgent is disabled. Fall back to the CDP Native path
        // automatically so the user request still completes instead of
        // silently failing. This keeps the store's surface stable while
        // we deprecate the IIFE injection.
        addLog('warning', '[LegacyPageAgent] Deprecated engine disabled by default; rerouting to CDP Native.');
        const cdpResult = await runCdpTask(
          pendingTask?.targetUrl,
          resolveBrowserActionPermissionMode(),
          false,
        );
        if (!shouldAcceptTaskCompletion()) {
          return;
        }
        completeCdpTask(cdpResult);
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

      await executeAgentTask(task, apiKey, config?.model || 'claude-3-5-sonnet-20241022', {
        baseUrl: config?.baseUrl,
        systemPrompt: pageAgentSystemPrompt,
      });

      // The browser window will emit completion events via Tauri event listener
      // Status will be updated by the event listener in setupEventListeners()
    } catch (error) {
      const pendingTaskForFailure = get().pendingTask ?? currentTask;
      const useCdpFailure = pendingTaskForFailure?.executionMode === 'cdp';

      // R3-07: belt-and-suspenders — native agent finally removes the page overlay,
      // but store error/abort paths always request cleanup so a stuck fullscreen mask
      // cannot survive after agent failure even if the CDP loop exited oddly.
      if (useCdpFailure) {
        void removeBrowserAgentOverlay();
      }

      if ((error as Error).name === 'AbortError') {
        addLog('info', t('browserAgent.log.taskStopped'));
        if (useCdpFailure) {
          void useCdpStore.getState().refreshCdpRuntimeState();
        }
        // R3-08: stopTask/closeWindow may already own lifecycle state — do not
        // clobber closeWindow's uninitialized teardown with a late idle write.
        if (!shouldAcceptTaskCompletion()) {
          return;
        }
        set({ status: 'idle', _abortController: null });
        updateDiagnosticsTask(currentTask.id, {
          state: 'cancelled',
          cancelable: false,
        });
        return;
      }
      // Same ownership guard for late failures after close/stop.
      if (!shouldAcceptTaskCompletion()) {
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
});

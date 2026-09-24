/**
 * Browser Agent Store - inspection / login-handoff action slice (AG-05).
 *
 * Mechanically extracted from `browserAgentStore.ts`. The action bodies below are
 * moved verbatim; the slice is spread into the store at the exact position the inline
 * actions occupied, so store key order, set/get order and await boundaries are unchanged.
 */

import { t } from '../i18n';
import { inspectEmbeddedSurface } from '../utils/browserCommands';
import { sendNotification, requestPermission, isPermissionGranted } from '@tauri-apps/plugin-notification';
import type {
  BrowserControlMode,
  BrowserInspectionResult,
  BrowserSessionStatus,
} from '../types/browser';
import { parseInspectionResult } from '../utils/browserInspection';
import type {
  BrowserAgentActionFactory,
  BrowserAgentInspectionActions,
} from './browserAgentStore.types';

export const createBrowserAgentInspectionActions:
  BrowserAgentActionFactory<BrowserAgentInspectionActions> = (set, get) => ({
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
});

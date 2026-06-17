import { useState } from 'react';

import { t } from '@/i18n';
import { useBrowserAgentStore } from '@/store/browserAgentStore';
import { useBrowserObservabilityStore } from '@/store/browserObservabilityStore';
import { useUIStore } from '@/store/uiStore';
import { normalizeScreenshotSrc } from '@/utils/screenshot';
import { safeInvoke } from '@/utils/safeInvoke';

type RecoveryAction = 'retry' | 'continue' | 'takeover' | 'copy' | null;

export function BrowserFailureRecovery() {
  const snapshot = useBrowserObservabilityStore((state) => state.activeFailureSnapshot);
  const dismissFailureSnapshot = useBrowserObservabilityStore((state) => state.dismissFailureSnapshot);
  const addNotification = useUIStore((state) => state.addNotification);
  const [pendingAction, setPendingAction] = useState<RecoveryAction>(null);

  if (!snapshot) {
    return null;
  }

  const screenshotSrc = normalizeScreenshotSrc(snapshot.screenshotPath);
  const hasScreenshot = typeof snapshot.screenshotPath === 'string' && snapshot.screenshotPath.trim().length > 0;

  const handleRetryLastAction = async () => {
    setPendingAction('retry');
    try {
      await safeInvoke('retry_browser_action', {
        taskId: snapshot.taskId,
        action: snapshot.failedAction,
      });

      const browserStore = useBrowserAgentStore.getState();
      if (browserStore.pendingTask?.executionPrompt) {
        await browserStore.executeTask(browserStore.pendingTask.executionPrompt);
      } else {
        await browserStore.inspectCurrentPage();
      }
    } catch (error) {
      addNotification('error', error instanceof Error ? error.message : String(error));
    } finally {
      setPendingAction(null);
    }
  };

  const handleContinueFromCurrentPage = async () => {
    setPendingAction('continue');
    try {
      const browserStore = useBrowserAgentStore.getState();
      if (browserStore.pendingTask) {
        await browserStore.resumePendingTask();
      } else {
        await browserStore.inspectCurrentPage();
      }
    } catch (error) {
      addNotification('error', error instanceof Error ? error.message : String(error));
    } finally {
      setPendingAction(null);
    }
  };

  const handleTakeOver = async () => {
    setPendingAction('takeover');
    try {
      await safeInvoke('take_over_browser', { taskId: snapshot.taskId });
      const browserStore = useBrowserAgentStore.getState();
      browserStore.switchToManualMode();
      browserStore.showMiniBrowser();
    } catch (error) {
      addNotification('error', error instanceof Error ? error.message : String(error));
    } finally {
      setPendingAction(null);
    }
  };

  const handleCopyDiagnostics = async () => {
    setPendingAction('copy');
    try {
      await navigator.clipboard.writeText(JSON.stringify(snapshot, null, 2));
      addNotification('success', t('browser.copyDiagnostics'));
    } catch (error) {
      addNotification('error', error instanceof Error ? error.message : String(error));
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-red-900">{t('browser.failureRecovery')}</h3>
          <p className="mt-1 text-xs text-red-700">
            {t('browser.failedAction')}: {snapshot.failedAction}
          </p>
          <p className="mt-1 text-xs text-red-700 break-all">
            {t('browser.currentPage')}: {snapshot.url}
          </p>
          <p className="mt-2 text-xs text-red-800 break-words">{snapshot.errorMessage}</p>
        </div>
        <button
          type="button"
          onClick={() => dismissFailureSnapshot(snapshot.taskId)}
          className="text-xs text-red-700 hover:text-red-900"
        >
          {t('common.close')}
        </button>
      </div>

      {hasScreenshot && (
        <div className="mt-3 overflow-hidden rounded-lg border border-red-200 bg-white/80">
          {screenshotSrc ? (
            <img
              src={screenshotSrc}
              alt={t('browser.failureRecovery')}
              className="block max-h-72 w-full object-contain"
              draggable={false}
            />
          ) : (
            <div className="flex min-h-28 items-center justify-center px-4 py-6 text-center text-xs text-red-700">
              {t('screenshot.invalid')}
            </div>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void handleRetryLastAction()}
          disabled={pendingAction !== null}
          className="rounded-lg bg-red-600 px-3 py-2 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
        >
          {t('browser.retryLastAction')}
        </button>
        <button
          type="button"
          onClick={() => void handleContinueFromCurrentPage()}
          disabled={pendingAction !== null}
          className="rounded-lg border border-red-300 bg-white px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
        >
          {t('browser.continueFromCurrentPage')}
        </button>
        <button
          type="button"
          onClick={() => void handleTakeOver()}
          disabled={pendingAction !== null}
          className="rounded-lg border border-red-300 bg-white px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
        >
          {t('browser.takeOver')}
        </button>
        <button
          type="button"
          onClick={() => void handleCopyDiagnostics()}
          disabled={pendingAction !== null}
          className="rounded-lg border border-red-300 bg-white px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
        >
          {t('browser.copyDiagnostics')}
        </button>
      </div>
    </div>
  );
}

export default BrowserFailureRecovery;
import { useBrowserAgentStore, useCdpStore } from '@/store';
import { useBrowserObservabilityStore } from '@/store/browserObservabilityStore';
import { t } from '@/i18n';
import { showBrowserWindow } from '@/utils/browserCommands';
import { resolveCdpBrowserDisplayState } from '@/utils/cdpBrowserDisplayState';

interface CdpBrowserSurfacePanelProps {
  variant?: 'compact' | 'expanded';
  className?: string;
}

function resolveScreenshotSrc(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  if (value.startsWith('data:')) {
    return value;
  }
  return `data:image/png;base64,${value}`;
}

/**
 * Status panel for CDP Native sessions. The controlled browser lives in
 * external Chrome, so this is a controller/status view rather than a WebView.
 */
export function CdpBrowserSurfacePanel({
  variant = 'compact',
  className = '',
}: CdpBrowserSurfacePanelProps) {
  const cdpStatus = useCdpStore((state) => state.status);
  const connectionState = useCdpStore((state) => state.connectionState);
  const cdpRuntime = useCdpStore((state) => state.runtime);
  const refreshCdpRuntimeState = useCdpStore((state) => state.refreshCdpRuntimeState);
  const {
    status,
    logs,
    pendingTask,
    currentUrl,
  } = useBrowserAgentStore();
  const latestPageState = useBrowserObservabilityStore((state) => state.latestPageState);
  const activeFailureSnapshot = useBrowserObservabilityStore((state) => state.activeFailureSnapshot);

  const displayState = resolveCdpBrowserDisplayState({
    cdpStatus,
    connectionState,
    cdpRuntime,
    latestPageState,
    pendingTask,
    browserCurrentUrl: currentUrl,
    browserStatus: status,
    activeFailureSnapshot,
  });
  const recentLogs = logs.slice(variant === 'expanded' ? -8 : -3);
  const screenshotSrc = resolveScreenshotSrc(latestPageState?.screenshot?.value);

  const handleOpenChrome = async () => {
    try {
      await showBrowserWindow();
    } catch (error) {
      console.error('Failed to show external Chrome window:', error);
    }
  };

  const handleRefreshStatus = async () => {
    await refreshCdpRuntimeState();
  };

  const paddingClass = variant === 'expanded' ? 'p-6' : 'p-3';
  const titleClass = variant === 'expanded' ? 'text-lg' : 'text-sm';

  return (
    <div
      className={`flex h-full w-full flex-col bg-gradient-to-b from-slate-50 to-white text-gray-800 ${paddingClass} ${className}`}
      data-testid="cdp-browser-surface-panel"
      data-variant={variant}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className={`font-semibold text-gray-900 ${titleClass}`}>
            {t('browser.surface.externalChromeTitle')}
          </h2>
          <p className="mt-1 text-xs leading-5 text-gray-600">
            {t('browser.surface.externalChromeControllerDescription')}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${
            displayState.connected
              ? 'bg-emerald-100 text-emerald-800'
              : cdpStatus === 'connecting'
                ? 'bg-blue-100 text-blue-800'
                : 'bg-gray-100 text-gray-600'
          }`}
        >
          {displayState.connected
            ? t('browser.surface.cdpConnected')
            : cdpStatus === 'connecting'
              ? t('browser.status.opening')
              : t('browser.surface.cdpDisconnected')}
        </span>
      </div>

      <div className={`mt-4 grid gap-3 ${variant === 'expanded' ? 'grid-cols-2' : 'grid-cols-1'}`}>
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
            {t('browser.surface.currentChromePage')}
          </p>
          <p className="mt-1 break-all text-xs text-gray-800">
            {displayState.displayUrl || t('browser.pendingPageMetadata')}
          </p>
          {displayState.pageTitle && (
            <p className="mt-1 truncate text-[10px] text-gray-500">{displayState.pageTitle}</p>
          )}
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
            {t('browser.surface.connectionHealth')}
          </p>
          <p className="mt-1 text-xs text-gray-800">
            {displayState.healthStatus || t('browser.status.unknown')}
          </p>
          <p className="mt-2 text-[10px] text-gray-500">
            {t('browser.surface.launchMode')}: {displayState.launchMode || t('browser.status.unknown')}
          </p>
        </div>
        <div className={`rounded-lg border border-gray-200 bg-white p-3 ${variant === 'expanded' ? '' : ''}`}>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
            {t('browser.surface.lastCdpTask')}
          </p>
          <p className="mt-1 text-xs text-gray-700">{displayState.taskText || t('browser.noActiveTask')}</p>
          <p className="mt-2 text-[10px] text-gray-500">
            {t('browser.surface.agentStatus')}: {status} / {displayState.taskStatus}
          </p>
          {displayState.lastResult && (
            <p className="mt-2 text-[10px] text-emerald-700 break-words">{displayState.lastResult}</p>
          )}
          {displayState.lastError && (
            <p className="mt-2 text-[10px] text-red-700 break-words">
              {displayState.lastFailedAction ? `${displayState.lastFailedAction}: ` : ''}
              {displayState.lastError}
            </p>
          )}
        </div>
        {screenshotSrc && (
          <div className="rounded-lg border border-gray-200 bg-white p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
              {t('browser.surface.latestSnapshot')}
            </p>
            <img
              src={screenshotSrc}
              alt=""
              className="mt-2 max-h-40 w-full rounded-md border border-gray-100 object-contain bg-gray-50"
            />
          </div>
        )}
      </div>

      {recentLogs.length > 0 && (
        <div className="mt-4 min-h-0 flex-1 overflow-hidden rounded-lg border border-gray-200 bg-slate-900/95 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            {t('browser.recentActivity')}
          </p>
          <div className={`mt-2 space-y-1 overflow-y-auto font-mono text-[10px] text-slate-300 ${variant === 'expanded' ? 'max-h-48' : 'max-h-24'}`}>
            {recentLogs.map((log, index) => (
              <p key={`${log.timestamp}-${index}`} className="break-words">
                [{log.timestamp}] {log.message}
              </p>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void handleOpenChrome()}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          {t('browser.surface.openExternalChrome')}
        </button>
        <button
          type="button"
          onClick={() => void handleRefreshStatus()}
          className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-medium text-blue-700 hover:bg-blue-100"
        >
          {t('browser.surface.resyncCdpState')}
        </button>
      </div>
    </div>
  );
}

export default CdpBrowserSurfacePanel;

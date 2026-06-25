/**
 * BrowserMiniPreview - Compact live browser surface in right panel browser tab
 *
 * This component hosts the same embedded browser surface used by the expanded view.
 * The actual webview is positioned by the backend into the preview viewport bounds,
 * so the user can interact with the real browser session directly in mini mode.
 */

import { useEffect, useRef, useState } from 'react';
import { useBrowserAgentStore, useUIStore, useCdpStore } from '@/store';
import { useBrowserInputBlocked, useBrowserMarqueeActive } from '@/hooks/useBrowserMarqueeActive';
import { BrowserAgentBusyOverlay } from './BrowserAgentBusyOverlay';
import { useBrowserObservabilityStore } from '@/store/browserObservabilityStore';
import { showBrowserWindow } from '@/utils/browserCommands';
import { createTaskEnvelope } from '@/utils/browserTaskPlanner';
import { BrowserDebugPanel } from './BrowserDebugPanel';
import { BrowserActionApprovalPrompt } from './BrowserActionApprovalPrompt';
import { CdpBrowserSurfacePanel } from './CdpBrowserSurfacePanel';
import { BrowserSurfaceViewport } from './BrowserSurfaceViewport';
import { useBrowserSurfaceKind } from '@/hooks/useBrowserSurfaceKind';
import {
  getBrowserExpandLabelKey,
  getBrowserOpenWindowLabelKey,
} from '@/utils/browserSurfaceKind';
import {
  getBrowserPanelPrimaryActionKey,
  getBrowserPanelStatusInfo,
  isBrowserPanelTaskInputDisabled,
  type BrowserPanelTone,
} from './browserPanelModel';
import { t } from '@/i18n';

interface InlineNotice {
  tone: BrowserPanelTone;
  titleKey: string;
  descriptionKey: string;
}

const toneClasses: Record<
  BrowserPanelTone,
  { container: string; title: string; body: string; icon: string }
> = {
  slate: {
    container: 'border-gray-200 bg-gray-50',
    title: 'text-gray-900',
    body: 'text-gray-600',
    icon: 'bg-white text-gray-500',
  },
  blue: {
    container: 'border-blue-200 bg-blue-50',
    title: 'text-blue-900',
    body: 'text-blue-700',
    icon: 'bg-white text-blue-600',
  },
  green: {
    container: 'border-green-200 bg-green-50',
    title: 'text-green-900',
    body: 'text-green-700',
    icon: 'bg-white text-green-600',
  },
  amber: {
    container: 'border-amber-200 bg-amber-50',
    title: 'text-amber-900',
    body: 'text-amber-700',
    icon: 'bg-white text-amber-600',
  },
  red: {
    container: 'border-red-200 bg-red-50',
    title: 'text-red-900',
    body: 'text-red-700',
    icon: 'bg-white text-red-600',
  },
};

const getToneIcon = (tone: BrowserPanelTone) => {
  switch (tone) {
    case 'green':
      return '✓';
    case 'blue':
      return '…';
    case 'amber':
      return '!';
    case 'red':
      return '×';
    default:
      return '•';
  }
};

export function BrowserMiniPreview() {
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    (async () => {
      try {
        cleanup = await useBrowserAgentStore.getState().setupEventListeners();
      } catch (err) {
        console.warn('Failed to setup browser event listeners in BrowserMiniPreview:', err);
      }
    })();
    return () => {
      cleanup?.();
    };
  }, []);

  const {
    currentUrl,
    status,
    authState,
    logs,
    pendingTask,
    isWindowOpen,
    presentationMode,
    executeTaskEnvelope,
    stopTask,
    clearLogs,
    addLog,
    inspectCurrentPage,
    confirmLoginAndResume,
    forceResumeWithoutAuth,
    expandBrowser,
    collapseBrowser,
  } = useBrowserAgentStore();

  const { openBrowserExternal, closeBrowserDock } = useUIStore();

  const [taskInput, setTaskInput] = useState('');
  const [isExecuting, setIsExecuting] = useState(false);
  const [copiedLogs, setCopiedLogs] = useState(false);
  const [activityView, setActivityView] = useState<'logs' | 'debug'>('logs');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [inlineNotice, setInlineNotice] = useState<InlineNotice | null>(null);
  const [cdpUrl, setCdpUrl] = useState('');
  const logsEndRef = useRef<HTMLDivElement>(null);
  const submittedTaskRef = useRef<string | null>(null);

  const cdpConnected = useCdpStore((state) => state.status === 'connected');
  const cdpConnectionState = useCdpStore((state) => state.connectionState);
  const debugPanelEnabled = useBrowserObservabilityStore((state) => state.debugPanelEnabled);

  useEffect(() => {
    if (!debugPanelEnabled && activityView === 'debug') {
      setActivityView('logs');
    }
  }, [activityView, debugPanelEnabled]);

  useEffect(() => {
    if (!showAdvanced && activityView === 'debug') {
      setActivityView('logs');
    }
  }, [activityView, showAdvanced]);

  const handleCopyLogs = async () => {
    if (logs.length === 0) return;
    const logText = logs
      .map((log) => `[${formatTime(log.timestamp)}] [${log.level.toUpperCase()}] ${log.message}`)
      .join('\n');

    try {
      await navigator.clipboard.writeText(logText);
      setCopiedLogs(true);
      setTimeout(() => setCopiedLogs(false), 2000);
    } catch {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = logText;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        setCopiedLogs(true);
        setTimeout(() => setCopiedLogs(false), 2000);
      } catch (fallbackErr) {
        console.error('Failed to copy logs:', fallbackErr);
        setCopiedLogs(false);
      }
    }
  };

  useEffect(() => {
    if (pendingTask?.executionPrompt) {
      setTaskInput(pendingTask.executionPrompt);
    }
  }, [pendingTask?.executionPrompt]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs, showAdvanced]);

  useEffect(() => {
    if (status === 'running' && submittedTaskRef.current) {
      setTaskInput('');
      submittedTaskRef.current = null;
    }
  }, [status]);

  const getSiteName = () => {
    if (!currentUrl) return t('browser.unknownSite');
    try {
      const url = new URL(currentUrl);
      return url.hostname.replace('www.', '');
    } catch {
      return t('browser.unknownSite');
    }
  };

  const getStatusText = () => {
    switch (status) {
      case 'uninitialized':
        return t('browser.status.uninitialized');
      case 'opening':
        return t('browser.status.opening');
      case 'idle':
        return t('browser.status.idle');
      case 'inspecting':
        return t('browser.status.inspecting');
      case 'needs_login':
        return t('browser.status.needsLogin');
      case 'waiting_user_resume':
        return t('browser.status.waitingUserResume');
      case 'ready_for_agent':
        return t('browser.status.readyForAgent');
      case 'running':
        return t('browser.status.running');
      case 'blocked_auth':
        return t('browser.status.blockedAuth');
      case 'blocked_captcha':
        return t('browser.status.blockedCaptcha');
      case 'blocked_manual_step':
        return t('browser.status.blockedManualStep');
      case 'completed':
        return t('browser.status.completed');
      case 'error':
        return t('browser.status.error');
      default:
        return t('browser.status.unknown');
    }
  };

  const getStatusBadgeColor = () => {
    switch (status) {
      case 'completed':
        return 'bg-green-500';
      case 'error':
        return 'bg-red-500';
      case 'running':
      case 'opening':
      case 'inspecting':
        return 'bg-blue-500 animate-pulse';
      case 'needs_login':
      case 'waiting_user_resume':
      case 'blocked_auth':
      case 'blocked_captcha':
      case 'blocked_manual_step':
        return 'bg-yellow-500';
      case 'ready_for_agent':
        return 'bg-green-500';
      default:
        return 'bg-gray-400';
    }
  };

  const getAuthBadgeColor = () => {
    switch (authState) {
      case 'authenticated':
        return 'bg-green-100 text-green-700';
      case 'unauthenticated':
        return 'bg-red-100 text-red-700';
      default:
        return 'bg-gray-100 text-gray-600';
    }
  };

  const getLogColor = (level: string) => {
    switch (level) {
      case 'success':
        return 'text-green-400';
      case 'error':
        return 'text-red-400';
      case 'warning':
        return 'text-yellow-400';
      case 'thinking':
        return 'text-yellow-400';
      case 'info':
        return 'text-blue-400';
      default:
        return 'text-gray-300';
    }
  };

  const formatTime = (timestamp: string) => {
    if (timestamp.includes(':') && timestamp.length <= 8) {
      return timestamp;
    }
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
  };

  const handleRunTask = async () => {
    const submittedTask = taskInput.trim();
    if (!submittedTask || isExecuting) return;

    setInlineNotice(null);
    setIsExecuting(true);
    submittedTaskRef.current = submittedTask;

    try {
      if (pendingTask) {
        await executeTaskEnvelope({
          ...pendingTask,
          id: crypto.randomUUID(),
          userIntent: submittedTask,
          executionPrompt: submittedTask,
        });
        return;
      }

      if (cdpConnected) {
        // Use explicit cdpUrl input, or fall back to the current page URL from CDP connection state
        const effectiveUrl = cdpUrl.trim() || cdpConnectionState?.current_url || '';
        if (!effectiveUrl) {
          setInlineNotice({
            tone: 'amber',
            titleKey: 'browser.notice.enterTargetUrlTitle',
            descriptionKey: 'browser.notice.enterTargetUrlDescription',
          });
          addLog?.('warning', t('browser.notice.enterTargetUrlDescription'));
          submittedTaskRef.current = null;
          return;
        }

        const url = effectiveUrl.startsWith('http')
          ? effectiveUrl
          : `https://${effectiveUrl}`;
        const envelope = createTaskEnvelope(url, submittedTask, submittedTask);
        envelope.executionMode = 'cdp';
        await executeTaskEnvelope(envelope);
        return;
      }

      setInlineNotice({
        tone: 'amber',
        titleKey: 'browser.notice.taskContextRequiredTitle',
        descriptionKey: 'browser.notice.taskContextRequiredDescription',
      });
      addLog?.('error', t('browserMiniPreview.cannotRunMissingContext'));
      submittedTaskRef.current = null;
    } finally {
      if (useBrowserAgentStore.getState().status !== 'running') {
        submittedTaskRef.current = null;
      }
      setIsExecuting(false);
    }
  };

  const handleStopTask = () => {
    stopTask();
    setIsExecuting(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleRunTask();
    }
  };

  const surfaceKind = useBrowserSurfaceKind();
  const cdpCurrentUrl = cdpConnectionState?.current_url ?? null;
  const cdpHealthStatus = cdpConnectionState?.health_status ?? null;
  const cdpLaunchMode = cdpConnectionState?.launch_mode ?? null;
  const expandLabelKey = getBrowserExpandLabelKey(surfaceKind, presentationMode === 'expanded');
  const openWindowLabelKey = getBrowserOpenWindowLabelKey(surfaceKind);

  const handleOpenLiveWindow = async () => {
    try {
      await showBrowserWindow();
    } catch (error) {
      console.error('Failed to show browser window:', error);
    }
  };

  const handleRefreshCheck = async () => {
    setInlineNotice(null);
    await inspectCurrentPage();
  };

  const handleConfirmLogin = async () => {
    setInlineNotice(null);
    await confirmLoginAndResume();
  };

  const handleForceResume = async () => {
    setInlineNotice(null);
    await forceResumeWithoutAuth();
  };

  const isExpanded = presentationMode === 'expanded';
  const showMarquee = useBrowserMarqueeActive();
  const blockBrowserInput = useBrowserInputBlocked();
  const isAgentRunning = status === 'running';
  const hasSurfaceContext = isWindowOpen || cdpConnected || Boolean(pendingTask);
  const showUserActionPrompt = status === 'needs_login' || status === 'waiting_user_resume' || status.startsWith('blocked_');
  const statusInfo = inlineNotice ?? getBrowserPanelStatusInfo({
    isWindowOpen: hasSurfaceContext,
    status,
  });
  const statusToneClass = toneClasses[statusInfo.tone];
  const currentTaskText = taskInput.trim() || pendingTask?.executionPrompt || '';
  const primaryActionKey = getBrowserPanelPrimaryActionKey(status);
  const taskInputDisabled = isBrowserPanelTaskInputDisabled(status);
  const recentActivity = logs[logs.length - 1]?.message || t('browser.waitingForExecution');
  const primaryButtonClass = showUserActionPrompt
    ? 'bg-amber-600 hover:bg-amber-700'
    : 'bg-green-600 hover:bg-green-700';

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {isAgentRunning && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-gradient-to-r from-blue-500 to-cyan-500 text-white text-[11px] font-medium flex-shrink-0">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-white animate-ping" />
          {t('browserMiniPreview.agentRunning')}
        </div>
      )}

      <div className="p-3 space-y-3 flex-shrink-0">
        {!isExpanded ? (
          <div
            className={`bg-white rounded-lg border border-gray-200 overflow-visible${
              showMarquee ? ' agent-running-border' : ' overflow-hidden'
            }`}
            style={{ position: 'relative' }}
          >
            {surfaceKind === 'embedded_webview' ? (
              <BrowserSurfaceViewport
                mode="mini"
                className="aspect-video bg-gray-100 relative"
                emptyState={
                  <div className="flex items-center justify-center h-full text-gray-500 text-sm">
                    <span>{t('browser.noBrowserSurface')}</span>
                  </div>
                }
              />
            ) : surfaceKind === 'cdp_external' ? (
              <div className="aspect-video relative overflow-hidden bg-gray-100">
                <CdpBrowserSurfacePanel variant="compact" className="h-full" />
              </div>
            ) : (
              <div className="aspect-video flex items-center justify-center bg-gray-100 text-gray-500 text-sm px-4 text-center">
                <span>{t('browser.surface.noEmbeddedSurface')}</span>
              </div>
            )}

            {blockBrowserInput && surfaceKind === 'embedded_webview' && (
              <BrowserAgentBusyOverlay className="rounded-t-lg" stripeSize="sm" />
            )}

            <div className="p-2 border-t border-gray-100">
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{getSiteName()}</p>
                  <p className="text-xs text-gray-500 truncate">{currentUrl || t('browser.pleaseOpenBrowserFirst')}</p>
                </div>
                <span className={`px-1.5 py-0.5 text-xs font-medium text-white rounded ${getStatusBadgeColor()}`}>
                  {getStatusText()}
                </span>
                {showAdvanced && (
                  <span className={`px-1.5 py-0.5 text-xs font-medium rounded ${getAuthBadgeColor()}`}>
                    {authState === 'authenticated'
                      ? t('browser.loggedIn')
                      : authState === 'unauthenticated'
                        ? t('browser.notLoggedIn')
                        : t('browser.status.unknown')}
                  </span>
                )}
              </div>
              {showAdvanced && cdpConnected && cdpConnectionState && (
                <div className="mt-2 grid grid-cols-1 gap-1 text-[10px] text-gray-500">
                  <p className="truncate">CDP URL: {cdpCurrentUrl || t('browser.pendingPageMetadata')}</p>
                  <p>Mode: {cdpLaunchMode || t('browser.status.unknown')} · Health: {cdpHealthStatus || t('browser.status.unknown')}</p>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-lg border border-gray-200 p-2">
            <div className="flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{getSiteName()}</p>
                <p className="text-xs text-gray-500 truncate">{currentUrl || t('browser.pleaseOpenBrowserFirst')}</p>
              </div>
              <span className={`px-1.5 py-0.5 text-xs font-medium text-white rounded ${getStatusBadgeColor()}`}>
                {getStatusText()}
              </span>
              {showAdvanced && (
                <span className={`px-1.5 py-0.5 text-xs font-medium rounded ${getAuthBadgeColor()}`}>
                  {authState === 'authenticated'
                    ? t('browser.loggedIn')
                    : authState === 'unauthenticated'
                      ? t('browser.notLoggedIn')
                      : t('browser.status.unknown')}
                </span>
              )}
            </div>
            {showAdvanced && cdpConnected && cdpConnectionState && (
              <div className="mt-2 text-[10px] text-gray-500">
                {cdpLaunchMode || t('browser.status.unknown')} · {cdpHealthStatus || t('browser.status.unknown')} · {cdpCurrentUrl || t('browser.pendingPageMetadata')}
              </div>
            )}
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={() => {
              if (presentationMode === 'expanded') {
                collapseBrowser();
              } else {
                expandBrowser();
              }
            }}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            {t(expandLabelKey)}
          </button>

          <button
            onClick={async () => {
              if (surfaceKind !== 'cdp_external') {
                openBrowserExternal();
              }
              await handleOpenLiveWindow();
            }}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            {t(openWindowLabelKey)}
          </button>

          <button
            onClick={closeBrowserDock}
            className="flex items-center justify-center px-3 py-2 text-sm font-medium text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors"
            title={t('browser.close')}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className={`rounded-xl border p-3 ${statusToneClass.container}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0 flex-1">
              <span className={`h-8 w-8 shrink-0 rounded-full flex items-center justify-center text-sm font-semibold ${statusToneClass.icon}`}>
                {getToneIcon(statusInfo.tone)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                  {t('browser.statusSummary')}
                </div>
                <p className={`mt-1 text-sm font-semibold ${statusToneClass.title}`}>
                  {t(statusInfo.titleKey as Parameters<typeof t>[0])}
                </p>
                <p className={`mt-1 text-xs leading-5 ${statusToneClass.body}`}>
                  {t(statusInfo.descriptionKey as Parameters<typeof t>[0])}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowAdvanced((prev) => !prev)}
              className={`px-2.5 py-1 text-[10px] font-medium rounded-full border transition-colors ${
                showAdvanced
                  ? 'border-blue-300 bg-blue-50 text-blue-700'
                  : 'border-white/60 bg-white text-gray-600 hover:border-blue-300 hover:text-blue-600'
              }`}
            >
              {showAdvanced ? t('browser.hideAdvancedInfo') : t('browser.showAdvancedInfo')}
            </button>
          </div>
        </div>
      </div>

      <div className="px-3 py-3 border-t border-gray-200 bg-white flex-shrink-0">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">{t('browser.currentTask')}</span>
          {showUserActionPrompt && (
            <span className="text-[10px] text-yellow-600 font-medium">{t('browser.loginRequired')}</span>
          )}
        </div>

        <div className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-700 mb-2 min-h-[38px] flex items-center">
          {currentTaskText || t('browser.noActiveTask')}
        </div>

        <div className="flex flex-col gap-2">
          {cdpConnected && !pendingTask && (
            <input
              type="text"
              value={cdpUrl}
              onChange={(e) => {
                setInlineNotice(null);
                setCdpUrl(e.target.value);
              }}
              onKeyDown={handleKeyDown}
              placeholder={t('browserMiniPreview.enterTargetUrl')}
              className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg bg-white focus:outline-none focus:border-blue-400"
            />
          )}

          <div className="flex gap-2">
            <input
              type="text"
              value={taskInput}
              onChange={(e) => {
                setInlineNotice(null);
                setTaskInput(e.target.value);
              }}
              onKeyDown={handleKeyDown}
              placeholder={hasSurfaceContext || pendingTask ? t('browser.enterTaskInstruction') : t('browser.pleaseOpenBrowserFirst')}
              disabled={taskInputDisabled}
              className="flex-1 px-3 py-2 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed"
            />
            {status === 'running' ? (
              <button
                onClick={handleStopTask}
                className="px-3 py-2 text-xs font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors"
              >
                {t('browser.stop')}
              </button>
            ) : (
              <button
                onClick={() => void handleRunTask()}
                disabled={!taskInput.trim() || isExecuting}
                className={`px-3 py-2 text-xs font-medium text-white rounded-lg transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed ${primaryButtonClass}`}
              >
                {t(primaryActionKey as Parameters<typeof t>[0])}
              </button>
            )}
          </div>
        </div>

        <BrowserActionApprovalPrompt />

        {showUserActionPrompt && (
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              onClick={handleOpenLiveWindow}
              className="px-3 py-1.5 text-[11px] font-medium text-gray-700 bg-gray-100 border border-gray-200 rounded-lg hover:bg-gray-200 transition-colors"
            >
              {t('browserMiniPreview.loginInWindow')}
            </button>
            <button
              onClick={handleRefreshCheck}
              className="px-3 py-1.5 text-[11px] font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 transition-colors"
            >
              {t('browser.continueCheck')}
            </button>
            {status === 'waiting_user_resume' && (
              <button
                onClick={handleConfirmLogin}
                className="px-3 py-1.5 text-[11px] font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors"
              >
                {t('browser.iHaveLoggedIn')}
              </button>
            )}
            {showAdvanced && status === 'waiting_user_resume' && (
              <button
                onClick={handleForceResume}
                className="px-3 py-1.5 text-[11px] font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
                title={t('browserMiniPreview.skipVerification')}
              >
                {t('browserMiniPreview.forceContinue')}
              </button>
            )}
          </div>
        )}
      </div>

      {showAdvanced ? (
        <>
          <div className="px-3 py-3 border-t border-gray-200 bg-gray-50 flex-shrink-0">
            <div className="rounded-xl border border-gray-200 bg-white p-3 grid grid-cols-2 gap-3 text-xs text-gray-600">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-gray-400">{t('browser.currentStatus')}</p>
                <p className="mt-1 break-words">{status}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-gray-400">{t('browser.authState')}</p>
                <div className="mt-1">
                  <span className={`px-2 py-0.5 text-[10px] font-medium rounded ${getAuthBadgeColor()}`}>
                    {authState === 'authenticated'
                      ? t('browser.loggedIn')
                      : authState === 'unauthenticated'
                        ? t('browser.notLoggedIn')
                        : t('browser.status.unknown')}
                  </span>
                </div>
              </div>
              {cdpConnected && (
                <>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-gray-400">CDP</p>
                    <p className="mt-1 break-words">{cdpLaunchMode || t('browser.status.unknown')}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-gray-400">Health</p>
                    <p className="mt-1 break-words">{cdpHealthStatus || t('browser.status.unknown')}</p>
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="flex-1 flex flex-col min-h-0 border-t border-gray-200">
            <div className="px-3 py-1.5 bg-gray-100 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                  {activityView === 'logs' ? t('browser.executionLog') : t('browser.debug')}
                </span>
                {debugPanelEnabled && (
                  <div className="flex items-center rounded-full border border-gray-200 bg-white p-0.5">
                    <button
                      onClick={() => setActivityView('logs')}
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors ${
                        activityView === 'logs'
                          ? 'bg-gray-900 text-white'
                          : 'text-gray-500 hover:text-gray-800'
                      }`}
                    >
                      {t('browser.logs')}
                    </button>
                    <button
                      onClick={() => setActivityView('debug')}
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors ${
                        activityView === 'debug'
                          ? 'bg-gray-900 text-white'
                          : 'text-gray-500 hover:text-gray-800'
                      }`}
                    >
                      {t('browser.debug')}
                    </button>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                {activityView === 'logs' ? (
                  <>
                    <button
                      onClick={handleCopyLogs}
                      disabled={logs.length === 0}
                      className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${
                        copiedLogs
                          ? 'text-green-600 bg-green-50'
                          : logs.length === 0
                            ? 'text-gray-300 cursor-not-allowed'
                            : 'text-gray-400 hover:text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {copiedLogs ? `✓ ${t('browser.copied')}` : t('browser.copyAll')}
                    </button>
                    <button onClick={clearLogs} className="text-[10px] text-gray-400 hover:text-gray-600">
                      {t('browser.clear')}
                    </button>
                  </>
                ) : (
                  <span className="text-[10px] text-gray-400">{t('browser.observability')}</span>
                )}
              </div>
            </div>
            {activityView === 'logs' ? (
              <div className="flex-1 overflow-y-auto p-3 bg-gray-900">
                {logs.length === 0 ? (
                  <p className="text-xs text-gray-600">{t('browser.waitingForExecution')}</p>
                ) : (
                  <div className="space-y-0.5">
                    {logs.map((log, index) => (
                      <p
                        key={index}
                        className={`text-[10px] font-mono leading-relaxed ${getLogColor(log.level)}`}
                      >
                        [{formatTime(log.timestamp)}] {log.message}
                      </p>
                    ))}
                    <div ref={logsEndRef} />
                  </div>
                )}
              </div>
            ) : (
              <div className="flex-1 min-h-0">
                <BrowserDebugPanel />
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="px-3 pb-3">
          <div className="rounded-xl border border-gray-200 bg-white p-3">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
              {t('browser.recentActivity')}
            </div>
            <p className="mt-2 text-xs leading-5 text-gray-700">{recentActivity}</p>
          </div>
        </div>
      )}
    </div>
  );
}

export default BrowserMiniPreview;

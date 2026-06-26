import { useEffect, useRef, useState } from 'react';

import { useBrowserAgentStore, useCdpStore, useUIStore } from '@/store';
import { useBrowserObservabilityStore } from '@/store/browserObservabilityStore';
import { BrowserActionApprovalPrompt } from './BrowserActionApprovalPrompt';
import { BrowserDebugPanel } from './BrowserDebugPanel';
import { showBrowserWindow } from '@/utils/browserCommands';
import { createTaskEnvelope } from '@/utils/browserTaskPlanner';
import {
  getBrowserExpandLabelKey,
  getBrowserOpenWindowLabelKey,
} from '@/utils/browserSurfaceKind';
import { resolveCdpBrowserDisplayState } from '@/utils/cdpBrowserDisplayState';
import {
  browserPanelToneClasses,
  formatBrowserPanelLogTime,
  getBrowserPanelLogColor,
  getBrowserPanelPrimaryActionKey,
  getBrowserPanelToneIcon,
  type BrowserPanelTone,
} from './browserPanelModel';
import { t } from '@/i18n';

interface InlineNotice {
  tone: BrowserPanelTone;
  titleKey: string;
  descriptionKey: string;
}

export function CdpBrowserControllerPanel() {
  const {
    currentUrl,
    status,
    logs,
    pendingTask,
    presentationMode,
    executeTaskEnvelope,
    stopTask,
    clearLogs,
    addLog,
    expandBrowser,
    collapseBrowser,
  } = useBrowserAgentStore();
  const { closeBrowserDock } = useUIStore();

  const cdpStatus = useCdpStore((state) => state.status);
  const cdpConnected = cdpStatus === 'connected';
  const cdpConnectionState = useCdpStore((state) => state.connectionState);
  const cdpRuntime = useCdpStore((state) => state.runtime);
  const refreshCdpRuntimeState = useCdpStore((state) => state.refreshCdpRuntimeState);
  const debugPanelEnabled = useBrowserObservabilityStore((state) => state.debugPanelEnabled);
  const latestPageState = useBrowserObservabilityStore((state) => state.latestPageState);
  const activeFailureSnapshot = useBrowserObservabilityStore((state) => state.activeFailureSnapshot);

  const [taskInput, setTaskInput] = useState('');
  const [isExecuting, setIsExecuting] = useState(false);
  const [copiedLogs, setCopiedLogs] = useState(false);
  const [activityView, setActivityView] = useState<'logs' | 'debug'>('logs');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [inlineNotice, setInlineNotice] = useState<InlineNotice | null>(null);
  const [cdpUrl, setCdpUrl] = useState('');
  const logsEndRef = useRef<HTMLDivElement>(null);
  const submittedTaskRef = useRef<string | null>(null);

  const displayState = resolveCdpBrowserDisplayState({
    cdpStatus,
    connectionState: cdpConnectionState,
    cdpRuntime,
    latestPageState,
    pendingTask,
    browserCurrentUrl: currentUrl,
    browserStatus: status,
    activeFailureSnapshot,
  });

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

  const handleOpenLiveWindow = async () => {
    try {
      await showBrowserWindow();
    } catch (error) {
      console.error('Failed to show browser window:', error);
    }
  };

  const handleRefreshCdpStatus = async () => {
    setInlineNotice(null);
    await refreshCdpRuntimeState();
  };

  const handleCopyLogs = async () => {
    if (logs.length === 0) return;
    const logText = logs
      .map((log) => `[${formatBrowserPanelLogTime(log.timestamp)}] [${log.level.toUpperCase()}] ${log.message}`)
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

      const effectiveUrl = cdpUrl.trim() || displayState.displayUrl || '';
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

  const statusInfo = inlineNotice ?? displayState;
  const statusToneClass = browserPanelToneClasses[statusInfo.tone];
  const targetUrl = cdpUrl.trim() || displayState.displayUrl;
  const currentTaskText = taskInput.trim() || pendingTask?.executionPrompt || '';
  const showUserActionPrompt =
    status === 'needs_login' ||
    status === 'waiting_user_resume' ||
    status.startsWith('blocked_');
  const primaryActionKey = getBrowserPanelPrimaryActionKey(status);
  const executeDisabled =
    !taskInput.trim() ||
    isExecuting ||
    (!pendingTask && !targetUrl);
  const isAgentRunning = status === 'running';
  const expandLabelKey = getBrowserExpandLabelKey('cdp_external', presentationMode === 'expanded');
  const openWindowLabelKey = getBrowserOpenWindowLabelKey('cdp_external');
  const primaryButtonClass = showUserActionPrompt
    ? 'bg-amber-600 hover:bg-amber-700'
    : 'bg-green-600 hover:bg-green-700';
  const recentActivity = logs[logs.length - 1]?.message || t('browser.waitingForExecution');

  return (
    <div className="h-full flex flex-col bg-gray-50" data-testid="cdp-browser-controller">
      {isAgentRunning && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-gradient-to-r from-blue-500 to-cyan-500 text-white text-[11px] font-medium flex-shrink-0">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-white animate-ping" />
          {t('browserMiniPreview.agentRunning')}
        </div>
      )}

      <div className="p-3 space-y-3 flex-shrink-0">
        <div className="rounded-xl border border-gray-200 bg-white p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold text-gray-900">
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
                  : displayState.connecting
                    ? 'bg-blue-100 text-blue-800'
                    : 'bg-gray-100 text-gray-600'
              }`}
            >
              {displayState.connected
                ? t('browser.surface.cdpConnected')
                : displayState.connecting
                  ? t('browser.status.opening')
                  : t('browser.surface.cdpDisconnected')}
            </span>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-gray-700">
            <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                {t('browser.surface.currentChromePage')}
              </p>
              <p className="mt-1 break-all">
                {displayState.displayUrl || t('browser.surface.noChromePage')}
              </p>
              {displayState.pageTitle && (
                <p className="mt-1 truncate text-[10px] text-gray-500">{displayState.pageTitle}</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                  {t('browser.surface.connectionHealth')}
                </p>
                <p className="mt-1 truncate">
                  {displayState.healthStatus || t('browser.status.unknown')}
                </p>
              </div>
              <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                  {t('browser.surface.agentStatus')}
                </p>
                <p className="mt-1 truncate">{status}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
          <button
            onClick={() => {
              if (presentationMode === 'expanded') {
                collapseBrowser();
              } else {
                expandBrowser();
              }
            }}
            className="flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            {t(expandLabelKey)}
          </button>

          <button
            onClick={handleOpenLiveWindow}
            className="flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            {t(openWindowLabelKey)}
          </button>

          <button
            onClick={closeBrowserDock}
            className="flex items-center justify-center px-3 py-2 text-sm font-medium text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors"
            title={t('browser.surface.hidePanel')}
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
                {getBrowserPanelToneIcon(statusInfo.tone)}
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
              onClick={() => void handleRefreshCdpStatus()}
              className="px-2.5 py-1 text-[10px] font-medium rounded-full border border-white/60 bg-white text-gray-600 hover:border-blue-300 hover:text-blue-600"
            >
              {t('browser.surface.resyncCdpState')}
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
          {currentTaskText || displayState.taskText || t('browser.noActiveTask')}
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
              placeholder={displayState.displayUrl || t('browserMiniPreview.enterTargetUrl')}
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
              placeholder={displayState.hasRunnableTarget || pendingTask ? t('browser.enterTaskInstruction') : t('browser.surface.enterTargetUrlFirst')}
              disabled={status === 'running'}
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
                disabled={executeDisabled}
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
              onClick={() => void handleRefreshCdpStatus()}
              className="px-3 py-1.5 text-[11px] font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 transition-colors"
            >
              {t('browser.surface.resyncCdpState')}
            </button>
          </div>
        )}
      </div>

      {showAdvanced ? (
        <>
          <div className="px-3 py-3 border-t border-gray-200 bg-gray-50 flex-shrink-0">
            <div className="rounded-xl border border-gray-200 bg-white p-3 grid grid-cols-2 gap-3 text-xs text-gray-600">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-gray-400">{t('browser.surface.launchMode')}</p>
                <p className="mt-1 break-words">{displayState.launchMode || t('browser.status.unknown')}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-gray-400">{t('browser.surface.connectionHealth')}</p>
                <p className="mt-1 break-words">{displayState.healthStatus || t('browser.status.unknown')}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-gray-400">Target</p>
                <p className="mt-1 break-words">{displayState.targetId || t('browser.status.unknown')}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-gray-400">Session</p>
                <p className="mt-1 break-words">{displayState.sessionId || t('browser.status.unknown')}</p>
              </div>
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
                      {copiedLogs ? t('browser.copied') : t('browser.copyAll')}
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
                        className={`text-[10px] font-mono leading-relaxed ${getBrowserPanelLogColor(log.level)}`}
                      >
                        [{formatBrowserPanelLogTime(log.timestamp)}] {log.message}
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
            <div className="flex items-center justify-between">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                {t('browser.recentActivity')}
              </div>
              <button
                type="button"
                onClick={() => setShowAdvanced(true)}
                className="text-[10px] text-blue-600 hover:text-blue-700"
              >
                {t('browser.showAdvancedInfo')}
              </button>
            </div>
            <p className="mt-2 text-xs leading-5 text-gray-700">{recentActivity}</p>
          </div>
        </div>
      )}
    </div>
  );
}

export default CdpBrowserControllerPanel;

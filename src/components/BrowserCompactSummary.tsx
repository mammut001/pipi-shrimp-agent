/**
 * BrowserCompactSummary - Compact browser summary for expanded/split mode
 */

import { useEffect, useRef, useState } from 'react';
import { useBrowserAgentStore, useUIStore } from '@/store';
import {
  getBrowserPanelStatusInfo,
  type BrowserPanelTone,
} from './browserPanelModel';
import { t } from '@/i18n';

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

export function BrowserCompactSummary() {
  const {
    currentUrl,
    status,
    authState,
    logs,
    pendingTask,
    isWindowOpen,
    clearLogs,
    confirmLoginAndResume,
    forceResumeWithoutAuth,
    inspectCurrentPage,
    collapseBrowser,
  } = useBrowserAgentStore();

  const { focusChatPane } = useUIStore();

  const [copiedLogs, setCopiedLogs] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);

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
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs, showAdvanced]);

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

  const getSiteName = () => {
    if (!currentUrl) return t('browser.unknownSite');
    try {
      const url = new URL(currentUrl);
      return url.hostname.replace('www.', '');
    } catch {
      return t('browser.unknownSite');
    }
  };

  const showUserActionPrompt = status === 'waiting_user_resume' || status === 'needs_login' || status.startsWith('blocked_');
  const statusInfo = getBrowserPanelStatusInfo({ isWindowOpen, status });
  const statusToneClass = toneClasses[statusInfo.tone];
  const recentActivity = logs[logs.length - 1]?.message || t('browser.waitingForExecution');

  return (
    <div className="h-full flex flex-col bg-gray-50">
      <div className="p-3 border-b border-gray-200 bg-white flex-shrink-0">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-semibold text-gray-700">{t('browser.title')}</h3>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setShowAdvanced((prev) => !prev)}
              className={`px-2 py-1 text-[10px] font-medium rounded-full border transition-colors ${
                showAdvanced
                  ? 'border-blue-300 bg-blue-50 text-blue-700'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-blue-300 hover:text-blue-600'
              }`}
            >
              {showAdvanced ? t('browser.hideAdvancedInfo') : t('browser.showAdvancedInfo')}
            </button>
            <button
              onClick={focusChatPane}
              className="p-1.5 rounded hover:bg-gray-100 text-gray-500"
              title={t('browser.returnToChat')}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </button>
            <button
              onClick={collapseBrowser}
              className="p-1.5 rounded hover:bg-gray-100 text-gray-500"
              title={t('browser.collapseToMini')}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
              </svg>
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <div className="flex-1 min-w-0">
            <p className="font-medium text-gray-800 truncate">{getSiteName()}</p>
            <p className="text-gray-400 truncate">{currentUrl || t('browser.pleaseOpenBrowserFirst')}</p>
          </div>
          <span className={`px-2 py-0.5 text-[10px] font-medium text-white rounded ${getStatusBadgeColor()}`}>
            {getStatusText()}
          </span>
          {showAdvanced && (
            <span className={`px-2 py-0.5 text-[10px] font-medium rounded ${getAuthBadgeColor()}`}>
              {authState === 'authenticated'
                ? t('browser.loggedIn')
                : authState === 'unauthenticated'
                  ? t('browser.notLoggedIn')
                  : t('browser.status.unknown')}
            </span>
          )}
        </div>
      </div>

      <div className="p-3 space-y-3 flex-shrink-0">
        <div className={`rounded-xl border p-3 ${statusToneClass.container}`}>
          <div className="flex items-start gap-3">
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
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">{t('browser.currentTask')}</span>
            {showUserActionPrompt && (
              <span className="text-[10px] text-yellow-600 font-medium">{t('browser.loginRequired')}</span>
            )}
          </div>

          <div className="text-xs text-gray-700 leading-5">
            {pendingTask?.executionPrompt || t('browser.noActiveTask')}
          </div>

          {showUserActionPrompt && (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={inspectCurrentPage}
                className="px-3 py-1.5 text-[11px] font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 transition-colors"
              >
                {t('browser.continueCheck')}
              </button>
              {status === 'waiting_user_resume' && (
                <button
                  onClick={confirmLoginAndResume}
                  className="px-3 py-1.5 text-[11px] font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors"
                >
                  {t('browser.iHaveLoggedIn')}
                </button>
              )}
              {showAdvanced && status === 'waiting_user_resume' && (
                <button
                  onClick={forceResumeWithoutAuth}
                  className="px-3 py-1.5 text-[11px] font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
                  title={t('browser.skipVerificationAndContinue')}
                >
                  {t('browser.forceContinue')}
                </button>
              )}
            </div>
          )}
        </div>

        {!showAdvanced && (
          <div className="rounded-xl border border-gray-200 bg-white p-3">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
              {t('browser.recentActivity')}
            </div>
            <p className="mt-2 text-xs leading-5 text-gray-700">{recentActivity}</p>
          </div>
        )}
      </div>

      {showAdvanced && (
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
            </div>
          </div>

          <div className="flex-1 flex flex-col min-h-0 border-t border-gray-200">
            <div className="px-3 py-1.5 bg-gray-100 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
              <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">{t('browser.executionLog')}</span>
              <div className="flex items-center gap-2">
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
              </div>
            </div>
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
          </div>
        </>
      )}
    </div>
  );
}

export default BrowserCompactSummary;
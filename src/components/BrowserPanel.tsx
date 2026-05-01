/**
 * BrowserPanel - PageAgent UI for controlling web pages
 *
 * Extended with auth handoff support:
 * - Shows current control mode (manual/agent)
 * - Displays authentication state
 * - Manual login handoff with user-facing prompts
 * - Advanced mode keeps debug surfaces available when needed
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useBrowserAgentStore } from '../store/browserAgentStore';
import { useUIStore } from '../store/uiStore';
import { goBack } from '../utils/browserCommands';
import {
  getAuthStateText,
  getBlockReasonText,
  getAuthStateColor,
  getAuthStateBgColor,
} from '../utils/browserInspection';
import {
  getBrowserPanelPrimaryActionKey,
  getBrowserPanelStatusInfo,
  isBrowserPanelTaskInputDisabled,
  runBrowserPanelTaskFlow,
  type BrowserPanelTone,
} from './browserPanelModel';
import { t } from '@/i18n';

const QUICK_SITES = [
  { nameKey: 'browser.quickSite.cbc', url: 'https://www.cbc.ca/news', icon: '📰' },
  { nameKey: 'browser.quickSite.googleNews', url: 'https://news.google.com', icon: '📱' },
  { nameKey: 'browser.quickSite.reddit', url: 'https://www.reddit.com', icon: '💬' },
  { nameKey: 'browser.quickSite.github', url: 'https://github.com', icon: '💻' },
  { nameKey: 'browser.quickSite.hn', url: 'https://news.ycombinator.com', icon: '🔥' },
  { nameKey: 'browser.quickSite.twitter', url: 'https://x.com', icon: '🐦' },
  { nameKey: 'browser.quickSite.youtube', url: 'https://www.youtube.com', icon: '▶️' },
  { nameKey: 'browser.quickSite.whatsapp', url: 'https://web.whatsapp.com', icon: '💬' },
];

interface TaskHistoryItem {
  id: string;
  url: string;
  task: string;
  timestamp: Date;
  status: 'pending' | 'completed' | 'failed';
}

interface InlineNotice {
  tone: BrowserPanelTone;
  titleKey: string;
  descriptionKey: string;
}

const getQuickTasks = (url: string): string[] => {
  const lowerUrl = url.toLowerCase();

  if (lowerUrl.includes('news') || lowerUrl.includes('cbc') || lowerUrl.includes('bbc')) {
    return [
      'browser.quickTask.extractHeadlines',
      'browser.quickTask.findTechNews',
      'browser.quickTask.listCategories',
    ];
  }

  if (lowerUrl.includes('reddit')) {
    return [
      'browser.quickTask.findHotPosts',
      'browser.quickTask.searchDiscussions',
      'browser.quickTask.extractComments',
    ];
  }

  if (lowerUrl.includes('github')) {
    return [
      'browser.quickTask.findHotRepos',
      'browser.quickTask.searchProjects',
      'browser.quickTask.extractProjectInfo',
    ];
  }

  if (lowerUrl.includes('youtube')) {
    return [
      'browser.quickTask.extractVideoTitle',
      'browser.quickTask.findRelatedRecommendations',
      'browser.quickTask.getVideoDescription',
    ];
  }

  if (lowerUrl.includes('whatsapp')) {
    return [
      'browser.quickTask.searchContacts',
      'browser.quickTask.sendTestMessage',
      'browser.quickTask.getRecentChats',
    ];
  }

  if (lowerUrl.includes('amazon') || lowerUrl.includes('shopping')) {
    return [
      'browser.quickTask.searchProducts',
      'browser.quickTask.extractPriceInfo',
      'browser.quickTask.compareReviews',
    ];
  }

  return [
    'browser.quickTask.extractMainContent',
    'browser.quickTask.findImportantInfo',
    'browser.quickTask.summarizePage',
  ];
};

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

export const BrowserPanel: React.FC = () => {
  const [urlInput, setUrlInput] = useState('');
  const [taskInput, setTaskInput] = useState('');
  const [taskHistory, setTaskHistory] = useState<TaskHistoryItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [inlineNotice, setInlineNotice] = useState<InlineNotice | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const activeTaskIdRef = useRef<string | null>(null);

  const {
    status,
    isWindowOpen,
    logs,
    currentUrl,
    error,
    mode,
    authState,
    blockReason,
    inspection,
    lastCompletedTaskId,
    openWindow,
    closeWindow,
    executeTask,
    stopTask,
    clearLogs,
    inspectCurrentPage,
    confirmLoginAndResume,
    forceResumeWithoutAuth,
    switchToManualMode,
    setupEventListeners,
    resetToReady,
  } = useBrowserAgentStore();

  useEffect(() => {
    const setup = async () => {
      cleanupRef.current = await setupEventListeners();
    };
    setup();

    return () => {
      cleanupRef.current?.();
    };
  }, [setupEventListeners]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs, showAdvanced]);

  useEffect(() => {
    const activeTaskId = activeTaskIdRef.current;
    if (!activeTaskId) return;

    if (status === 'completed') {
      setTaskHistory((prev) =>
        prev.map((item) =>
          item.id === activeTaskId ? { ...item, status: 'completed' as const } : item
        )
      );
      activeTaskIdRef.current = null;
      return;
    }

    if (status === 'error') {
      setTaskHistory((prev) =>
        prev.map((item) =>
          item.id === activeTaskId ? { ...item, status: 'failed' as const } : item
        )
      );
      activeTaskIdRef.current = null;
    }
  }, [status, lastCompletedTaskId]);

  const handleOpenWindow = useCallback(async () => {
    if (urlInput.trim()) {
      setInlineNotice(null);
      await openWindow(urlInput.trim());
    }
  }, [urlInput, openWindow]);

  const handleExecute = useCallback(async () => {
    const taskToRun = taskInput.trim();
    if (!taskToRun) return;

    setInlineNotice(null);

    const result = await runBrowserPanelTaskFlow({
      task: taskToRun,
      initialState: {
        isWindowOpen,
        status,
      },
      getState: () => {
        const state = useBrowserAgentStore.getState();
        return {
          status: state.status,
          authState: state.authState,
          inspection: state.inspection,
        };
      },
      inspectCurrentPage,
      confirmLoginAndResume,
      executeTask,
    });

    if (result.outcome === 'open_window_required') {
      setInlineNotice({
        tone: 'amber',
        titleKey: 'browser.notice.openWindowFirstTitle',
        descriptionKey: 'browser.notice.openWindowFirstDescription',
      });
      return;
    }

    if (!result.executionPromise) {
      return;
    }

    if (!result.shouldClearTaskInput) {
      await result.executionPromise.catch(() => {});
      return;
    }

    const taskId = crypto.randomUUID();
    const historyItem: TaskHistoryItem = {
      id: taskId,
      url: useBrowserAgentStore.getState().currentUrl || currentUrl,
      task: taskToRun,
      timestamp: new Date(),
      status: 'pending',
    };
    setTaskHistory((prev) => [historyItem, ...prev].slice(0, 20));
    activeTaskIdRef.current = taskId;
    setTaskInput('');

    try {
      await result.executionPromise;
    } catch {
      setTaskHistory((prev) =>
        prev.map((item) => (item.id === taskId ? { ...item, status: 'failed' } : item))
      );
      activeTaskIdRef.current = null;
    }
  }, [
    taskInput,
    isWindowOpen,
    status,
    inspectCurrentPage,
    confirmLoginAndResume,
    executeTask,
    currentUrl,
  ]);

  const handleQuickSite = useCallback(async (url: string) => {
    setInlineNotice(null);
    setUrlInput(url);
    await openWindow(url);
  }, [openWindow]);

  const handleQuickTask = useCallback((task: string) => {
    setTaskInput(task);
  }, []);

  const handleHistoryItem = useCallback((item: TaskHistoryItem) => {
    setUrlInput(item.url);
    setTaskInput(item.task);
  }, []);

  const handleReturnToChat = useCallback(async () => {
    const { focusChatPane, browserDockMode } = useUIStore.getState();

    if (browserDockMode === 'hidden') {
      return;
    }

    focusChatPane();
  }, []);

  const handleExpandToSplit = useCallback(() => {
    const { expandBrowserToSplit } = useUIStore.getState();
    expandBrowserToSplit();
  }, []);

  const handleOpenInWindow = useCallback(() => {
    const { openBrowserExternal } = useUIStore.getState();
    openBrowserExternal();
  }, []);

  const handleCloseBrowser = useCallback(async () => {
    const { closeBrowserDock } = useUIStore.getState();
    await closeWindow();
    closeBrowserDock();
  }, [closeWindow]);

  const handleGoBack = useCallback(async () => {
    try {
      await goBack();
      setTimeout(async () => {
        const { getBrowserUrl } = await import('../utils/browserCommands');
        const url = await getBrowserUrl();
        useBrowserAgentStore.setState({ currentUrl: url });
      }, 500);
    } catch (goBackError) {
      console.error('Failed to go back:', goBackError);
    }
  }, []);

  const handleInspect = useCallback(async () => {
    setInlineNotice(null);
    await inspectCurrentPage();
  }, [inspectCurrentPage]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleExecute();
    }
  }, [handleExecute]);

  const getStatusColor = () => {
    switch (status) {
      case 'running':
        return 'text-blue-500';
      case 'completed':
        return 'text-green-500';
      case 'error':
        return 'text-red-500';
      case 'needs_login':
      case 'waiting_user_resume':
        return 'text-yellow-500';
      case 'blocked_auth':
      case 'blocked_captcha':
      case 'blocked_manual_step':
        return 'text-orange-500';
      case 'ready_for_agent':
        return 'text-green-500';
      default:
        return 'text-gray-500';
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

  const getModeBadge = () => {
    if (mode === 'manual_handoff') {
      return (
        <span className="px-2 py-0.5 text-[10px] font-medium bg-yellow-100 text-yellow-700 rounded-full">
          {t('browser.manualControl')}
        </span>
      );
    }

    return (
      <span className="px-2 py-0.5 text-[10px] font-medium bg-green-100 text-green-700 rounded-full">
        {t('browser.agentControl')}
      </span>
    );
  };

  const getAuthStateBadge = () => {
    const color = getAuthStateColor(authState);
    const bgColor = getAuthStateBgColor(authState);

    return (
      <span className={`px-2 py-0.5 text-[10px] font-medium rounded-full ${bgColor} ${color}`}>
        {getAuthStateText(authState)}
      </span>
    );
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

  const getLogIcon = (level: string) => {
    switch (level) {
      case 'success':
        return '✅';
      case 'error':
        return '❌';
      case 'warning':
        return '⚠️';
      case 'thinking':
        return '🤔';
      case 'info':
        return 'ℹ️';
      default:
        return '';
    }
  };

  const showUserActionPrompt = status === 'needs_login' || status === 'waiting_user_resume' || status.startsWith('blocked_');
  const showBlockedState = status.startsWith('blocked_');
  const statusInfo = inlineNotice ?? getBrowserPanelStatusInfo({ isWindowOpen, status });
  const statusToneClass = toneClasses[statusInfo.tone];
  const primaryActionKey = getBrowserPanelPrimaryActionKey(status);
  const taskInputDisabled = isBrowserPanelTaskInputDisabled(status);
  const primaryActionDisabled = !taskInput.trim() || status === 'opening' || status === 'inspecting';
  const primaryButtonClass = showUserActionPrompt
    ? 'bg-amber-600 hover:bg-amber-700'
    : 'bg-green-600 hover:bg-green-700';

  return (
    <div className="h-full flex flex-col bg-gray-50">
      <div className="p-4 border-b border-gray-200 bg-white">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <button
              onClick={handleReturnToChat}
              className="p-1.5 rounded-md bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors"
              title={t('browser.returnToChat')}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </button>
            <h2 className="text-sm font-bold text-gray-800 uppercase tracking-tight">{t('browser.title')}</h2>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowAdvanced((prev) => !prev)}
              className={`px-2.5 py-1 text-[10px] font-medium rounded-full border transition-colors ${
                showAdvanced
                  ? 'border-blue-300 bg-blue-50 text-blue-700'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-blue-300 hover:text-blue-600'
              }`}
            >
              {showAdvanced ? t('browser.hideAdvancedInfo') : t('browser.showAdvancedInfo')}
            </button>
            {showAdvanced && isWindowOpen && getModeBadge()}
            {showAdvanced && isWindowOpen && getAuthStateBadge()}
            {isWindowOpen && (
              <button
                onClick={handleGoBack}
                className="p-1.5 rounded-md bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors"
                title={t('browser.returnToPreviousPage')}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            )}
            {isWindowOpen && <span className="text-xs text-green-500">{t('browser.windowOpened')}</span>}
            <span className={`text-xs font-medium ${getStatusColor()}`}>{getStatusText()}</span>
          </div>
        </div>

        <div className="flex gap-2">
          <input
            type="url"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void handleOpenWindow()}
            placeholder={t('browser.url') + ' (https://www.example.com)'}
            className="flex-1 px-3 py-2 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          {isWindowOpen ? (
            <>
              <button
                onClick={handleExpandToSplit}
                className="px-2 py-2 text-xs font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                title={t('browser.expandToSplit')}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                </svg>
              </button>
              <button
                onClick={handleOpenInWindow}
                className="px-2 py-2 text-xs font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                title={t('browser.openNewWindow')}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </button>
              <button
                onClick={handleCloseBrowser}
                className="px-3 py-2 text-xs font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors"
              >
                {t('browser.close')}
              </button>
            </>
          ) : (
            <button
              onClick={handleOpenWindow}
              disabled={!urlInput.trim()}
              className="px-3 py-2 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {t('browser.openWindow')}
            </button>
          )}
        </div>

        {currentUrl && (
          <div className="mt-2 text-[10px] text-gray-400 truncate flex items-center gap-2">
            <span>{t('browser.currentPage')}</span>
            <span className="text-blue-500">{currentUrl}</span>
          </div>
        )}

        {showAdvanced && (
          <div className="mt-3">
            <div className="mb-1.5 text-[10px] font-medium text-gray-500 uppercase tracking-wide">
              {t('browser.quickSites')}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {QUICK_SITES.map((site) => (
                <button
                  key={site.url}
                  onClick={() => void handleQuickSite(site.url)}
                  className={`px-2 py-1 text-[10px] rounded-md border transition-colors flex items-center gap-1 ${
                    currentUrl === site.url
                      ? 'bg-blue-100 border-blue-300 text-blue-700'
                      : 'bg-white border-gray-200 text-gray-600 hover:border-blue-300 hover:text-blue-600'
                  }`}
                >
                  <span>{site.icon}</span>
                  <span>{site.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}
                  {site.icon} {t(site.nameKey as Parameters<typeof t>[0])}

      <div className="px-4 py-4 border-b border-gray-200 bg-white">
        <div className={`rounded-xl border p-4 ${statusToneClass.container}`}>
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
                {showBlockedState && blockReason && showAdvanced && (
                  <p className="mt-2 text-[11px] text-amber-700">
                    {t('browser.blockReasonDebug')}: {getBlockReasonText(blockReason || undefined)}
                  </p>
                )}
                {error && (
                  <p className="mt-2 text-[11px] text-red-700 break-words">{error}</p>
                )}
              </div>
            </div>
            <span className={`shrink-0 text-[10px] font-medium ${getStatusColor()}`}>{getStatusText()}</span>
          </div>

          {showUserActionPrompt && (
            <div className="mt-3 flex flex-wrap gap-2">
              {status === 'waiting_user_resume' && (
                <button
                  onClick={confirmLoginAndResume}
                  className="px-3 py-1.5 text-xs font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors"
                >
                  {t('browser.iHaveLoggedIn')}
                </button>
              )}
              <button
                onClick={handleInspect}
                className="px-3 py-1.5 text-xs font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 transition-colors"
              >
                {t('browser.continueCheck')}
              </button>
              {showAdvanced && status === 'waiting_user_resume' && (
                <button
                  onClick={forceResumeWithoutAuth}
                  className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
                  title={t('browser.skipVerificationAndContinue')}
                >
                  {t('browser.forceContinue')}
                </button>
              )}
              {showAdvanced && showBlockedState && (
                <button
                  onClick={switchToManualMode}
                  className="px-3 py-1.5 text-xs font-medium text-white bg-gray-700 rounded-lg hover:bg-gray-800 transition-colors"
                >
                  {t('browser.switchToManual')}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="p-4 border-b border-gray-200 bg-white">
        <div className="flex gap-2">
          <input
            type="text"
            value={taskInput}
            onChange={(e) => setTaskInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isWindowOpen ? t('browser.enterTaskInstruction') : t('browser.pleaseOpenBrowserFirst')}
            disabled={taskInputDisabled}
            className="flex-1 px-3 py-2 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed"
          />
          {status === 'running' ? (
            <button
              onClick={stopTask}
              className="px-3 py-2 text-xs font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors"
            >
              {t('browser.stop')}
            </button>
          ) : (
            <button
              onClick={() => void handleExecute()}
              disabled={primaryActionDisabled}
              className={`px-3 py-2 text-xs font-medium text-white rounded-lg transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed ${primaryButtonClass}`}
            >
              {t(primaryActionKey as Parameters<typeof t>[0])}
            </button>
          )}
        </div>
      </div>

      {showAdvanced && isWindowOpen && (
        <>
          <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 space-y-3">
            <div className="rounded-xl border border-gray-200 bg-white p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                  {t('browser.advancedDetails')}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleInspect}
                    className="text-[10px] text-blue-600 hover:text-blue-700"
                  >
                    {t('browser.refreshAndCheck')}
                  </button>
                  {status === 'completed' && (
                    <button
                      onClick={resetToReady}
                      className="text-[10px] text-green-600 hover:text-green-700"
                    >
                      {t('browser.resetStatus')}
                    </button>
                  )}
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-gray-600">
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-gray-400">{t('browser.currentStatus')}</p>
                  <p className="mt-1 break-words">{status}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-gray-400">{t('browser.controlMode')}</p>
                  <p className="mt-1">{mode}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-gray-400">{t('browser.authState')}</p>
                  <div className="mt-1">{getAuthStateBadge()}</div>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-gray-400">{t('browser.blockReasonDebug')}</p>
                  <p className="mt-1 break-words">{blockReason || '-'}</p>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-gray-200 bg-white p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                {t('browser.inspectionDetails')}
              </div>
              {inspection ? (
                <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-gray-600">
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-gray-400">{t('browser.pageTitle')}</p>
                    <p className="mt-1 break-words">{inspection.title || '-'}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-gray-400">{t('browser.siteSafety')}</p>
                    <p className="mt-1">{inspection.safeForAgent ? t('browser.safeForAgent') : t('browser.notSafeForAgent')}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-gray-400">{t('browser.matchedSite')}</p>
                    <p className="mt-1 break-words">{inspection.matchedProfileId || t('browser.unknownSite')}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-gray-400">{t('browser.blockReasonDebug')}</p>
                    <p className="mt-1 break-words">{inspection.blockReason || '-'}</p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-[10px] uppercase tracking-wide text-gray-400">{t('browser.matchedSignals')}</p>
                    <p className="mt-1 break-words">
                      {inspection.matchedSignals.length > 0 ? inspection.matchedSignals.join(', ') : '-'}
                    </p>
                  </div>
                </div>
              ) : (
                <p className="mt-3 text-xs text-gray-500">{t('browser.noInspectionResult')}</p>
              )}
            </div>
          </div>

          <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] text-gray-500 font-medium">{t('browser.quickTasks')}</span>
              <button
                onClick={() => setShowHistory((prev) => !prev)}
                className="text-[10px] text-blue-500 hover:text-blue-600"
              >
                {showHistory ? t('browser.hideHistory') : t('browser.showHistory')}
              </button>
            </div>

            {showHistory && taskHistory.length > 0 ? (
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {taskHistory.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => handleHistoryItem(item)}
                    className="w-full text-left px-2 py-1 text-[10px] bg-white rounded border border-gray-200 hover:border-blue-300 flex items-center justify-between"
                  >
                    <span className="truncate flex-1">
                      <span
                        className="text-gray-400 mr-1"
                        title={item.status === 'completed' ? t('browser.taskCompleted') : item.status === 'failed' ? t('browser.taskFailed') : t('browser.status.running')}
                      >
                        {item.status === 'completed' ? '✅' : item.status === 'failed' ? '❌' : '⏳'}
                      </span>
                      {item.task}
                    </span>
                    <span className="text-gray-400 ml-2 text-[9px]">
                      {item.timestamp.toLocaleTimeString()}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex flex-wrap gap-1">
                {getQuickTasks(currentUrl).map((task, index) => (
                  <button
                    key={index}
                    onClick={() => handleQuickTask(t(task as Parameters<typeof t>[0]))}
                    className="px-2 py-1 text-[10px] bg-white rounded border border-gray-200 text-gray-600 hover:border-green-300 hover:text-green-600 transition-colors"
                  >
                    {t(task as Parameters<typeof t>[0])}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex-1 flex flex-col min-h-0">
            <div className="px-3 py-1.5 bg-gray-100 border-b border-gray-200 flex items-center justify-between">
              <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">{t('browser.executionLog')}</span>
              <button onClick={clearLogs} className="text-[10px] text-gray-400 hover:text-gray-600">
                {t('browser.clear')}
              </button>
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
                      [{log.timestamp}] {getLogIcon(log.level)} {log.message}
                    </p>
                  ))}
                  <div ref={logsEndRef} />
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {!showAdvanced && <div className="flex-1 bg-gray-50" />}
    </div>
  );
};
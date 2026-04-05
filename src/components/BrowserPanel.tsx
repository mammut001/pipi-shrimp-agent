/**
 * BrowserPanel - PageAgent UI for controlling web pages
 *
 * Extended with auth handoff support:
 * - Shows current control mode (manual/agent)
 * - Displays authentication state
 * - Manual login handoff with "I Have Logged In" button
 * - Blocked state handling
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useBrowserAgentStore } from '../store/browserAgentStore';
import { useUIStore } from '../store/uiStore';
import { goBack } from '../utils/browserCommands';
import {
  getAuthStateText,
  getBlockReasonText,
  getRecommendation,
  getAuthStateColor,
  getAuthStateBgColor,
} from '../utils/browserInspection';

/**
 * Quick access website definitions
 */
const QUICK_SITES = [
  { name: 'CBC', url: 'https://www.cbc.ca/news', icon: '📰' },
  { name: 'Google News', url: 'https://news.google.com', icon: '📱' },
  { name: 'Reddit', url: 'https://www.reddit.com', icon: '💬' },
  { name: 'GitHub', url: 'https://github.com', icon: '💻' },
  { name: 'HN', url: 'https://news.ycombinator.com', icon: '🔥' },
  { name: 'Twitter', url: 'https://x.com', icon: '🐦' },
  { name: 'YouTube', url: 'https://www.youtube.com', icon: '▶️' },
  { name: 'WhatsApp', url: 'https://web.whatsapp.com', icon: '💬' },
];

/**
 * Task history item
 */
interface TaskHistoryItem {
  id: string;
  url: string;
  task: string;
  timestamp: Date;
  status: 'pending' | 'completed' | 'failed';
}

/**
 * Quick task suggestions based on current URL
 */
const getQuickTasks = (url: string): string[] => {
  const lowerUrl = url.toLowerCase();

  if (lowerUrl.includes('news') || lowerUrl.includes('cbc') || lowerUrl.includes('bbc')) {
    return [
      '提取头条新闻标题',
      '找出科技/AI相关新闻',
      '列出所有新闻分类',
    ];
  }

  if (lowerUrl.includes('reddit')) {
    return [
      '找出热门帖子',
      '搜索相关讨论',
      '提取评论概要',
    ];
  }

  if (lowerUrl.includes('github')) {
    return [
      '找出热门仓库',
      '搜索开源项目',
      '提取项目信息',
    ];
  }

  if (lowerUrl.includes('youtube')) {
    return [
      '提取视频标题',
      '找出相关推荐',
      '获取视频描述',
    ];
  }

  if (lowerUrl.includes('whatsapp')) {
    return [
      '搜索联系人',
      '发送测试消息',
      '获取最近对话',
    ];
  }

  if (lowerUrl.includes('amazon') || lowerUrl.includes('shopping')) {
    return [
      '搜索产品',
      '提取价格信息',
      '比较产品评价',
    ];
  }

  // Default tasks
  return [
    '提取页面主要内容',
    '找出重要信息',
    '总结页面要点',
  ];
};

export const BrowserPanel: React.FC = () => {
  const [urlInput, setUrlInput] = useState('');
  const [taskInput, setTaskInput] = useState('');
  const [taskHistory, setTaskHistory] = useState<TaskHistoryItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);
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

  // Setup event listeners on mount
  useEffect(() => {
    const setup = async () => {
      cleanupRef.current = await setupEventListeners();
    };
    setup();

    return () => {
      cleanupRef.current?.();
    };
  }, [setupEventListeners]);

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

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
      await openWindow(urlInput.trim());
    }
  }, [urlInput, openWindow]);

  const handleExecute = useCallback(async () => {
    if (!taskInput.trim()) return;

    // Add to history with pending status
    const taskId = crypto.randomUUID();
    const historyItem: TaskHistoryItem = {
      id: taskId,
      url: currentUrl,
      task: taskInput.trim(),
      timestamp: new Date(),
      status: 'pending' as const,
    };
    setTaskHistory((prev) => [historyItem, ...prev].slice(0, 20));
    activeTaskIdRef.current = taskId;

    const taskToRun = taskInput.trim();
    setTaskInput('');

    try {
      await executeTask(taskToRun);
    } catch {
      setTaskHistory((prev) =>
        prev.map((item) => (item.id === taskId ? { ...item, status: 'failed' as const } : item))
      );
      activeTaskIdRef.current = null;
    }
  }, [taskInput, currentUrl, executeTask]);

  const handleQuickSite = useCallback(async (url: string) => {
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
    // Use dock actions instead of route changes
    const { focusChatPane, browserDockMode } = useUIStore.getState();

    // If browser is not in a visible mode, close the dock
    if (browserDockMode === 'hidden') {
      return;
    }

    // Focus the chat pane (works in split and external modes)
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
    // Use dock action to close browser
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
    } catch (error) {
      console.error('Failed to go back:', error);
    }
  }, []);

  const handleInspect = useCallback(async () => {
    await inspectCurrentPage();
  }, [inspectCurrentPage]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleExecute();
    }
  }, [handleExecute]);

  // Get status display
  const getStatusColor = () => {
    switch (status) {
      case 'running': return 'text-blue-500';
      case 'completed': return 'text-green-500';
      case 'error': return 'text-red-500';
      case 'needs_login':
      case 'waiting_user_resume':
        return 'text-yellow-500';
      case 'blocked_auth':
      case 'blocked_captcha':
      case 'blocked_manual_step':
        return 'text-orange-500';
      case 'ready_for_agent':
        return 'text-green-500';
      default: return 'text-gray-500';
    }
  };

  const getStatusText = () => {
    switch (status) {
      case 'uninitialized': return '未初始化';
      case 'opening': return '正在打开';
      case 'idle': return '空闲';
      case 'inspecting': return '检查中';
      case 'needs_login': return '需要登录';
      case 'waiting_user_resume': return '等待确认';
      case 'ready_for_agent': return '可执行任务';
      case 'running': return '执行中';
      case 'blocked_auth': return '认证被阻止';
      case 'blocked_captcha': return '需要验证码';
      case 'blocked_manual_step': return '需要手动确认';
      case 'completed': return '已完成';
      case 'error': return '错误';
      default: return '未知';
    }
  };

  // Get control mode display
  const getModeBadge = () => {
    if (mode === 'manual_handoff') {
      return (
        <span className="px-2 py-0.5 text-[10px] font-medium bg-yellow-100 text-yellow-700 rounded-full">
          手动控制
        </span>
      );
    }
    return (
      <span className="px-2 py-0.5 text-[10px] font-medium bg-green-100 text-green-700 rounded-full">
        Agent 控制
      </span>
    );
  };

  // Get auth state display
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
      case 'success': return 'text-green-400';
      case 'error': return 'text-red-400';
      case 'warning': return 'text-yellow-400';
      case 'thinking': return 'text-yellow-400';
      case 'info': return 'text-blue-400';
      default: return 'text-gray-300';
    }
  };

  const getLogIcon = (level: string) => {
    switch (level) {
      case 'success': return '✅';
      case 'error': return '❌';
      case 'warning': return '⚠️';
      case 'thinking': return '🤔';
      case 'info': return 'ℹ️';
      default: return '';
    }
  };

  // Check if should show login prompt
  const showLoginPrompt = status === 'waiting_user_resume';
  const showBlockedState = status.startsWith('blocked_');
  // Execution is ONLY allowed when explicitly ready_for_agent
  const canExecute = status === 'ready_for_agent';

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* Header */}
      <div className="p-4 border-b border-gray-200 bg-white">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <button
              onClick={handleReturnToChat}
              className="p-1.5 rounded-md bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors"
              title="返回聊天"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </button>
            <h2 className="text-sm font-bold text-gray-800 uppercase tracking-tight">浏览器控制</h2>
          </div>
          <div className="flex items-center gap-2">
            {/* Control Mode Badge */}
            {isWindowOpen && getModeBadge()}
            {/* Auth State Badge */}
            {isWindowOpen && getAuthStateBadge()}
            {isWindowOpen && (
              <button
                onClick={handleGoBack}
                className="p-1.5 rounded-md bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors"
                title="返回上一页"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            )}
            {isWindowOpen && (
              <span className="text-xs text-green-500">
                ● 窗口已打开
              </span>
            )}
            <span className={`text-xs font-medium ${getStatusColor()}`}>
              {getStatusText()}
            </span>
          </div>
        </div>

        {/* URL Input Row */}
        <div className="flex gap-2">
          <input
            type="url"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleOpenWindow()}
            placeholder="输入网址 (例如: https://www.example.com)"
            className="flex-1 px-3 py-2 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          {isWindowOpen ? (
            <>
              {/* Expand to Split */}
              <button
                onClick={handleExpandToSplit}
                className="px-2 py-2 text-xs font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                title="展开到分屏"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                </svg>
              </button>
              {/* Open in Window */}
              <button
                onClick={handleOpenInWindow}
                className="px-2 py-2 text-xs font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                title="打开新窗口"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </button>
              {/* Close */}
              <button
                onClick={handleCloseBrowser}
                className="px-3 py-2 text-xs font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors"
              >
                关闭
              </button>
            </>
          ) : (
            <button
              onClick={handleOpenWindow}
              disabled={!urlInput.trim()}
              className="px-3 py-2 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              打开窗口
            </button>
          )}
        </div>

        {currentUrl && (
          <div className="mt-2 text-[10px] text-gray-400 truncate flex items-center gap-2">
            <span>当前页面:</span>
            <span className="text-blue-500">{currentUrl}</span>
          </div>
        )}

        {/* Quick Site Buttons */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {QUICK_SITES.map((site) => (
            <button
              key={site.url}
              onClick={() => handleQuickSite(site.url)}
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

      {/* Login / Blocked State Banner */}
      {showLoginPrompt && (
        <div className="px-4 py-3 bg-yellow-50 border-b border-yellow-200">
          <div className="flex items-start gap-2">
            <span className="text-lg">🔐</span>
            <div className="flex-1">
              <p className="text-xs font-medium text-yellow-800">
                {getRecommendation(inspection || { authState, safeForAgent: false } as any)}
              </p>
              <p className="text-[10px] text-yellow-600 mt-1">
                请在浏览器窗口中完成登录后，点击下方按钮验证登录状态
              </p>
              <div className="mt-2 flex gap-2 flex-wrap">
                <button
                  onClick={inspectCurrentPage}
                  className="px-3 py-1.5 text-xs font-medium text-white bg-yellow-600 rounded-lg hover:bg-yellow-700 transition-colors"
                >
                  刷新检查
                </button>
                <button
                  onClick={confirmLoginAndResume}
                  className="px-3 py-1.5 text-xs font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors"
                >
                  我已登录
                </button>
                <button
                  onClick={forceResumeWithoutAuth}
                  className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
                  title="跳过验证，直接继续执行"
                >
                  强制继续
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Blocked State Banner */}
      {showBlockedState && (
        <div className="px-4 py-3 bg-orange-50 border-b border-orange-200">
          <div className="flex items-start gap-2">
            <span className="text-lg">⚠️</span>
            <div className="flex-1">
              <p className="text-xs font-medium text-orange-800">
                操作被阻止: {getBlockReasonText(blockReason || undefined)}
              </p>
              <p className="text-[10px] text-orange-600 mt-1">
                请在浏览器窗口中完成必要的操作，然后重试。
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={inspectCurrentPage}
                  className="px-3 py-1.5 text-xs font-medium text-white bg-orange-600 rounded-lg hover:bg-orange-700 transition-colors"
                >
                  重新检查
                </button>
                <button
                  onClick={switchToManualMode}
                  className="px-3 py-1.5 text-xs font-medium text-white bg-gray-600 rounded-lg hover:bg-gray-700 transition-colors"
                >
                  手动控制
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Ready for Agent Banner */}
      {status === 'ready_for_agent' && (
        <div className="px-4 py-2 bg-green-50 border-b border-green-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-green-500">✓</span>
            <span className="text-xs text-green-700">页面已就绪，可以执行自动化任务</span>
          </div>
          <button
            onClick={switchToManualMode}
            className="text-[10px] text-green-600 hover:text-green-700"
          >
            切换到手动
          </button>
        </div>
      )}

      {/* Inspect Button Row */}
      {isWindowOpen && !showLoginPrompt && !showBlockedState && (
        <div className="px-4 py-2 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
          <button
            onClick={handleInspect}
            className="text-[10px] text-blue-500 hover:text-blue-600 flex items-center gap-1"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            检查页面状态
          </button>
          {inspection && (
            <span className="text-[10px] text-gray-500">
              匹配站点: {inspection.matchedProfileId || '未知'}
            </span>
          )}
        </div>
      )}

      {/* Quick Task Suggestions */}
      {isWindowOpen && (
        <div className="px-4 py-2 bg-gray-50 border-b border-gray-200">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] text-gray-500 font-medium">快捷任务</span>
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="text-[10px] text-blue-500 hover:text-blue-600"
            >
              {showHistory ? '隐藏历史' : '查看历史'}
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
                    <span className="text-gray-400 mr-1">
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
                  onClick={() => handleQuickTask(task)}
                  className="px-2 py-1 text-[10px] bg-white rounded border border-gray-200 text-gray-600 hover:border-green-300 hover:text-green-600 transition-colors"
                >
                  {task}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Task Input */}
      <div className="p-3 border-b border-gray-200 bg-white">
        <div className="flex gap-2">
          <input
            type="text"
            value={taskInput}
            onChange={(e) => setTaskInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isWindowOpen ? "输入任务指令 (例如: 点击登录按钮)" : "请先打开浏览器窗口"}
            disabled={status === 'running' || !isWindowOpen || showLoginPrompt}
            className="flex-1 px-3 py-2 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed"
          />
          {status === 'running' ? (
            <button
              onClick={stopTask}
              className="px-3 py-2 text-xs font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors"
            >
              停止
            </button>
          ) : status === 'completed' ? (
            <button
              onClick={resetToReady}
              className="px-3 py-2 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
            >
              重置状态
            </button>
          ) : (
            <button
              onClick={handleExecute}
              disabled={!taskInput.trim() || !isWindowOpen || showLoginPrompt || !canExecute}
              className="px-3 py-2 text-xs font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              执行
            </button>
          )}
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="px-3 py-2 bg-red-50 border-b border-red-200">
          <p className="text-xs text-red-600">{error}</p>
        </div>
      )}

      {/* Logs Panel — fills remaining space */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="px-3 py-1.5 bg-gray-100 border-b border-gray-200 flex items-center justify-between">
          <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">执行日志</span>
          <button onClick={clearLogs} className="text-[10px] text-gray-400 hover:text-gray-600">
            清空
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 bg-gray-900">
          {logs.length === 0 ? (
            <p className="text-xs text-gray-600">等待任务执行...</p>
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
    </div>
  );
};

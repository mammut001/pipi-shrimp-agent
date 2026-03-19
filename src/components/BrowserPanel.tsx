/**
 * BrowserPanel - PageAgent UI for controlling web pages
 *
 * Uses the second WebviewWindow approach:
 * - Browser window opens separately via Tauri commands
 * - Task execution happens in the browser window
 * - Events are emitted back to this panel for display
 */

import React, { useEffect, useRef, useState } from 'react';
import { useBrowserAgentStore } from '../store/browserAgentStore';
import { useUIStore } from '../store/uiStore';
import { goBack } from '../utils/browserCommands';

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
  { name: 'Wikipedia', url: 'https://www.wikipedia.org', icon: '📖' },
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

  const {
    status,
    isWindowOpen,
    logs,
    currentUrl,
    error,
    openWindow,
    closeWindow,
    executeTask,
    stopTask,
    clearLogs,
    setupEventListeners,
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

  const handleOpenWindow = async () => {
    if (urlInput.trim()) {
      await openWindow(urlInput.trim());
    }
  };

  const handleExecute = async () => {
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
    setTaskHistory((prev) => [historyItem, ...prev].slice(0, 20)); // Keep last 20

    const taskToRun = taskInput.trim();
    setTaskInput('');

    try {
      await executeTask(taskToRun);
      // Update history with final status based on store status
      setTaskHistory((prev) =>
        prev.map((item) =>
          item.id === taskId
            ? { ...item, status: useBrowserAgentStore.getState().status === 'error' ? 'failed' : 'completed' }
            : item
        )
      );
    } catch {
      setTaskHistory((prev) =>
        prev.map((item) => (item.id === taskId ? { ...item, status: 'failed' as const } : item))
      );
    }
  };

  const handleQuickSite = async (url: string) => {
    setUrlInput(url);
    await openWindow(url);
  };

  const handleQuickTask = (task: string) => {
    setTaskInput(task);
  };

  const handleHistoryItem = (item: TaskHistoryItem) => {
    setUrlInput(item.url);
    setTaskInput(item.task);
  };

  const handleReturnToChat = async () => {
    const { setCurrentView } = useUIStore.getState();
    await closeWindow();
    setCurrentView('chat');
  };

  const handleGoBack = async () => {
    try {
      await goBack();
      // Update current URL after navigation
      setTimeout(async () => {
        const { getBrowserUrl } = await import('../utils/browserCommands');
        const url = await getBrowserUrl();
        useBrowserAgentStore.setState({ currentUrl: url });
      }, 500);
    } catch (error) {
      console.error('Failed to go back:', error);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleExecute();
    }
  };

  const getStatusColor = () => {
    switch (status) {
      case 'running': return 'text-blue-500';
      case 'completed': return 'text-green-500';
      case 'error': return 'text-red-500';
      default: return 'text-gray-500';
    }
  };

  const getStatusText = () => {
    switch (status) {
      case 'uninitialized': return '未初始化';
      case 'idle': return '空闲';
      case 'running': return '执行中';
      case 'completed': return '已完成';
      case 'error': return '错误';
      default: return '未知';
    }
  };

  const getLogColor = (level: string) => {
    switch (level) {
      case 'success': return 'text-green-400';
      case 'error': return 'text-red-400';
      case 'thinking': return 'text-yellow-400';
      case 'info': return 'text-blue-400';
      default: return 'text-gray-300';
    }
  };

  const getLogIcon = (level: string) => {
    switch (level) {
      case 'success': return '✅';
      case 'error': return '❌';
      case 'thinking': return '🤔';
      case 'info': return 'ℹ️';
      default: return '';
    }
  };

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
            <button
              onClick={closeWindow}
              className="px-3 py-2 text-xs font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors"
            >
              关闭
            </button>
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
            disabled={status === 'running' || !isWindowOpen}
            className="flex-1 px-3 py-2 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed"
          />
          {status === 'running' ? (
            <button
              onClick={stopTask}
              className="px-3 py-2 text-xs font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors"
            >
              停止
            </button>
          ) : (
            <button
              onClick={handleExecute}
              disabled={!taskInput.trim() || !isWindowOpen}
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

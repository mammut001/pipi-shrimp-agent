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

export const BrowserPanel: React.FC = () => {
  const [urlInput, setUrlInput] = useState('');
  const [taskInput, setTaskInput] = useState('');
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
    await executeTask(taskInput.trim());
    setTaskInput('');
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
          <h2 className="text-sm font-bold text-gray-800 uppercase tracking-tight">浏览器控制</h2>
          <div className="flex items-center gap-2">
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
      </div>

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

      {/* Info Panel - Explains the architecture */}
      <div className="flex-1 border-b border-gray-200 bg-white overflow-hidden min-h-0 p-4">
        {!isWindowOpen ? (
          <div className="h-full flex flex-col items-center justify-center text-gray-400">
            <svg className="w-16 h-16 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
            </svg>
            <p className="text-sm font-medium mb-2">浏览器窗口已关闭</p>
            <p className="text-xs">在上方输入网址并点击"打开窗口"开始</p>
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-gray-400">
            <svg className="w-12 h-12 mb-3 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-sm font-medium text-gray-600 mb-1">浏览器窗口已打开</p>
            <p className="text-xs">任务将在独立的浏览器窗口中执行</p>
            <p className="text-xs text-gray-400 mt-2">查看窗口日志了解执行进度</p>
          </div>
        )}
      </div>

      {/* Error Display */}
      {error && (
        <div className="px-3 py-2 bg-red-50 border-b border-red-200">
          <p className="text-xs text-red-600">{error}</p>
        </div>
      )}

      {/* Logs Panel */}
      <div className="h-40 flex flex-col">
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

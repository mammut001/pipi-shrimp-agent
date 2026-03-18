/**
 * BrowserPanel - PageAgent UI for controlling web pages
 * Provides URL input, task input, iframe view, and execution logs
 */

import React, { useEffect, useRef, useState } from 'react';
import { useBrowserAgentStore } from '../store/browserAgentStore';

export const BrowserPanel: React.FC = () => {
  const [urlInput, setUrlInput] = useState('');
  const [taskInput, setTaskInput] = useState('');
  const logsEndRef = useRef<HTMLDivElement>(null);

  const {
    status,
    logs,
    currentUrl,
    error,
    initializeAgent,
    executeTask,
    stopTask,
    setUrl,
    clearLogs,
  } = useBrowserAgentStore();

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // Initialize agent on mount
  useEffect(() => {
    initializeAgent();
  }, []);

  const handleNavigate = () => {
    if (urlInput.trim()) {
      setUrl(urlInput.trim());
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

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* Header */}
      <div className="p-4 border-b border-gray-200 bg-white">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-gray-800 uppercase tracking-tight">浏览器控制</h2>
          <span className={`text-xs font-medium ${getStatusColor()}`}>
            {getStatusText()}
          </span>
        </div>

        {/* URL Input */}
        <div className="flex gap-2">
          <input
            type="url"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleNavigate()}
            placeholder="输入网址 (例如: https://www.example.com)"
            className="flex-1 px-3 py-2 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <button
            onClick={handleNavigate}
            className="px-3 py-2 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
          >
            打开
          </button>
        </div>

        {currentUrl && (
          <div className="mt-2 text-[10px] text-gray-400 truncate">
            {currentUrl}
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
            placeholder="输入任务指令 (例如: 点击登录按钮)"
            disabled={status === 'running'}
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
              disabled={!taskInput.trim()}
              className="px-3 py-2 text-xs font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              执行
            </button>
          )}
        </div>
      </div>

      {/* WebView iframe */}
      <div className="flex-1 border-b border-gray-200 bg-white overflow-hidden min-h-0">
        <iframe
          id="browser-webview"
          src={currentUrl || 'about:blank'}
          style={{ width: '100%', height: '100%', border: 'none' }}
          title="Browser Preview"
          sandbox="allow-scripts allow-same-origin allow-forms"
        />
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
                  className={`text-[10px] font-mono leading-relaxed ${
                    log.includes('❌') ? 'text-red-400' :
                    log.includes('✅') ? 'text-green-400' :
                    log.includes('🤔') ? 'text-yellow-400' :
                    log.includes('🔧') ? 'text-blue-400' :
                    'text-gray-300'
                  }`}
                >
                  {log}
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
